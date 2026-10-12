import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Events, type ChallengeEvent, type PeriodDecidedEvent } from '../../common/events.js';
import { ProviderAuthError, ProviderUnavailable } from '../../common/http.js';
import { PROVIDER_LABELS } from '../../common/providers.js';
import { CryptoService } from '../../core/crypto.service.js';
import { OAuthService } from '../auth/oauth.service.js';
import { Challenge, Participant, type ProviderKey } from '../challenges/entities/challenge.entities.js';
import { endedPeriods, periodEnd, periodStart, settleAfter } from '../challenges/schedule.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RiskService } from '../risk/risk.service.js';
import { ConnectedAccount, Wallet } from '../users/entities/user.entities.js';
import type { AdapterContext, DayResult, VerificationAdapter } from './adapters/adapter.js';
import { CodeforcesAdapter } from './adapters/codeforces.adapter.js';
import { GithubAdapter } from './adapters/github.adapter.js';
import { LeetcodeAdapter } from './adapters/leetcode.adapter.js';
import { CameraAdapter, HealthAdapter, PhotoAdapter } from './adapters/proof.adapters.js';
import { SolanaAdapter } from './adapters/solana.adapter.js';
import { WakatimeAdapter } from './adapters/wakatime.adapter.js';
import { ProofSubmission, Verification, type ProofState } from './entities/verification.entities.js';
import { ProviderHealthService } from './provider-health.service.js';
import { errMsg } from '../../common/errors.js';

const MIN = 60_000;
const BACKOFF = [10, 30, 60, 120, 240, 480].map((m) => m * MIN);
const MAX_JOBS_PER_TICK = 300;

type Combined = { kind: 'result'; result: DayResult } | { kind: 'unavailable'; auth: boolean; reason: string };

/**
 * The verification engine (PRD §9, §10, §32). Checks each ended period for each participant through
 * the challenge's adapters. Provider failures are retried with backoff and, if they last, the period
 * is excused: a technical failure never becomes a user failure.
 */
@Injectable()
export class VerificationService {
  private readonly log = new Logger('Verification');
  private readonly adapters: Map<ProviderKey, VerificationAdapter>;
  private readonly graceMs: number;
  private running = false;

  constructor(
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    @InjectRepository(Verification) private readonly verifications: Repository<Verification>,
    @InjectRepository(ProofSubmission) private readonly proofs: Repository<ProofSubmission>,
    @InjectRepository(ConnectedAccount) private readonly connections: Repository<ConnectedAccount>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    private readonly health: ProviderHealthService,
    private readonly crypto: CryptoService,
    private readonly oauth: OAuthService,
    private readonly risk: RiskService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
    config: ConfigService,
    github: GithubAdapter,
    solana: SolanaAdapter,
    leetcode: LeetcodeAdapter,
    codeforces: CodeforcesAdapter,
    wakatime: WakatimeAdapter,
    camera: CameraAdapter,
    healthAdapter: HealthAdapter,
    photo: PhotoAdapter,
  ) {
    this.adapters = new Map<ProviderKey, VerificationAdapter>(
      [github, solana, leetcode, codeforces, wakatime, camera, healthAdapter, photo].map((a) => [a.key, a]),
    );
    this.graceMs = (config.get<number>('verification.unavailableGraceHours') ?? 24) * 3600_000;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.runDays();
      await this.runCounts();
    } catch (e) {
      this.log.error('Verification tick failed', e instanceof Error ? e.stack : e);
    } finally {
      this.running = false;
    }
  }

  // ---------- day-by-day challenges ----------

  private async runDays() {
    const now = new Date();
    const list = await this.challenges.findBy({ status: In(['live', 'settling']), mode: 'days' });
    const jobs: { c: Challenge; p: Participant; period: number; row?: Verification }[] = [];
    for (const c of list) {
      const ended = endedPeriods(c, now);
      if (!ended) continue;
      const ps = await this.participants.findBy({ challengeId: c.id, status: 'active' });
      if (!ps.length) continue;
      const rows = await this.verifications.findBy({ challengeId: c.id });
      const byKey = new Map(rows.map((r) => [`${r.participantId}:${r.period}`, r]));
      const upgradeUntil = settleAfter(c).getTime() - 2 * 3600_000;
      for (const p of ps) {
        for (let period = 0; period < ended; period++) {
          if (p.freezeFrom !== null && period >= p.freezeFrom && period < p.freezeFrom + c.freezePeriods) continue;
          const row = byKey.get(`${p.id}:${period}`);
          if (row && ['verified', 'failed', 'disputed'].includes(row.state)) continue;
          // Excused days keep being retried for a while: if the data shows up, they become verified.
          if (row?.state === 'excused' && now.getTime() > upgradeUntil) continue;
          if (row?.nextAttemptAt && row.nextAttemptAt > now) continue;
          jobs.push({ c, p, period, row });
          if (jobs.length >= MAX_JOBS_PER_TICK) break;
        }
      }
    }
    for (let i = 0; i < jobs.length; i += 5) {
      await Promise.all(jobs.slice(i, i + 5).map((j) => this.checkDay(j.c, j.p, j.period, j.row).catch((e) => this.log.error(`check ${j.p.id}/${j.period}`, e instanceof Error ? e.stack : e))));
    }
  }

  async checkDay(c: Challenge, p: Participant, period: number, existing?: Verification) {
    const from = periodStart(c, period);
    const to = periodEnd(c, period);
    const row =
      existing ??
      (await this.verifications.findOneBy({ participantId: p.id, period })) ??
      this.verifications.create({ participantId: p.id, challengeId: c.id, userId: p.userId, period, provider: c.providers[0], state: 'pending', attempts: 0 });
    const combined = await this.runAdapters(c, p, from, to, period);
    const now = new Date();
    row.attempts = (row.attempts ?? 0) + 1;

    if (combined.kind === 'unavailable') {
      if (row.state === 'excused') return this.save(row, { nextAttemptAt: new Date(now.getTime() + BACKOFF[Math.min(row.attempts, BACKOFF.length - 1)]) });
      const first = row.firstUnavailableAt ?? now;
      if (now.getTime() - first.getTime() >= this.graceMs) {
        // A revoked connection is the person's to fix, so it can be disputed; an outage is excused.
        if (combined.auth) return this.decide(c, p, row, 'failed', `We couldn't check this day because your ${PROVIDER_LABELS[row.provider]} connection was removed. Dispute it if you did the work.`, {});
        return this.decide(c, p, row, 'excused', `${PROVIDER_LABELS[row.provider]} couldn't be reached`, { reason: combined.reason });
      }
      return this.save(row, {
        state: 'unavailable',
        firstUnavailableAt: first,
        detail: combined.auth ? `Reconnect ${PROVIDER_LABELS[row.provider]} so we can check this day` : `Waiting for ${PROVIDER_LABELS[row.provider]}; we'll keep trying`,
        nextAttemptAt: new Date(now.getTime() + BACKOFF[Math.min(row.attempts - 1, BACKOFF.length - 1)]),
      });
    }

    const r = combined.result;
    if (row.state === 'excused') {
      // Only an upgrade is possible from here.
      if (r.outcome === 'verified') return this.decide(c, p, row, 'verified', r.detail, r.evidence ?? {}, r);
      return this.save(row, { nextAttemptAt: new Date(now.getTime() + BACKOFF[Math.min(row.attempts, BACKOFF.length - 1)]) });
    }
    if (r.outcome === 'waiting') return this.save(row, { state: 'pending', detail: r.detail, nextAttemptAt: new Date(now.getTime() + 15 * MIN) });
    if (r.outcome === 'verified') return this.decide(c, p, row, 'verified', r.detail, r.evidence ?? {}, r);

    // A miss during a provider incident is protected (PRD §3, §32).
    for (const prov of c.providers) {
      if (await this.health.overlapsOutage(prov, from, to)) {
        return this.decide(c, p, row, 'excused', `${PROVIDER_LABELS[prov]} had problems that day, so it can't count against you`, r.evidence ?? {});
      }
    }
    return this.decide(c, p, row, 'failed', r.detail, r.evidence ?? {}, r);
  }

  /** Runs every provider for the window. With two providers, a day needs both. */
  private async runAdapters(c: Challenge, p: Participant, from: Date, to: Date, period: number | null): Promise<Combined> {
    const results: DayResult[] = [];
    for (const key of c.providers) {
      const adapter = this.adapters.get(key)!;
      const started = Date.now();
      try {
        const ctx = await this.context(c, p, key, from, to, period);
        const r = await adapter.day(ctx);
        this.health.record(key, true, Date.now() - started);
        results.push(r);
      } catch (e) {
        if (e instanceof ProviderAuthError) {
          await this.connections.update({ userId: p.userId, provider: key as ConnectedAccount['provider'] }, { status: 'needs_reconnect' });
          await this.notifications.notify(p.userId, {
            kind: 'problem',
            title: `Reconnect ${PROVIDER_LABELS[key]}`,
            body: `We can't check your progress until you reconnect ${PROVIDER_LABELS[key]}. Nothing counts against you while we wait.`,
            href: '/profile',
            dedupeKey: `reconnect:${p.userId}:${key}:${new Date().toISOString().slice(0, 10)}`,
            email: true,
          });
          return { kind: 'unavailable', auth: true, reason: 'credentials rejected' };
        }
        if (e instanceof ProviderUnavailable || e instanceof MissingConnection) {
          if (e instanceof ProviderUnavailable) this.health.record(key, false, Date.now() - started);
          return { kind: 'unavailable', auth: e instanceof MissingConnection, reason: e.message };
        }
        // Unknown errors are ours, not the person's: treat as unavailable and log.
        this.log.error(`${key} adapter error`, e instanceof Error ? e.stack : e);
        this.health.record(key, false, Date.now() - started);
        return { kind: 'unavailable', auth: false, reason: 'internal error' };
      }
    }
    if (results.some((r) => r.outcome === 'waiting')) return { kind: 'result', result: { outcome: 'waiting', detail: results.find((r) => r.outcome === 'waiting')!.detail } };
    const failed = results.find((r) => r.outcome === 'failed');
    if (failed) return { kind: 'result', result: { ...failed, evidence: Object.assign({}, ...results.map((r) => r.evidence ?? {})) } };
    return {
      kind: 'result',
      result: {
        outcome: 'verified',
        detail: results.map((r) => r.detail).join(' · '),
        evidence: Object.assign({}, ...results.map((r) => r.evidence ?? {})),
        fingerprints: results.flatMap((r) => r.fingerprints ?? []),
        units: results[0]?.units,
        baselinePatch: Object.assign({}, ...results.map((r) => r.baselinePatch ?? {})),
      },
    };
  }

  private async context(c: Challenge, p: Participant, key: ProviderKey, from: Date, to: Date, period: number | null): Promise<AdapterContext> {
    const ctx: AdapterContext = { challenge: c, participant: p, from, to, proofs: [], now: new Date() };
    if (['github', 'leetcode', 'codeforces', 'wakatime'].includes(key)) {
      const conn = await this.connections.findOneBy({ userId: p.userId, provider: key as ConnectedAccount['provider'] });
      if (!conn) throw new MissingConnection(key);
      ctx.account = conn.username;
      if (conn.accessToken) {
        if (key === 'wakatime' && conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() < Date.now() + 5 * MIN && conn.refreshToken) {
          const fresh = await this.oauth.refresh('wakatime', this.crypto.openText(conn.refreshToken));
          await this.connections.update({ id: conn.id }, { accessToken: this.crypto.seal(fresh.accessToken), refreshToken: this.crypto.seal(fresh.refreshToken), tokenExpiresAt: fresh.expiresAt });
          ctx.token = fresh.accessToken;
        } else {
          ctx.token = this.crypto.openText(conn.accessToken);
        }
      }
      if (key === 'github' && !ctx.token) throw new MissingConnection(key);
    }
    if (key === 'solana') {
      const w = await this.wallets.findOne({ where: { userId: p.userId, kind: 'external', verifiedAt: Not(IsNull()) }, order: { primary: 'DESC' } });
      if (!w) throw new MissingConnection(key);
      ctx.wallet = w.address;
    }
    if (['photo', 'camera', 'health'].includes(key)) {
      ctx.proofs = await this.proofs.findBy({ participantId: p.id, kind: key as ProofSubmission['kind'], ...(period !== null ? { period } : {}) });
    }
    return ctx;
  }

  // ---------- count challenges ----------

  private async runCounts() {
    const now = new Date();
    const list = await this.challenges.findBy({ status: In(['live', 'settling']), mode: 'count' });
    for (const c of list) {
      const ended = now >= c.endsAt;
      const ps = await this.participants.findBy({ challengeId: c.id, status: 'active' });
      const last = c.periodCount - 1;
      for (const p of ps) {
        const final = ended ? await this.verifications.findOneBy({ participantId: p.id, period: last }) : null;
        if (final && ['verified', 'failed', 'disputed', 'excused'].includes(final.state)) continue;
        if (final?.nextAttemptAt && final.nextAttemptAt > now) continue;
        const fresh = !p.progressCheckedAt || now.getTime() - p.progressCheckedAt.getTime() > 30 * MIN;
        if (!ended && !fresh) continue;
        await this.countOne(c, p, ended, final ?? undefined).catch((e) => this.log.error(`count ${p.id}`, e instanceof Error ? e.stack : e));
      }
    }
  }

  private async countOne(c: Challenge, p: Participant, ended: boolean, existing?: Verification) {
    const key = c.providers[0];
    const adapter = this.adapters.get(key)!;
    const now = new Date();
    const to = ended ? c.endsAt : now;
    const started = Date.now();
    let total: number | null = null;
    let evidence: Record<string, unknown> = {};
    let unavailableReason: string | null = null;
    try {
      const r = await adapter.count(await this.context(c, p, key, c.startsAt, to, null));
      this.health.record(key, true, Date.now() - started);
      total = r.total;
      evidence = { ...r.evidence, fingerprints: r.fingerprints ?? [] };
      await this.participants.update({ id: p.id }, { progress: r.total, progressCheckedAt: now });
    } catch (e) {
      if (e instanceof ProviderUnavailable) this.health.record(key, false, Date.now() - started);
      unavailableReason = e instanceof Error ? e.message : 'error';
    }
    if (!ended) return;

    // The challenge is over: decide the final result on the last period.
    const last = c.periodCount - 1;
    const row = existing ?? this.verifications.create({ participantId: p.id, challengeId: c.id, userId: p.userId, period: last, provider: key, state: 'pending', attempts: 0 });
    row.attempts = (row.attempts ?? 0) + 1;
    const target = c.targetCount ?? 1;
    if (total === null) {
      const first = row.firstUnavailableAt ?? now;
      if (now.getTime() - first.getTime() >= this.graceMs) return this.decide(c, p, row, 'excused', `${PROVIDER_LABELS[key]} couldn't be reached to confirm your total`, { reason: unavailableReason });
      return this.save(row, { state: 'unavailable', firstUnavailableAt: first, detail: `Confirming your final total with ${PROVIDER_LABELS[key]}`, nextAttemptAt: new Date(now.getTime() + BACKOFF[Math.min(row.attempts - 1, BACKOFF.length - 1)]) });
    }
    if (['camera', 'health', 'photo'].includes(key) && (await this.proofs.existsBy({ participantId: p.id, status: 'pending_review' }))) {
      return this.save(row, { state: 'pending', detail: 'Waiting for proof reviews before the final count', nextAttemptAt: new Date(now.getTime() + 15 * MIN) });
    }
    if (total >= target) return this.decide(c, p, row, 'verified', `Reached ${total} of ${target} ${c.countUnit ?? ''}`.trim(), evidence);
    if (await this.health.overlapsOutage(key, new Date(c.endsAt.getTime() - 86_400_000), c.endsAt)) {
      return this.decide(c, p, row, 'excused', `${PROVIDER_LABELS[key]} had problems at the finish, so this can't count against you`, evidence);
    }
    return this.decide(c, p, row, 'failed', `Reached ${total} of ${target} ${c.countUnit ?? ''}`.trim(), evidence);
  }

  // ---------- decisions ----------

  private async save(row: Verification, patch: Partial<Verification>) {
    Object.assign(row, patch);
    return this.verifications.save(row);
  }

  async decide(c: Challenge, p: Participant, row: Verification, state: 'verified' | 'failed' | 'excused', detail: string, evidence: Record<string, unknown>, r?: DayResult) {
    const fingerprints = r?.fingerprints ?? (evidence.fingerprints as string[] | undefined) ?? [];
    const outcome = state === 'verified' ? 'verified' : state === 'failed' ? 'missed' : 'excused';
    await this.save(row, {
      state,
      detail: detail.slice(0, 300),
      evidence: { ...evidence, fingerprints },
      units: r?.units ?? row.units,
      decidedAt: new Date(),
      nextAttemptAt: null,
      chainOutcome: outcome,
      chainStatus: c.onChain ? 'queued' : 'none',
      chainError: null,
    });
    if (r?.baselinePatch && Object.keys(r.baselinePatch).length) {
      await this.participants.update({ id: p.id }, { baseline: { ...p.baseline, ...r.baselinePatch } as never });
      Object.assign(p.baseline, r.baselinePatch);
    }
    await this.recount(p.id);
    if (state === 'verified' && fingerprints.length) await this.checkReuse(row, fingerprints);
    this.events.emit(Events.PeriodDecided, { verificationId: row.id, participantId: p.id, challengeId: c.id, userId: p.userId, period: row.period, state } satisfies PeriodDecidedEvent);
    return row;
  }

  /** Counters always come from the rows, so they can't drift. Disputed days count as missed until resolved, like on-chain. */
  async recount(participantId: string) {
    const rows: { state: ProofState; n: string }[] = await this.verifications
      .createQueryBuilder('v')
      .select('v.state', 'state')
      .addSelect('COUNT(*)', 'n')
      .where('v.participant_id = :participantId', { participantId })
      .groupBy('v.state')
      .getRawMany();
    const n = (s: ProofState) => Number(rows.find((r) => r.state === s)?.n ?? 0);
    const missed = n('failed') + n('disputed');
    await this.participants.update({ id: participantId }, { verifiedCount: n('verified'), missedCount: missed, excusedCount: n('excused') });
    await this.strikeOut(participantId, missed);
  }

  /**
   * No-stake day-by-day challenges have no penalty to pay, so a miss past the allowed ones takes
   * you out: checks stop and you settle as not completed. A won dispute brings you back.
   */
  private async strikeOut(participantId: string, missed: number) {
    const p = await this.participants.findOne({ where: { id: participantId }, relations: { challenge: true } });
    const c = p?.challenge;
    if (!p || !c || p.settled || c.stakeMode !== 'none' || c.mode !== 'days') return;
    const out = missed > c.periodCount - c.requiredPeriods;
    if (out && p.status === 'active') await this.participants.update({ id: p.id, status: 'active' }, { status: 'failed' });
    else if (!out && p.status === 'failed') await this.participants.update({ id: p.id, status: 'failed', settled: false }, { status: 'active' });
  }

  /** The same commit, transaction, program or photo used as proof by two accounts (PRD §11). */
  private async checkReuse(row: Verification, fingerprints: string[]) {
    const others = await this.verifications
      .createQueryBuilder('v')
      .where("v.user_id != :userId AND v.state = 'verified' AND (v.evidence->'fingerprints') ?| :fps", { userId: row.userId, fps: fingerprints })
      .limit(5)
      .getMany();
    for (const o of others) {
      await this.risk.addSignal(row.userId, 'duplicate_proof', 'Used the same proof as another account', 40, `dup:${row.id}:${o.id}`, o.userId);
      await this.risk.addSignal(o.userId, 'duplicate_proof', 'Another account submitted the same proof', 25, `dup:${o.id}:${row.id}`, row.userId);
    }
  }

  /**
   * Settlement may only start once every participant has a final result for every period (every
   * non-frozen day, or the final total). Without this, a period nobody checked would silently
   * count as completed.
   */
  async isComplete(c: Challenge) {
    const ps = await this.participants.findBy({ challengeId: c.id, status: 'active' });
    if (!ps.length) return true;
    const decided = await this.verifications
      .createQueryBuilder('v')
      .select('v.participant_id', 'pid')
      .addSelect('COUNT(*)::int', 'n')
      .where("v.challenge_id = :id AND v.state IN ('verified', 'failed', 'excused')", { id: c.id })
      .andWhere(c.mode === 'count' ? 'v.period = :last' : '1=1', { last: c.periodCount - 1 })
      .groupBy('v.participant_id')
      .getRawMany<{ pid: string; n: number }>();
    const done = new Map(decided.map((d) => [d.pid, d.n]));
    return ps.every((p) => {
      if (c.mode === 'count') return (done.get(p.id) ?? 0) >= 1;
      const frozen = p.freezeFrom === null ? 0 : Math.max(0, Math.min(c.freezePeriods, c.periodCount - p.freezeFrom));
      return (done.get(p.id) ?? 0) >= c.periodCount - frozen;
    });
  }

  /** Called by disputes: a moderator's decision replaces the day's result. */
  async applyDisputeDecision(verificationId: string, upheld: boolean, note: string) {
    const row = await this.verifications.findOneByOrFail({ id: verificationId });
    await this.save(row, { state: upheld ? 'verified' : 'failed', detail: note.slice(0, 300), decidedAt: new Date() });
    await this.recount(row.participantId);
    return row;
  }

  async markDisputed(verificationId: string) {
    const row = await this.verifications.findOneByOrFail({ id: verificationId });
    await this.save(row, { state: 'disputed' });
    await this.recount(row.participantId);
  }

  async declareOutage(adminId: string, provider: ProviderKey, from: Date, to: Date | null, reason: string) {
    const res = await this.health.declare(adminId, provider, from, to, reason);
    const rows = res.protectedIds.length ? await this.verifications.findBy({ id: In(res.protectedIds) }) : [];
    for (const pid of new Set(rows.map((r) => r.participantId))) await this.recount(pid);
    return { id: res.incident.id, provider: res.incident.provider, startsAt: res.incident.startsAt, endsAt: res.incident.endsAt, protected: rows.length };
  }

  // ---------- start-of-challenge snapshot ----------

  @OnEvent(Events.ChallengeStarted, { async: true, promisify: true })
  async onStart(e: ChallengeEvent) {
    const c = await this.challenges.findOneBy({ id: e.challengeId });
    if (!c) return;
    const ps = await this.participants.findBy({ challengeId: c.id, status: 'active' });
    for (const p of ps) {
      let baseline = { ...p.baseline };
      for (const key of c.providers) {
        const a = this.adapters.get(key)!;
        if (!a.baseline) continue;
        try {
          baseline = { ...baseline, ...(await a.baseline(await this.context(c, p, key, c.startsAt, c.startsAt, null))) };
        } catch (err) {
          this.log.warn(`Baseline for ${p.id}/${key} failed: ${errMsg(err)}`);
        }
      }
      await this.participants.update({ id: p.id }, { baseline: baseline as never });
    }
  }
}

class MissingConnection extends Error {
  constructor(provider: string) {
    super(`${provider} not connected`);
  }
}
