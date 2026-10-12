import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../../common/auth.js';
import type { LogsService } from './logs.service.js';
import { redactUrl } from './redact.js';

const ID = /^[A-Za-z0-9-]{8,36}$/;

/** One server-log entry per request, plus an X-Request-Id that ties it to errors and to support tickets. */
export function requestLogger(logs: LogsService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && ID.test(incoming) ? incoming : randomUUID();
    (req as Request & { id: string }).id = id;
    res.setHeader('X-Request-Id', id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      // Health checks and CORS preflights are noise.
      if (req.path === '/api/health' || req.method === 'OPTIONS') return;
      const status = res.statusCode;
      logs.request(
        {
          requestId: id,
          method: req.method,
          path: redactUrl(req.originalUrl),
          status,
          durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
          userId: (req as Request & { user?: AuthUser }).user?.id ?? null,
          ip: req.ip ?? null,
          userAgent: (req.headers['user-agent'] ?? '').slice(0, 300),
        },
        status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      );
    });
    next();
  };
}

export function requestInfo(req: Request) {
  return {
    requestId: (req as Request & { id?: string }).id ?? null,
    method: req.method,
    path: redactUrl(req.originalUrl ?? req.url),
    userId: (req as Request & { user?: AuthUser }).user?.id ?? null,
    ip: req.ip ?? null,
    userAgent: (req.headers?.['user-agent'] ?? '').slice(0, 300),
  };
}
