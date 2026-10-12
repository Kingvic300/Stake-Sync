import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { ErrorGroup, ServerLog, type LogKind, type LogLevel } from './log.entities.js';
import { redact } from './redact.js';

export interface RequestInfo {
  requestId?: string | null;
  method?: string | null;
  path?: string | null;
  status?: number | null;
  durationMs?: number | null;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

type Entry = Partial<ServerLog> & { level: LogLevel; kind: LogKind; message: string };

const MAX_BUFFER = 5000;

/** Same error, different ids or numbers: one group. */
function fingerprint(context: string, message: string, stack?: string | null) {
  const norm = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,88}\b/g, '<key>')
    .replace(/\d+/g, '<n>')
    .slice(0, 300);
  const frame = (stack ?? '').split('\n').find((l) => l.trim().startsWith('at ') && !l.includes('node_modules')) ?? '';
  return createHash('sha256').update(`${context}|${norm}|${frame.replace(/:\d+:\d+\)?$/, '').trim()}`).digest('hex');
}

/**
 * Writes the server log (requests, app messages, security events) and groups errors. Writes are
 * buffered and flushed every two seconds, so logging never slows a request, and a logging failure
 * never breaks one.
 */
@Injectable()
export class LogsService implements OnApplicationShutdown {
  private buffer: Entry[] = [];
  private flushing = false;
  private readonly timer: NodeJS.Timeout;
  private readonly keep: { info: number; warn: number; error: number };

  constructor(
    @InjectRepository(ServerLog) private readonly logs: Repository<ServerLog>,
    @InjectRepository(ErrorGroup) private readonly groups: Repository<ErrorGroup>,
    config: ConfigService,
  ) {
    this.timer = setInterval(() => void this.flush(), 2000);
    this.timer.unref();
    this.keep = {
      info: config.get<number>('logs.keepInfoDays') ?? 14,
      warn: config.get<number>('logs.keepWarnDays') ?? 30,
      error: config.get<number>('logs.keepErrorDays') ?? 90,
    };
  }

  private push(e: Entry) {
    if (this.buffer.length >= MAX_BUFFER) this.buffer.shift(); // drop the oldest rather than run out of memory
    this.buffer.push({ ...e, message: e.message.slice(0, 1000), context: (e.context ?? '').slice(0, 60), meta: redact(e.meta ?? {}) as Record<string, unknown> });
  }

  request(r: RequestInfo, level: LogLevel = 'info') {
    this.push({ level, kind: 'request', context: 'HTTP', message: `${r.method} ${r.path} ${r.status} ${r.durationMs}ms`, ...r });
  }

  app(level: LogLevel, context: string, message: string, meta: Record<string, unknown> = {}) {
    this.push({ level, kind: 'app', context, message, meta });
  }

  /** Suspicious or blocked activity: failed sign-ins, lockouts, replayed tokens, forbidden access. */
  security(event: string, message: string, r: RequestInfo = {}, meta: Record<string, unknown> = {}) {
    this.push({ level: 'warn', kind: 'security', context: event, message, ...r, meta });
  }

  /** An exception, grouped with earlier ones like it. Also printed to stderr for the host's logs. */
  async error(context: string, err: unknown, r: RequestInfo = {}, meta: Record<string, unknown> = {}) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = typeof meta.stack === 'string' ? meta.stack : err instanceof Error ? (err.stack ?? null) : null;
    const { stack: _omit, ...rest } = meta;
    void _omit;
    console.error(`[${context}]${r.requestId ? ` [${r.requestId}]` : ''} ${stack ?? message}`);
    let groupId: string | null = null;
    try {
      const fp = fingerprint(context, message, stack);
      const where = r.path ? `${r.method ?? ''} ${r.path.split('?')[0]}`.trim() : context;
      const rows: { id: string }[] = await this.groups.query(
        `INSERT INTO error_groups (id, fingerprint, message, context, "where", count, first_seen, last_seen, status, sample_stack, last_request_id)
         VALUES (uuid_generate_v4(), $1, $2, $3, $4, 1, now(), now(), 'open', $5, $6)
         ON CONFLICT (fingerprint) DO UPDATE SET count = error_groups.count + 1, last_seen = now(), "where" = $4,
           last_request_id = $6, sample_stack = COALESCE($5, error_groups.sample_stack),
           status = 'open', resolved_at = CASE WHEN error_groups.status = 'resolved' THEN NULL ELSE error_groups.resolved_at END
         RETURNING id`,
        [fp, message.slice(0, 1000), context.slice(0, 60), where.slice(0, 500), stack?.slice(0, 8000) ?? null, r.requestId ?? null],
      );
      groupId = rows[0]?.id ?? null;
    } catch {
      // The database may be the thing that's failing; the entry still goes to the buffer and stderr.
    }
    this.push({ level: 'error', kind: 'error', context, message, stack: stack?.slice(0, 8000) ?? null, errorGroupId: groupId, ...r, meta: rest });
  }

  async flush() {
    if (this.flushing || !this.buffer.length) return;
    this.flushing = true;
    const batch = this.buffer.splice(0, 500);
    try {
      await this.logs.insert(batch as never[]);
    } catch (e) {
      // Put them back once (e.g. the database is restarting); after that they're dropped.
      if (this.buffer.length < MAX_BUFFER) this.buffer.unshift(...batch.slice(0, MAX_BUFFER - this.buffer.length));
      console.error(`[Logs] could not write ${batch.length} log entries: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.flushing = false;
    }
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.flush();
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune() {
    for (const [level, days] of Object.entries(this.keep)) {
      await this.logs.query(`DELETE FROM server_logs WHERE level = $1 AND created_at < now() - ($2 || ' days')::interval`, [level, String(days)]);
    }
    await this.groups.query(`DELETE FROM error_groups WHERE status = 'resolved' AND last_seen < now() - interval '90 days'`);
  }
}
