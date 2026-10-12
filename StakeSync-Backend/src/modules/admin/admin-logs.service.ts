import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { notFound } from '../../common/errors.js';
import { AuditService } from '../../core/audit.service.js';
import { ErrorGroup, ServerLog } from '../../core/logs/log.entities.js';
import { User } from '../users/entities/user.entities.js';

export interface LogQuery {
  kind?: string;
  level?: string;
  q?: string;
  status?: string;
  user?: string;
  requestId?: string;
  since?: string;
  before?: string;
  limit?: number;
}

/** Reads the server and error logs for the admin app. */
@Injectable()
export class AdminLogsService {
  constructor(
    @InjectRepository(ServerLog) private readonly logs: Repository<ServerLog>,
    @InjectRepository(ErrorGroup) private readonly groups: Repository<ErrorGroup>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditService,
  ) {}

  private async people(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    const rows = unique.length ? await this.users.find({ where: { id: In(unique) }, select: { id: true, name: true, handle: true } }) : [];
    return new Map(rows.map((u) => [u.id, { name: u.name, handle: u.handle }]));
  }

  private view(l: ServerLog, people: Map<string, { name: string; handle: string }>) {
    return {
      id: l.id,
      at: l.createdAt.toISOString(),
      level: l.level,
      kind: l.kind,
      context: l.context,
      message: l.message,
      requestId: l.requestId,
      method: l.method,
      path: l.path,
      status: l.status,
      durationMs: l.durationMs,
      user: l.userId ? (people.get(l.userId) ?? { name: 'Unknown', handle: '' }) : null,
      ip: l.ip,
      userAgent: l.userAgent,
      meta: l.meta,
      errorGroupId: l.errorGroupId,
      hasStack: Boolean(l.stack),
    };
  }

  async list(q: LogQuery) {
    const limit = Math.min(q.limit ?? 100, 500);
    const qb = this.logs.createQueryBuilder('l').orderBy('l.created_at', 'DESC').take(limit + 1);
    if (q.kind) qb.andWhere('l.kind = :kind', { kind: q.kind });
    if (q.level) qb.andWhere('l.level IN (:...levels)', { levels: q.level.split(',') });
    if (q.status && /^[1-5]xx$/.test(q.status)) {
      const base = Number(q.status[0]) * 100;
      qb.andWhere('l.status >= :lo AND l.status < :hi', { lo: base, hi: base + 100 });
    }
    if (q.requestId) qb.andWhere('l.request_id = :rid', { rid: q.requestId });
    if (q.user) {
      const u = await this.users.findOne({ where: { handle: q.user.replace(/^@/, '').toLowerCase() }, select: { id: true } });
      qb.andWhere('l.user_id = :uid', { uid: u?.id ?? '00000000-0000-0000-0000-000000000000' });
    }
    if (q.q) {
      const term = `%${q.q.replace(/[%_\\]/g, '')}%`;
      qb.andWhere(new Brackets((w) => w.where('l.message ILIKE :term', { term }).orWhere('l.path ILIKE :term').orWhere('l.context ILIKE :term').orWhere('l.ip = :exact', { exact: q.q })));
    }
    if (q.since) qb.andWhere('l.created_at >= :since', { since: new Date(q.since) });
    if (q.before) qb.andWhere('l.created_at < :before', { before: new Date(q.before) });
    const rows = await qb.getMany();
    const page = rows.slice(0, limit);
    const people = await this.people(page.map((r) => r.userId));
    return { items: page.map((r) => this.view(r, people)), nextBefore: rows.length > limit ? page[page.length - 1].createdAt.toISOString() : null };
  }

  async one(id: string) {
    const l = await this.logs.findOneBy({ id });
    if (!l) throw notFound('log entry');
    const people = await this.people([l.userId]);
    // Everything else recorded during the same request, for a full trace.
    const related = l.requestId ? await this.logs.find({ where: { requestId: l.requestId }, order: { createdAt: 'ASC' }, take: 50 }) : [];
    return { ...this.view(l, people), stack: l.stack, related: related.filter((r) => r.id !== l.id).map((r) => this.view(r, people)) };
  }

  /** The health of the last N hours, for the top of the server log page. */
  async stats(hours = 24) {
    const since = new Date(Date.now() - hours * 3600_000);
    const [totals] = await this.logs.query(
      `SELECT
         COUNT(*) FILTER (WHERE kind = 'request')::int AS requests,
         COUNT(*) FILTER (WHERE kind = 'request' AND status >= 500)::int AS "serverErrors",
         COUNT(*) FILTER (WHERE kind = 'request' AND status >= 400 AND status < 500)::int AS "clientErrors",
         COUNT(*) FILTER (WHERE kind = 'error')::int AS errors,
         COUNT(*) FILTER (WHERE kind = 'security')::int AS security,
         COUNT(*) FILTER (WHERE level = 'warn' AND kind = 'app')::int AS warnings,
         COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE kind = 'request'), 0)::int AS p50,
         COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE kind = 'request'), 0)::int AS p95
       FROM server_logs WHERE created_at >= $1`,
      [since],
    );
    const series: { hour: string; requests: number; errors: number }[] = await this.logs.query(
      `SELECT to_char(date_trunc('hour', created_at), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS hour,
         COUNT(*) FILTER (WHERE kind = 'request')::int AS requests,
         COUNT(*) FILTER (WHERE kind = 'error' OR (kind = 'request' AND status >= 500))::int AS errors
       FROM server_logs WHERE created_at >= $1 GROUP BY 1 ORDER BY 1`,
      [since],
    );
    const slowest: { path: string; p95: number; count: number }[] = await this.logs.query(
      `SELECT method || ' ' || split_part(path, '?', 1) AS path, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95, COUNT(*)::int AS count
       FROM server_logs WHERE kind = 'request' AND created_at >= $1 GROUP BY 1 HAVING COUNT(*) >= 5 ORDER BY 2 DESC LIMIT 5`,
      [since],
    );
    const securityEvents: { event: string; count: number }[] = await this.logs.query(
      `SELECT context AS event, COUNT(*)::int AS count FROM server_logs WHERE kind = 'security' AND created_at >= $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
      [since],
    );
    const openErrors = await this.groups.countBy({ status: 'open' });
    return {
      hours,
      ...totals,
      errorRate: totals.requests ? Math.round((totals.serverErrors / totals.requests) * 10_000) / 100 : 0,
      openErrors,
      series,
      slowest,
      securityEvents,
    };
  }

  // ---------- grouped errors ----------

  async errorGroups(status?: string, q?: string) {
    const qb = this.groups.createQueryBuilder('g').orderBy('g.last_seen', 'DESC').take(300);
    if (status === 'open' || status === 'resolved') qb.andWhere('g.status = :status', { status });
    if (q) qb.andWhere('(g.message ILIKE :t OR g.context ILIKE :t OR g."where" ILIKE :t)', { t: `%${q.replace(/[%_\\]/g, '')}%` });
    const rows = await qb.getMany();
    const affected: { gid: string; users: number; last24: number }[] = rows.length
      ? await this.logs.query(
          `SELECT error_group_id AS gid, COUNT(DISTINCT user_id)::int AS users, COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS last24
           FROM server_logs WHERE error_group_id = ANY($1) GROUP BY 1`,
          [rows.map((r) => r.id)],
        )
      : [];
    const resolvers = await this.people(rows.map((r) => r.resolvedById));
    return rows.map((g) => {
      const a = affected.find((x) => x.gid === g.id);
      return {
        id: g.id,
        message: g.message,
        context: g.context,
        where: g.where,
        count: g.count,
        last24h: a?.last24 ?? 0,
        usersAffected: a?.users ?? 0,
        firstSeen: g.firstSeen.toISOString(),
        lastSeen: g.lastSeen.toISOString(),
        status: g.status,
        resolvedBy: g.resolvedById ? (resolvers.get(g.resolvedById)?.name ?? null) : null,
        resolvedAt: g.resolvedAt?.toISOString() ?? null,
        resolution: g.resolution,
      };
    });
  }

  async errorGroup(id: string) {
    const g = await this.groups.findOneBy({ id });
    if (!g) throw notFound('error');
    const occurrences = await this.logs.find({ where: { errorGroupId: id }, order: { createdAt: 'DESC' }, take: 50 });
    const people = await this.people(occurrences.map((o) => o.userId));
    return {
      ...(await this.errorGroups(undefined, undefined)).find((x) => x.id === id),
      stack: g.sampleStack,
      lastRequestId: g.lastRequestId,
      occurrences: occurrences.map((o) => this.view(o, people)),
    };
  }

  async resolve(adminId: string, id: string, reason: string) {
    const g = await this.groups.findOneBy({ id });
    if (!g) throw notFound('error');
    await this.groups.update({ id }, { status: 'resolved', resolvedById: adminId, resolvedAt: new Date(), resolution: reason });
    await this.audit.log(adminId, 'Resolved error', g.message.slice(0, 180), reason);
  }

  async reopen(adminId: string, id: string) {
    const g = await this.groups.findOneBy({ id });
    if (!g) throw notFound('error');
    await this.groups.update({ id }, { status: 'open', resolvedAt: null, resolution: null });
    await this.audit.log(adminId, 'Reopened error', g.message.slice(0, 180), 'Reopened from the error log');
  }
}
