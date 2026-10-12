import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { randomCode, sha256Hex } from '../../common/crypto.js';
import { openImage } from '../../common/images.js';
import { AppError, conflict, errMsg, notFound } from '../../common/errors.js';
import { Events, type LinkedEvent, type WalletLinkedEvent } from '../../common/events.js';
import { toUsd } from '../../common/money.js';
import { PROVIDER_LABELS } from '../../common/providers.js';
import { TERMS_VERSION } from '../../common/terms.js';
import { StorageService } from '../../core/storage.service.js';
import { AuthToken, Session } from '../auth/entities/auth.entities.js';
import { CATEGORIES, Challenge, Participant, type ProviderKey } from '../challenges/entities/challenge.entities.js';
import { PushSubscription } from '../notifications/entities/notification.entities.js';
import { Organization, OrgMember } from '../organizations/entities/organization.entities.js';
import { Achievement } from '../reputation/entities/reputation.entities.js';
import { RiskService } from '../risk/risk.service.js';
import { codeforcesUser } from '../verification/clients/codeforces.js';
import { leetcodeProfile } from '../verification/clients/leetcode.js';
import { ConnectedAccount, User, Wallet, type ConnectionProvider, type NotificationPrefs, type PrivacySettings } from './entities/user.entities.js';

const RESERVED = new Set(['admin', 'support', 'stakesync', 'stake-sync', 'api', 'help', 'settings', 'wallet', 'me', 'root', 'system', 'moderator']);
const MONTH = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export interface UpdateProfile {
  name?: string;
  handle?: string;
  bio?: string;
  timezone?: string;
  interests?: string[];
  privacy?: Partial<PrivacySettings>;
  notificationPrefs?: Partial<NotificationPrefs>;
  fundingPreference?: 'wallet' | 'local';
  onboarded?: boolean;
  acceptTerms?: boolean;
}

export interface ConnectionInput {
  provider: ConnectionProvider;
  externalId: string;
  username: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  scopes?: string;
  externalCreatedAt?: Date | null;
}

@Injectable()
export class UsersService {
  private readonly log = new Logger('Users');

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ConnectedAccount) private readonly connections: Repository<ConnectedAccount>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(OrgMember) private readonly members: Repository<OrgMember>,
    @InjectRepository(Organization) private readonly orgs: Repository<Organization>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    @InjectRepository(Achievement) private readonly achievements: Repository<Achievement>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(AuthToken) private readonly tokens: Repository<AuthToken>,
    @InjectRepository(PushSubscription) private readonly pushSubs: Repository<PushSubscription>,
    private readonly risk: RiskService,
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
  ) {}

  async uniqueHandle(base: string) {
    const root = (base.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'member').slice(0, 20).padEnd(3, '0');
    for (let i = 0; i < 50; i++) {
      const h = i === 0 ? root : `${root.slice(0, 16)}${Math.floor(Math.random() * 9000 + 1000)}`;
      if (!RESERVED.has(h) && !(await this.users.existsBy({ handle: h }))) return h;
    }
    return `member${Date.now().toString(36)}`;
  }

  /** The signed-in person's own view. */
  async me(userId: string) {
    const u = await this.users.findOneByOrFail({ id: userId });
    const [connections, wallets, memberships, trust] = await Promise.all([
      this.connections.findBy({ userId }),
      this.wallets.find({ where: { userId }, order: { primary: 'DESC', createdAt: 'ASC' } }),
      this.members.findBy({ userId }),
      this.risk.trust(userId),
    ]);
    const orgs = memberships.length ? await this.orgs.findBy({ id: In(memberships.map((m) => m.orgId)) }) : [];
    return {
      id: u.id,
      name: u.name,
      handle: u.handle,
      hue: u.hue,
      avatarUrl: u.avatarUrl,
      email: u.email,
      emailVerified: Boolean(u.emailVerifiedAt),
      hasPassword: Boolean(u.passwordHash),
      bio: u.bio,
      timezone: u.timezone,
      interests: u.interests,
      fundingPreference: u.fundingPreference,
      onboarded: Boolean(u.onboardedAt),
      termsAccepted: u.termsVersion === TERMS_VERSION,
      termsVersion: TERMS_VERSION,
      privacy: u.privacy,
      notificationPrefs: u.notificationPrefs,
      score: u.score,
      status: u.status,
      adminRole: u.adminRole,
      verificationLevel: trust.level,
      nextVerificationSteps: trust.next,
      joined: MONTH.format(u.createdAt),
      connected: connections.map((c) => ({ provider: PROVIDER_LABELS[c.provider], account: c.username, status: c.status, since: c.createdAt.toISOString() })),
      wallets: wallets.map((w) => ({ address: w.address, kind: w.kind, primary: w.primary, verified: Boolean(w.verifiedAt) })),
      orgs: memberships.map((m) => {
        const o = orgs.find((x) => x.id === m.orgId)!;
        return { slug: o.slug, name: o.name, role: m.role };
      }),
    };
  }

  async update(userId: string, dto: UpdateProfile) {
    const u = await this.users.findOneByOrFail({ id: userId });
    if (dto.handle !== undefined && dto.handle !== u.handle) {
      const h = dto.handle.toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(h)) throw new AppError('invalid_handle', 'Usernames are 3–20 letters, numbers or underscores.');
      if (RESERVED.has(h) || (await this.users.existsBy({ handle: h, id: Not(userId) }))) throw conflict('handle_taken', 'That username is taken. Try another.');
      u.handle = h;
    }
    if (dto.name !== undefined) u.name = dto.name.trim();
    if (dto.bio !== undefined) u.bio = dto.bio.trim();
    if (dto.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: dto.timezone });
      } catch {
        throw new AppError('invalid_timezone', "We don't recognise that timezone.");
      }
      u.timezone = dto.timezone;
    }
    if (dto.interests) u.interests = dto.interests.filter((i) => (CATEGORIES as readonly string[]).includes(i));
    if (dto.privacy) u.privacy = { ...u.privacy, ...dto.privacy };
    if (dto.notificationPrefs) u.notificationPrefs = { ...u.notificationPrefs, ...dto.notificationPrefs };
    if (dto.fundingPreference) u.fundingPreference = dto.fundingPreference;
    if (dto.onboarded && !u.onboardedAt) u.onboardedAt = new Date();
    if (dto.acceptTerms === true) {
      u.termsAcceptedAt = new Date();
      u.termsVersion = TERMS_VERSION;
    }
    await this.users.save(u);
    return this.me(userId);
  }

  async setAvatar(userId: string, file: Buffer) {
    const img = await (await openImage(file)).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
    const key = await this.storage.put('public/avatars', img, 'image/webp');
    const before = await this.users.findOneByOrFail({ id: userId });
    await this.users.update({ id: userId }, { avatarUrl: this.storage.url(key) });
    await this.dropUpload(before.avatarUrl);
    return this.me(userId);
  }

  /** Back to the initials avatar. The old photo is deleted, not just unlinked. */
  async removeAvatar(userId: string) {
    const u = await this.users.findOneByOrFail({ id: userId });
    await this.users.update({ id: userId }, { avatarUrl: null });
    await this.dropUpload(u.avatarUrl);
    return this.me(userId);
  }

  private async dropUpload(url: string | null) {
    const key = url ? this.storage.keyFromUrl(url) : null;
    if (!key) return;
    // The profile already shows the change; a file left behind is only tidied up later.
    await this.storage.remove(key).catch((e) => this.log.warn(`Couldn't delete ${key}: ${errMsg(e)}`));
  }

  /** Public profile (PRD §24), honouring the person's privacy setting. */
  async profile(handle: string, viewerId?: string) {
    const u = await this.users.findOneBy({ handle: handle.toLowerCase() });
    if (!u || u.status === 'closed') throw notFound('profile');
    const self = viewerId === u.id;
    if (!self && (u.privacy.profile === 'private' || (u.privacy.profile === 'members' && !viewerId))) {
      return { person: this.person(u), private: true };
    }
    const [parts, achievements, connections, memberships] = await Promise.all([
      this.participants.find({ where: { userId: u.id, status: Not('pending') }, relations: { challenge: true }, order: { createdAt: 'DESC' } }),
      this.achievements.find({ where: { userId: u.id }, order: { earnedAt: 'DESC' } }),
      u.privacy.showConnectedAccounts || self ? this.connections.findBy({ userId: u.id, status: 'active' }) : Promise.resolve([]),
      this.members.findBy({ userId: u.id }),
    ]);
    // Private challenges aren't shown to other people.
    const visible = parts.filter((p) => self || p.challenge!.privacy === 'public');
    const finished = parts.filter((p) => p.completed !== null);
    const completed = finished.filter((p) => p.completed).length;
    const orgs = memberships.length ? await this.orgs.findBy({ id: In(memberships.map((m) => m.orgId)), verification: 'verified' }) : [];
    return {
      person: this.person(u),
      private: false,
      bio: u.bio,
      score: u.score,
      joined: MONTH.format(u.createdAt),
      entered: parts.length,
      completed,
      completionRate: finished.length ? Math.round((completed / finished.length) * 1000) / 10 : null,
      connected: connections.map((c) => ({ provider: PROVIDER_LABELS[c.provider], account: c.username })),
      orgs: orgs.map((o) => ({ slug: o.slug, name: o.name })),
      achievements: achievements.map((a) => ({
        id: a.id,
        title: a.title,
        provider: PROVIDER_LABELS[a.provider],
        earned: MONTH.format(a.earnedAt),
        detail: a.detail,
      })),
      active: visible
        .filter((p) => p.status === 'active')
        .map((p) => ({ id: p.challenge!.slug, title: p.challenge!.title, category: p.challenge!.category, endsAt: p.challenge!.endsAt.toISOString() })),
      history: visible
        .filter((p) => p.completed !== null || p.status === 'refunded')
        .map((p) => ({
          id: p.challenge!.slug,
          title: p.challenge!.title,
          result: p.status === 'refunded' ? 'Cancelled' : p.completed ? 'Completed' : 'Not completed',
          when: MONTH.format(p.challenge!.endsAt),
          earned: p.status === 'refunded' ? 0 : p.completed ? toUsd(p.claimable - p.stake) : -toUsd(p.stake),
        })),
    };
  }

  person(u: Pick<User, 'name' | 'handle' | 'hue' | 'avatarUrl'>) {
    return { name: u.name, handle: u.handle, hue: u.hue, avatarUrl: u.avatarUrl };
  }

  // ---------- connected accounts ----------

  /** One external account, one Stake-Sync identity (PRD §11). */
  async saveConnection(userId: string, c: ConnectionInput) {
    const taken = await this.connections.findOneBy({ provider: c.provider, externalId: c.externalId });
    if (taken && taken.userId !== userId) {
      this.events.emit('risk.linked_account_attempt', { userId, otherUserId: taken.userId, provider: c.provider });
      throw new AppError(
        'account_in_use',
        `This ${PROVIDER_LABELS[c.provider]} account is already connected to another Stake-Sync account. Each one can only be used once. Contact support if it's yours.`,
        HttpStatus.CONFLICT,
      );
    }
    const row = (await this.connections.findOneBy({ userId, provider: c.provider })) ?? this.connections.create({ userId, provider: c.provider });
    if (row.externalId && row.externalId !== c.externalId && (await this.inUse(userId, c.provider))) {
      throw conflict('connection_in_use', `You're in a challenge verified with your current ${PROVIDER_LABELS[c.provider]} account, so it can't be swapped until that challenge ends.`);
    }
    Object.assign(row, {
      externalId: c.externalId,
      username: c.username,
      accessToken: c.accessToken ?? null,
      refreshToken: c.refreshToken ?? null,
      tokenExpiresAt: c.tokenExpiresAt ?? null,
      scopes: c.scopes ?? '',
      externalCreatedAt: c.externalCreatedAt ?? null,
      status: 'active',
    });
    await this.connections.save(row);
    this.events.emit(Events.AccountLinked, { userId, provider: c.provider, externalId: c.externalId, externalCreatedAt: c.externalCreatedAt } satisfies LinkedEvent);
    return { provider: PROVIDER_LABELS[c.provider], account: c.username };
  }

  private async inUse(userId: string, provider: string) {
    const active = await this.participants.find({ where: { userId, status: In(['pending', 'active']) }, relations: { challenge: true } });
    return active.some((p) => p.challenge!.providers.includes(provider as ProviderKey));
  }

  async disconnect(userId: string, provider: ConnectionProvider) {
    if (provider !== 'google' && (await this.inUse(userId, provider))) {
      throw conflict('connection_in_use', `You're in a challenge verified with ${PROVIDER_LABELS[provider]}. You can disconnect it once that challenge ends.`);
    }
    const u = await this.users.findOneByOrFail({ id: userId });
    const others = await this.connections.countBy({ userId, provider: Not(provider) });
    const hasWallet = await this.wallets.existsBy({ userId, kind: 'external' });
    if (!u.passwordHash && others === 0 && !hasWallet) {
      throw conflict('last_sign_in_method', 'This is how you sign in. Set a password first so you don’t get locked out.');
    }
    await this.connections.delete({ userId, provider });
  }

  /**
   * LeetCode and Codeforces have no OAuth. Ownership is proven by putting a one-time code in the
   * public profile (LeetCode: "About me"; Codeforces: first name, last name or organisation).
   */
  async profileCode(userId: string, provider: 'leetcode' | 'codeforces', username: string) {
    const code = `SS-${randomCode(6)}`;
    const tokenHash = sha256Hex(`profile:${userId}:${provider}`);
    await this.tokens.delete({ tokenHash });
    await this.tokens.save(
      this.tokens.create({ kind: 'oauth_state', tokenHash, userId, data: { provider, username: username.trim(), code }, expiresAt: new Date(Date.now() + 30 * 60_000) }),
    );
    const where = provider === 'leetcode' ? 'the "About me" (Summary) section of your LeetCode profile' : 'your Codeforces first name, last name or organisation (Settings → Social)';
    return { code, instructions: `Add ${code} to ${where}, save, then tap Verify. You can remove it afterwards.`, expiresInMinutes: 30 };
  }

  async verifyProfileCode(userId: string, provider: 'leetcode' | 'codeforces') {
    const t = await this.tokens.findOneBy({ tokenHash: sha256Hex(`profile:${userId}:${provider}`) });
    if (!t || t.expiresAt < new Date()) throw new AppError('code_expired', 'That code expired. Get a new one and try again.', HttpStatus.GONE);
    const { username, code } = t.data as { username: string; code: string };
    if (provider === 'leetcode') {
      const p = await leetcodeProfile(username);
      if (!p) throw notFound('LeetCode user');
      if (!p.aboutMe.includes(code)) throw new AppError('code_not_found', `We couldn't find ${code} on your LeetCode profile yet. Paste it into ReadMe (or Display Name) under Edit Profile, click Save, then try again. LeetCode can take a minute to update.`);
      await this.tokens.delete({ id: t.id });
      return this.saveConnection(userId, { provider, externalId: p.username.toLowerCase(), username: p.username });
    }
    const u = await codeforcesUser(username);
    if (!u) throw notFound('Codeforces user');
    if (![u.firstName, u.lastName, u.organization].some((f) => f?.includes(code))) {
      throw new AppError('code_not_found', `We couldn't find ${code} on your Codeforces profile yet. Save it and try again in a minute.`);
    }
    await this.tokens.delete({ id: t.id });
    return this.saveConnection(userId, {
      provider,
      externalId: u.handle.toLowerCase(),
      username: u.handle,
      externalCreatedAt: new Date(u.registrationTimeSeconds * 1000),
    });
  }

  // ---------- wallets ----------

  async linkWallet(userId: string, address: string, kind: 'external' | 'embedded' = 'external') {
    const existing = await this.wallets.findOneBy({ address });
    if (existing && existing.userId !== userId) {
      throw conflict('wallet_in_use', 'This wallet is linked to another Stake-Sync account. Each wallet can only be linked once.');
    }
    if (existing) return existing;
    const hasPrimary = await this.wallets.existsBy({ userId, primary: true });
    const w = await this.wallets.save(this.wallets.create({ userId, address, kind, primary: !hasPrimary, verifiedAt: new Date() }));
    this.events.emit(Events.WalletLinked, { userId, address, kind } satisfies WalletLinkedEvent);
    return w;
  }

  async setPrimaryWallet(userId: string, address: string) {
    const w = await this.wallets.findOneBy({ userId, address });
    if (!w) throw notFound('wallet');
    await this.wallets.update({ userId }, { primary: false });
    await this.wallets.update({ id: w.id }, { primary: true });
  }

  async unlinkWallet(userId: string, address: string) {
    const w = await this.wallets.findOneBy({ userId, address });
    if (!w) throw notFound('wallet');
    const busy = await this.participants.existsBy({ userId, wallet: address, claimed: false, status: In(['pending', 'active', 'completed']) });
    if (busy) throw conflict('wallet_in_use', 'This wallet has money in a challenge. You can unlink it after you’ve claimed.');
    await this.wallets.delete({ id: w.id });
    if (w.primary) {
      const next = await this.wallets.findOne({ where: { userId }, order: { createdAt: 'ASC' } });
      if (next) await this.wallets.update({ id: next.id }, { primary: true });
    }
  }

  // ---------- closing the account (no dark patterns: one call, plain answer) ----------

  async closeAccount(userId: string) {
    const blockers: string[] = [];
    const active = await this.participants.find({ where: { userId, status: In(['pending', 'active']) }, relations: { challenge: true } });
    const staked = active.filter((p) => p.stake > 0n);
    if (staked.length) blockers.push(`You have money staked in ${staked.map((p) => p.challenge!.title).join(', ')}. It's returned under the challenge rules when ${staked.length === 1 ? 'it ends' : 'they end'}.`);
    const unclaimed = await this.participants.createQueryBuilder('p').where('p.user_id = :userId AND p.claimed = false AND p.claimable > 0', { userId }).getMany();
    if (unclaimed.length) blockers.push('You have money ready to claim. Claim it from Wallet first.');
    // Wallets belong to the person, so whatever is in them stays theirs after the account closes.
    if (blockers.length && (staked.length || unclaimed.length)) {
      throw new AppError('cannot_close_yet', 'We can close your account once your money is out.', HttpStatus.CONFLICT, { blockers });
    }
    // Leave participation records for other people's settlement and audit; remove personal data.
    await this.users.update(
      { id: userId },
      {
        status: 'closed',
        closedAt: new Date(),
        email: null,
        passwordHash: null,
        name: 'Closed account',
        handle: `closed_${userId.slice(0, 8)}`,
        bio: '',
        avatarUrl: null,
        totpSecret: null,
        totpEnabled: false,
      },
    );
    await this.connections.delete({ userId });
    await this.pushSubs.delete({ userId });
    await this.sessions.update({ userId }, { revokedAt: new Date() });
    return { closed: true, notes: blockers };
  }

  /** People to invite, by handle or name. Private profiles and closed accounts aren't listed. */
  async search(viewerId: string, q: string) {
    const term = q.trim().replace(/^@/, '').toLowerCase();
    if (term.length < 2) return [];
    const rows = await this.users
      .createQueryBuilder('u')
      .where("u.status = 'active'")
      .andWhere('u.id != :viewerId', { viewerId })
      .andWhere("(u.privacy->>'profile') IS DISTINCT FROM 'private'")
      .andWhere('(u.handle LIKE :prefix OR LOWER(u.name) LIKE :anywhere)', { prefix: `${term.replace(/[%_]/g, '')}%`, anywhere: `%${term.replace(/[%_]/g, '')}%` })
      .orderBy('u.handle', 'ASC')
      .take(8)
      .getMany();
    return rows.map((u) => ({ name: u.name, handle: u.handle, hue: u.hue, avatarUrl: u.avatarUrl }));
  }

}
