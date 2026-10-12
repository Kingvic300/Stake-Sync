import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { AuditService } from '../../core/audit.service.js';
import { PROVIDERS, type ProviderKey } from '../challenges/entities/challenge.entities.js';
import { ProviderIncident, Verification } from './entities/verification.entities.js';

interface Call {
  at: number;
  ok: boolean;
  ms: number;
}

const WINDOW = 15 * 60_000;

/**
 * Tracks each provider's success rate and latency, and opens a "degraded" incident on its own when
 * a provider starts failing (PRD §32 outage detection). Admins can declare full outages.
 */
@Injectable()
export class ProviderHealthService {
  private readonly log = new Logger('ProviderHealth');
  private readonly calls = new Map<ProviderKey, Call[]>();

  constructor(
    @InjectRepository(ProviderIncident) private readonly incidents: Repository<ProviderIncident>,
    @InjectRepository(Verification) private readonly verifications: Repository<Verification>,
    private readonly audit: AuditService,
  ) {}

  record(provider: ProviderKey, ok: boolean, ms: number) {
    const list = this.calls.get(provider) ?? [];
    list.push({ at: Date.now(), ok, ms });
    const cutoff = Date.now() - 60 * 60_000;
    while (list.length && list[0].at < cutoff) list.shift();
    this.calls.set(provider, list);
  }

  private recent(provider: ProviderKey, ms = WINDOW) {
    return (this.calls.get(provider) ?? []).filter((c) => c.at >= Date.now() - ms);
  }

  async stats() {
    const open = await this.incidents.findBy({ endsAt: IsNull() });
    return Promise.all(
      PROVIDERS.map(async (p) => {
        const hour = this.recent(p, 60 * 60_000);
        const ok = hour.filter((c) => c.ok);
        const incident = open.find((i) => i.provider === p);
        const retrying = await this.verifications.countBy({ provider: p, state: 'unavailable' });
        return {
          provider: p,
          status: incident?.status ?? 'operational',
          success: hour.length ? Math.round((ok.length / hour.length) * 1000) / 10 : 100,
          latency: ok.length ? Math.round(ok.reduce((s, c) => s + c.ms, 0) / ok.length) : 0,
          calls: hour.length,
          retrying,
          incident: incident ? { id: incident.id, since: incident.startsAt.toISOString(), reason: incident.reason } : null,
        };
      }),
    );
  }

  /** Was any outage declared or detected for this provider during [from, to)? */
  async overlapsOutage(provider: ProviderKey, from: Date, to: Date) {
    return this.incidents
      .createQueryBuilder('i')
      .where('i.provider = :provider AND i.starts_at < :to AND (i.ends_at IS NULL OR i.ends_at > :from)', { provider, from, to })
      .getExists();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async detect() {
    for (const p of PROVIDERS) {
      const calls = this.recent(p);
      const open = await this.incidents.findOneBy({ provider: p, endsAt: IsNull(), declaredById: IsNull() });
      if (calls.length < 10) continue;
      const failRate = calls.filter((c) => !c.ok).length / calls.length;
      if (!open && failRate >= 0.5) {
        await this.incidents.save(this.incidents.create({ provider: p, status: 'degraded', startsAt: new Date(Date.now() - WINDOW), reason: `${Math.round(failRate * 100)}% of checks failing` }));
        await this.audit.log(null, 'Marked provider degraded', p, `${Math.round(failRate * 100)}% of checks failed in 15 minutes`);
        this.log.warn(`${p} degraded`);
      } else if (open && failRate < 0.1) {
        await this.incidents.update({ id: open.id }, { endsAt: new Date() });
        await this.audit.log(null, 'Marked provider recovered', p, 'Checks succeeding again');
      }
    }
  }

  /**
   * Admin-declared outage (PRD §32). Misses in the window that haven't reached the chain yet become
   * excused; future checks in the window can't become misses either.
   */
  async declare(adminId: string, provider: ProviderKey, from: Date, to: Date | null, reason: string) {
    const until = to ?? new Date('9999-01-01');
    const rows: { id: string }[] = await this.verifications.query(
      `UPDATE verifications v SET state = 'excused', chain_outcome = CASE WHEN v.chain_status = 'queued' THEN 'excused' ELSE v.chain_outcome END,
         detail = $4, updated_at = now()
       FROM challenges c
       WHERE c.id = v.challenge_id AND v.provider = $1
         AND v.state IN ('failed', 'unavailable', 'pending') AND v.chain_status IN ('none', 'queued')
         AND c.starts_at + (v.period * c.period_secs) * interval '1 second' < $3
         AND c.starts_at + ((v.period + 1) * c.period_secs) * interval '1 second' > $2
       RETURNING v.id`,
      [provider, from, until, `${provider} outage; this day is protected`],
    );
    const ids = Array.isArray(rows[0]) ? (rows[0] as { id: string }[]) : rows;
    const incident = await this.incidents.save(this.incidents.create({ provider, status: 'outage', startsAt: from, endsAt: to, reason, declaredById: adminId, protectedCount: ids.length }));
    await this.audit.log(adminId, 'Declared outage', `${provider}, ${from.toISOString()} to ${to?.toISOString() ?? 'ongoing'}`, `${reason}. ${ids.length} checks protected from penalties`, { incidentId: incident.id });
    return { incident, protectedIds: ids.map((r) => r.id) };
  }

  async resolve(adminId: string, id: string, reason: string) {
    await this.incidents.update({ id, endsAt: IsNull() }, { endsAt: new Date() });
    await this.audit.log(adminId, 'Ended outage', id, reason);
  }

  list() {
    return this.incidents.find({ where: { startsAt: LessThanOrEqual(new Date()) }, order: { startsAt: 'DESC' }, take: 50 });
  }
}
