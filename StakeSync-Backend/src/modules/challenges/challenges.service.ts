import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { randomCode } from '../../common/crypto.js';
import { openImage } from '../../common/images.js';
import { AppError, forbidden, notFound } from '../../common/errors.js';
import { Events, type ChallengeEvent } from '../../common/events.js';
import { toUnits, USDC } from '../../common/money.js';
import { ladderBps } from '../../common/settlement-math.js';
import { AuditService } from '../../core/audit.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { StorageService } from '../../core/storage.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { Organization, OrgMember } from '../organizations/entities/organization.entities.js';
import { ConnectedAccount, User } from '../users/entities/user.entities.js';
import type { CreateChallengeDto, ListChallengesQuery } from './dto/challenge.dto.js';
import { Challenge, ChallengeRule, Participant, type VerificationConfig, type VerificationLevel } from './entities/challenge.entities.js';
import { TERMS_VERSION } from '../../common/terms.js';
import { rulesDocument } from './rules.js';
import { sanitizeVerificationConfig } from './verification-config.js';
import { zonedMidnight } from './schedule.js';
import { leetcodeQuestion } from '../verification/clients/leetcode.js';
import { assignedProblems } from '../verification/leetcode-assigned.js';
import { currentPeriod } from './schedule.js';
import { challengeView, defaultUnit, person, requirementText } from './views.js';

const DAY = 86_400;

function defaultConfig(c: CreateChallengeDto): VerificationConfig {
  const given = sanitizeVerificationConfig(c.verificationConfig);
  const out: VerificationConfig = {};
  for (const p of c.providers) {
    if (p === 'github') out.github = { minChangedLines: 5, countPullRequests: true, mergedOnly: c.mode === 'count', ...given.github };
    if (p === 'solana') out.solana = { cluster: 'devnet', activity: c.mode === 'count' ? 'deploy' : 'transaction', ...given.solana };
    if (p === 'leetcode') out.leetcode = { newOnly: true, ...given.leetcode };
    if (p === 'codeforces') out.codeforces = { ...given.codeforces };
    if (p === 'wakatime') out.wakatime = { minMinutes: 30, ...given.wakatime };
    if (p === 'camera') out.camera = { exercise: 'pushups', reps: 100, ...given.camera };
    if (p === 'health') out.health = { metric: c.mode === 'count' ? 'distance' : 'steps', threshold: c.mode === 'count' ? 1000 : 10_000, ...given.health };
    if (p === 'photo') out.photo = { instructions: 'Show today’s progress clearly', ...given.photo };
  }
  const sched = out.leetcode?.schedule;
  if (sched && c.mode === 'days' && sched.length !== c.duration) {
    throw new AppError('invalid_verification', `The problem list has ${sched.length} days but the challenge runs ${c.duration}. Add problems for every day.`);
  }
  if (given.criteria) {
    // Photo-checked rules are judged by reviewers from the daily photo, so the challenge needs one.
    if (given.criteria.some((r) => r.check === 'photo') && !c.providers.includes('photo')) {
      throw new AppError('invalid_verification', 'Rules checked by photo need Photo proof as one of the verification methods.');
    }
    out.criteria = given.criteria;
  }
  return out;
}

/** Mirrors the create flow: higher stakes or big sponsor pools need stronger accounts (PRD §11). */
function levelFor(topStakeUsd: number, poolUsd: number): VerificationLevel {
  if (topStakeUsd === 0 && poolUsd === 0) return 'Basic';
  if (topStakeUsd > 50 || poolUsd >= 5000) return 'Enhanced';
  return 'Verified user';
}

function slugify(title: string) {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'challenge'
  );
}

/** Fewest people a challenge needs before it can show as trending. */
const TRENDING_MIN = 5;

@Injectable()
export class ChallengesService {
  constructor(
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    @InjectRepository(ChallengeRule) private readonly rules: Repository<ChallengeRule>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Organization) private readonly orgs: Repository<Organization>,
    @InjectRepository(OrgMember) private readonly members: Repository<OrgMember>,
    @InjectRepository(ConnectedAccount) private readonly connections: Repository<ConnectedAccount>,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------- creation (PRD §8) ----------

  /**
   * Every rule-bearing field of a challenge from the create form, validated. Shared by create and
   * by edits made before anyone joins, so both follow exactly the same rules.
   */
  private async fieldsFrom(dto: CreateChallengeDto, user: User) {
    const limits = await this.settings.limits();
    const structures = await this.settings.structures();
    const preset = structures.find((s) => s.key === dto.preset);
    if (!preset) throw new AppError('invalid_structure', 'Choose one of the approved strike structures.');

    const tz = dto.timezone ?? user.timezone;
    const startsAt = zonedMidnight(dto.start, tz);
    if (startsAt.getTime() < Date.now() + 2 * 3600_000) throw new AppError('start_too_soon', 'Pick a start date at least a few hours from now, so people have time to join.');
    if (startsAt.getTime() > Date.now() + 180 * DAY * 1000) throw new AppError('start_too_far', 'Pick a start date within the next six months.');
    if (dto.duration > limits.maxDurationDays) throw new AppError('too_long', `Challenges can run for up to ${limits.maxDurationDays} days.`);

    // Stakes
    let stakeMin = 0n;
    let stakeMax = 0n;
    if (dto.stakeMode === 'fixed') {
      if (!dto.stake || dto.stake < 1) throw new AppError('invalid_stake', 'Set a stake of at least $1, or choose no stake.');
      stakeMin = stakeMax = toUnits(dto.stake);
    } else if (dto.stakeMode === 'range') {
      const [lo, hi] = dto.range ?? [0, 0];
      if (lo < 1 || hi <= lo) throw new AppError('invalid_stake', 'Set a range where the minimum is at least $1 and below the maximum.');
      stakeMin = toUnits(lo);
      stakeMax = toUnits(hi);
    }
    if (stakeMax > BigInt(limits.maxStakeUsd) * USDC) throw new AppError('invalid_stake', `Stakes are capped at $${limits.maxStakeUsd} for now.`);
    const pledge = toUnits(dto.pool ?? 0);
    if (pledge > BigInt(limits.maxSponsorUsd) * USDC) throw new AppError('invalid_pool', `Sponsor pools are capped at $${limits.maxSponsorUsd.toLocaleString('en')}.`);

    // Requirement
    const days = dto.mode === 'days';
    if (days && (!dto.required || dto.required > dto.duration)) throw new AppError('invalid_requirement', 'Required days must be between 1 and the challenge length.');
    if (!days && !dto.target) throw new AppError('invalid_requirement', 'Set a target to reach.');
    if (dto.freeze && !days) throw new AppError('invalid_freeze', 'Freezes only apply to day-by-day challenges.');
    const cfg = defaultConfig(dto);
    const primary = dto.providers[0];

    // Count mode maps onto the escrow as daily periods where only the final result is recorded,
    // and reaching the target is required. Strikes and freezes apply to day-by-day challenges.
    const asked = days ? dto.required! : dto.duration;
    const freeStrikes = days ? Math.min(preset.freeStrikes, dto.duration - asked) : 0;
    // With no stake there is no penalty to pay, so a miss past the free strikes puts you out.
    // Raising the required days keeps the program's completion rule in step with that.
    const required = days && dto.stakeMode === 'none' ? dto.duration - freeStrikes : asked;
    const ladder = days ? ladderBps(preset.penalties) : [0, 0, 0];
    const freezePeriods = days && dto.freeze ? (dto.freezeDays ?? 2) : 0;
    const onChain = dto.stakeMode !== 'none' || pledge > 0n;

    return {
      title: dto.title.trim(),
      summary: (dto.summary ?? dto.description.split(/(?<=\.)\s/)[0]).trim().slice(0, 160),
      description: dto.description.trim(),
      category: dto.category,
      providers: dto.providers,
      verificationConfig: cfg,
      privacy: dto.privacy,
      participantLimit: dto.limit ?? null,
      stakeMode: dto.stakeMode,
      stakeMin,
      stakeMax,
      sponsorPledge: pledge,
      mode: dto.mode,
      durationDays: dto.duration,
      periodSecs: DAY,
      periodCount: dto.duration,
      requiredPeriods: required,
      targetCount: days ? null : dto.target!,
      countUnit: days ? null : (dto.countUnit ?? defaultUnit(primary, cfg)),
      requirement: dto.requirement?.trim() || requirementText(primary, cfg, dto.mode, required, dto.duration, dto.target ?? 0),
      penaltyPreset: preset.key,
      freeStrikes,
      penaltiesBps: ladder,
      freezePeriods,
      disputeWindowSecs: (dto.disputeWindowHours ?? 48) * 3600,
      startsAt,
      joinBy: startsAt,
      endsAt: new Date(startsAt.getTime() + dto.duration * DAY * 1000),
      timezone: tz,
      difficulty: dto.difficulty ?? (dto.duration <= 14 ? 'Hard' : 'Steady'),
      verificationLevel: levelFor(Number(stakeMax / USDC), Number(pledge / USDC)),
      forfeitsToFinishers: dto.forfeits ?? true,
      ...(await this.feesFor()),
      onChain,
      status: onChain ? 'pending_chain' : 'open',

    } satisfies Partial<Challenge>;
  }

  async create(userId: string, dto: CreateChallengeDto) {
    if (dto.agreeToRules !== true) {
      throw new AppError('rules_not_accepted', 'Tick the box to confirm you agree to the challenge rules and the Terms of Service.');
    }
    const user = await this.users.findOneByOrFail({ id: userId });
    if (user.termsVersion !== TERMS_VERSION) await this.users.update({ id: userId }, { termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION });
    if (user.status !== 'active') throw forbidden('Your account is under review, so you can’t create challenges right now.');
    if (!user.emailVerifiedAt) throw new AppError('email_unverified', 'Confirm your email before creating a challenge.', HttpStatus.FORBIDDEN);

    let org: Organization | null = null;
    if (dto.host !== 'me') {
      org = await this.orgs.findOneBy({ slug: dto.host });
      const m = org && (await this.members.findOneBy({ orgId: org.id, userId }));
      if (!org || !m || !['Owner', 'Admin'].includes(m.role)) throw forbidden('Only owners and admins can create challenges for this organization.');
      if (org.verification !== 'verified') throw forbidden(`${org.name} can create challenges once Stake-Sync verifies it. We usually reply within two working days.`);
    }
    if (dto.privacy === 'org' && !org) throw new AppError('invalid_privacy', 'Members-only challenges need an organization as the host.');

    const fields = await this.fieldsFrom(dto, user);
    const c = this.challenges.create({
      ...fields,
      slug: await this.uniqueSlug(dto.title),
      creatorId: userId,
      orgId: org?.id ?? null,
      creatorAgreedAt: new Date(),
      inviteCode: await this.uniqueInvite(),
      rulesHash: '',
    });
    const { doc, hash } = rulesDocument(c, user.name, org?.name ?? null);
    c.rulesHash = hash;
    const saved = await this.challenges.save(c);
    await this.rules.save(this.rules.create({ challengeId: saved.id, doc, hash }));
    // The escrow is created on Solana in the background (ChainWorker); no-money challenges are ready now.
    this.events.emit(fields.onChain ? 'challenge.needs_chain' : Events.ChallengeCreated, { challengeId: saved.id } satisfies ChallengeEvent);
    return this.view(saved, userId);
  }

  private async feesFor() {
    const f = await this.settings.fees();
    return { feeBps: f.forfeitBps, joinFeeBps: f.joinBps };
  }

  private async uniqueSlug(title: string) {
    const base = slugify(title);
    for (let i = 0; i < 20; i++) {
      const s = i === 0 ? base : `${base}-${randomCode(4).toLowerCase()}`;
      if (!(await this.challenges.existsBy({ slug: s }))) return s;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  private async uniqueInvite() {
    for (;;) {
      const code = randomCode(8);
      if (!(await this.challenges.existsBy({ inviteCode: code }))) return code;
    }
  }

  // ---------- reading ----------

  async bySlug(slug: string) {
    const c = await this.challenges.findOneBy({ slug });
    if (!c) throw notFound('challenge');
    return c;
  }

  /** Private and members-only challenges don't leak: unauthorised viewers get a 404. */
  async canView(c: Challenge, viewerId?: string, code?: string) {
    if (c.privacy === 'public') return true;
    if (code && code.toUpperCase() === c.inviteCode) return true;
    if (!viewerId) return false;
    if (c.creatorId === viewerId) return true;
    if (await this.participants.existsBy({ challengeId: c.id, userId: viewerId })) return true;
    if (c.orgId && (await this.members.existsBy({ orgId: c.orgId, userId: viewerId }))) {
      if (c.privacy === 'org') return true;
      const m = await this.members.findOneBy({ orgId: c.orgId, userId: viewerId });
      return ['Owner', 'Admin', 'Moderator'].includes(m!.role);
    }
    return false;
  }

  async canManage(c: Challenge, userId: string) {
    if (c.creatorId === userId) return true;
    if (!c.orgId) return false;
    const m = await this.members.findOneBy({ orgId: c.orgId, userId });
    return Boolean(m && ['Owner', 'Admin'].includes(m.role));
  }

  async visible(slug: string, viewerId?: string, code?: string) {
    const c = await this.bySlug(slug);
    if (!(await this.canView(c, viewerId, code))) throw notFound('challenge');
    return c;
  }

  async view(c: Challenge, viewerId?: string) {
    const [creator, org] = await Promise.all([this.users.findOneByOrFail({ id: c.creatorId }), c.orgId ? this.orgs.findOneBy({ id: c.orgId }) : null]);
    const manage = viewerId ? await this.canManage(c, viewerId) : false;
    const member = viewerId ? await this.participants.existsBy({ challengeId: c.id, userId: viewerId }) : false;
    return challengeView(c, creator, org, { showInvite: manage || (member && c.privacy !== 'public') || c.privacy === 'public' });
  }

  async views(list: Challenge[]) {
    const users = await this.users.findBy({ id: In([...new Set(list.map((c) => c.creatorId))]) });
    const orgIds = [...new Set(list.map((c) => c.orgId).filter((x): x is string => Boolean(x)))];
    const orgs = orgIds.length ? await this.orgs.findBy({ id: In(orgIds) }) : [];
    return list.map((c) =>
      challengeView(
        c,
        users.find((u) => u.id === c.creatorId)!,
        orgs.find((o) => o.id === c.orgId) ?? null,
        { showInvite: c.privacy === 'public' },
      ),
    );
  }

  async detail(slug: string, viewerId?: string, code?: string) {
    const c = await this.visible(slug, viewerId, code);
    const view = await this.view(c, viewerId);
    const me = viewerId ? await this.participants.findOneBy({ challengeId: c.id, userId: viewerId }) : null;
    return { ...view, joined: Boolean(me && me.status !== 'pending'), joinPending: me?.status === 'pending', canManage: viewerId ? await this.canManage(c, viewerId) : false };
  }

  async rulesFor(slug: string, viewerId?: string, code?: string) {
    const c = await this.visible(slug, viewerId, code);
    const r = await this.rules.findOneByOrFail({ challengeId: c.id });
    return { hash: r.hash, document: JSON.parse(r.doc) as unknown, raw: r.doc };
  }

  /** Marketplace search and filters (PRD §6). Shows public challenges plus your organizations'. */
  async list(q: ListChallengesQuery, viewerId?: string) {
    const qb = this.challenges.createQueryBuilder('c').where('c.moderation_hold IS NULL');
    const orgIds = viewerId ? (await this.members.findBy({ userId: viewerId })).map((m) => m.orgId) : [];
    qb.andWhere(
      new Brackets((w) => {
        w.where("c.privacy = 'public'");
        if (orgIds.length) w.orWhere("(c.privacy = 'org' AND c.org_id IN (:...orgIds))", { orgIds });
        // Creators always see their own challenges, private ones included; nobody else finds those here.
        if (viewerId) w.orWhere('c.creator_id = :viewer', { viewer: viewerId });
      }),
    );
    if (q.privacy) qb.andWhere('c.privacy = :privacy', { privacy: q.privacy });
    const status = q.status ?? null;
    if (status === 'open') qb.andWhere("c.status IN ('open', 'pending_chain')");
    else if (status) qb.andWhere('c.status = :status', { status });
    else qb.andWhere("c.status IN ('open', 'live', 'pending_chain')");
    if (q.q) qb.andWhere('(c.title ILIKE :q OR c.summary ILIKE :q OR c.requirement ILIKE :q)', { q: `%${q.q.replace(/[%_]/g, '')}%` });
    if (q.category) qb.andWhere('c.category = :category', { category: q.category });
    if (q.provider) qb.andWhere(':provider = ANY(c.providers)', { provider: q.provider });
    if (q.stakeMin !== undefined) qb.andWhere('c.stake_max >= :smin', { smin: toUnits(q.stakeMin).toString() });
    if (q.stakeMax !== undefined) qb.andWhere('c.stake_min <= :smax', { smax: toUnits(q.stakeMax).toString() });
    if (q.rewardMin !== undefined) qb.andWhere('GREATEST(c.sponsor_pool, c.sponsor_pledge) >= :rmin', { rmin: toUnits(q.rewardMin).toString() });
    if (q.durationMin) qb.andWhere('c.duration_days >= :dmin', { dmin: q.durationMin });
    if (q.durationMax) qb.andWhere('c.duration_days <= :dmax', { dmax: q.durationMax });
    if (q.difficulty) qb.andWhere('c.difficulty = :difficulty', { difficulty: q.difficulty });
    if (q.participantsMin) qb.andWhere('c.participant_count >= :pmin', { pmin: q.participantsMin });
    if (q.org) qb.innerJoin(Organization, 'o', 'o.id = c.org_id AND o.slug = :org', { org: q.org });

    // Trending needs real pull, not just being the newest or only challenge.
    if (q.sort === 'trending') qb.andWhere('c.participant_count >= :trendMin', { trendMin: TRENDING_MIN });
    switch (q.sort) {
      case 'starting':
        qb.orderBy('c.join_by', 'ASC');
        break;
      case 'reward':
        qb.orderBy('GREATEST(c.sponsor_pool, c.sponsor_pledge)', 'DESC');
        break;
      case 'new':
        qb.orderBy('c.created_at', 'DESC');
        break;
      case 'participants':
        qb.orderBy('c.participant_count', 'DESC');
        break;
      default:
        qb.addSelect(
          (sq) => sq.select('COUNT(*)').from(Participant, 'p').where("p.challenge_id = c.id AND p.created_at > now() - interval '7 days'"),
          'recent_joins',
        ).orderBy('recent_joins', 'DESC').addOrderBy('c.participant_count', 'DESC');
    }
    const limit = q.limit ?? 24;
    const [rows, total] = await qb.take(limit).skip(q.offset ?? 0).getManyAndCount();
    return { items: await this.views(rows), total, limit, offset: q.offset ?? 0 };
  }

  /** Home sections (PRD §6). */
  async discover(viewerId?: string) {
    const base = { status: 'open' } as const;
    const [trending, starting, sponsored] = await Promise.all([
      this.list({ ...base, sort: 'trending', limit: 8 }, viewerId),
      this.list({ status: 'open', sort: 'starting', limit: 8 }, viewerId),
      this.list({ rewardMin: 1, sort: 'reward', limit: 8 }, viewerId),
    ]);
    let recommended = trending.items;
    if (viewerId) {
      const [user, conns, joined] = await Promise.all([
        this.users.findOneByOrFail({ id: viewerId }),
        this.connections.findBy({ userId: viewerId }),
        this.participants.findBy({ userId: viewerId }),
      ]);
      const joinedIds = new Set(joined.map((p) => p.challengeId));
      const providers = conns.map((c) => c.provider as string);
      const qb = this.challenges
        .createQueryBuilder('c')
        .where("c.privacy = 'public' AND c.status IN ('open', 'pending_chain') AND c.moderation_hold IS NULL");
      if (user.interests.length || providers.length) {
        qb.andWhere(
          new Brackets((w) => {
            if (user.interests.length) w.orWhere('c.category IN (:...cats)', { cats: user.interests });
            if (providers.length) w.orWhere('c.providers && :providers', { providers });
          }),
        );
      }
      const rows = (await qb.orderBy('c.participant_count', 'DESC').take(20).getMany()).filter((c) => !joinedIds.has(c.id)).slice(0, 8);
      if (rows.length) recommended = await this.views(rows);
    }
    const categories = await this.challenges
      .createQueryBuilder('c')
      .select('c.category', 'category')
      .addSelect('COUNT(*)::int', 'count')
      .where("c.privacy = 'public' AND c.status IN ('open', 'live') AND c.moderation_hold IS NULL")
      .groupBy('c.category')
      .getRawMany<{ category: string; count: number }>();
    return { trending: trending.items, startingSoon: starting.items, sponsored: sponsored.items, recommended, categories };
  }

  /** Invite codes from the join-code box: a challenge or an organization. */
  async resolveInvite(code: string) {
    const normalized = code.trim().toUpperCase();
    const c = await this.challenges.findOneBy({ inviteCode: normalized });
    if (c && c.status !== 'cancelled') return { kind: 'challenge' as const, id: c.slug, title: c.title, code: normalized };
    const o = await this.orgs.findOneBy({ inviteCode: normalized });
    if (o && o.verification !== 'rejected') return { kind: 'org' as const, slug: o.slug, name: o.name, code: normalized };
    throw new AppError('invalid_code', "That code doesn't match a challenge or organization. Check it with whoever shared it.", HttpStatus.NOT_FOUND);
  }

  // ---------- managing ----------

  /**
   * Invites people by username. Hosts can always invite; people in the challenge can invite
   * friends too. Each person gets a notification and an email with the invite link.
   */
  async inviteUsers(userId: string, slug: string, handles: string[]) {
    const c = await this.bySlug(slug);
    const manage = await this.canManage(c, userId);
    if (!manage && !(await this.participants.existsBy({ challengeId: c.id, userId }))) throw forbidden('Join this challenge to invite people.');
    if (!['pending_chain', 'open', 'live'].includes(c.status)) throw new AppError('closed', 'This challenge isn’t open for new people.', HttpStatus.CONFLICT);
    const wanted = [...new Set(handles.map((h) => h.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))].slice(0, 20);
    const inviter = await this.users.findOneByOrFail({ id: userId });
    const found = wanted.length ? await this.users.findBy({ handle: In(wanted), status: 'active' }) : [];
    for (const u of found.filter((u) => u.id !== userId)) {
      await this.notifications.notify(u.id, {
        kind: 'activity',
        title: `${inviter.name} invited you to ${c.title}`,
        body: `${c.requirement}. Starts ${c.startsAt.toUTCString().slice(0, 16)}. See the rules and decide if you’re in.`,
        href: `/i/${c.inviteCode}`,
        email: true,
        emailAction: 'See the challenge',
        dedupeKey: `invite:${c.id}:${u.id}`,
      });
    }
    return { invited: found.filter((u) => u.id !== userId).map((u) => u.handle), notFound: wanted.filter((h) => !found.some((u) => u.handle === h)) };
  }

  /**
   * Changes any setting while nobody has joined and before the start. The rules document and
   * hash are rebuilt, and if an escrow exists it's cancelled and a new one created with the new
   * rules (the same link and invite code keep working). Once someone joins, the rules are locked.
   */
  async edit(userId: string, slug: string, dto: CreateChallengeDto) {
    const c = await this.bySlug(slug);
    if (!(await this.canManage(c, userId))) throw forbidden();
    if (!['pending_chain', 'open'].includes(c.status) || c.startsAt <= new Date()) {
      throw new AppError('rules_locked', 'This challenge has started, so its rules are locked.', HttpStatus.CONFLICT);
    }
    if (await this.participants.existsBy({ challengeId: c.id })) {
      throw new AppError('rules_locked', 'Someone has joined, so the rules are locked for everyone. You can still edit the description and banner.', HttpStatus.CONFLICT);
    }
    if (c.sponsorPool > 0n) {
      throw new AppError('rules_locked', 'Sponsor money is already in escrow under these rules. Cancel this challenge and create a new one to change them.', HttpStatus.CONFLICT);
    }
    const user = await this.users.findOneByOrFail({ id: c.creatorId });
    const org = c.orgId ? await this.orgs.findOneBy({ id: c.orgId }) : null;
    if (dto.privacy === 'org' && !org) throw new AppError('invalid_privacy', 'Members-only challenges need an organization as the host.');
    const oldEscrow = c.challengePda;
    Object.assign(c, await this.fieldsFrom(dto, user));
    // A new escrow gets a new on-chain id; the old one is cancelled in the background.
    Object.assign(c, { chainId: null, challengePda: null, vaultPda: null, createSig: null });
    const { doc, hash } = rulesDocument(c, user.name, org?.name ?? null);
    c.rulesHash = hash;
    const saved = await this.challenges.save(c);
    await this.rules.update({ challengeId: saved.id }, { doc, hash });
    await this.audit.log(userId, 'Edited challenge rules', c.title, 'before anyone joined');
    if (oldEscrow) this.events.emit('challenge.escrow_replaced', { challengeId: saved.id, oldEscrow });
    if (saved.onChain) this.events.emit('challenge.needs_chain', { challengeId: saved.id } satisfies ChallengeEvent);
    return this.view(saved, userId);
  }

  async update(userId: string, slug: string, dto: { summary?: string }) {
    const c = await this.bySlug(slug);
    if (!(await this.canManage(c, userId))) throw forbidden();
    // Rules are locked into the escrow; only the summary and banner can change (PRD §7).
    if (dto.summary !== undefined) c.summary = dto.summary.trim();
    await this.challenges.save(c);
    return this.view(c, userId);
  }

  async setBanner(userId: string, slug: string, file: Buffer) {
    const c = await this.bySlug(slug);
    if (!(await this.canManage(c, userId))) throw forbidden();
    const img = await (await openImage(file)).rotate().resize(1600, 640, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
    c.bannerUrl = this.storage.url(await this.storage.put('public/banners', img, 'image/webp'));
    await this.challenges.save(c);
    return this.view(c, userId);
  }

  /** Before it starts, the host can call it off. Everyone gets their full stake back. */
  async cancel(userId: string | null, slug: string, reason: string, byAdmin = false) {
    const c = await this.bySlug(slug);
    if (!byAdmin && !(await this.canManage(c, userId!))) throw forbidden();
    if (!['pending_chain', 'open'].includes(c.status) || c.startsAt <= new Date()) {
      throw new AppError('too_late_to_cancel', 'This challenge has started, so it can’t be cancelled. It will settle under its rules.', HttpStatus.CONFLICT);
    }
    const wasOnChain = c.onChain && c.status === 'open';
    c.status = 'cancelled';
    await this.challenges.save(c);
    if (byAdmin) await this.audit.log(userId, 'Cancelled challenge', c.title, reason);
    const ps = await this.participants.findBy({ challengeId: c.id });
    const anyStake = ps.some((p) => p.stake > 0n);
    await this.notifications.notifyMany(
      ps.filter((p) => p.status !== 'pending').map((p) => p.userId),
      {
        kind: 'problem',
        title: `${c.title} was cancelled`,
        body: anyStake ? 'Your full stake is coming back. If you paid from your own wallet, open Wallet to collect it.' : 'It was cancelled before it started.',
        href: '/wallet',
        dedupeKey: `cancelled:${c.id}`,
        email: true,
      },
    );
    this.events.emit(Events.ChallengeCancelled, { challengeId: c.id, onChain: wasOnChain } as ChallengeEvent);
    return { cancelled: true };
  }

  /** Ranking signals: completion and consistency, never stake size (PRD §12). */
  /** Today's set LeetCode problems, or none when any new problem counts. */
  async todayProblems(slug: string, viewerId?: string, code?: string) {
    const c = await this.visible(slug, viewerId, code);
    const p = currentPeriod(c) ?? (c.startsAt > new Date() ? 0 : null);
    if (p === null || !c.verificationConfig.leetcode?.assigned) return { day: null, problems: [] };
    const slugs = (await assignedProblems(c, p).catch(() => null)) ?? [];
    const problems = await Promise.all(slugs.map((s) => leetcodeQuestion(s).catch(() => ({ slug: s, title: s, difficulty: 'Unknown', url: `https://leetcode.com/problems/${s}/` }))));
    return { day: p + 1, started: c.startsAt <= new Date(), problems };
  }

  async leaderboard(slug: string, viewerId?: string, code?: string) {
    const c = await this.visible(slug, viewerId, code);
    const rows = await this.participants
      .createQueryBuilder('p')
      .innerJoin(User, 'u', 'u.id = p.user_id')
      .select(['p.user_id AS user_id', 'p.verified_count AS verified', 'p.missed_count AS missed', 'p.progress AS progress', 'p.rank AS rank', 'p.previous_rank AS previous'])
      .addSelect(['u.name AS name', 'u.handle AS handle', 'u.hue AS hue', 'u.avatar_url AS avatar', "u.privacy->>'showOnLeaderboards' AS visible"])
      .where("p.challenge_id = :id AND p.status IN ('active', 'completed', 'failed')", { id: c.id })
      .orderBy(c.mode === 'days' ? 'p.verified_count' : 'p.progress', 'DESC')
      .addOrderBy('p.missed_count', 'ASC')
      .addOrderBy('p.activated_at', 'ASC')
      .limit(500)
      .getRawMany<{ user_id: string; verified: number; missed: number; progress: number; name: string; handle: string; hue: number; avatar: string | null; visible: string | null; previous: number | null }>();
    return rows.map((r, i) => {
      const you = r.user_id === viewerId;
      const hidden = r.visible === 'false' && !you;
      return {
        rank: i + 1,
        person: hidden ? { name: 'Private member', handle: '', hue: 220, avatarUrl: null } : { name: r.name, handle: r.handle, hue: r.hue, avatarUrl: r.avatar },
        completed: c.mode === 'days' ? Number(r.verified) : Number(r.progress),
        consistency: Number(r.verified) + Number(r.missed) ? Math.round((Number(r.verified) / (Number(r.verified) + Number(r.missed))) * 100) : 100,
        movement: r.previous ? r.previous - (i + 1) : 0,
        you: you || undefined,
      };
    });
  }

  async participantsFor(slug: string, userId: string) {
    const c = await this.bySlug(slug);
    if (!(await this.canManage(c, userId))) throw forbidden();
    const rows = await this.participants.find({ where: { challengeId: c.id }, order: { activatedAt: 'ASC' } });
    const users = await this.users.findBy({ id: In(rows.map((r) => r.userId)) });
    return rows.map((p) => ({
      person: person(users.find((u) => u.id === p.userId)!),
      status: p.status,
      completed: p.verifiedCount,
      missed: p.missedCount,
      progress: p.progress,
      rank: p.rank,
      joinedAt: p.activatedAt?.toISOString() ?? null,
    }));
  }
}
