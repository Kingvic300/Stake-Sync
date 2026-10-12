import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { IsNull, Repository } from 'typeorm';
import {
  hashPassword,
  newTotpSecret,
  randomToken,
  sha256Hex,
  verifyEd25519,
  verifyPassword,
  totpStep,
} from '../../common/crypto.js';
import { AppError, forbidden } from '../../common/errors.js';
import { Events, type UserEvent } from '../../common/events.js';
import { CryptoService } from '../../core/crypto.service.js';
import { assertStrongPassword } from '../../common/password-policy.js';
import { TERMS_VERSION } from '../../common/terms.js';
import { LogsService } from '../../core/logs/logs.service.js';
import { MailService } from '../notifications/mail.service.js';
import { ConnectedAccount, User, Wallet } from '../users/entities/user.entities.js';
import { UsersService } from '../users/users.service.js';
import { AuthToken, Session, type AuthTokenKind } from './entities/auth.entities.js';
import { OAuthService, type OAuthProfile, type OAuthProvider } from './oauth.service.js';

export interface RequestContext {
  ip?: string;
  userAgent?: string;
  device?: string;
}

const MINUTE = 60_000;

const termsRequired = () =>
  new AppError('terms_required', 'Tick the box to agree to the Terms of Service and Privacy Policy to create your account.', HttpStatus.BAD_REQUEST);
/** Compared against when the email doesn't exist, so a miss takes as long as a wrong password. */
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==';

/** Only same-site paths: '/x' is fine; '//evil.com', '/\\evil.com' and full URLs are not. */
export function safeRedirect(r?: string) {
  return r && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(r) ? r : '/';
}

/** "Chrome on Windows" from a user agent, good enough for a security email. */
export function describeAgent(ua: string) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'an unknown system';
  return `${browser} on ${os}`;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(AuthToken) private readonly tokens: Repository<AuthToken>,
    @InjectRepository(ConnectedAccount) private readonly connections: Repository<ConnectedAccount>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly oauth: OAuthService,
    private readonly mail: MailService,
    private readonly crypto: CryptoService,
    private readonly usersService: UsersService,
    private readonly events: EventEmitter2,
    private readonly logs: LogsService,
  ) {}

  // ---------- email + password ----------

  async signup(dto: { name: string; email: string; password: string; acceptTerms: boolean }, ctx: RequestContext) {
    if (dto.acceptTerms !== true) throw termsRequired();
    const email = dto.email.trim().toLowerCase();
    assertStrongPassword(dto.password, email);
    if (await this.users.existsBy({ email })) {
      throw new AppError('email_taken', 'An account already uses this email. Sign in instead, or reset your password.', HttpStatus.CONFLICT);
    }
    const user = await this.users.save(
      this.users.create({
        email,
        name: dto.name.trim(),
        passwordHash: await hashPassword(dto.password),
        termsAcceptedAt: new Date(),
        termsVersion: TERMS_VERSION,
        handle: await this.usersService.uniqueHandle(dto.name),
        hue: Math.floor(Math.random() * 360),
        signupIpHash: ctx.ip ? sha256Hex(ctx.ip) : null,
        deviceHash: ctx.device ? sha256Hex(ctx.device) : null,
      }),
    );
    this.events.emit(Events.UserSignedUp, { userId: user.id, ip: ctx.ip, device: ctx.device } satisfies UserEvent);
    await this.sendVerification(user);
    return this.issue(user, ctx);
  }

  async login(dto: { email: string; password: string }, ctx: RequestContext) {
    const user = await this.checkPassword(dto.email, dto.password, ctx, 'login');
    if (!user) throw new AppError('invalid_credentials', "That email and password don't match. Try again or reset your password.", HttpStatus.UNAUTHORIZED);
    return this.issue(user, ctx);
  }

  /**
   * Password check shared by both sign-ins. Takes the same time whether or not the email exists
   * (no account discovery by timing), and locks the account for a while after repeated failures
   * (no password guessing), telling the owner by email.
   */
  private async checkPassword(emailInput: string, password: string, ctx: RequestContext, where: 'login' | 'admin_login') {
    const email = emailInput.trim().toLowerCase();
    const user = await this.users.findOneBy({ email });
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      this.logs.security('login_locked', `Sign-in attempt on a locked account`, this.req(ctx), { email, where });
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new AppError('account_locked', `Too many attempts. For your safety, sign-in is paused for ${mins} minute${mins === 1 ? '' : 's'}. You can reset your password instead.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (user?.passwordHash && ok) {
      if (user.failedLogins) await this.users.update({ id: user.id }, { failedLogins: 0, lockedUntil: null });
      return user;
    }
    this.logs.security(`${where}_failed`, `Failed ${where === 'admin_login' ? 'admin ' : ''}sign-in`, this.req(ctx), { email, knownAccount: Boolean(user) });
    if (user) {
      const failed = user.failedLogins + 1;
      const max = this.config.get<number>('security.maxLoginAttempts') ?? 8;
      if (failed >= max) {
        const until = new Date(Date.now() + (this.config.get<number>('security.lockMinutes') ?? 15) * MINUTE);
        await this.users.update({ id: user.id }, { failedLogins: 0, lockedUntil: until });
        this.logs.security('account_locked', `Account locked after ${failed} failed sign-ins`, this.req(ctx), { userId: user.id });
        if (user.email) {
          await this.mail.send(user.email, 'Someone tried to sign in to your account', `There were ${failed} failed attempts to sign in to your Stake-Sync account, so we paused sign-in for a few minutes. If this was you, wait a moment or reset your password. If it wasn't, reset your password now.`, { label: 'Reset password', href: '/forgot' });
        }
      } else {
        await this.users.update({ id: user.id }, { failedLogins: failed });
      }
    }
    return null;
  }

  private req(ctx: RequestContext) {
    return { ip: ctx.ip ?? null, userAgent: ctx.userAgent?.slice(0, 300) ?? null };
  }

  async sendVerification(user: User) {
    if (!user.email || user.emailVerifiedAt) return;
    const token = await this.token('verify_email', user.id, 48 * 60 * MINUTE);
    await this.mail.send(user.email, 'Confirm your email', `Hi ${user.name.split(' ')[0]}, confirm your email to finish setting up Stake-Sync.`, {
      label: 'Confirm email',
      href: `/verify-email?token=${token}`,
    });
  }

  async resendVerification(userId: string) {
    await this.sendVerification(await this.users.findOneByOrFail({ id: userId }));
  }

  async verifyEmail(token: string) {
    const t = await this.consume('verify_email', token);
    await this.users.update({ id: t.userId! }, { emailVerifiedAt: new Date() });
  }

  async forgotPassword(email: string) {
    const user = await this.users.findOneBy({ email: email.trim().toLowerCase() });
    if (!user?.email || user.status === 'closed') return; // never reveal whether an account exists
    const token = await this.token('reset_password', user.id, 60 * MINUTE);
    await this.mail.send(user.email, 'Reset your password', 'Someone asked to reset your Stake-Sync password. If it was you, use the button below within an hour. If not, you can ignore this email.', {
      label: 'Choose a new password',
      href: `/reset-password?token=${token}`,
    });
  }

  async resetPassword(token: string, password: string) {
    const t = await this.consume('reset_password', token);
    const u = await this.users.findOneByOrFail({ id: t.userId! });
    assertStrongPassword(password, u.email);
    await this.users.update({ id: t.userId! }, { passwordHash: await hashPassword(password), emailVerifiedAt: new Date(), failedLogins: 0, lockedUntil: null });
    await this.revokeAll(t.userId!);
  }

  async changePassword(userId: string, current: string | undefined, next: string, sessionId: string) {
    const user = await this.users.findOneByOrFail({ id: userId });
    if (user.passwordHash && !(current && (await verifyPassword(current, user.passwordHash)))) {
      throw new AppError('invalid_credentials', "Your current password isn't right.");
    }
    assertStrongPassword(next, user.email);
    await this.users.update({ id: userId }, { passwordHash: await hashPassword(next) });
    // Sign out everywhere else.
    await this.sessions.createQueryBuilder().update().set({ revokedAt: () => 'now()' }).where('user_id = :userId AND id != :sessionId AND revoked_at IS NULL', { userId, sessionId }).execute();
  }

  // ---------- OAuth (sign in, or connect an account) ----------

  async oauthStart(provider: OAuthProvider, mode: 'login' | 'connect', userId: string | null, redirect?: string, acceptTerms = false) {
    if (mode === 'login' && provider === 'wakatime') throw new AppError('unsupported', 'WakaTime can be connected, not used to sign in.');
    if (mode === 'connect' && !userId) throw forbidden();
    const state = await this.token('oauth_state', userId, 10 * MINUTE, { provider, mode, redirect: safeRedirect(redirect), acceptTerms });
    return { url: this.oauth.authorizeUrl(provider, state) };
  }

  async oauthCallback(provider: OAuthProvider, code: string, state: string, ctx: RequestContext, currentUserId?: string) {
    const t = await this.consume('oauth_state', state);
    const data = t.data as { provider: string; mode: 'login' | 'connect'; redirect: string; acceptTerms?: boolean };
    if (data.provider !== provider) throw new AppError('oauth_failed', 'That sign-in link expired. Please try again.');
    const profile = await this.oauth.exchange(provider, code);

    if (data.mode === 'connect') {
      if (!t.userId || (currentUserId && currentUserId !== t.userId)) throw forbidden();
      await this.link(t.userId, profile);
      return { connected: provider, redirect: data.redirect };
    }

    const existing = await this.connections.findOneBy({ provider, externalId: profile.externalId });
    let user: User | null = existing ? await this.users.findOneBy({ id: existing.userId }) : null;
    if (!user && profile.email && profile.emailVerified) {
      // Same verified email: sign in to that account and link this provider to it.
      user = await this.users.findOneBy({ email: profile.email.toLowerCase() });
    }
    let created = false;
    if (!user) {
      // A new account: the sign-up screen's terms checkbox must have been ticked before going to Google/GitHub.
      if (data.acceptTerms !== true) throw termsRequired();
      user = await this.users.save(
        this.users.create({
          email: profile.email?.toLowerCase() ?? null,
          emailVerifiedAt: profile.emailVerified ? new Date() : null,
          termsAcceptedAt: new Date(),
          termsVersion: TERMS_VERSION,
          name: profile.name,
          handle: await this.usersService.uniqueHandle(provider === 'github' ? profile.username : profile.name),
          avatarUrl: profile.avatarUrl,
          hue: Math.floor(Math.random() * 360),
          signupIpHash: ctx.ip ? sha256Hex(ctx.ip) : null,
          deviceHash: ctx.device ? sha256Hex(ctx.device) : null,
        }),
      );
      created = true;
      this.events.emit(Events.UserSignedUp, { userId: user.id, ip: ctx.ip, device: ctx.device } satisfies UserEvent);
    } else if (profile.emailVerified && !user.emailVerifiedAt && user.email === profile.email?.toLowerCase()) {
      await this.users.update({ id: user.id }, { emailVerifiedAt: new Date() });
    }
    if (!existing) await this.link(user.id, profile);
    return { ...(await this.issue(user, ctx)), created, redirect: data.redirect };
  }

  /** Stores the connection with its tokens encrypted. Uniqueness rules live in UsersService. */
  link(userId: string, p: OAuthProfile) {
    return this.usersService.saveConnection(userId, {
      provider: p.provider,
      externalId: p.externalId,
      username: p.username,
      accessToken: this.crypto.seal(p.accessToken),
      refreshToken: p.refreshToken ? this.crypto.seal(p.refreshToken) : null,
      tokenExpiresAt: p.expiresAt,
      scopes: p.scopes,
      externalCreatedAt: p.createdAt,
    });
  }

  // ---------- wallet sign-in ----------

  /** Message a wallet signs to prove ownership. Used for sign-in and for linking. */
  async walletNonce(address: string, purpose: 'login' | 'link', userId: string | null) {
    try {
      new PublicKey(address);
    } catch {
      throw new AppError('invalid_wallet', "That doesn't look like a Solana wallet address.");
    }
    const nonce = randomToken(16);
    // Names the site and expires, so a signature can't be replayed elsewhere or later (SIWS style).
    const domain = new URL(this.config.get<string>('appUrl') ?? 'https://stake-sync-ui.vercel.app').host;
    const message = `${domain} wants you to ${purpose === 'login' ? 'sign in with' : 'link'} this Solana wallet:\n${address}\n\nThis costs nothing and doesn't approve any payment.\n\nURI: https://${domain}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${new Date(Date.now() + 10 * MINUTE).toISOString()}`;
    await this.token('wallet_nonce', userId, 10 * MINUTE, { address, message, purpose }, nonce);
    return { message, nonce };
  }

  async verifyWalletSignature(nonce: string, address: string, signature: string, purpose: 'login' | 'link') {
    const t = await this.consume('wallet_nonce', nonce);
    const d = t.data as { address: string; message: string; purpose: string };
    if (d.address !== address || d.purpose !== purpose) throw new AppError('invalid_signature', 'That signature is for a different wallet. Please try again.');
    let ok = false;
    try {
      ok = verifyEd25519(new PublicKey(address).toBytes(), new TextEncoder().encode(d.message), bs58.decode(signature));
    } catch {
      ok = false;
    }
    if (!ok) {
      this.logs.security('invalid_wallet_signature', 'Wallet signature did not verify', {}, { address, purpose });
      throw new AppError('invalid_signature', "We couldn't confirm that signature. Please sign the message again.");
    }
    return t.userId;
  }

  async linkWallet(userId: string, nonce: string, address: string, signature: string, kind: 'external' | 'embedded' = 'external') {
    const owner = await this.verifyWalletSignature(nonce, address, signature, 'link');
    if (owner !== userId) throw forbidden();
    await this.usersService.linkWallet(userId, address, kind);
    return this.usersService.me(userId);
  }

  async walletLogin(nonce: string, address: string, signature: string, ctx: RequestContext) {
    await this.verifyWalletSignature(nonce, address, signature, 'login');
    const wallet = await this.wallets.findOneBy({ address });
    if (!wallet?.verifiedAt) {
      throw new AppError('wallet_not_linked', "This wallet isn't linked to an account yet. Sign in another way, then link it from Wallet.", HttpStatus.NOT_FOUND);
    }
    return this.issue(await this.users.findOneByOrFail({ id: wallet.userId }), ctx);
  }

  // ---------- sessions ----------

  /**
   * Emails the owner when someone signs in from a browser or device we haven't seen on this account.
   * The first sign-in after signing up doesn't count; the welcome email covers that.
   */
  private async alertNewDevice(user: User, ctx: RequestContext, admin: boolean) {
    if (!user.email) return;
    const agent = (ctx.userAgent ?? '').slice(0, 250);
    const seen = await this.sessions.countBy({ userId: user.id });
    if (!seen || (await this.sessions.existsBy({ userId: user.id, userAgent: agent }))) return;
    const when = new Date().toUTCString().replace(' GMT', ' UTC');
    await this.mail.send(
      user.email,
      admin ? 'New sign-in to the Stake-Sync admin console' : 'New sign-in to your Stake-Sync account',
      `Your account was just signed in to from a new device or browser.\n\nWhen: ${when}\nDevice: ${describeAgent(agent)}\n\nIf this was you, there's nothing to do. If it wasn't, reset your password now and sign out of other devices from Settings.`,
      { label: 'Reset password', href: '/forgot' },
    );
  }

  async issue(user: User, ctx: RequestContext, admin = false, mfa = false) {
    if (user.status === 'suspended') {
      throw new AppError('account_suspended', 'This account is suspended. Email stakesync2@gmail.com and we’ll explain what happens next. Any money in active challenges stays safe in escrow.', HttpStatus.FORBIDDEN);
    }
    if (user.status === 'closed') throw new AppError('account_closed', 'This account was closed. Email stakesync2@gmail.com to reopen it.', HttpStatus.FORBIDDEN);

    await this.alertNewDevice(user, ctx, admin);
    const refresh = randomToken(48);
    const ttlDays = admin ? 1 : this.config.get<number>('auth.refreshTtlDays')!;
    const session = await this.sessions.save(
      this.sessions.create({
        userId: user.id,
        refreshHash: sha256Hex(refresh),
        admin,
        mfa: admin && mfa,
        userAgent: (ctx.userAgent ?? '').slice(0, 250),
        ipHash: ctx.ip ? sha256Hex(ctx.ip) : null,
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
      }),
    );
    await this.users.update({ id: user.id }, { lastActiveAt: new Date() });
    return { ...(await this.tokensFor(user, session)), refreshToken: refresh };
  }

  private async tokensFor(user: User, session: Session) {
    const expiresIn = this.config.get<number>('auth.accessTtlSecs')!;
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, sid: session.id, ...(session.admin && user.adminRole ? { adm: user.adminRole, mfa: session.mfa } : {}) },
      { expiresIn, algorithm: 'HS256' },
    );
    return { accessToken, expiresIn, user: await this.usersService.me(user.id) };
  }

  async refresh(refreshToken: string) {
    const hash = sha256Hex(refreshToken);
    const session = await this.sessions.findOneBy({ refreshHash: hash, revokedAt: IsNull() });
    if (!session) {
      // A rotated-out token being reused means it was copied: end that session.
      const stolen = await this.sessions.findOneBy({ previousHash: hash });
      if (stolen) {
        await this.sessions.update({ id: stolen.id }, { revokedAt: new Date() });
        this.logs.security('refresh_token_reuse', 'An old refresh token was reused; the session was ended', { userId: stolen.userId }, { sessionId: stolen.id });
      }
      throw new AppError('session_expired', 'Please sign in again.', HttpStatus.UNAUTHORIZED);
    }
    if (session.expiresAt < new Date()) throw new AppError('session_expired', 'Please sign in again.', HttpStatus.UNAUTHORIZED);
    const user = await this.users.findOneByOrFail({ id: session.userId });
    if (user.status === 'suspended' || user.status === 'closed') {
      await this.sessions.update({ id: session.id }, { revokedAt: new Date() });
      throw new AppError('session_expired', 'Please sign in again.', HttpStatus.UNAUTHORIZED);
    }
    const next = randomToken(48);
    session.previousHash = session.refreshHash;
    session.refreshHash = sha256Hex(next);
    await this.sessions.save(session);
    await this.users.update({ id: user.id }, { lastActiveAt: new Date() });
    return { ...(await this.tokensFor(user, session)), refreshToken: next };
  }

  async logout(sessionId: string) {
    await this.sessions.update({ id: sessionId }, { revokedAt: new Date() });
  }

  async revokeAll(userId: string) {
    await this.sessions.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  async listSessions(userId: string, currentId: string) {
    const rows = await this.sessions.find({ where: { userId, revokedAt: IsNull() }, order: { updatedAt: 'DESC' } });
    return rows
      .filter((s) => s.expiresAt > new Date())
      .map((s) => ({ id: s.id, device: s.userAgent || 'Unknown device', lastUsed: s.updatedAt.toISOString(), current: s.id === currentId, admin: s.admin }));
  }

  async revokeSession(userId: string, id: string) {
    await this.sessions.update({ id, userId }, { revokedAt: new Date() });
  }

  // ---------- admin ----------

  async adminLogin(dto: { email: string; password: string; code?: string }, ctx: RequestContext) {
    const user = await this.checkPassword(dto.email, dto.password, ctx, 'admin_login');
    if (!user || !user.adminRole) {
      if (user) this.logs.security('admin_login_non_admin', 'Non-admin tried the admin sign-in', this.req(ctx), { userId: user.id });
      throw new AppError('invalid_credentials', "That email and password don't match an admin account.", HttpStatus.UNAUTHORIZED);
    }
    if (user.totpEnabled) {
      if (!dto.code) throw new AppError('two_factor_required', 'Enter the 6-digit code from your authenticator app.', HttpStatus.UNAUTHORIZED);
      await this.useTotp(user, dto.code, ctx);
    }
    const required = this.config.get<boolean>('security.adminRequire2fa') ?? false;
    return { ...(await this.issue(user, ctx, true, user.totpEnabled)), twoFactorEnabled: user.totpEnabled, twoFactorRequired: required && !user.totpEnabled };
  }

  /** Accepts each code once (no replay within its 30-second window) and logs failures. */
  private async useTotp(user: User, code: string, ctx: RequestContext) {
    const step = user.totpSecret ? totpStep(this.crypto.openText(user.totpSecret), code) : null;
    if (step === null || (user.totpLastStep !== null && step <= user.totpLastStep)) {
      this.logs.security('admin_2fa_failed', 'Wrong or reused two-step code', this.req(ctx), { userId: user.id });
      throw new AppError('invalid_code', "That code didn't work. Codes change every 30 seconds; try the current one.", HttpStatus.UNAUTHORIZED);
    }
    await this.users.update({ id: user.id }, { totpLastStep: step });
  }

  async totpSetup(userId: string) {
    const user = await this.users.findOneByOrFail({ id: userId });
    if (user.totpEnabled) throw new AppError('already_enabled', 'Two-factor is already on for your account.');
    const secret = newTotpSecret();
    await this.users.update({ id: userId }, { totpSecret: this.crypto.seal(secret) });
    const label = encodeURIComponent(`Stake-Sync Admin:${user.email}`);
    return { secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=Stake-Sync%20Admin&period=30&digits=6` };
  }

  /** Turns on two-step verification and upgrades the current session, so there's no need to sign in again. */
  async totpEnable(userId: string, code: string, sessionId: string) {
    const user = await this.users.findOneByOrFail({ id: userId });
    if (!user.totpSecret) throw new AppError('setup_first', 'Start the setup first to get your secret.');
    await this.useTotp(user, code, {});
    await this.users.update({ id: userId }, { totpEnabled: true });
    await this.sessions.update({ id: sessionId, userId, admin: true }, { mfa: true });
    const session = await this.sessions.findOneByOrFail({ id: sessionId });
    return this.tokensFor(await this.users.findOneByOrFail({ id: userId }), session);
  }

  // ---------- single-use tokens ----------

  private async token(kind: AuthTokenKind, userId: string | null, ttlMs: number, data: Record<string, unknown> = {}, value = randomToken()) {
    await this.tokens.save(this.tokens.create({ kind, tokenHash: sha256Hex(value), userId, data, expiresAt: new Date(Date.now() + ttlMs) }));
    return value;
  }

  private async consume(kind: AuthTokenKind, value: string) {
    const t = await this.tokens.findOneBy({ kind, tokenHash: sha256Hex(value), usedAt: IsNull() });
    if (!t || t.expiresAt < new Date()) {
      throw new AppError('link_expired', 'This link has expired or was already used. Request a new one.', HttpStatus.GONE);
    }
    const res = await this.tokens.update({ id: t.id, usedAt: IsNull() }, { usedAt: new Date() });
    if (!res.affected) throw new AppError('link_expired', 'This link was already used. Request a new one.', HttpStatus.GONE);
    return t;
  }
}
