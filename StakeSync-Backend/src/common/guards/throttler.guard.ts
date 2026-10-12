import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectThrottlerOptions, InjectThrottlerStorage, ThrottlerGuard, type ThrottlerModuleOptions, type ThrottlerStorage } from '@nestjs/throttler';
import type { Request } from 'express';
import { bearer } from './auth.guard.js';

/**
 * Rate limits per signed-in person, or per IP when signed out. Only a token that verifies counts,
 * so forging tokens can't buy fresh limits.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwt: JwtService,
  ) {
    super(options, storage, reflector);
  }

  protected override async getTracker(req: Record<string, unknown>) {
    const token = bearer(req as unknown as Request);
    if (token) {
      try {
        const p = await this.jwt.verifyAsync<{ sub: string }>(token, { algorithms: ['HS256'] });
        return `user:${p.sub}`;
      } catch {
        // fall through to IP
      }
    }
    return `ip:${(req as unknown as Request).ip ?? 'unknown'}`;
  }
}
