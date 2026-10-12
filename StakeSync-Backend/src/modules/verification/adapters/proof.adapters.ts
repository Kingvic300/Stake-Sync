import { Injectable } from '@nestjs/common';
import type { ProofSubmission } from '../entities/verification.entities.js';
import { plural, type AdapterContext, type CountResult, type DayResult, type VerificationAdapter } from './adapter.js';

const accepted = (p: ProofSubmission) => p.status === 'approved' || p.status === 'auto_approved';
const HOUR = 3600_000;

/** Photo proof: counts once a reviewer approves it. A photo still in review keeps the day open. */
@Injectable()
export class PhotoAdapter implements VerificationAdapter {
  readonly key = 'photo' as const;

  async day(ctx: AdapterContext): Promise<DayResult> {
    const ok = ctx.proofs.filter(accepted);
    if (ok.length) return { outcome: 'verified', detail: ok[0].note ? `Photo approved: “${ok[0].note.slice(0, 80)}”` : 'Photo approved', fingerprints: ok.map((p) => `photo:${p.phash}`) };
    if (ctx.proofs.some((p) => p.status === 'pending_review')) return { outcome: 'waiting', detail: 'Photo waiting for review' };
    // Uploads in flight at midnight get a short grace period.
    if (ctx.now.getTime() < ctx.to.getTime() + 2 * HOUR) return { outcome: 'waiting', detail: 'Waiting for your photo' };
    const rejected = ctx.proofs.find((p) => p.status === 'rejected');
    return { outcome: 'failed', detail: rejected ? `Photo not approved: ${rejected.reviewReason ?? 'it didn’t show the required progress'}` : 'No photo submitted' };
  }

  async count(ctx: AdapterContext): Promise<CountResult> {
    const n = ctx.proofs.filter(accepted).length;
    return { total: n, detail: plural(n, 'approved photo') };
  }
}

/** Reps counted on the phone camera, re-scored on the server from the movement trace. */
@Injectable()
export class CameraAdapter implements VerificationAdapter {
  readonly key = 'camera' as const;

  async day(ctx: AdapterContext): Promise<DayResult> {
    const goal = ctx.challenge.verificationConfig.camera?.reps ?? 100;
    const ok = ctx.proofs.filter(accepted);
    const reps = ok.reduce((s, p) => s + (p.value ?? 0), 0);
    if (reps >= goal) return { outcome: 'verified', detail: `${reps} reps in ${plural(ok.length, 'set')}`, units: reps, evidence: { sets: ok.map((p) => p.id) } };
    if (ctx.proofs.some((p) => p.status === 'pending_review')) return { outcome: 'waiting', detail: 'A set is being checked' };
    if (ctx.now.getTime() < ctx.to.getTime() + HOUR) return { outcome: 'waiting', detail: `${reps} of ${goal} reps so far` };
    return { outcome: 'failed', detail: `${reps} of ${goal} reps`, units: reps };
  }

  async count(ctx: AdapterContext): Promise<CountResult> {
    const reps = ctx.proofs.filter(accepted).reduce((s, p) => s + (p.value ?? 0), 0);
    return { total: reps, detail: `${reps} reps` };
  }
}

/** Steps or distance from Apple Health / Health Connect, synced by the mobile app. */
@Injectable()
export class HealthAdapter implements VerificationAdapter {
  readonly key = 'health' as const;

  async day(ctx: AdapterContext): Promise<DayResult> {
    const cfg = ctx.challenge.verificationConfig.health ?? { metric: 'steps' as const, threshold: 10_000 };
    const ok = ctx.proofs.filter(accepted);
    const value = Math.max(0, ...ok.map((p) => p.value ?? 0));
    const fmt = (v: number) => (cfg.metric === 'steps' ? `${v.toLocaleString('en')} steps` : `${(v / 1000).toFixed(1)} km`);
    if (value >= cfg.threshold) return { outcome: 'verified', detail: fmt(value), units: value };
    if (ctx.proofs.some((p) => p.status === 'pending_review')) return { outcome: 'waiting', detail: 'Your data is being checked' };
    // Phones sync in the background, sometimes the next morning.
    if (ctx.now.getTime() < ctx.to.getTime() + 24 * HOUR) return { outcome: 'waiting', detail: ok.length ? `${fmt(value)} so far` : 'Waiting for your phone to sync' };
    return {
      outcome: 'failed',
      detail: ok.length ? `${fmt(value)} of ${fmt(cfg.threshold)}` : 'No data arrived from your phone for this day. If it didn’t sync, dispute this day.',
      units: value,
    };
  }

  async count(ctx: AdapterContext): Promise<CountResult> {
    const cfg = ctx.challenge.verificationConfig.health ?? { metric: 'distance' as const, threshold: 1000 };
    // One accepted value per day: the highest sync for that day.
    const perDay = new Map<number, number>();
    for (const p of ctx.proofs.filter(accepted)) perDay.set(p.period, Math.max(perDay.get(p.period) ?? 0, p.value ?? 0));
    const sum = [...perDay.values()].reduce((s, v) => s + v, 0);
    const total = cfg.metric === 'steps' ? sum : Math.floor(sum / 1000);
    return { total, detail: cfg.metric === 'steps' ? `${sum.toLocaleString('en')} steps` : `${(sum / 1000).toFixed(1)} km` };
  }
}
