import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { PublicKey } from '@solana/web3.js';
import { In, LessThan, LessThanOrEqual, Repository } from 'typeorm';
import { Events, type ChallengeEvent, type ParticipantEvent } from '../../common/events.js';
import { completed, distribute, forfeit, penalty } from '../../common/settlement-math.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SolanaService } from '../payments/solana/solana.service.js';
import { FeedItem } from '../community/entities/community.entities.js';
import { User } from '../users/entities/user.entities.js';
import { Verification } from '../verification/entities/verification.entities.js';
import { VerificationService } from '../verification/verification.service.js';
import { Challenge, Participant } from './entities/challenge.entities.js';
import { ParticipationService } from './participation.service.js';
import { currentPeriod, periodEnd, periodStart, settleAfter } from './schedule.js';
import { leetcodeQuestion } from '../verification/clients/leetcode.js';
import { assignedProblems } from '../verification/leetcode-assigned.js';

/** Moves challenges through open → live → settling → ended, and keeps ranks and reminders going. */
@Injectable()
export class LifecycleService {
  private readonly log = new Logger('Lifecycle');
  private running = false;

  constructor(
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    @InjectRepository(Verification) private readonly verifications: Repository<Verification>,
    @InjectRepository(FeedItem) private readonly feed: Repository<FeedItem>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly participation: ParticipationService,
    private readonly verification: VerificationService,
    private readonly solana: SolanaService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.start();
      await this.expireUnfunded();
      await this.end();
      await this.settleOffChain();
      await this.sweepPendingJoins();
    } catch (e) {
      this.log.error('Lifecycle tick failed', e instanceof Error ? e.stack : e);
    } finally {
      this.running = false;
    }
  }

  private async start() {
    const due = await this.challenges.findBy({ status: 'open', startsAt: LessThanOrEqual(new Date()) });
    for (const c of due) {
      await this.challenges.update({ id: c.id }, { status: 'live' });
      this.events.emit(Events.ChallengeStarted, { challengeId: c.id } satisfies ChallengeEvent);
      const ps = await this.participants.findBy({ challengeId: c.id, status: 'active' });
      await this.notifications.notifyMany(
        ps.map((p) => p.userId),
        { kind: 'starting', title: `${c.title} has started`, body: `Day 1 is today. ${c.requirement}.`, href: `/c/${c.slug}`, dedupeKey: `started:${c.id}`, email: true },
      );
    }
  }

  /** Escrow never got created before the start date: nobody could have paid, so close it quietly. */
  private async expireUnfunded() {
    const stale = await this.challenges.findBy({ status: 'pending_chain', startsAt: LessThanOrEqual(new Date()) });
    for (const c of stale) {
      await this.challenges.update({ id: c.id }, { status: 'cancelled' });
      await this.notifications.notify(c.creatorId, {
        kind: 'problem',
        title: `${c.title} couldn’t be set up in time`,
        body: 'We couldn’t create its escrow before the start date, so it was cancelled. Nobody was charged. You can create it again with a later start.',
        href: '/create',
        dedupeKey: `expired:${c.id}`,
      });
    }
  }

  private async end() {
    const done = await this.challenges.findBy({ status: 'live', endsAt: LessThanOrEqual(new Date()) });
    for (const c of done) await this.challenges.update({ id: c.id }, { status: 'settling' });
  }

  /** No-money challenges settle here, with the same rules the program uses. */
  private async settleOffChain() {
    const list = await this.challenges.findBy({ status: 'settling', onChain: false });
    for (const c of list) {
      if (new Date() < settleAfter(c)) continue;
      const open = await this.verifications.countBy({ challengeId: c.id, state: In(['pending', 'unavailable', 'disputed']) });
      if (open || !(await this.verification.isComplete(c))) continue;
      // 'failed' and unsettled: struck out of a no-stake challenge before the end.
      const ps = await this.participants.findBy({ challengeId: c.id, status: In(['active', 'failed']), settled: false });
      let finishers = 0;
      let forfeited = 0n;
      for (const p of ps) {
        const done = completed(p.missedCount, c.periodCount, c.requiredPeriods);
        const pen = done ? penalty(p.stake, p.missedCount, c.freeStrikes, c.penaltiesBps.map((b) => b / 100)) : 0n;
        forfeited += forfeit(p.stake, done, pen);
        if (done) finishers++;
        await this.participants.update({ id: p.id }, { settled: true, completed: done, penalty: pen, status: done ? 'completed' : 'failed' });
        this.events.emit(Events.ParticipantSettled, { participantId: p.id, challengeId: c.id, userId: p.userId } satisfies ParticipantEvent);
      }
      const d = distribute(c.sponsorPool, forfeited, finishers, c.feeBps, c.forfeitsToFinishers);
      await this.challenges.update({ id: c.id }, { status: 'ended', settledAt: new Date(), finisherCount: finishers, rewardPerFinisher: d.rewardPerFinisher });
      this.events.emit(Events.ChallengeFinalized, { challengeId: c.id } satisfies ChallengeEvent);
    }
  }

  /** Wallet joins that were never signed: check the chain once, then let them go. */
  private async sweepPendingJoins() {
    const stale = await this.participants.find({ where: { status: 'pending', createdAt: LessThan(new Date(Date.now() - 20 * 60_000)) }, relations: { challenge: true }, take: 100 });
    for (const p of stale) {
      const c = p.challenge!;
      if (c.onChain && p.wallet && c.challengePda) {
        const onChain = await this.solana.fetchParticipant(new PublicKey(c.challengePda), new PublicKey(p.wallet)).catch(() => null);
        if (onChain) {
          p.stake = BigInt(onChain.stake.toString());
          p.joinFee = BigInt(onChain.joinFee.toString());
          await this.participation.activate(c, p, null);
          continue;
        }
      }
      await this.participants.delete({ id: p.id, status: 'pending' });
    }
  }

  // ---------- ranks, feed and reminders ----------

  @Cron(CronExpression.EVERY_10_MINUTES)
  async ranks() {
    const live = await this.challenges.findBy({ status: In(['live', 'settling']) });
    for (const c of live) {
      const ps = await this.participants.find({ where: { challengeId: c.id, status: In(['active', 'completed', 'failed']) } });
      const sorted = [...ps].sort(
        (a, b) =>
          (c.mode === 'days' ? b.verifiedCount - a.verifiedCount : b.progress - a.progress) ||
          a.missedCount - b.missedCount ||
          (a.activatedAt?.getTime() ?? 0) - (b.activatedAt?.getTime() ?? 0),
      );
      for (const [i, p] of sorted.entries()) {
        const rank = i + 1;
        if (p.rank === rank) continue;
        await this.participants.update({ id: p.id }, { previousRank: p.rank, rank });
        const prev = p.rank;
        if (prev && prev - rank >= 10) {
          await this.notifications.notify(p.userId, {
            kind: 'leaderboard',
            title: `You moved up ${prev - rank} places`,
            body: `${c.title}. You’re now #${rank}.`,
            href: `/c/${c.slug}`,
            dedupeKey: `rank:${c.id}:${new Date().toISOString().slice(0, 10)}`,
          });
        }
        if (prev && prev > 10 && rank <= 10 && ps.length > 20) {
          const u = await this.users.findOneBy({ id: p.userId });
          if (u?.privacy.showOnLeaderboards) {
            await this.feed
              .createQueryBuilder()
              .insert()
              .values({ challengeId: c.id, userId: p.userId, kind: 'rank', text: `${u.name.split(' ')[0]} moved into the top 10`, dedupeKey: `top10:${c.id}:${p.userId}` })
              .orIgnore()
              .execute();
          }
        }
      }
    }
  }

  /**
   * LeetCode challenges with set problems: each morning, everyone still in gets that day's
   * problems with links, in the app and by email. Runs during the first hours of each day.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async leetcodeDaily() {
    const live = await this.challenges.findBy({ status: 'live', mode: 'days' });
    const now = new Date();
    for (const c of live.filter((x) => x.verificationConfig.leetcode?.assigned)) {
      const p = currentPeriod(c, now);
      if (p === null || now.getTime() - periodStart(c, p).getTime() > 3 * 3600_000) continue;
      try {
        const slugs = await assignedProblems(c, p);
        if (!slugs) continue;
        const qs = await Promise.all(slugs.map((s) => leetcodeQuestion(s)));
        const list = qs.map((q) => `${q.title} (${q.difficulty}): ${q.url}`).join('\n');
        const ps = await this.participants.findBy({ challengeId: c.id, status: 'active' });
        for (const part of ps) {
          await this.notifications.notify(part.userId, {
            kind: 'deadline',
            title: qs.length === 1 ? `Day ${p + 1}: ${qs[0].title}` : `Day ${p + 1}: ${qs.length} problems to solve`,
            body: `${c.title}. Solve ${qs.length === 1 ? 'this' : 'these'} on LeetCode today:\n${list}`,
            href: `/c/${c.slug}`,
            email: true,
            emailAction: 'Open the challenge',
            dedupeKey: `lcdaily:${c.id}:${p}`,
          });
        }
      } catch (e) {
        this.log.warn(`LeetCode daily for ${c.slug} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  /** "Requirement approaching deadline" (PRD §25): once per day, a few hours before it closes. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async reminders() {
    const live = await this.challenges.findBy({ status: 'live', mode: 'days' });
    const now = new Date();
    for (const c of live) {
      const p = currentPeriod(c, now);
      if (p === null) continue;
      const left = periodEnd(c, p).getTime() - now.getTime();
      if (left > 4 * 3600_000 || left < 30 * 60_000) continue;
      const ps = await this.participants.findBy({ challengeId: c.id, status: 'active' });
      const done = new Set((await this.verifications.findBy({ challengeId: c.id, period: p, state: 'verified' })).map((v) => v.participantId));
      for (const part of ps) {
        if (done.has(part.id)) continue;
        if (part.freezeFrom !== null && p >= part.freezeFrom && p < part.freezeFrom + c.freezePeriods) continue;
        const hours = Math.max(1, Math.round(left / 3600_000));
        await this.notifications.notify(part.userId, {
          kind: 'deadline',
          title: `Day ${p + 1} closes in about ${hours} hour${hours === 1 ? '' : 's'}`,
          body: `${c.title}. ${c.requirement.split(' on at least')[0]}.`,
          href: `/c/${c.slug}`,
          dedupeKey: `deadline:${c.id}:${p}`,
        });
      }
    }
  }

  @OnEvent(Events.PeriodDecided, { async: true, promisify: true })
  async onDecided(e: { challengeId: string; userId: string; period: number; state: string }) {
    if (e.state !== 'verified') return;
    const c = await this.challenges.findOneBy({ id: e.challengeId });
    const u = await this.users.findOneBy({ id: e.userId });
    if (!c || !u?.privacy.showOnLeaderboards || c.mode !== 'days') return;
    await this.feed
      .createQueryBuilder()
      .insert()
      .values({ challengeId: c.id, userId: u.id, kind: 'day', text: `${u.name.split(' ')[0]} completed Day ${e.period + 1}`, dedupeKey: `day:${c.id}:${u.id}:${e.period}` })
      .orIgnore()
      .execute();
    const count = await this.verifications.countBy({ challengeId: c.id, period: e.period, state: 'verified' });
    for (const m of [10, 50, 100, 250, 500, 1000, 5000]) {
      if (count === m) {
        await this.feed
          .createQueryBuilder()
          .insert()
          .values({ challengeId: c.id, kind: 'milestone', text: `${m} participants have completed day ${e.period + 1}`, dedupeKey: `milestone:${c.id}:${e.period}:${m}` })
          .orIgnore()
          .execute();
      }
    }
  }
}
