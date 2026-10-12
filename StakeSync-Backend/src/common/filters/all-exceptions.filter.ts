import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { LogsService } from '../../core/logs/logs.service.js';
import { requestInfo } from '../../core/logs/request-logger.js';

/**
 * People never see stack traces, raw provider errors or framework messages. Known errors keep their
 * plain message; everything else is recorded in the error log and replaced with a next step plus a
 * reference support can look up.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logs?: LogsService) {}

  catch(err: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw err;
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const info = requestInfo(req);

    if (err instanceof ThrottlerException) {
      this.logs?.security('rate_limited', `Rate limit hit on ${info.method} ${info.path?.split('?')[0]}`, info);
      return res.status(429).json({ code: 'rate_limited', message: "You're going a bit fast. Wait a moment and try again." });
    }

    if (err instanceof HttpException) {
      const status = err.getStatus();
      const body = err.getResponse() as { code?: string; message?: string | string[]; details?: unknown };
      if (status === HttpStatus.FORBIDDEN && info.path?.startsWith('/api/admin')) {
        this.logs?.security('admin_forbidden', `Blocked admin request to ${info.method} ${info.path.split('?')[0]}`, info);
      }
      if (body && typeof body === 'object' && body.code) {
        return res.status(status).json({ code: body.code, message: body.message, details: body.details });
      }
      if (status === HttpStatus.BAD_REQUEST && Array.isArray(body?.message)) {
        // class-validator output: keep it readable, it describes the person's own input.
        return res.status(400).json({ code: 'invalid_input', message: 'Some details need fixing.', details: { fields: body.message } });
      }
      if (status === HttpStatus.BAD_REQUEST && typeof body?.message === 'string' && /json/i.test(body.message)) {
        return res.status(400).json({ code: 'invalid_json', message: 'That request wasn’t valid JSON.' });
      }
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) return res.status(413).json({ code: 'too_large', message: 'That’s too large to upload. Try a smaller file.' });
      if (status === HttpStatus.UNAUTHORIZED) return res.status(401).json({ code: 'unauthorized', message: 'Please sign in again.' });
      if (status === HttpStatus.FORBIDDEN) return res.status(403).json({ code: 'forbidden', message: "You don't have access to this." });
      if (status === HttpStatus.NOT_FOUND) return res.status(404).json({ code: 'not_found', message: "We couldn't find that." });
      if (status < 500) return res.status(status).json({ code: 'bad_request', message: 'That request could not be completed. Check the details and try again.' });
    }

    // Body-parser errors (malformed JSON, oversized bodies) arrive as plain errors with a status.
    const parserStatus = (err as { status?: number; type?: string })?.status;
    if (parserStatus === 413) return res.status(413).json({ code: 'too_large', message: 'That request is too large.' });
    if (parserStatus === 400 && (err as { type?: string }).type === 'entity.parse.failed') {
      return res.status(400).json({ code: 'invalid_json', message: 'That request wasn’t valid JSON.' });
    }

    const ref = info.requestId ?? 'unknown';
    if (this.logs) void this.logs.error('HTTP', err, info);
    else console.error(`[${ref}]`, err);
    return res.status(500).json({
      code: 'server_error',
      message: "Something went wrong on our side. Your money is safe. Please try again, and contact support if it keeps happening.",
      ref,
    });
  }
}
