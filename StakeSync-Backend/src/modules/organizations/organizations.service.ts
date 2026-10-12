import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomCode } from '../../common/crypto.js';
import { openImage } from '../../common/images.js';
import { AppError, conflict, forbidden, notFound } from '../../common/errors.js';
import { toUsd } from '../../common/money.js';
import { AuditService } from '../../core/audit.service.js';
import { StorageService } from '../../core/storage.service.js';
import { ChallengesService } from '../challenges/challenges.service.js';
import { Challenge, Participant } from '../challenges/entities/challenge.entities.js';
import { currentPeriod } from '../challenges/schedule.js';
import { person } from '../challenges/views.js';
import { CommunityService } from '../community/community.service.js';
import { MailService } from '../notifications/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SponsorContribution } from '../payments/entities/payment.entities.js';
import { User } from '../users/entities/user.entities.js';
import { Verification } from '../verification/entities/verification.entities.js';
import { Announcement, OrgMember, Organization, type OrgKind, type OrgPlan, type OrgRole } from './entities/organization.entities.js';

const MANAGE: OrgRole[] = ['Owner', 'Admin'];
const MODERATE: OrgRole[] = ['Owner', 'Admin', 'Moderator'];

const csv = (rows: (string | number | null)[][]) =>
  rows.map((r) => r.map((v) => (v === null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\n');

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization) private readonly orgs: Repository<Organization>,
    @InjectRepository(OrgMember) private readonly members: Repository<OrgMember>,
    @InjectRepository(Announcement) private readonly announcements: Repository<Announcement>,
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    @InjectRepository(Verification) private readonly verifications: Repository<Verification>,
    @InjectRepository(SponsorContribution) private readonly sponsors: Repository<SponsorContribution>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly challengesService: ChallengesService,
    private readonly community: CommunityService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  private async bySlug(slug: string) {
    const o = await this.orgs.findOneBy({ slug });
    if (!o || o.verification === 'rejected') throw notFound('organization');
    return o;
  }

  private async role(orgId: string, userId?: string) {
    if (!userId) return null;
    return (await this.members.findOneBy({ orgId, userId }))?.role ?? null;
  }

  private async require(slug: string, userId: string, allowed: OrgRole[]) {
    const o = await this.bySlug(slug);
    const role = await this.role(o.id, userId);
    if (!role || !allowed.includes(role)) throw forbidden(`Only ${allowed.join(', ').toLowerCase()}s can do this.`);
    return { o, role };
  }

  /** Apply for an organization account. Stake-Sync verifies it before it can host challenges. */
  async create(userId: string, dto: { name: string; kind: OrgKind; about: string; website?: string; plan?: OrgPlan }) {
    const user = await this.users.findOneByOrFail({ id: userId });
    if (!user.emailVerifiedAt) throw new AppError('email_unverified', 'Confirm your email before creating an organization.', HttpStatus.FORBIDDEN);
    const base = dto.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'org';
    let slug = base;
    for (let i = 0; await this.orgs.existsBy({ slug }); i++) slug = `${base}-${randomCode(3).toLowerCase()}`;
    const o = await this.orgs.save(
      this.orgs.create({
        slug,
        name: dto.name.trim(),
        kind: dto.kind,
        about: dto.about.trim(),
        website: dto.website ?? null,
        plan: dto.plan ?? 'Community',
        hue: Math.floor(Math.random() * 360),
        inviteCode: randomCode(8),
        createdById: userId,
      }),
    );
    await this.members.save(this.members.create({ orgId: o.id, userId, role: 'Owner' }));
    return this.view(o, userId);
  }

  async view(o: Organization, viewerId?: string) {
    const role = await this.role(o.id, viewerId);
    const [members, challenges, sponsored] = await Promise.all([
      this.members.countBy({ orgId: o.id }),
      this.challenges.find({ where: { orgId: o.id }, order: { startsAt: 'DESC' } }),
      this.sponsors.createQueryBuilder('s').select('COALESCE(SUM(s.amount), 0)', 'sum').where("s.org_id = :id AND s.status = 'confirmed'", { id: o.id }).getRawOne<{ sum: string }>(),
    ]);
    const visible = challenges.filter((c) => c.privacy === 'public' || role);
    return {
      slug: o.slug,
      name: o.name,
      kind: o.kind,
      person: { name: o.name, handle: o.slug, hue: o.hue, avatarUrl: o.avatarUrl },
      about: o.about,
      website: o.website,
      plan: o.plan,
      verification: o.verification,
      members,
      role,
      inviteCode: role ? o.inviteCode : undefined,
      challenges: visible.map((c) => c.slug),
      // Enough to show on an invite or profile without another request.
      featured: visible.slice(0, 3).map((c) => ({ id: c.slug, title: c.title, startsAt: c.startsAt, status: c.status })),
      sponsored: toUsd(BigInt(sponsored?.sum ?? '0')),
    };
  }

  async get(slug: string, viewerId?: string) {
    return this.view(await this.bySlug(slug), viewerId);
  }

  async mine(userId: string) {
    const ms = await this.members.findBy({ userId });
    if (!ms.length) return [];
    const os = await this.orgs.findBy({ id: In(ms.map((m) => m.orgId)) });
    return Promise.all(os.filter((o) => o.verification !== 'rejected').map((o) => this.view(o, userId)));
  }

  async directory() {
    const os = await this.orgs.find({ where: { verification: 'verified' }, order: { createdAt: 'ASC' }, take: 200 });
    return Promise.all(os.map((o) => this.view(o)));
  }

  async update(userId: string, slug: string, dto: { about?: string; website?: string | null; name?: string }) {
    const { o } = await this.require(slug, userId, MANAGE);
    if (dto.about !== undefined) o.about = dto.about.trim();
    if (dto.website !== undefined) o.website = dto.website;
    if (dto.name !== undefined) o.name = dto.name.trim();
    await this.orgs.save(o);
    return this.view(o, userId);
  }

  async setAvatar(userId: string, slug: string, file: Buffer) {
    const { o } = await this.require(slug, userId, MANAGE);
    const img = await (await openImage(file)).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
    o.avatarUrl = this.storage.url(await this.storage.put('public/orgs', img, 'image/webp'));
    await this.orgs.save(o);
    return this.view(o, userId);
  }

  // ---------- membership ----------

  async join(userId: string, code: string) {
    const o = await this.orgs.findOneBy({ inviteCode: code.trim().toUpperCase() });
    if (!o || o.verification === 'rejected') throw new AppError('invalid_code', "That invite code doesn't match an organization. Check it with whoever shared it.", HttpStatus.NOT_FOUND);
    if (!(await this.members.existsBy({ orgId: o.id, userId }))) await this.members.save(this.members.create({ orgId: o.id, userId, role: 'Member' }));
    return this.view(o, userId);
  }

  async leave(userId: string, slug: string) {
    const o = await this.bySlug(slug);
    const m = await this.members.findOneBy({ orgId: o.id, userId });
    if (!m) return;
    if (m.role === 'Owner' && (await this.members.countBy({ orgId: o.id, role: 'Owner' })) === 1) {
      throw conflict('last_owner', 'Make someone else an owner before you leave.');
    }
    await this.members.delete({ id: m.id });
  }

  async listMembers(userId: string, slug: string) {
    const o = await this.bySlug(slug);
    if (!(await this.role(o.id, userId))) throw forbidden('Only members can see the member list.');
    const ms = await this.members.find({ where: { orgId: o.id }, order: { createdAt: 'ASC' } });
    const users = ms.length ? await this.users.findBy({ id: In(ms.map((m) => m.userId)) }) : [];
    const orgChallenges = await this.challenges.findBy({ orgId: o.id });
    const parts = orgChallenges.length && ms.length ? await this.participants.findBy({ challengeId: In(orgChallenges.map((c) => c.id)), userId: In(ms.map((m) => m.userId)) }) : [];
    return ms.map((m) => {
      const mine = parts.filter((p) => p.userId === m.userId && p.status !== 'pending');
      const finished = mine.filter((p) => p.completed !== null);
      return {
        person: person(users.find((u) => u.id === m.userId)!),
        role: m.role,
        joined: m.createdAt.toISOString().slice(0, 10),
        challenges: mine.length,
        completion: finished.length ? Math.round((finished.filter((p) => p.completed).length / finished.length) * 100) : null,
      };
    });
  }

  async setRole(userId: string, slug: string, handle: string, role: OrgRole) {
    const { o, role: mine } = await this.require(slug, userId, MANAGE);
    if ((role === 'Owner' || role === 'Admin') && mine !== 'Owner') throw forbidden('Only owners can make someone an owner or admin.');
    const target = await this.users.findOneBy({ handle: handle.toLowerCase() });
    const m = target && (await this.members.findOneBy({ orgId: o.id, userId: target.id }));
    if (!m) throw notFound('member');
    if (m.role === 'Owner' && role !== 'Owner' && (await this.members.countBy({ orgId: o.id, role: 'Owner' })) === 1) {
      throw conflict('last_owner', 'An organization needs at least one owner.');
    }
    if (m.role === 'Owner' && mine !== 'Owner') throw forbidden();
    await this.members.update({ id: m.id }, { role });
  }

  async removeMember(userId: string, slug: string, handle: string) {
    const { o, role: mine } = await this.require(slug, userId, MANAGE);
    const target = await this.users.findOneBy({ handle: handle.toLowerCase() });
    const m = target && (await this.members.findOneBy({ orgId: o.id, userId: target.id }));
    if (!m) throw notFound('member');
    if (m.role === 'Owner' || (m.role === 'Admin' && mine !== 'Owner')) throw forbidden('You can’t remove this member.');
    await this.members.delete({ id: m.id });
  }

  async rotateInvite(userId: string, slug: string) {
    const { o } = await this.require(slug, userId, MANAGE);
    o.inviteCode = randomCode(8);
    await this.orgs.save(o);
    return { inviteCode: o.inviteCode };
  }

  /** Direct invitations (PRD §13): existing members get a notification, emails get a link. */
  async invite(userId: string, slug: string, handles: string[], emails: string[]) {
    const { o } = await this.require(slug, userId, MANAGE);
    const inviter = await this.users.findOneByOrFail({ id: userId });
    const users = handles.length ? await this.users.findBy({ handle: In(handles.map((h) => h.toLowerCase().replace(/^@/, ''))) }) : [];
    for (const u of users) {
      await this.notifications.notify(u.id, {
        kind: 'announcement',
        title: `${inviter.name} invited you to ${o.name}`,
        body: `Join with code ${o.inviteCode}.`,
        href: `/join?code=${o.inviteCode}`,
        dedupeKey: `orginvite:${o.id}:${u.id}`,
      });
    }
    for (const e of emails.slice(0, 50)) {
      await this.mail.send(e, `${inviter.name} invited you to ${o.name} on Stake-Sync`, `${inviter.name} invited you to join ${o.name} on Stake-Sync, where people commit to goals and prove they follow through.`, {
        label: `Join ${o.name}`,
        href: `/join?code=${o.inviteCode}`,
      });
    }
    return { invited: users.length + Math.min(emails.length, 50) };
  }

  // ---------- dashboard (PRD §14) ----------

  async dashboard(userId: string, slug: string) {
    const { o } = await this.require(slug, userId, MODERATE);
    const challenges = await this.challenges.find({ where: { orgId: o.id }, order: { startsAt: 'DESC' } });
    const live = challenges.filter((c) => c.status === 'live' || c.status === 'settling');
    const parts = live.length ? await this.participants.findBy({ challengeId: In(live.map((c) => c.id)), status: In(['active', 'completed', 'failed']) }) : [];
    let onTrack = 0;
    let atRisk = 0;
    let out = 0;
    const risky: { person: ReturnType<typeof person>; challengeId: string; strikesUsed: number; lastVerified: string | null }[] = [];
    const users = parts.length ? await this.users.findBy({ id: In([...new Set(parts.map((p) => p.userId))]) }) : [];
    for (const p of parts) {
      const c = live.find((x) => x.id === p.challengeId)!;
      const allowed = c.periodCount - c.requiredPeriods;
      if (p.status === 'failed' || p.missedCount > allowed) out++;
      else if (allowed - p.missedCount <= 1 || (c.freeStrikes > 0 && p.missedCount >= c.freeStrikes)) {
        atRisk++;
        if (risky.length < 50) {
          const last = await this.verifications.findOne({ where: { participantId: p.id, state: 'verified' }, order: { period: 'DESC' } });
          risky.push({ person: person(users.find((u) => u.id === p.userId)!), challengeId: c.slug, strikesUsed: Math.min(p.missedCount, c.freeStrikes), lastVerified: last?.decidedAt?.toISOString().slice(0, 10) ?? null });
        }
      } else onTrack++;
    }
    // Share of active participants verified on each of the last six days.
    const daily: number[] = [];
    for (let back = 6; back >= 1; back--) {
      let done = 0;
      let total = 0;
      for (const c of live) {
        const cur = currentPeriod(c);
        if (cur === null) continue;
        const period = cur - back;
        if (period < 0) continue;
        const n = parts.filter((p) => p.challengeId === c.id && p.status === 'active').length;
        total += n;
        done += await this.verifications.countBy({ challengeId: c.id, period, state: 'verified' });
      }
      daily.push(total ? Math.round((done / total) * 100) : 0);
    }
    return {
      org: await this.view(o, userId),
      stats: { active: parts.filter((p) => p.status === 'active').length, onTrack, atRisk, out, dailyCompletion: daily },
      challenges: await this.challengesService.views(challenges),
      atRisk: risky,
    };
  }

  async announce(userId: string, slug: string, body: string, challengeSlug?: string, pinned = false) {
    const { o } = await this.require(slug, userId, MODERATE);
    let challenge: Challenge | null = null;
    if (challengeSlug) {
      challenge = await this.challenges.findOneBy({ slug: challengeSlug, orgId: o.id });
      if (!challenge) throw notFound('challenge');
    }
    const audience = challenge
      ? (await this.participants.findBy({ challengeId: challenge.id, status: 'active' })).map((p) => p.userId)
      : (await this.members.findBy({ orgId: o.id })).map((m) => m.userId);
    const a = await this.announcements.save(this.announcements.create({ orgId: o.id, challengeId: challenge?.id ?? null, authorId: userId, body: body.trim(), pinned, reach: audience.length }));
    if (challenge) await this.community.post(challenge.slug, userId, body, undefined, true);
    await this.notifications.notifyMany(
      audience.filter((id) => id !== userId),
      { kind: 'announcement', title: o.name, body: body.slice(0, 200), href: challenge ? `/c/${challenge.slug}` : `/orgs/${o.slug}`, dedupeKey: `announce:${a.id}` },
    );
    return { id: a.id, reach: audience.length };
  }

  async listAnnouncements(userId: string, slug: string) {
    const o = await this.bySlug(slug);
    if (!(await this.role(o.id, userId))) throw forbidden();
    const rows = await this.announcements.find({ where: { orgId: o.id }, order: { createdAt: 'DESC' }, take: 50 });
    const cs = rows.length ? await this.challenges.findBy({ id: In(rows.map((r) => r.challengeId).filter((x): x is string => Boolean(x))) }) : [];
    return rows.map((r) => ({ id: r.id, challengeId: cs.find((c) => c.id === r.challengeId)?.slug ?? null, body: r.body, at: r.createdAt.toISOString(), pinned: r.pinned, reach: r.reach }));
  }

  /** Results export (PRD §14): one row per participant. */
  async exportResults(userId: string, slug: string, challengeSlug: string) {
    const { o } = await this.require(slug, userId, MANAGE);
    const c = await this.challenges.findOneBy({ slug: challengeSlug, orgId: o.id });
    if (!c) throw notFound('challenge');
    const parts = await this.participants.find({ where: { challengeId: c.id, status: In(['active', 'completed', 'failed', 'refunded']) }, order: { rank: 'ASC' } });
    const users = parts.length ? await this.users.findBy({ id: In(parts.map((p) => p.userId)) }) : [];
    await this.audit.log(userId, 'Exported results', c.title, `Organization ${o.name}`);
    return {
      filename: `${c.slug}-results.csv`,
      body: csv([
        ['rank', 'name', 'username', 'status', 'days_completed', 'days_missed', 'progress', 'stake_usdc', 'penalty_usdc', 'payout_usdc', 'claimed'],
        ...parts.map((p) => {
          const u = users.find((x) => x.id === p.userId)!;
          return [p.rank, u.name, u.handle, p.status, p.verifiedCount, p.missedCount, p.progress, toUsd(p.stake), toUsd(p.penalty), toUsd(p.claimable), p.claimed ? 'yes' : 'no'];
        }),
      ]),
    };
  }

  // ---------- Stake-Sync admin ----------

  async adminList() {
    const os = await this.orgs.find({ order: { createdAt: 'DESC' } });
    return Promise.all(
      os.map(async (o) => {
        const v = await this.view(o);
        return { name: o.name, slug: o.slug, kind: o.kind, members: v.members, challenges: v.challenges.length, sponsored: v.sponsored, plan: o.plan, verification: o.verification === 'verified' ? 'Verified' : o.verification === 'pending' ? 'Pending' : 'Rejected', applied: o.createdAt.toISOString().slice(0, 10), hue: o.hue };
      }),
    );
  }

  async decide(adminId: string, slug: string, approve: boolean, reason: string) {
    const o = await this.orgs.findOneBy({ slug });
    if (!o) throw notFound('organization');
    o.verification = approve ? 'verified' : 'rejected';
    o.verificationReason = reason;
    await this.orgs.save(o);
    await this.audit.log(adminId, approve ? 'Approved organization' : 'Rejected organization', o.name, reason);
    const owners = await this.members.findBy({ orgId: o.id, role: 'Owner' });
    await this.notifications.notifyMany(
      owners.map((m) => m.userId),
      {
        kind: 'announcement',
        title: approve ? `${o.name} is verified` : `${o.name} wasn't approved`,
        body: approve ? 'You can now create and sponsor challenges for your community.' : `${reason} You can reply to our email to appeal.`,
        href: `/orgs/${o.slug}`,
        dedupeKey: `orgdecision:${o.id}:${o.verification}`,
        email: true,
      },
    );
  }
}
