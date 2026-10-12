import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Events, type ParticipantEvent } from '../../common/events.js';
import { toUsd } from '../../common/money.js';
import { SettingsService } from '../../core/settings.service.js';
import { Challenge, Participant, type ProviderKey } from '../challenges/entities/challenge.entities.js';
import { person } from '../challenges/views.js';
import { Dispute } from '../disputes/entities/dispute.entity.js';
import { OrgMember, Organization } from '../organizations/entities/organization.entities.js';
import { SponsorContribution } from '../payments/entities/payment.entities.js';
import { User } from '../users/entities/user.entities.js';
import { Verification } from '../verification/entities/verification.entities.js';
import { Achievement, ReputationRecord } from './entities/reputation.entities.js';

const DIFFICULTY = { Starter: 1, Steady: 1.5, Hard: 2 } as const;
/** How hard the proof is to fake. API data beats self-submitted photos. */
const STRENGTH: Record<ProviderKey, number> = { github: 1, solana: 1, leetcode: 1, codeforces: 1, wakatime: 1, camera: 0.8, health: 0.8, photo: 0.7 };
const BASE_SCORE = 300;
const MONTH = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Commitment score and verified achievements (PRD §22, §23). Built from difficulty, completion,
 * consistency, verification strength, disputes and history. Stake size plays no part, so nobody
 * can buy reputation.
 */
@Injectable()
export class ReputationService {
  constructor(
    @InjectRepository(Achievement) private readonly achievements: Repository<Achievement>,
    @InjectRepository(ReputationRecord) private readonly records: Repository<ReputationRecord>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    @InjectRepository(Dispute) private readonly disputes: Repository<Dispute>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Verification) private readonly verifications: Repository<Verification>,
    @InjectRepository(OrgMember) private readonly members: Repository<OrgMember>,
    @InjectRepository(Organization) private readonly orgs: Repository<Organization>,
    @InjectRepository(SponsorContribution) private readonly sponsors: Repository<SponsorContribution>,
    private readonly settings: SettingsService,
  ) {}

  @OnEvent(Events.ParticipantSettled, { async: true, promisify: true })
  async onSettled(e: ParticipantEvent) {
    const p = await this.participants.findOneBy({ id: e.participantId });
    const c = await this.challenges.findOneBy({ id: e.challengeId });
    if (!p || !c || p.completed === null) return;
    const decided = p.verifiedCount + p.missedCount;
    const consistency = decided ? p.verifiedCount / decided : 1;
    const difficulty = DIFFICULTY[c.difficulty];
    const length = Math.min(2, Math.max(0.5, c.durationDays / 15));
    const strength = Math.min(...c.providers.map((x) => STRENGTH[x]));
    const lostDisputes = await this.disputes.countBy({ participantId: p.id, status: 'failure_confirmed' });
    const factors = { difficulty, length, consistency: Math.round(consistency * 100) / 100, strength, lostDisputes };
    const delta = p.completed ? Math.round(20 * difficulty * length * consistency * strength) - lostDisputes * 2 : -Math.round(6 / difficulty) - lostDisputes * 2;

    await this.records
      .createQueryBuilder()
      .insert()
      .values({ userId: p.userId, challengeId: c.id, delta, reason: p.completed ? `Completed ${c.title}` : `Didn't complete ${c.title}`, factors })
      .orIgnore()
      .execute();
    if (p.completed) {
      const primary = c.providers[0];
      const detail =
        c.mode === 'days'
          ? `${p.verifiedCount} of ${c.periodCount} days verified`
          : `${p.progress} ${c.countUnit ?? ''}`.trim() + (primary === 'leetcode' || primary === 'codeforces' ? ' (new problems)' : '');
      await this.achievements.createQueryBuilder().insert().values({ userId: p.userId, challengeId: c.id, title: c.title, provider: primary, detail, earnedAt: new Date() }).orIgnore().execute();
    }
    await this.recompute(p.userId);
  }

  async recompute(userId: string) {
    const sum = await this.records.createQueryBuilder('r').select('COALESCE(SUM(r.delta), 0)', 'sum').where('r.user_id = :userId', { userId }).getRawOne<{ sum: string }>();
    const score = Math.max(0, Math.min(1000, BASE_SCORE + Number(sum?.sum ?? 0)));
    await this.users.update({ id: userId }, { score });
    return score;
  }

  /** Why the score is what it is, line by line. */
  async breakdown(userId: string) {
    const rows = await this.records.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 100 });
    return { base: BASE_SCORE, score: (await this.users.findOneByOrFail({ id: userId })).score, items: rows.map((r) => ({ at: r.createdAt.toISOString(), delta: r.delta, reason: r.reason, factors: r.factors })) };
  }

  // ---------- leaderboards ----------

  async people(viewerId?: string) {
    const users = await this.users
      .createQueryBuilder('u')
      .where("u.status = 'active' AND (u.privacy->>'showOnLeaderboards')::boolean IS NOT FALSE AND u.score > :base", { base: BASE_SCORE })
      .orderBy('u.score', 'DESC')
      .take(100)
      .getMany();
    if (!users.length) return [];
    const ids = users.map((u) => u.id);
    const parts = await this.participants.find({ where: { userId: In(ids), status: In(['completed', 'failed']) }, relations: { challenge: true } });
    const memberships = await this.members.findBy({ userId: In(ids) });
    const orgs = memberships.length ? await this.orgs.findBy({ id: In(memberships.map((m) => m.orgId)), verification: 'verified' }) : [];
    const prev = (await this.settings.get<Record<string, number> | undefined>('leaderboard_prev')) ?? {};
    const streaks = await this.streaks(ids);
    return users.map((u, i) => {
      const mine = parts.filter((p) => p.userId === u.id);
      const done = mine.filter((p) => p.completed);
      const cats = new Map<string, number>();
      for (const p of done) cats.set(p.challenge!.category, (cats.get(p.challenge!.category) ?? 0) + 1);
      const top = [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const org = orgs.find((o) => memberships.some((m) => m.userId === u.id && m.orgId === o.id));
      return {
        person: person(u),
        score: u.score,
        completed: done.length,
        rate: mine.length ? Math.round((done.length / mine.length) * 1000) / 10 : 0,
        streak: streaks.get(u.id) ?? 0,
        top,
        org: org?.name,
        change: prev[u.id] ? prev[u.id] - (i + 1) : 0,
        you: u.id === viewerId || undefined,
      };
    });
  }

  /** Consecutive days, up to yesterday, with at least one verified day in any challenge. */
  private async streaks(userIds: string[]) {
    const rows: { user_id: string; day: string }[] = await this.verifications.query(
      `SELECT DISTINCT v.user_id, to_char((c.starts_at + (v.period * c.period_secs) * interval '1 second') AT TIME ZONE c.timezone, 'YYYY-MM-DD') AS day
       FROM verifications v JOIN challenges c ON c.id = v.challenge_id
       WHERE v.state = 'verified' AND v.user_id = ANY($1) AND c.mode = 'days'
         AND c.starts_at + (v.period * c.period_secs) * interval '1 second' > now() - interval '400 days'`,
      [userIds],
    );
    const byUser = new Map<string, Set<string>>();
    for (const r of rows) byUser.set(r.user_id, (byUser.get(r.user_id) ?? new Set()).add(r.day));
    const out = new Map<string, number>();
    for (const [id, days] of byUser) {
      let n = 0;
      const d = new Date();
      if (!days.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
      while (days.has(d.toISOString().slice(0, 10))) {
        n++;
        d.setUTCDate(d.getUTCDate() - 1);
      }
      out.set(id, n);
    }
    return out;
  }

  async organizations() {
    const orgs = await this.orgs.findBy({ verification: 'verified' });
    const prev = (await this.settings.get<Record<string, number> | undefined>('leaderboard_orgs_prev')) ?? {};
    const rows = await Promise.all(
      orgs.map(async (o) => {
        const cs = await this.challenges.findBy({ orgId: o.id });
        const parts = cs.length ? await this.participants.findBy({ challengeId: In(cs.map((c) => c.id)), status: In(['active', 'completed', 'failed']) }) : [];
        const finished = parts.filter((p) => p.completed !== null);
        const sponsored = await this.sponsors.createQueryBuilder('s').select('COALESCE(SUM(s.amount), 0)', 'sum').where("s.org_id = :id AND s.status = 'confirmed'", { id: o.id }).getRawOne<{ sum: string }>();
        return {
          name: o.name,
          slug: o.slug,
          person: { name: o.name, handle: o.slug, hue: o.hue, avatarUrl: o.avatarUrl },
          active: parts.filter((p) => p.status === 'active').length,
          rate: finished.length ? Math.round((finished.filter((p) => p.completed).length / finished.length) * 1000) / 10 : 0,
          challenges: cs.length,
          sponsored: toUsd(BigInt(sponsored?.sum ?? '0')),
        };
      }),
    );
    return rows
      .sort((a, b) => b.rate - a.rate || b.active - a.active)
      .map((r, i) => ({ ...r, change: prev[r.slug] ? prev[r.slug] - (i + 1) : 0 }));
  }

  /** Daily snapshot so leaderboards can show movement. */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async snapshot() {
    const people = await this.people();
    await this.settings.set('leaderboard_prev', Object.fromEntries(await Promise.all(people.map(async (p, i) => [(await this.users.findOneByOrFail({ handle: p.person.handle })).id, i + 1]))));
    const orgs = await this.organizations();
    await this.settings.set('leaderboard_orgs_prev', Object.fromEntries(orgs.map((o, i) => [o.slug, i + 1])));
  }

  async achievementsFor(handle: string) {
    const u = await this.users.findOneBy({ handle: handle.toLowerCase() });
    if (!u) return [];
    const rows = await this.achievements.find({ where: { userId: u.id }, order: { earnedAt: 'DESC' } });
    return rows.map((a) => ({ id: a.id, title: a.title, provider: a.provider, earned: MONTH.format(a.earnedAt), detail: a.detail }));
  }
}
