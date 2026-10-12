import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PublicKey } from '@solana/web3.js';
import { Brackets, In, IsNull, MoreThan, Not, Repository } from 'typeorm';
import { ADMIN_ROLES, type AdminRole } from '../../common/auth.js';
import { AppError, conflict, forbidden, notFound } from '../../common/errors.js';
import { toUsd, USDC } from '../../common/money.js';
import { PROVIDER_LABELS } from '../../common/providers.js';
import { AuditService } from '../../core/audit.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { Challenge, Participant } from '../challenges/entities/challenge.entities.js';
import { settleAfter } from '../challenges/schedule.js';
import { person } from '../challenges/views.js';
import { Dispute } from '../disputes/entities/dispute.entity.js';
import { Organization } from '../organizations/entities/organization.entities.js';
import { LedgerEntry } from '../payments/entities/payment.entities.js';
import { SolanaService } from '../payments/solana/solana.service.js';
import { RiskFlag, RiskSignal } from '../risk/entities/risk.entities.js';
import { RiskService } from '../risk/risk.service.js';
import { ConnectedAccount, User, Wallet } from '../users/entities/user.entities.js';
import { Verification } from '../verification/entities/verification.entities.js';
import { AuditEntry } from './entities/admin.entities.js';

const DAY = 86_400_000;

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    @InjectRepository(Verification) private readonly verifications: Repository<Verification>,
    @InjectRepository(Dispute) private readonly disputes: Repository<Dispute>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(ConnectedAccount) private readonly connections: Repository<ConnectedAccount>,
    @InjectRepository(Organization) private readonly orgs: Repository<Organization>,
    @InjectRepository(RiskFlag) private readonly flags: Repository<RiskFlag>,
    @InjectRepository(RiskSignal) private readonly signals: Repository<RiskSignal>,
    @InjectRepository(LedgerEntry) private readonly ledger: Repository<LedgerEntry>,
    @InjectRepository(AuditEntry) private readonly auditRows: Repository<AuditEntry>,
    private readonly solana: SolanaService,
    private readonly risk: RiskService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  // ---------- overview (PRD §29) ----------

  async overview() {
    const active = await this.challenges.findBy({ status: In(['open', 'live', 'settling']) });
    const ids = active.map((c) => c.id);
    const staked = ids.length
      ? await this.participants.createQueryBuilder('p').select('COALESCE(SUM(p.stake), 0)', 'sum').where("p.challenge_id IN (:...ids) AND p.status = 'active'", { ids }).getRawOne<{ sum: string }>()
      : { sum: '0' };
    const pools = active.reduce((s, c) => s + c.sponsorPool, 0n);
    const participants = active.reduce((s, c) => s + c.participantCount, 0);
    const week = new Date(Date.now() - 7 * DAY);
    const decided = await this.verifications.createQueryBuilder('v').select('v.state', 'state').addSelect('COUNT(*)::int', 'n').where('v.decided_at > :week', { week }).groupBy('v.state').getRawMany<{ state: string; n: number }>();
    const n = (s: string) => decided.find((d) => d.state === s)?.n ?? 0;
    const totalDecided = n('verified') + n('failed') + n('excused') + n('disputed');
    const month = new Date(Date.now() - 30 * DAY);
    const failures = await this.verifications.countBy({ decidedAt: MoreThan(month), state: In(['failed', 'disputed']) });
    const overturned = await this.disputes.countBy({ decidedAt: MoreThan(month), status: 'approved' });
    const closed = await this.disputes.find({ where: { decidedAt: MoreThan(month) }, select: { createdAt: true, decidedAt: true } });
    const hours = closed.map((d) => (d.decidedAt!.getTime() - d.createdAt.getTime()) / 3600_000).sort((a, b) => a - b);
    const weekly: number[] = [];
    for (let w = 5; w >= 0; w--) {
      const at = new Date(Date.now() - w * 7 * DAY);
      weekly.push(
        await this.participants
          .createQueryBuilder('p')
          .innerJoin(Challenge, 'c', 'c.id = p.challenge_id')
          .where("p.status IN ('active', 'completed', 'failed') AND p.activated_at <= :at AND c.starts_at <= :at AND c.ends_at > :at", { at })
          .getCount(),
      );
    }
    return {
      activeChallenges: active.length,
      participants,
      escrow: toUsd(BigInt(staked?.sum ?? '0') + pools),
      sponsorPools: toUsd(pools),
      verifyRate: totalDecided ? Math.round(((n('verified') + n('excused')) / totalDecided) * 1000) / 10 : 100,
      falseFailures: failures + overturned ? Math.round((overturned / (failures + overturned)) * 1000) / 10 : 0,
      openDisputes: await this.disputes.countBy({ status: In(['new', 'in_review', 'waiting_on_user']) }),
      medianDisputeHours: hours.length ? Math.round(hours[Math.floor(hours.length / 2)]) : 0,
      openRiskCases: await this.flags.countBy({ status: 'open' }),
      verificationFailures: n('failed'),
      flaggedChallenges: await this.challenges.countBy({ moderationHold: Not(IsNull()) }),
      weekly,
    };
  }

  // ---------- users ----------

  async listUsers(q?: string, status?: string) {
    const qb = this.users.createQueryBuilder('u').where("u.status != 'closed'");
    if (q) qb.andWhere(new Brackets((w) => w.where('u.handle ILIKE :q', { q: `%${q}%` }).orWhere('u.name ILIKE :q').orWhere('u.email ILIKE :q')));
    if (status) qb.andWhere('u.status = :status', { status });
    const users = await qb.orderBy('u.created_at', 'DESC').take(200).getMany();
    return Promise.all(users.map((u) => this.userRow(u)));
  }

  private async userRow(u: User) {
    const [trust, parts, conns, wallets] = await Promise.all([
      this.risk.trust(u.id),
      this.participants.findBy({ userId: u.id, status: Not('pending') }),
      this.connections.findBy({ userId: u.id }),
      this.wallets.findBy({ userId: u.id }),
    ]);
    return {
      id: u.id,
      person: person(u),
      email: u.email,
      joined: u.createdAt.toISOString().slice(0, 10),
      level: trust.level,
      active: parts.filter((p) => p.status === 'active').length,
      completed: parts.filter((p) => p.completed).length,
      staked: toUsd(parts.filter((p) => p.status === 'active').reduce((s, p) => s + p.stake, 0n)),
      risk: trust.score,
      status: u.status === 'active' ? 'Active' : u.status === 'restricted' ? 'Restricted' : 'Suspended',
      statusReason: u.statusReason,
      accounts: [...conns.map((c) => PROVIDER_LABELS[c.provider]), ...(wallets.length ? ['Solana'] : [])],
    };
  }

  async userDetail(handle: string) {
    const u = await this.users.findOneBy({ handle: handle.toLowerCase() });
    if (!u) throw notFound('user');
    const [row, signals, flags, parts, wallets] = await Promise.all([
      this.userRow(u),
      this.signals.find({ where: { userId: u.id }, order: { createdAt: 'DESC' }, take: 50 }),
      this.flags.find({ where: { userId: u.id }, order: { createdAt: 'DESC' } }),
      this.participants.find({ where: { userId: u.id }, relations: { challenge: true }, order: { createdAt: 'DESC' }, take: 50 }),
      this.wallets.findBy({ userId: u.id }),
    ]);
    return {
      ...row,
      signals: signals.map((s) => ({ at: s.createdAt.toISOString(), kind: s.kind, detail: s.detail, weight: s.weight })),
      flags: flags.map((f) => ({ id: f.id, status: f.status, score: f.score, at: f.createdAt.toISOString() })),
      challenges: parts.map((p) => ({ id: p.challenge!.slug, title: p.challenge!.title, status: p.status, stake: toUsd(p.stake), completed: p.verifiedCount, missed: p.missedCount })),
      wallets: wallets.map((w) => ({ address: w.address, kind: w.kind, fundedBy: w.fundedBy })),
    };
  }

  async reinstate(adminId: string, handle: string, reason: string) {
    const u = await this.users.findOneBy({ handle: handle.toLowerCase() });
    if (!u) throw notFound('user');
    await this.users.update({ id: u.id }, { status: 'active', statusReason: null });
    await this.flags.update({ userId: u.id, status: 'restricted' }, { status: 'cleared', decidedById: adminId, decisionReason: reason });
    await this.audit.log(adminId, 'Reinstated account', `@${u.handle}`, reason);
  }

  async userIdForHandle(handle: string) {
    const u = await this.users.findOneBy({ handle: handle.toLowerCase() });
    if (!u) throw notFound('user');
    return u;
  }

  // ---------- risk ----------

  async riskFlags(status?: string) {
    const rows = await this.flags.find({ where: status ? { status: status as RiskFlag['status'] } : { status: In(['open', 'watching', 'restricted']) }, order: { score: 'DESC' }, take: 200 });
    const ids = [...new Set(rows.flatMap((r) => [r.userId, ...r.linkedUserIds]))];
    const users = ids.length ? await this.users.findBy({ id: In(ids) }) : [];
    const p = (id: string) => person(users.find((u) => u.id === id) ?? { name: 'Unknown', handle: '', hue: 0, avatarUrl: null });
    return rows.map((r) => ({
      id: r.id,
      user: p(r.userId),
      userId: r.userId,
      score: r.score,
      status: r.status[0].toUpperCase() + r.status.slice(1),
      signals: r.signals,
      linked: r.linkedUserIds.map(p),
      value: toUsd(r.value),
      raised: r.createdAt.toISOString(),
    }));
  }

  async setRisk(adminId: string, id: string, status: 'watching' | 'cleared', reason: string) {
    const f = await this.flags.findOneBy({ id });
    if (!f) throw notFound('risk case');
    await this.flags.update({ id }, { status, decidedById: adminId, decisionReason: reason });
    await this.audit.log(adminId, `Marked ${status}`, `Risk flag ${id}`, reason);
  }

  // ---------- challenges ----------

  async listChallenges(status?: string) {
    const where = status ? { status: status as Challenge['status'] } : {};
    const rows = await this.challenges.find({ where, order: { startsAt: 'DESC' }, take: 300 });
    const creators = rows.length ? await this.users.findBy({ id: In([...new Set(rows.map((c) => c.creatorId))]) }) : [];
    const orgs = rows.length ? await this.orgs.findBy({ id: In(rows.map((c) => c.orgId).filter((x): x is string => Boolean(x))) }) : [];
    return Promise.all(
      rows.map(async (c) => {
        const staked = await this.participants.createQueryBuilder('p').select('COALESCE(SUM(p.stake), 0)', 'sum').where("p.challenge_id = :id AND p.status IN ('active', 'completed', 'failed') AND p.claimed = false", { id: c.id }).getRawOne<{ sum: string }>();
        const v = await this.verifications.createQueryBuilder('v').select('v.state', 'state').addSelect('COUNT(*)::int', 'n').where('v.challenge_id = :id', { id: c.id }).groupBy('v.state').getRawMany<{ state: string; n: number }>();
        const cnt = (s: string) => v.find((x) => x.state === s)?.n ?? 0;
        const total = cnt('verified') + cnt('failed') + cnt('excused') + cnt('disputed');
        const status = c.moderationHold ? 'Paused' : ({ pending_chain: 'Open', open: 'Open', live: 'Live', settling: 'Settling', ended: 'Ended', cancelled: 'Ended' } as const)[c.status];
        return {
          id: c.slug,
          title: c.title,
          host: orgs.find((o) => o.id === c.orgId)?.name ?? creators.find((u) => u.id === c.creatorId)?.name ?? '',
          status,
          participants: c.participantCount,
          escrow: toUsd(BigInt(staked?.sum ?? '0') + c.sponsorPool),
          sponsor: toUsd(c.sponsorPool),
          verifyRate: total ? Math.round(((cnt('verified') + cnt('excused')) / total) * 1000) / 10 : 100,
          disputes: await this.disputes.countBy({ challengeId: c.id }),
          flagged: c.moderationHold ?? undefined,
          providers: c.providers.map((p) => PROVIDER_LABELS[p]),
          address: c.vaultPda ? `${c.vaultPda.slice(0, 4)}…${c.vaultPda.slice(-4)}` : '—',
          vault: c.vaultPda,
        };
      }),
    );
  }

  /** Unlist or pause a challenge (no new joins, hidden from discovery). Running escrow is untouched. */
  async hold(adminId: string, slug: string, reason: string | null) {
    const c = await this.challenges.findOneBy({ slug });
    if (!c) throw notFound('challenge');
    await this.challenges.update({ id: c.id }, { moderationHold: reason });
    await this.audit.log(adminId, reason ? 'Paused challenge' : 'Unpaused challenge', c.title, reason ?? 'Review finished');
  }

  // ---------- escrow (read only; nobody can move escrowed funds) ----------

  /**
   * Where the platform's money goes. The program pays joining fees and the platform share of
   * forfeits straight to the treasury wallet when a challenge settles; nobody here can move it.
   */
  async treasury() {
    const wallet = this.solana.treasury ?? null;
    const [config, usdc] = await Promise.all([
      this.solana.fetchConfig().catch(() => null),
      wallet ? this.solana.tokenAccountBalance(this.solana.ata(wallet)) : Promise.resolve(null),
    ]);
    const settled = await this.challenges.find({ where: { status: 'ended', platformRevenue: Not(IsNull()) }, order: { settledAt: 'DESC' } });
    const join = (c: Challenge) => c.platformJoinFees ?? 0n;
    const total = (c: Challenge) => c.platformRevenue ?? 0n;
    const sum = (list: Challenge[], f: (c: Challenge) => bigint) => list.reduce((s, c) => s + f(c), 0n);
    const last30 = settled.filter((c) => c.settledAt && c.settledAt.getTime() > Date.now() - 30 * DAY);

    // Joining fees already paid into running challenges: they reach the treasury at settlement,
    // or go back to people if a challenge is cancelled.
    const held = await this.participants
      .createQueryBuilder('p')
      .innerJoin('p.challenge', 'c')
      .select('COALESCE(SUM(p.join_fee), 0)', 'sum')
      .where('c.on_chain = true AND c.status IN (:...open)', { open: ['open', 'live', 'settling'] })
      .andWhere('p.status = :active', { active: 'active' })
      .getRawOne<{ sum: string }>();

    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - (11 - i));
      return { key: d.toISOString().slice(0, 7), label: d.toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }) };
    });
    const monthly = months.map((m) => {
      const inMonth = settled.filter((c) => c.settledAt?.toISOString().slice(0, 7) === m.key);
      return { month: m.label, joinFees: toUsd(sum(inMonth, join)), forfeitShare: toUsd(sum(inMonth, total) - sum(inMonth, join)) };
    });

    const explorer = (a: string) => `https://explorer.solana.com/address/${a}${this.solana.cluster === 'mainnet-beta' ? '' : `?cluster=${this.solana.cluster}`}`;
    const fees = await this.settings.fees();
    return {
      cluster: this.solana.cluster,
      wallet: wallet ? { address: wallet.toBase58(), explorer: explorer(wallet.toBase58()), usdc: usdc === null ? null : toUsd(usdc) } : null,
      // The program only pays the treasury it has on record; the API's setting must match it.
      program: config
        ? {
            treasury: config.treasury.toBase58(),
            matches: wallet ? config.treasury.equals(wallet) : false,
            admin: config.admin.toBase58(),
            joinPercent: config.joinFeeBps / 100,
            platformSharePercent: config.feeBps / 100,
            paused: config.paused,
          }
        : null,
      fees: { joinPercent: fees.joinBps / 100, platformSharePercent: fees.forfeitBps / 100 },
      totals: {
        allTime: toUsd(sum(settled, total)),
        last30: toUsd(sum(last30, total)),
        joinFees: toUsd(sum(settled, join)),
        forfeitShare: toUsd(sum(settled, total) - sum(settled, join)),
        heldInEscrow: toUsd(BigInt(held?.sum ?? '0')),
        challenges: settled.length,
      },
      monthly,
      recent: settled.slice(0, 50).map((c) => ({
        id: c.slug,
        title: c.title,
        settledAt: c.settledAt?.toISOString() ?? null,
        total: toUsd(total(c)),
        joinFees: toUsd(join(c)),
        forfeitShare: toUsd(total(c) - join(c)),
        finishers: c.finisherCount ?? 0,
      })),
    };
  }

  async escrow() {
    const list = await this.challenges.find({ where: { onChain: true, status: In(['open', 'live', 'settling', 'ended', 'cancelled']), vaultPda: Not(IsNull()) }, order: { startsAt: 'DESC' }, take: 100 });
    const challenges = await Promise.all(
      list.map(async (c) => {
        const parts = await this.participants.findBy({ challengeId: c.id, status: In(['active', 'completed', 'failed', 'refunded']) });
        const owedStakes = parts.filter((p) => !p.claimed).reduce((s, p) => s + (p.settled ? p.claimable : p.stake), 0n);
        const expected = c.status === 'ended' ? owedStakes : owedStakes + c.sponsorPool;
        const onChain = await this.solana.tokenAccountBalance(new PublicKey(c.vaultPda!));
        const openDisputes = await this.disputes.countBy({ challengeId: c.id, status: In(['new', 'in_review', 'waiting_on_user']) });
        const finishers = parts.filter((p) => p.completed).length;
        const settlement =
          c.status === 'ended' || c.status === 'cancelled' ? 'Settled' : openDisputes ? 'Waiting for disputes' : c.status === 'settling' && new Date() >= settleAfter(c) ? 'Ready to settle' : null;
        return {
          id: c.slug,
          title: c.title,
          vault: c.vaultPda,
          onChain: onChain === null ? null : toUsd(onChain),
          expected: toUsd(expected),
          matches: onChain === null ? null : c.status === 'ended' ? onChain >= expected : onChain === expected,
          settlement: settlement
            ? {
                status: settlement,
                finishers,
                returned: toUsd(parts.filter((p) => p.completed).reduce((s, p) => s + p.stake - p.penalty, 0n)),
                rewards: toUsd(c.sponsorPool),
                forfeited: toUsd(parts.filter((p) => p.settled).reduce((s, p) => s + (p.completed ? p.penalty : p.stake), 0n)),
                checks: [
                  openDisputes ? `${openDisputes} open dispute${openDisputes === 1 ? '' : 's'}` : 'No open disputes',
                  onChain === null ? 'Vault balance unavailable' : onChain === expected || c.status === 'ended' ? 'Totals match escrow balance' : 'Escrow balance differs from records: investigate',
                ],
              }
            : null,
        };
      }),
    );
    const alerts = await this.signals.find({ where: { kind: In(['shared_funding', 'duplicate_proof', 'rapid_join_claim']), createdAt: MoreThan(new Date(Date.now() - 7 * DAY)) }, order: { createdAt: 'DESC' }, take: 50 });
    const large = await this.ledger.find({ where: { kind: 'sponsored', createdAt: MoreThan(new Date(Date.now() - 7 * DAY)) }, order: { createdAt: 'DESC' }, take: 50 });
    return {
      challenges,
      alerts: [
        ...alerts.map((a) => ({ id: a.id, at: a.createdAt.toISOString(), kind: a.kind.replace(/_/g, ' '), detail: a.detail, amount: 0, severity: a.weight >= 30 ? 'High' : a.weight >= 15 ? 'Medium' : 'Low', signature: null })),
        ...large.filter((l) => -l.amount >= 1000n * USDC).map((l) => ({ id: l.id, at: l.createdAt.toISOString(), kind: 'Large sponsor deposit', detail: `${toUsd(-l.amount)} USDC sponsored`, amount: toUsd(-l.amount), severity: 'Low', signature: l.signature })),
      ].sort((a, b) => b.at.localeCompare(a.at)),
      program: { id: this.solana.program.programId.toBase58(), cluster: this.solana.cluster, adminCanWithdraw: false },
    };
  }

  // ---------- audit, team, settings ----------

  async auditLog(q?: string, before?: string) {
    const qb = this.auditRows.createQueryBuilder('a').orderBy('a.created_at', 'DESC').take(200);
    if (q) qb.where(new Brackets((w) => w.where('a.action ILIKE :q', { q: `%${q}%` }).orWhere('a.target ILIKE :q').orWhere('a.actor_name ILIKE :q').orWhere('a.reason ILIKE :q')));
    if (before) qb.andWhere('a.created_at < :before', { before: new Date(before) });
    const rows = await qb.getMany();
    return rows.map((a) => ({ id: a.id, at: a.createdAt.toISOString(), actor: a.actorName, action: a.action, target: a.target, reason: a.reason }));
  }

  async team() {
    const rows = await this.users.find({ where: { adminRole: Not(IsNull()) }, order: { createdAt: 'ASC' } });
    return rows.map((u) => ({ id: u.id, person: person(u), email: u.email, role: u.adminRole, twoFactor: u.totpEnabled, lastActive: u.lastActiveAt?.toISOString() ?? null }));
  }

  async setRole(adminId: string, email: string, role: AdminRole | null, reason: string) {
    const actor = await this.users.findOne({ where: { id: adminId }, select: { id: true, adminRole: true } });
    if (actor?.adminRole !== 'Super admin') throw forbidden('Only a super admin can manage admin roles.');
    if (role && !(ADMIN_ROLES as readonly string[]).includes(role)) throw new AppError('invalid_role', 'Choose a valid role.');
    const u = await this.users.findOneBy({ email: email.toLowerCase() });
    if (!u) throw new AppError('no_account', 'That person needs a Stake-Sync account first. Ask them to sign up with this email.', HttpStatus.NOT_FOUND);
    if (u.id === adminId) throw forbidden('You can’t change your own role.');
    if (u.adminRole === 'Super admin' && role !== 'Super admin' && (await this.users.countBy({ adminRole: 'Super admin' })) <= 1) throw conflict('last_super_admin', 'There must be at least one super admin.');
    await this.users.update({ id: u.id }, { adminRole: role });
    await this.audit.log(adminId, role ? `Set admin role: ${role}` : 'Removed admin access', u.email ?? u.handle, reason);
  }

  async platformSettings() {
    return {
      structures: await this.settings.structures(),
      fees: await this.settings.fees(),
      banner: await this.settings.get<string | null>('banner'),
      limits: await this.settings.limits(),
    };
  }

  async setBanner(adminId: string, text: string | null) {
    await this.settings.set('banner', text, adminId);
    await this.audit.log(adminId, text ? 'Published banner' : 'Removed banner', 'App banner', text ?? '');
  }

  async setLimits(adminId: string, limits: Record<string, number>, reason: string) {
    const current = await this.settings.limits();
    await this.settings.set('limits', { ...current, ...limits }, adminId);
    await this.audit.log(adminId, 'Changed limits', 'Platform limits', reason, limits);
  }
}
