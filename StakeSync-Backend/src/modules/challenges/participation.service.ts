import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { PublicKey } from '@solana/web3.js';
import { In, IsNull, Not, Repository } from 'typeorm';
import { AppError, conflict, notFound } from '../../common/errors.js';
import { Events, type ParticipantEvent } from '../../common/events.js';
import { toUnits, toUsd } from '../../common/money.js';
import { joinFee } from '../../common/settlement-math.js';
import { PROVIDER_LABELS } from '../../common/providers.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OrgMember } from '../organizations/entities/organization.entities.js';
import { LedgerEntry } from '../payments/entities/payment.entities.js';
import { chainFailure } from '../payments/solana/chain-errors.js';
import { RentService } from '../payments/solana/rent.service.js';
import { bitSet, SolanaService } from '../payments/solana/solana.service.js';
import { RiskService } from '../risk/risk.service.js';
import { ConnectedAccount, Wallet } from '../users/entities/user.entities.js';
import { Verification } from '../verification/entities/verification.entities.js';
import { ChallengesService } from './challenges.service.js';
import type { JoinDto } from './dto/challenge.dto.js';
import { Challenge, Participant } from './entities/challenge.entities.js';
import { currentPeriod } from './schedule.js';
import { participationView } from './views.js';

@Injectable()
export class ParticipationService {
  private readonly log = new Logger('Participation');

  constructor(
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    @InjectRepository(Verification) private readonly verifications: Repository<Verification>,
    @InjectRepository(ConnectedAccount) private readonly connections: Repository<ConnectedAccount>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(OrgMember) private readonly members: Repository<OrgMember>,
    @InjectRepository(LedgerEntry) private readonly ledger: Repository<LedgerEntry>,
    private readonly challengesService: ChallengesService,
    private readonly risk: RiskService,
    private readonly solana: SolanaService,
    private readonly rent: RentService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
  ) {}

  /** What stands between this person and joining, so the app can show it before they try. */
  async requirements(c: Challenge, userId: string) {
    const missing: { provider: string; how: string }[] = [];
    const conns = await this.connections.findBy({ userId, status: 'active' });
    const has = (p: string) => conns.some((c) => c.provider === p);
    for (const p of c.providers) {
      if (['github', 'leetcode', 'codeforces', 'wakatime'].includes(p) && !has(p)) missing.push({ provider: PROVIDER_LABELS[p], how: `Connect your ${PROVIDER_LABELS[p]} account` });
      if (p === 'solana' && !(await this.wallets.existsBy({ userId, kind: 'external', verifiedAt: Not(IsNull()) }))) {
        missing.push({ provider: 'Solana', how: 'Link the wallet you build with' });
      }
      if (['camera', 'health'].includes(p)) {
        // Proof comes from the phone; nothing to connect. Health needs the mobile app.
      }
    }
    return missing;
  }

  async join(userId: string, slug: string, dto: JoinDto) {
    const c = await this.challengesService.visible(slug, userId, dto.code);
    if (c.moderationHold) throw conflict('challenge_paused', 'This challenge is paused while we review it. Try again later.');
    if (c.status === 'pending_chain') throw conflict('setting_up', 'This challenge is still being set up. Try again in a minute.');
    if (c.status !== 'open' || new Date() >= c.joinBy) throw conflict('join_closed', 'Joining has closed for this challenge.');
    if (c.privacy === 'private' && dto.code !== c.inviteCode && !(await this.challengesService.canManage(c, userId))) {
      throw new AppError('invite_required', 'This challenge is invite-only. Ask the host for the invite code or link.', HttpStatus.FORBIDDEN);
    }
    if (c.privacy === 'org' && c.orgId && !(await this.members.existsBy({ orgId: c.orgId, userId }))) {
      throw new AppError('members_only', 'This challenge is for members of the hosting organization. Join it with their invite code first.', HttpStatus.FORBIDDEN);
    }
    if (c.participantLimit && c.participantCount >= c.participantLimit) throw conflict('challenge_full', 'This challenge is full.');
    if (dto.acceptedRulesHash !== c.rulesHash) {
      throw new AppError('rules_changed', 'The rules you accepted don’t match this challenge. Review them again to join.', HttpStatus.CONFLICT);
    }
    await this.risk.assertCanJoin(userId, c.verificationLevel);
    const missing = await this.requirements(c, userId);
    if (missing.length) throw new AppError('connections_required', `${missing.map((m) => m.how).join('. ')} to join.`, HttpStatus.FORBIDDEN, { missing });

    const stake = c.stakeMode === 'none' ? 0n : c.stakeMode === 'fixed' ? c.stakeMin : toUnits(dto.stake ?? 0);
    if (stake < c.stakeMin || stake > c.stakeMax) {
      throw new AppError('stake_out_of_range', `Choose a stake between $${toUsd(c.stakeMin)} and $${toUsd(c.stakeMax)}.`);
    }

    const existing = await this.participants.findOneBy({ challengeId: c.id, userId });
    if (existing && existing.status !== 'pending') throw conflict('already_joined', 'You’re already in this challenge.');

    if (!c.onChain) {
      const p = existing ?? this.participants.create({ challengeId: c.id, userId, acceptedRulesHash: dto.acceptedRulesHash, acceptedAt: new Date() });
      await this.activate(c, await this.participants.save(p), null);
      return { status: 'active' as const };
    }

    // The person's own wallet (embedded or external) signs. Stake-Sync never holds funds.
    const wallet = dto.wallet
      ? await this.wallets.findOneBy({ userId, address: dto.wallet, verifiedAt: Not(IsNull()) })
      : await this.wallets.findOne({ where: { userId, verifiedAt: Not(IsNull()) }, order: { primary: 'DESC' } });
    if (!wallet) throw new AppError('no_wallet', 'Set up your wallet first. It takes a few seconds.', HttpStatus.PAYMENT_REQUIRED);
    const owner = new PublicKey(wallet.address);
    // The joining fee is paid on top of the stake.
    const fee = joinFee(stake, c.joinFeeBps);
    if (stake > 0n) {
      const balance = await this.solana.usdcBalance(owner);
      if (balance < stake + fee) {
        const short = toUsd(stake + fee - balance);
        const feeNote = fee > 0n ? ` (your $${toUsd(stake)} stake plus the $${toUsd(fee)} joining fee)` : '';
        throw new AppError('insufficient_balance', `You need $${short.toFixed(2)} more${feeNote}. Add money and try again.`, HttpStatus.PAYMENT_REQUIRED, {
          needed: short,
          stake: toUsd(stake),
          fee: toUsd(fee),
        });
      }
    }

    const p =
      existing ??
      this.participants.create({ challengeId: c.id, userId, acceptedRulesHash: dto.acceptedRulesHash, acceptedAt: new Date() });
    Object.assign(p, { wallet: wallet.address, walletKind: wallet.kind, stake, joinFee: fee, participantPda: this.solana.pdas.participant(new PublicKey(c.challengePda!), owner).toBase58() });
    await this.participants.save(p);

    const ix = await this.solana.joinIx(new PublicKey(c.challengePda!), owner, stake, Buffer.from(c.rulesHash, 'hex'));
    // Joining creates a small account whose rent the wallet pays; top it up if it has no SOL.
    await this.rent.ensure(wallet);
    // Their wallet signs; the platform already signed as fee payer.
    const tx = await this.solana.buildForWallet([ix]);
    return { status: 'needs_signature' as const, ...tx };
  }

  /** The app sends the signature after the wallet submits the join transaction. */
  async confirmJoin(userId: string, slug: string, signature: string) {
    const c = await this.challengesService.bySlug(slug);
    const p = await this.participants.findOneBy({ challengeId: c.id, userId });
    if (!p) throw notFound('join');
    if (p.status !== 'pending') return { status: p.status };
    try {
      await this.solana.confirmExternal(signature);
    } catch (e) {
      throw chainFailure(e);
    }
    const onChain = await this.solana.fetchParticipant(new PublicKey(c.challengePda!), new PublicKey(p.wallet!));
    if (!onChain) return { status: 'pending' as const }; // not visible yet; the indexer will pick it up
    p.stake = BigInt(onChain.stake.toString());
    p.joinFee = BigInt(onChain.joinFee.toString());
    await this.activate(c, p, signature);
    return { status: 'active' as const };
  }

  async abandonJoin(userId: string, slug: string) {
    const c = await this.challengesService.bySlug(slug);
    await this.participants.delete({ challengeId: c.id, userId, status: 'pending' });
  }

  /** Marks a join final. Idempotent: the indexer may also call this. */
  async activate(c: Challenge, p: Participant, signature: string | null) {
    const res = await this.participants.update({ id: p.id, status: 'pending' }, { status: 'active', activatedAt: new Date(), joinSig: signature });
    if (!res.affected) return;
    await this.challenges.increment({ id: c.id }, 'participantCount', 1);
    if (p.stake > 0n) {
      await this.ledger
        .createQueryBuilder()
        .insert()
        .values({ userId: p.userId, challengeId: c.id, kind: 'stake_deposited', amount: -p.stake, signature, status: 'confirmed', ref: `join:${p.id}` })
        .orIgnore()
        .execute();
    }
    if (p.joinFee > 0n) {
      await this.ledger
        .createQueryBuilder()
        .insert()
        .values({ userId: p.userId, challengeId: c.id, kind: 'join_fee', amount: -p.joinFee, signature, status: 'confirmed', ref: `joinfee:${p.id}` })
        .orIgnore()
        .execute();
    }
    this.events.emit(Events.ParticipantJoined, { participantId: p.id, challengeId: c.id, userId: p.userId } satisfies ParticipantEvent);
    await this.notifications.notify(p.userId, {
      kind: 'activity',
      title: `You're in: ${c.title}`,
      body: p.stake > 0n ? `$${toUsd(p.stake)} is locked in the challenge escrow. It starts ${c.startsAt.toUTCString().slice(0, 16)}.` : `It starts ${c.startsAt.toUTCString().slice(0, 16)}.`,
      href: `/c/${c.slug}`,
      dedupeKey: `joined:${p.id}`,
    });
  }

  // ---------- progress ----------

  async progress(userId: string, slug: string) {
    const c = await this.challengesService.bySlug(slug);
    const p = await this.participants.findOneBy({ challengeId: c.id, userId });
    if (!p || p.status === 'pending') throw notFound('participation');
    const vs = await this.verifications.findBy({ participantId: p.id });
    return participationView(c, p, vs);
  }

  /** Everything the person is in, newest first, with progress. */
  async mine(userId: string) {
    const ps = await this.participants.find({ where: { userId, status: Not('pending') }, relations: { challenge: true }, order: { createdAt: 'DESC' } });
    const vs = ps.length ? await this.verifications.findBy({ participantId: In(ps.map((p) => p.id)) }) : [];
    const views = await this.challengesService.views(ps.map((p) => p.challenge!));
    return ps.map((p, i) => ({
      challenge: views[i],
      participation: participationView(p.challenge!, p, vs.filter((v) => v.participantId === p.id)),
    }));
  }

  // ---------- emergency freeze (PRD §20) ----------

  async freeze(userId: string, slug: string, day: number) {
    const c = await this.challengesService.bySlug(slug);
    const p = await this.participants.findOneBy({ challengeId: c.id, userId });
    if (!p || p.status !== 'active') throw notFound('participation');
    if (c.freezePeriods === 0) throw conflict('freeze_unavailable', 'This challenge doesn’t allow freezes.');
    if (p.freezeUsed) throw conflict('freeze_used', 'You’ve already used your freeze in this challenge.');
    const first = day - 1;
    const cur = currentPeriod(c) ?? (new Date() < c.startsAt ? 0 : c.periodCount);
    const last = first + c.freezePeriods - 1;
    if (first < cur || last >= c.periodCount) {
      throw new AppError('freeze_invalid', `A freeze covers ${c.freezePeriods} days and has to start today or later, before the last ${c.freezePeriods - 1} days.`);
    }
    const missed = await this.verifications.findOne({ where: { participantId: p.id, state: 'failed' }, order: { period: 'DESC' } });
    if (missed && missed.period >= first) throw new AppError('freeze_invalid', 'A freeze can’t cover a day already marked missed.');

    if (c.onChain) {
      const ix = await this.solana.useFreezeIx(new PublicKey(c.challengePda!), new PublicKey(p.wallet!), first);
      return { status: 'needs_signature' as const, ...(await this.solana.buildForWallet([ix])) };
    }
    await this.applyFreeze(p, first);
    return { status: 'frozen' as const, from: day, days: c.freezePeriods };
  }

  async confirmFreeze(userId: string, slug: string, signature: string) {
    const c = await this.challengesService.bySlug(slug);
    const p = await this.participants.findOneByOrFail({ challengeId: c.id, userId });
    try {
      await this.solana.confirmExternal(signature);
    } catch (e) {
      throw chainFailure(e);
    }
    const onChain = await this.solana.fetchParticipant(new PublicKey(c.challengePda!), new PublicKey(p.wallet!));
    if (!onChain?.freezeUsed) return { status: 'pending' as const };
    const first = Array.from({ length: c.periodCount }, (_, i) => i).find((i) => bitSet(onChain.frozen, i)) ?? 0;
    await this.applyFreeze(p, first);
    return { status: 'frozen' as const, from: first + 1, days: c.freezePeriods };
  }

  private async applyFreeze(p: Participant, first: number) {
    await this.participants.update({ id: p.id }, { freezeUsed: true, freezeFrom: first });
  }
}
