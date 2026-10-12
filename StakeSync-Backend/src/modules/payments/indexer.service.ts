import { BorshCoder, EventParser } from '@anchor-lang/core';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { PublicKey } from '@solana/web3.js';
import { Repository } from 'typeorm';
import { Events, type MoneyEvent } from '../../common/events.js';
import { SettingsService } from '../../core/settings.service.js';
import { Challenge, Participant } from '../challenges/entities/challenge.entities.js';
import { ParticipationService } from '../challenges/participation.service.js';
import { Wallet } from '../users/entities/user.entities.js';
import { Verification } from '../verification/entities/verification.entities.js';
import { ChainWorkerService } from './chain-worker.service.js';
import { ChainEvent, LedgerEntry, SponsorContribution } from './entities/payment.entities.js';
import { SolanaService } from './solana/solana.service.js';
import { errMsg } from '../../common/errors.js';

const CURSOR = 'indexer_cursor';

type Data = Record<string, unknown> & { challenge?: PublicKey; user?: PublicKey; sponsor?: PublicKey };
const str = (v: unknown) => (v instanceof PublicKey ? v.toBase58() : v && typeof v === 'object' && 'toNumber' in v ? (v as { toString(): string }).toString() : v);

/**
 * Mirrors program events into Postgres (PRD §27: escrow monitoring, transaction confirmation).
 * Polls signatures, so nothing is missed when a websocket drops. Accounts remain the source of
 * truth; events confirm actions people took from their own wallets.
 */
@Injectable()
export class IndexerService {
  private readonly log = new Logger('Indexer');
  private readonly parser: EventParser;
  private readonly enabled: boolean;
  private running = false;

  constructor(
    @InjectRepository(ChainEvent) private readonly events: Repository<ChainEvent>,
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(SponsorContribution) private readonly sponsors: Repository<SponsorContribution>,
    @InjectRepository(LedgerEntry) private readonly ledger: Repository<LedgerEntry>,
    @InjectRepository(Verification) private readonly verifications: Repository<Verification>,
    private readonly solana: SolanaService,
    private readonly settings: SettingsService,
    private readonly participation: ParticipationService,
    private readonly worker: ChainWorkerService,
    private readonly bus: EventEmitter2,
    config: ConfigService,
  ) {
    this.parser = new EventParser(solana.program.programId, new BorshCoder(solana.program.idl));
    this.enabled = config.get<boolean>('solana.workersEnabled') !== false;
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async poll() {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      const until = await this.settings.get<string | null>(CURSOR);
      const sigs: { signature: string; slot: number; err: unknown }[] = [];
      let before: string | undefined;
      for (let page = 0; page < 10; page++) {
        const batch = await this.solana.connection.getSignaturesForAddress(this.solana.program.programId, { before, until: until ?? undefined, limit: 1000 });
        sigs.push(...batch);
        if (batch.length < 1000) break;
        before = batch[batch.length - 1].signature;
      }
      // Oldest first, so the cursor only moves past what's been handled.
      for (const s of sigs.reverse()) {
        if (!s.err) await this.handle(s.signature, s.slot);
        await this.settings.set(CURSOR, s.signature);
      }
    } catch (e) {
      this.log.warn(`poll failed: ${errMsg(e)}`);
    } finally {
      this.running = false;
    }
  }

  private async handle(signature: string, slot: number) {
    const tx = await this.solana.connection.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
    const logs = tx?.meta?.logMessages ?? [];
    let idx = 0;
    for (const ev of this.parser.parseLogs(logs)) {
      const data = ev.data as Data;
      const plain = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, str(v)]));
      const inserted = await this.events.createQueryBuilder().insert().values({ signature, idx: idx++, slot: String(slot), name: ev.name, data: plain as never }).orIgnore().execute();
      if (!inserted.identifiers[0]) continue; // already processed
      try {
        await this.apply(ev.name, data, signature);
        await this.events.update({ signature, idx: idx - 1 }, { processed: true });
      } catch (e) {
        this.log.error(`apply ${ev.name} ${signature}`, e instanceof Error ? e.stack : e);
      }
    }
  }

  private async apply(name: string, d: Data, signature: string) {
    const challenge = d.challenge ? await this.challenges.findOneBy({ challengePda: d.challenge.toBase58() }) : null;
    if (!challenge) return;
    const byWallet = (w?: PublicKey) => (w ? this.participants.findOneBy({ challengeId: challenge.id, wallet: w.toBase58() }) : Promise.resolve(null));

    switch (name) {
      case 'joined':
      case 'Joined': {
        const p = await byWallet(d.user);
        if (p?.status === 'pending') {
          p.stake = BigInt(String(d.stake));
          p.joinFee = BigInt((d.fee as { toString(): string } | undefined)?.toString() ?? '0');
          await this.participation.activate(challenge, p, signature);
        }
        break;
      }
      case 'sponsored':
      case 'Sponsored': {
        const wallet = d.sponsor!.toBase58();
        const amount = BigInt(String(d.amount));
        const pending = await this.sponsors.findOne({ where: { challengeId: challenge.id, wallet, status: 'pending' }, order: { createdAt: 'ASC' } });
        let contribution = pending;
        if (pending) {
          await this.sponsors.update({ id: pending.id }, { status: 'confirmed', signature, amount });
        } else {
          const owner = await this.wallets.findOneBy({ address: wallet });
          if (owner) contribution = await this.sponsors.save(this.sponsors.create({ challengeId: challenge.id, sponsorUserId: owner.userId, wallet, amount, signature, status: 'confirmed' }));
        }
        const chain = await this.solana.fetchChallenge(new PublicKey(challenge.challengePda!));
        if (chain) await this.challenges.update({ id: challenge.id }, { sponsorPool: BigInt(chain.sponsorPool.toString()) });
        if (contribution) {
          await this.ledger
            .createQueryBuilder()
            .insert()
            .values({ userId: contribution.sponsorUserId, challengeId: challenge.id, kind: 'sponsored', amount: -amount, signature, status: 'confirmed', ref: `sponsor:${signature}` })
            .orIgnore()
            .execute();
          this.bus.emit(Events.Sponsored, { userId: contribution.sponsorUserId, challengeId: challenge.id, amount, signature } satisfies MoneyEvent);
        }
        break;
      }
      case 'claimed':
      case 'Claimed': {
        const p = await byWallet(d.user);
        if (p && !p.claimed) await this.worker.recordWithdrawal(challenge.status === 'cancelled' ? 'refund' : 'claim', challenge, p, signature);
        break;
      }
      case 'periodRecorded':
      case 'PeriodRecorded': {
        const p = await byWallet(d.user);
        if (p) await this.verifications.update({ participantId: p.id, period: Number(d.period), chainStatus: 'sent' }, { chainStatus: 'confirmed', chainSig: signature });
        break;
      }
      case 'disputeOpened':
      case 'DisputeOpened': {
        const p = await byWallet(d.user);
        if (p) this.bus.emit('chain.dispute_opened', { participantId: p.id, period: Number(d.period), signature });
        break;
      }
      case 'freezeUsed':
      case 'FreezeUsed': {
        const p = await byWallet(d.user);
        if (p && !p.freezeUsed) await this.participants.update({ id: p.id }, { freezeUsed: true, freezeFrom: Number(d.firstPeriod ?? d.first_period) });
        break;
      }
      default:
        // ChallengeCreated, ParticipantSettled, ChallengeFinalized, DisputeResolved: our own
        // actions, already reflected by the worker that sent them.
        break;
    }
  }
}
