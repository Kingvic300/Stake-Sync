import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { LogsService } from '../../core/logs/logs.service.js';
import { requestInfo } from '../../core/logs/request-logger.js';
import { Session } from '../../modules/auth/entities/auth.entities.js';
import { User } from '../../modules/users/entities/user.entities.js';
import { ADMIN_PERMISSION, ALLOW_WITHOUT_MFA, IS_PUBLIC, OPTIONAL_AUTH, PERMISSIONS, type AdminRole, type AuthUser, type Permission } from '../auth.js';
import { AppError, forbidden } from '../errors.js';

interface TokenPayload {
  sub: string;
  sid: string;
  adm?: AdminRole;
  mfa?: boolean;
}

export function bearer(req: Pick<Request, 'headers'>) {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

/** Session and account state, cached briefly so revocation takes effect within seconds without a query per request. */
const CACHE_MS = 15_000;

/**
 * Global guard: every route needs a valid access token unless marked @Public or @OptionalAuth.
 * Beyond the signature it checks the session hasn't been revoked and the account isn't suspended,
 * so signing out everywhere or suspending someone works immediately, not when the token expires.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly cache = new Map<string, { ok: boolean; at: number }>();
  private readonly require2fa: boolean;
  private readonly allowlist: string[];

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly logs: LogsService,
    config: ConfigService,
  ) {
    this.require2fa = config.get<boolean>('security.adminRequire2fa') ?? false;
    this.allowlist = config.get<string[]>('security.adminIpAllowlist') ?? [];
  }

  private async alive(p: TokenPayload) {
    const key = `${p.sid}:${p.sub}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.ok;
    const [session, user] = await Promise.all([
      this.sessions.findOne({ where: { id: p.sid, userId: p.sub }, select: { id: true, revokedAt: true, expiresAt: true } }),
      this.users.findOne({ where: { id: p.sub }, select: { id: true, status: true, adminRole: true } }),
    ]);
    const ok = Boolean(
      session && !session.revokedAt && session.expiresAt > new Date() && user && user.status !== 'suspended' && user.status !== 'closed' && (!p.adm || user.adminRole === p.adm),
    );
    if (this.cache.size > 50_000) this.cache.clear();
    this.cache.set(key, { ok, at: Date.now() });
    return ok;
  }

  async canActivate(ctx: ExecutionContext) {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH, targets);
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(ADMIN_PERMISSION, targets);
    const withoutMfa = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA, targets);
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = bearer(req);

    if (token) {
      let p: TokenPayload | null = null;
      try {
        p = await this.jwt.verifyAsync<TokenPayload>(token, { algorithms: ['HS256'] });
      } catch {
        p = null;
      }
      if (p && (await this.alive(p))) {
        req.user = { id: p.sub, sessionId: p.sid, adminRole: p.adm, mfa: Boolean(p.mfa) };
      } else if (!isPublic && !optional) {
        throw new UnauthorizedException();
      }
    }
    if (isPublic || optional) return true;
    if (!req.user) throw new UnauthorizedException();

    if (permission) {
      if (this.allowlist.length && !this.allowlist.some((a) => (a.endsWith('.') || a.endsWith(':') ? req.ip?.startsWith(a) : req.ip === a))) {
        this.logs.security('admin_ip_blocked', `Admin request from an address outside the allowlist`, requestInfo(req));
        throw forbidden('Admin access isn’t allowed from this network.');
      }
      const role = req.user.adminRole;
      if (!role || !(PERMISSIONS[permission] as readonly AdminRole[]).includes(role)) {
        throw forbidden("Your admin role can't do this. Ask a super admin if you need access.");
      }
      if (this.require2fa && !req.user.mfa && !withoutMfa) {
        throw new AppError('two_factor_setup_required', 'Turn on two-step verification to use the admin console.', 403);
      }
    }
    return true;
  }
}
