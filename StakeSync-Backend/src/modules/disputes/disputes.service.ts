import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { PublicKey } from '@solana/web3.js';
import { In, LessThan, Repository } from 'typeorm';
import { openImage } from '../../common/images.js';
import { AppError, conflict, forbidden, notFound } from '../../common/errors.js';
import { Events, type DisputeEvent } from '../../common/events.js';
import { toUsd, USDC } from '../../common/money.js';
import { PROVIDER_LABELS } from '../../common/providers.js';
import { completed, penalty } from '../../common/settlement-math.js';
import { AuditService } from '../../core/audit.service.js';
import { StorageService } from '../../core/storage.service.js';
import { ChallengesService } from '../challenges/challenges.service.js';
import { Challenge, Participant } from '../challenges/entities/challenge.entities.js';
import { settleAfter } from '../challenges/schedule.js';
import { person } from '../challenges/views.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { chainFailure } from '../payments/solana/chain-errors.js';
import { SolanaService } from '../payments/solana/solana.service.js';
import { User } from '../users/entities/user.entities.js';
import { ProofSubmission, Verification } from '../verification/entities/verification.entities.js';
import { VerificationService } from '../verification/verification.service.js';
import { Dispute, type DisputeStatus, type Evidence } from './entities/dispute.entity.js';

const USER_STATUS: Record<DisputeStatus, string> = {
  new: 'Under review',
  in_review: 'Under review',
  waiting_on_user: 'Needs evidence',
  approved: 'Approved',
  failure_confirmed: 'Failure confirmed',
};
const ADMIN_STATUS: Record<DisputeStatus, string> = {
  new: 'New',
  in_review: 'In review',
  waiting_on_user: 'Waiting on user',
  approved: 'Approved',
  failure_confirmed: 'Failure confirmed',
};
const OPEN: DisputeStatus[] = ['new', 'in_review', 'waiting_on_user'];

/** Disputes (PRD §21): money affected stays locked until a moderator decides. */
@Injectable()
export class DisputesService {
  constructor(
    @InjectRepository(Dispute) private readonly disputes: Repository<Dispute>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    @InjectRepository(Verification) private readonly verifications: Repository<Verification>,
    @InjectRepository(ProofSubmission) private readonly proofs: Repository<ProofSubmission>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly challengesService: ChallengesService,
    private readonly verification: VerificationService,
    private readonly solana: SolanaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  /** What this one miss could cost: payout with it versus without it. */
  private locked(c: Challenge, p: Participant) {
    const ladder = c.penaltiesBps.map((b) => b / 100);
    const payout = (missed: number) => (completed(missed, c.periodCount, c.requiredPeriods) ? p.stake - penalty(p.stake, missed, c.freeStrikes, ladder) : 0n);
    return payout(Math.max(0, p.missedCount - 1)) - payout(p.missedCount);
  }

  async open(userId: string, slug: string, day: number, reason: string, links: string[], images: Buffer[]) {
    const c = await this.challengesService.bySlug(slug);
    const p = await this.participants.findOneBy({ challengeId: c.id, userId });
    if (!p || p.settled || !['active', 'failed'].includes(p.status)) throw notFound('participation');
    const period = day - 1;
    const v = await this.verifications.findOneBy({ participantId: p.id, period });
    if (!v || v.state !== 'failed') throw new AppError('not_disputable', 'Only a day marked missed can be disputed.');
    if (await this.disputes.existsBy({ participantId: p.id, period })) throw conflict('already_disputed', 'You already disputed this day.');
    if (new Date() >= settleAfter(c)) throw new AppError('dispute_window_closed', 'The window to dispute this challenge has closed.', HttpStatus.GONE);

    const now = new Date();
    const evidence: Evidence[] = links.map((l) => ({ kind: 'link' as const, value: l, at: now.toISOString() }));
    for (const img of images.slice(0, 4)) {
      const clean = await (await openImage(img)).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      evidence.push({ kind: 'image', value: await this.storage.put('evidence', clean, 'image/jpeg'), at: now.toISOString() });
    }
    const locked = this.locked(c, p);
    const due = new Date(Math.min(now.getTime() + 48 * 3600_000, settleAfter(c).getTime() - 2 * 3600_000));
    const d = await this.disputes.save(
      this.disputes.create({
        participantId: p.id,
        challengeId: c.id,
        userId,
        verificationId: v.id,
        period,
        provider: v.provider,
        reason: reason.trim(),
        evidence,
        lockedAmount: locked,
        priority: locked >= 20n * USDC || due.getTime() - now.getTime() < 12 * 3600_000 ? 'High' : 'Normal',
        dueAt: due,
        timeline: [
          { at: now.toISOString(), source: 'provider', text: `${PROVIDER_LABELS[v.provider]} result: ${v.detail}` },
          { at: now.toISOString(), source: 'user', text: `Dispute opened: ${reason.trim().slice(0, 200)}` },
        ],
      }),
    );

    // The on-chain hold, signed by the person's wallet.
    if (c.onChain && p.wallet) {
      const ix = await this.solana.openDisputeIx(new PublicKey(c.challengePda!), new PublicKey(p.wallet), period);
      return { dispute: this.userView(d, c), status: 'needs_signature' as const, ...(await this.solana.buildForWallet([ix])) };
    }
    await this.activate(d.id);
    return { dispute: this.userView(await this.disputes.findOneByOrFail({ id: d.id }), c), status: 'opened' as const };
  }

  async confirmOpen(userId: string, id: string, signature: string) {
    const d = await this.disputes.findOneBy({ id, userId });
    if (!d) throw notFound('dispute');
    try {
      await this.solana.confirmExternal(signature);
    } catch (e) {
      throw chainFailure(e);
    }
    await this.disputes.update({ id, chainOpenStatus: 'none' }, { chainOpenStatus: 'confirmed', chainOpenSig: signature });
    await this.activate(id);
    return { status: 'opened' as const };
  }

  @OnEvent('chain.dispute_opened', { async: true })
  async onChainOpened(e: { participantId: string; period: number; signature: string }) {
    const d = await this.disputes.findOneBy({ participantId: e.participantId, period: e.period });
    if (!d || d.chainOpenStatus === 'confirmed') return;
    await this.disputes.update({ id: d.id }, { chainOpenStatus: 'confirmed', chainOpenSig: e.signature });
    await this.activate(d.id);
  }

  /** Once the hold is in place, the day shows as disputed and moderators see it. */
  private async activate(id: string) {
    const d = await this.disputes.findOneByOrFail({ id });
    await this.verification.markDisputed(d.verificationId);
    this.events.emit(Events.DisputeOpened, { disputeId: d.id, userId: d.userId, challengeId: d.challengeId } satisfies DisputeEvent);
  }

  /** Wallet disputes that were never signed are dropped after an hour. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async dropUnsigned() {
    const stale = await this.disputes.find({ where: { chainOpenStatus: 'none', createdAt: LessThan(new Date(Date.now() - 3600_000)) } });
    for (const d of stale) {
      const c = await this.challenges.findOneBy({ id: d.challengeId });
      const p = await this.participants.findOneBy({ id: d.participantId });
      if (c?.onChain && p?.wallet) await this.disputes.delete({ id: d.id, chainOpenStatus: 'none' });
    }
  }

  private visibleToModerators(d: Dispute, c: Challenge) {
    return !c.onChain || d.chainOpenStatus === 'confirmed';
  }

  async addEvidence(userId: string, id: string, note: string, links: string[], images: Buffer[]) {
    const d = await this.disputes.findOneBy({ id, userId });
    if (!d) throw notFound('dispute');
    if (!OPEN.includes(d.status)) throw conflict('dispute_closed', 'This dispute has already been decided.');
    const at = new Date().toISOString();
    const added: Evidence[] = [...(note ? [{ kind: 'text' as const, value: note, at }] : []), ...links.map((l) => ({ kind: 'link' as const, value: l, at }))];
    for (const img of images.slice(0, 4)) {
      const clean = await (await openImage(img)).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      added.push({ kind: 'image', value: await this.storage.put('evidence', clean, 'image/jpeg'), at });
    }
    d.evidence = [...d.evidence, ...added].slice(0, 30);
    d.timeline = [...d.timeline, { at, source: 'user', text: `Added ${added.length} piece${added.length === 1 ? '' : 's'} of evidence` }];
    if (d.status === 'waiting_on_user') d.status = 'in_review';
    await this.disputes.save(d);
    this.events.emit(Events.DisputeUpdated, { disputeId: d.id, userId, challengeId: d.challengeId } satisfies DisputeEvent);
    return this.userView(d, await this.challenges.findOneByOrFail({ id: d.challengeId }));
  }

  async mine(userId: string) {
    const rows = await this.disputes.find({ where: { userId }, order: { createdAt: 'DESC' } });
    const cs = rows.length ? await this.challenges.findBy({ id: In(rows.map((r) => r.challengeId)) }) : [];
    return rows.filter((d) => this.visibleToModerators(d, cs.find((c) => c.id === d.challengeId)!)).map((d) => this.userView(d, cs.find((c) => c.id === d.challengeId)!));
  }

  async evidenceFile(id: string, index: number, viewer: { id: string; admin: boolean }) {
    const d = await this.disputes.findOneBy({ id });
    if (!d) throw notFound('dispute');
    if (d.userId !== viewer.id && !viewer.admin) throw forbidden();
    const e = d.evidence[index];
    if (!e || e.kind !== 'image') throw notFound('file');
    return this.storage.get(e.value);
  }

  userView(d: Dispute, c: Challenge) {
    return {
      id: d.id,
      challengeId: c.slug,
      challenge: c.title,
      day: d.period + 1,
      opened: d.createdAt.toISOString(),
      status: USER_STATUS[d.status],
      reason: d.reason,
      amountLocked: OPEN.includes(d.status) ? toUsd(d.lockedAmount) : 0,
      evidence: d.evidence.map((e, i) => ({ kind: e.kind, value: e.kind === 'image' ? `/api/disputes/${d.id}/evidence/${i}` : e.value, at: e.at })),
      timeline: d.timeline.map((t) => ({ at: t.at, text: t.text })),
      dueBy: d.dueAt.toISOString(),
    };
  }

  // ---------- moderators ----------

  async queue(status?: string) {
    const rows = await this.disputes.find({ where: status ? { status: status as DisputeStatus } : {}, order: { dueAt: 'ASC' }, take: 300 });
    const cs = rows.length ? await this.challenges.findBy({ id: In([...new Set(rows.map((r) => r.challengeId))]) }) : [];
    const users = rows.length ? await this.users.findBy({ id: In([...new Set(rows.map((r) => r.userId))]) }) : [];
    return rows
      .filter((d) => this.visibleToModerators(d, cs.find((c) => c.id === d.challengeId)!))
      .map((d) => this.adminView(d, cs.find((c) => c.id === d.challengeId)!, users.find((u) => u.id === d.userId)!));
  }

  /** Everything a moderator needs: the provider's raw result, the person's proof, the history. */
  async detail(id: string) {
    const d = await this.disputes.findOneBy({ id });
    if (!d) throw notFound('dispute');
    const [c, u, v] = await Promise.all([
      this.challenges.findOneByOrFail({ id: d.challengeId }),
      this.users.findOneByOrFail({ id: d.userId }),
      this.verifications.findOneByOrFail({ id: d.verificationId }),
    ]);
    const p = await this.participants.findOneByOrFail({ id: d.participantId });
    const proofs = await this.proofs.findBy({ participantId: p.id, period: d.period });
    const history = await this.verifications.find({ where: { participantId: p.id }, order: { period: 'ASC' } });
    return {
      ...this.adminView(d, c, u),
      verification: { state: v.state, detail: v.detail, evidence: v.evidence, attempts: v.attempts, chainSig: v.chainSig },
      proofs: proofs.map((x) => ({ id: x.id, kind: x.kind, status: x.status, flags: x.flags, value: x.value, note: x.note })),
      participant: { stake: toUsd(p.stake), verified: p.verifiedCount, missed: p.missedCount, wallet: p.wallet },
      days: history.map((h) => ({ day: h.period + 1, state: h.state, detail: h.detail })),
    };
  }

  adminView(d: Dispute, c: Challenge, u: User) {
    return {
      id: d.id,
      code: `D-${d.id.slice(0, 4).toUpperCase()}`,
      user: person(u),
      challenge: c.title,
      challengeId: c.slug,
      provider: PROVIDER_LABELS[d.provider],
      day: d.period + 1,
      opened: d.createdAt.toISOString(),
      due: d.dueAt.toISOString(),
      status: ADMIN_STATUS[d.status],
      priority: d.priority,
      reason: d.reason,
      locked: toUsd(d.lockedAmount),
      evidence: d.evidence.map((e, i) => (e.kind === 'image' ? `Image: /api/disputes/${d.id}/evidence/${i}` : e.kind === 'link' ? e.value : `“${e.value}”`)),
      events: d.timeline,
    };
  }

  async requestEvidence(adminId: string, id: string, message: string) {
    const d = await this.disputes.findOneBy({ id });
    if (!d || !OPEN.includes(d.status)) throw notFound('dispute');
    d.status = 'waiting_on_user';
    d.timeline = [...d.timeline, { at: new Date().toISOString(), source: 'moderator', text: `Asked for more evidence: ${message}` }];
    d.assigneeId = adminId;
    await this.disputes.save(d);
    await this.audit.log(adminId, 'Requested evidence', `Dispute D-${id.slice(0, 4).toUpperCase()}`, message);
    this.events.emit(Events.DisputeUpdated, { disputeId: d.id, userId: d.userId, challengeId: d.challengeId } satisfies DisputeEvent);
  }

  async startReview(adminId: string, id: string) {
    await this.disputes.update({ id, status: 'new' }, { status: 'in_review', assigneeId: adminId });
  }

  /** Approve completion or confirm the failure. Upheld turns the miss into a completed day, on-chain too. */
  async decide(adminId: string, id: string, upheld: boolean, reason: string) {
    const d = await this.disputes.findOneBy({ id });
    if (!d) throw notFound('dispute');
    if (!OPEN.includes(d.status)) throw conflict('already_decided', 'This dispute has already been decided.');
    const c = await this.challenges.findOneByOrFail({ id: d.challengeId });
    d.status = upheld ? 'approved' : 'failure_confirmed';
    d.decidedById = adminId;
    d.decidedAt = new Date();
    d.decisionReason = reason;
    d.timeline = [...d.timeline, { at: new Date().toISOString(), source: 'moderator', text: upheld ? `Completion approved: ${reason}` : `Failure confirmed: ${reason}` }];
    d.chainResolveStatus = c.onChain ? 'queued' : 'none';
    await this.disputes.save(d);
    await this.verification.applyDisputeDecision(d.verificationId, upheld, upheld ? `Approved on review: ${reason}` : `Confirmed on review: ${reason}`);
    await this.audit.log(adminId, upheld ? 'Approved completion' : 'Confirmed failure', `Dispute D-${id.slice(0, 4).toUpperCase()}`, reason);
    this.events.emit(Events.DisputeUpdated, { disputeId: d.id, userId: d.userId, challengeId: d.challengeId } satisfies DisputeEvent);
    return this.adminView(d, c, await this.users.findOneByOrFail({ id: d.userId }));
  }

  get(id: string) {
    return this.disputes.findOneBy({ id });
  }
}
