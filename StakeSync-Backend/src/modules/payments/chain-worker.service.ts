import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { randomInt } from 'node:crypto';
import { In, IsNull, Repository } from 'typeorm';
import { Events, type ChallengeEvent, type MoneyEvent, type ParticipantEvent } from '../../common/events.js';
import { toUsd } from '../../common/money.js';
import { Challenge, Participant } from '../challenges/entities/challenge.entities.js';
import { settleAfter } from '../challenges/schedule.js';
import { Dispute } from '../disputes/entities/dispute.entity.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { Verification } from '../verification/entities/verification.entities.js';
import { VerificationService } from '../verification/verification.service.js';
import { LedgerEntry, SponsorContribution } from './entities/payment.entities.js';
import { programErrorCode, SolanaService, type Outcome } from './solana/solana.service.js';
import { errMsg } from '../../common/errors.js';

const HOUR = 3600_000;
/** Misses wait this long before going on-chain, so an outage declared soon after can still protect them. */
const MISS_HOLD = 6 * HOUR;
const BATCH = 6;
const ERR = { AlreadyRecorded: 6014, PeriodProtected: 6015, PeriodNotOver: 6013, NotOpen: 6006, AlreadySettled: 6024, NotDisputed: 6021 };

/**
 * Everything the backend does on Solana on its own: creating escrows, writing verification results
 * with the verifier key, resolving disputes, cancelling, and cranking settlement (PRD §17, §27).
 */
@Injectable()
export class ChainWorkerService {
  private readonly log = new Logger('ChainWorker');
  private readonly enabled: boolean;
  private busy = new Set<string>();

  constructor(
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    @InjectRepository(Verification) private readonly verifications: Repository<Verification>,
    @InjectRepository(Dispute) private readonly disputes: Repository<Dispute>,
    @InjectRepository(LedgerEntry) private readonly ledger: Repository<LedgerEntry>,
    @InjectRepository(SponsorContribution) private readonly sponsors: Repository<SponsorContribution>,
    private readonly solana: SolanaService,
    private readonly verification: VerificationService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('solana.workersEnabled') !== false;
  }

  /** One run of each job at a time. */
  private async once(name: string, fn: () => Promise<void>) {
    if (!this.enabled || !this.solana.ready || this.busy.has(name)) return;
    this.busy.add(name);
    try {
      await fn();
    } catch (e) {
      this.log.error(`${name} failed`, e instanceof Error ? e.stack : e);
    } finally {
      this.busy.delete(name);
    }
  }

  // ---------- escrow creation ----------

  @OnEvent('challenge.needs_chain', { async: true })
  onNeedsChain() {
    return this.createPending();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  createPending() {
    return this.once('create', async () => {
      const list = await this.challenges.findBy({ status: 'pending_chain' });
      for (const c of list) {
        if (c.startsAt.getTime() < Date.now() + 10 * 60_000) continue; // lifecycle expires it
        const id = c.chainId ?? BigInt(Date.now()) * 1000n + BigInt(randomInt(1000));
        if (!c.chainId) await this.challenges.update({ id: c.id }, { chainId: id });
        const creator = this.solana.platform!.publicKey;
        const pda = this.solana.pdas.challenge(creator, id);
        try {
          // Idempotent: a previous attempt may have landed.
          const existing = await this.solana.fetchChallenge(pda);
          let sig = c.createSig;
          if (!existing) {
            const ix = await this.solana.createChallengeIx(id, {
              rulesHash: Buffer.from(c.rulesHash, 'hex'),
              stakeMin: c.stakeMin,
              stakeMax: c.stakeMax,
              startTs: Math.floor(c.startsAt.getTime() / 1000),
              periodSecs: c.periodSecs,
              periodCount: c.periodCount,
              requiredPeriods: c.requiredPeriods,
              joinDeadline: Math.floor(c.joinBy.getTime() / 1000) - 1,
              disputeWindowSecs: c.disputeWindowSecs,
              freeStrikes: c.freeStrikes,
              penaltyBps: [c.penaltiesBps[0] ?? 0, c.penaltiesBps[1] ?? 0, c.penaltiesBps[2] ?? 0],
              freezePeriods: c.freezePeriods,
              maxParticipants: c.participantLimit ?? 0,
              forfeitsToFinishers: c.forfeitsToFinishers,
            });
            sig = await this.solana.send([ix]);
          }
          const onChain = await this.solana.fetchChallenge(pda);
          await this.challenges.update(
            { id: c.id, status: 'pending_chain' },
            {
              status: 'open',
              challengePda: pda.toBase58(),
              vaultPda: this.solana.pdas.vault(pda).toBase58(),
              createSig: sig,
              // The program's copy of the fees is what applies; keep ours identical.
              feeBps: onChain?.feeBps ?? c.feeBps,
              joinFeeBps: onChain?.joinFeeBps ?? c.joinFeeBps,
            },
          );
          this.events.emit(Events.ChallengeCreated, { challengeId: c.id } satisfies ChallengeEvent);
        } catch (e) {
          this.log.warn(`Creating escrow for ${c.slug} failed: ${errMsg(e)}`);
        }
      }
    });
  }

  // ---------- verification results ----------

  @Cron(CronExpression.EVERY_MINUTE)
  recordResults() {
    return this.once('record', async () => {
      if (!this.solana.verifier) return;
      const rows = await this.verifications.find({ where: { chainStatus: 'queued' }, order: { decidedAt: 'ASC' }, take: 120 });
      if (!rows.length) return;
      const challenges = await this.challenges.findBy({ id: In([...new Set(rows.map((r) => r.challengeId))]) });
      const parts = await this.participants.findBy({ id: In([...new Set(rows.map((r) => r.participantId))]) });
      const now = Date.now();
      const ready = rows.filter((r) => {
        const c = challenges.find((x) => x.id === r.challengeId)!;
        if (!c.challengePda) return false;
        if (r.chainOutcome !== 'missed') return true;
        const hold = now > settleAfter(c).getTime() - 8 * HOUR ? 0 : MISS_HOLD;
        return now - (r.decidedAt?.getTime() ?? now) >= hold;
      });
      for (const c of challenges) {
        const mine = ready.filter((r) => r.challengeId === c.id);
        for (let i = 0; i < mine.length; i += BATCH) {
          const batch = mine.slice(i, i + BATCH);
          const ixs = await Promise.all(
            batch.map((r) => this.solana.recordPeriodIx(new PublicKey(c.challengePda!), new PublicKey(parts.find((p) => p.id === r.participantId)!.wallet!), r.period, r.chainOutcome as Outcome)),
          );
          await this.verifications.update({ id: In(batch.map((r) => r.id)) }, { chainStatus: 'sent' });
          try {
            const sig = await this.solana.send(ixs, [this.solana.verifier]);
            await this.verifications.update({ id: In(batch.map((r) => r.id)) }, { chainStatus: 'confirmed', chainSig: sig, chainError: null });
          } catch {
            // One bad entry fails the whole transaction: retry each on its own.
            for (const [j, r] of batch.entries()) await this.recordOne(c, parts.find((p) => p.id === r.participantId)!, r, ixs[j]);
          }
        }
      }
    });
  }

  private async recordOne(c: Challenge, p: Participant, r: Verification, ix: TransactionInstruction) {
    try {
      const sig = await this.solana.send([ix], [this.solana.verifier!]);
      await this.verifications.update({ id: r.id }, { chainStatus: 'confirmed', chainSig: sig, chainError: null });
    } catch (e) {
      const code = programErrorCode(e);
      const chainP = await this.solana.fetchParticipant(new PublicKey(c.challengePda!), new PublicKey(p.wallet!)).catch(() => null);
      if (code === ERR.AlreadyRecorded && chainP) {
        await this.verifications.update({ id: r.id }, { chainStatus: 'confirmed', chainError: 'already on chain' });
      } else if (code === ERR.PeriodProtected) {
        // The chain already protects this day (excused or frozen): match it.
        await this.verifications.update({ id: r.id }, { state: 'excused', chainOutcome: 'excused', chainStatus: 'confirmed', chainError: 'protected on chain' });
        await this.verification.recount(p.id);
      } else if (code === ERR.PeriodNotOver) {
        await this.verifications.update({ id: r.id }, { chainStatus: 'queued' });
      } else {
        const msg = e instanceof Error ? e.message.slice(0, 250) : 'unknown';
        await this.verifications.update({ id: r.id }, { chainStatus: code === ERR.NotOpen ? 'failed' : 'queued', chainError: msg });
        this.log.warn(`record ${r.id} failed: ${msg}`);
      }
    }
  }

  // ---------- disputes ----------

  @Cron(CronExpression.EVERY_MINUTE)
  resolveDisputes() {
    return this.once('disputes', async () => {
      if (!this.solana.verifier) return;
      const list = await this.disputes.findBy({ chainResolveStatus: 'queued' });
      for (const d of list) {
        const c = await this.challenges.findOneByOrFail({ id: d.challengeId });
        const p = await this.participants.findOneByOrFail({ id: d.participantId });
        try {
          const ix = await this.solana.resolveDisputeIx(new PublicKey(c.challengePda!), new PublicKey(p.wallet!), d.period, d.status === 'approved');
          const sig = await this.solana.send([ix], [this.solana.verifier]);
          await this.disputes.update({ id: d.id }, { chainResolveStatus: 'confirmed', chainResolveSig: sig });
        } catch (e) {
          if (programErrorCode(e) === ERR.NotDisputed) {
            await this.disputes.update({ id: d.id }, { chainResolveStatus: 'confirmed' });
          } else {
            this.log.warn(`resolve dispute ${d.id} failed: ${errMsg(e)}`);
          }
        }
      }
    });
  }

  // ---------- cancellation and refunds ----------

  @OnEvent(Events.ChallengeCancelled, { async: true })
  async onCancelled(e: ChallengeEvent & { onChain?: boolean }) {
    if (e.onChain) await this.cancelOnChain(e.challengeId);
  }

  /** An edited challenge's old escrow: cancel it so nobody can join under the old rules. */
  @OnEvent('challenge.escrow_replaced', { async: true })
  async onEscrowReplaced(e: { challengeId: string; oldEscrow: string }) {
    const pda = new PublicKey(e.oldEscrow);
    try {
      const chain = await this.solana.fetchChallenge(pda);
      if (chain?.status.open) await this.solana.send([await this.solana.cancelIx(pda)]);
    } catch (err) {
      this.log.warn(`cancelling replaced escrow ${e.oldEscrow} failed: ${errMsg(err)}`);
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  retryCancellations() {
    return this.once('cancel', async () => {
      const list = await this.challenges.find({ where: { status: 'cancelled', settledAt: IsNull() } });
      for (const c of list) if (c.challengePda) await this.cancelOnChain(c.id);
    });
  }

  private async cancelOnChain(challengeId: string) {
    const c = await this.challenges.findOneByOrFail({ id: challengeId });
    if (!c.challengePda) return;
    const pda = new PublicKey(c.challengePda);
    const chain = await this.solana.fetchChallenge(pda);
    if (chain?.status.open) {
      try {
        await this.solana.send([await this.solana.cancelIx(pda)]);
      } catch (e) {
        this.log.warn(`cancel ${c.slug} failed: ${errMsg(e)}`);
        return;
      }
    }
    // Everyone collects a full refund with one signature from their wallet.
    const ps = await this.participants.findBy({ challengeId: c.id, status: In(['active', 'pending']) });
    for (const p of ps) {
      if (p.stake === 0n && p.joinFee === 0n) await this.participants.update({ id: p.id }, { status: 'refunded', claimed: true });
      else await this.participants.update({ id: p.id }, { claimable: p.stake + p.joinFee });
    }
    for (const s of await this.sponsors.findBy({ challengeId: c.id, status: 'confirmed', reclaimed: false })) await this.notifyReclaim(c, s);
    await this.challenges.update({ id: c.id }, { settledAt: new Date() });
  }

  // ---------- settlement ----------

  @Cron(CronExpression.EVERY_5_MINUTES)
  settle() {
    return this.once('settle', async () => {
      const list = await this.challenges.findBy({ status: 'settling', onChain: true });
      for (const c of list) {
        if (Date.now() < settleAfter(c).getTime()) continue;
        if (await this.disputes.existsBy({ challengeId: c.id, status: In(['new', 'in_review', 'waiting_on_user']) })) continue;
        if (await this.verifications.existsBy({ challengeId: c.id, chainStatus: In(['queued', 'sent']) })) continue;
        if (await this.verifications.existsBy({ challengeId: c.id, state: In(['pending', 'unavailable']) })) continue;
        if (!(await this.verification.isComplete(c))) continue; // unchecked periods would count as passes
        await this.settleChallenge(c).catch((e) => this.log.error(`settle ${c.slug}`, e instanceof Error ? e.stack : e));
      }
    });
  }

  private async settleChallenge(c: Challenge) {
    const pda = new PublicKey(c.challengePda!);
    let chain = await this.solana.fetchChallenge(pda);
    if (!chain) return;
    if (chain.openDisputes > 0) return;
    if (chain.status.open) {
      const ps = await this.participants.findBy({ challengeId: c.id, status: In(['active', 'failed']), settled: false });
      const unsettled: Participant[] = [];
      for (const p of ps) {
        const cp = await this.solana.fetchParticipant(pda, new PublicKey(p.wallet!));
        if (cp && !cp.settled) unsettled.push(p);
      }
      for (let i = 0; i < unsettled.length; i += BATCH) {
        const ixs = await Promise.all(unsettled.slice(i, i + BATCH).map((p) => this.solana.settleParticipantIx(pda, new PublicKey(p.wallet!))));
        try {
          await this.solana.send(ixs);
        } catch (e) {
          if (programErrorCode(e) !== ERR.AlreadySettled) throw e;
        }
      }
      chain = (await this.solana.fetchChallenge(pda))!;
      if (chain.settledCount < chain.participantCount) return; // someone not in our DB; next tick
      await this.solana.send(await this.solana.finalizeIxs(pda));
    }
    await this.finalizeLocal(c);
  }

  /** Copies the program's final numbers into the database. */
  private async finalizeLocal(c: Challenge) {
    const fresh = await this.challenges.findOneByOrFail({ id: c.id });
    if (fresh.status === 'ended') return;
    const pda = new PublicKey(c.challengePda!);
    const chain = (await this.solana.fetchChallenge(pda))!;
    if (!chain.status.settled) return;
    const reward = BigInt(chain.rewardPerFinisher.toString());
    const ps = await this.participants.findBy({ challengeId: c.id, status: In(['active', 'failed']), settled: false });
    for (const p of ps) {
      const cp = await this.solana.fetchParticipant(pda, new PublicKey(p.wallet!));
      if (!cp) continue;
      const pen = BigInt(cp.penalty.toString());
      const claimable = cp.completed ? p.stake - pen + reward : 0n;
      await this.participants.update({ id: p.id }, { settled: true, completed: cp.completed, penalty: pen, claimable, status: cp.completed ? 'completed' : 'failed' });
      this.events.emit(Events.ParticipantSettled, { participantId: p.id, challengeId: c.id, userId: p.userId } satisfies ParticipantEvent);
    }
    await this.challenges.update(
      { id: c.id },
      {
        status: 'ended',
        settledAt: new Date(),
        rewardPerFinisher: reward,
        finisherCount: chain.finisherCount,
        // What the program sent to the treasury, for the admin Treasury page.
        platformRevenue: BigInt(chain.treasuryAmount.toString()),
        platformJoinFees: BigInt(chain.joinFees.toString()),
      },
    );
    this.events.emit(Events.ChallengeFinalized, { challengeId: c.id } satisfies ChallengeEvent);

    // Finishers claim with one signature (notified by the finalize listener). If nobody finished,
    // sponsors can take their money back.
    if (chain.finisherCount === 0) {
      for (const s of await this.sponsors.findBy({ challengeId: c.id, status: 'confirmed', reclaimed: false })) await this.notifyReclaim(c, s);
    }
  }

  private notifyReclaim(c: Challenge, s: SponsorContribution) {
    return this.notifications.notify(s.sponsorUserId, {
      kind: 'reward',
      title: `Your $${toUsd(s.amount)} sponsorship can come back`,
      body: c.status === 'cancelled' ? `${c.title} was cancelled, so you can take your sponsorship back.` : `Nobody finished ${c.title}, so you can take your sponsorship back.`,
      href: '/wallet',
      dedupeKey: `reclaim:${s.id}`,
      email: true,
    });
  }

  /** Ledger and state for a claim/refund, from the app's confirmation or the indexer. Idempotent. */
  async recordWithdrawal(kind: 'claim' | 'refund', c: Challenge, p: Participant, sig: string | null) {
    const res = await this.participants.update({ id: p.id, claimed: false }, { claimed: true, claimSig: sig, ...(kind === 'refund' ? { status: 'refunded' } : {}) });
    if (!res.affected) return;
    const entries =
      kind === 'refund'
        ? [{ kind: 'refund' as const, amount: p.stake + p.joinFee, ref: `refund:${p.id}` }]
        : [
            { kind: 'stake_returned' as const, amount: p.stake - p.penalty, ref: `return:${p.id}` },
            { kind: 'reward_claimed' as const, amount: (c.rewardPerFinisher ?? 0n), ref: `reward:${p.id}` },
          ].filter((x) => x.amount > 0n);
    for (const e of entries) {
      await this.ledger.createQueryBuilder().insert().values({ userId: p.userId, challengeId: c.id, kind: e.kind, amount: e.amount, signature: sig, status: 'confirmed', ref: e.ref }).orIgnore().execute();
    }
    const total = entries.reduce((s, e) => s + e.amount, 0n);
    this.events.emit(Events.Claimed, { userId: p.userId, challengeId: c.id, amount: total, signature: sig ?? undefined } satisfies MoneyEvent);
  }

  async recordReclaim(c: Challenge, s: SponsorContribution, sig: string | null) {
    const res = await this.sponsors.update({ id: s.id, reclaimed: false }, { reclaimed: true });
    if (!res.affected) return;
    await this.ledger
      .createQueryBuilder()
      .insert()
      .values({ userId: s.sponsorUserId, challengeId: c.id, kind: 'sponsorship_reclaimed', amount: s.amount, signature: sig, status: 'confirmed', ref: `reclaim:${s.id}` })
      .orIgnore()
      .execute();
  }
}
