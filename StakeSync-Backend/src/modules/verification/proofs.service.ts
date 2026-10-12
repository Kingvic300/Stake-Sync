import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import exifr from 'exifr';
import { randomInt } from 'node:crypto';
import sharp from 'sharp';
import { In, MoreThan, Not, Repository } from 'typeorm';
import { openImage } from '../../common/images.js';
import { AppError, forbidden, notFound } from '../../common/errors.js';
import { Events, type ProofSubmittedEvent } from '../../common/events.js';
import { AuditService } from '../../core/audit.service.js';
import { StorageService } from '../../core/storage.service.js';
import { Challenge, Participant } from '../challenges/entities/challenge.entities.js';
import { currentPeriod, periodEnd, periodStart, zonedMidnight } from '../challenges/schedule.js';
import { RiskService } from '../risk/risk.service.js';
import { User } from '../users/entities/user.entities.js';
import { ProofSubmission, type ProofKind } from './entities/verification.entities.js';

const HOUR = 3600_000;
/** Fastest believable pace per exercise, reps per second. */
const MAX_PACE = { pushups: 1.5, situps: 1.6, squats: 1.4 } as const;

/** 64-bit difference hash: robust to resizing and recompression, for duplicate detection. */
async function dhash(img: Buffer) {
  const px = await sharp(img).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return bits.toString(16).padStart(16, '0');
}

const hamming = (a: string, b: string) => {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
};

/**
 * Re-counts reps from the joint-angle trace the app records (elbow for push-ups, hip for sit-ups,
 * knee for squats). A rep is a full down-and-up cycle with hysteresis, the same rule the app uses.
 */
export function countReps(angles: number[], exercise: keyof typeof MAX_PACE) {
  const [down, up] = exercise === 'situps' ? [70, 120] : exercise === 'squats' ? [100, 160] : [90, 150];
  let reps = 0;
  let low = false;
  for (const a of angles) {
    if (!low && a < down) low = true;
    else if (low && a > up) {
      reps++;
      low = false;
    }
  }
  return reps;
}

@Injectable()
export class ProofsService {
  constructor(
    @InjectRepository(ProofSubmission) private readonly proofs: Repository<ProofSubmission>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly storage: StorageService,
    private readonly risk: RiskService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  /** The active participation and the period proof is for: today, or yesterday within the grace window. */
  private async target(userId: string, slug: string, kind: ProofKind) {
    const c = await this.challenges.findOneBy({ slug });
    if (!c) throw notFound('challenge');
    if (!c.providers.includes(kind)) throw new AppError('wrong_proof', 'This challenge doesn’t use that kind of proof.');
    const p = await this.participants.findOneBy({ challengeId: c.id, userId, status: 'active' });
    if (!p) throw notFound('participation');
    const now = new Date();
    let period = currentPeriod(c, now);
    if (period === null && now >= c.endsAt && now.getTime() < c.endsAt.getTime() + 2 * HOUR) period = c.periodCount - 1;
    if (period === null) throw new AppError('not_running', now < c.startsAt ? 'The challenge hasn’t started yet.' : 'The challenge has ended.');
    return { c, p, period };
  }

  async submitPhoto(userId: string, slug: string, file: Buffer, note: string) {
    const { c, p, period } = await this.target(userId, slug, 'photo');
    const flags: string[] = [];
    const exif = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate']).catch(() => null);
    const takenAt: Date | null = exif?.DateTimeOriginal ?? exif?.CreateDate ?? null;
    if (takenAt && takenAt.getTime() < periodStart(c, period).getTime() - HOUR) {
      flags.push(`Photo taken ${takenAt.toUTCString().slice(5, 16)} according to its metadata, before this day`);
    }
    // Strip metadata (location!) before storing.
    const clean = await (await openImage(file)).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const phash = await dhash(clean);
    const recent = await this.proofs.find({ where: { kind: 'photo', createdAt: MoreThan(new Date(Date.now() - 45 * 86_400_000)), phash: Not('') }, select: { id: true, userId: true, phash: true }, take: 5000 });
    for (const r of recent) {
      if (!r.phash || hamming(r.phash, phash) > 6) continue;
      if (r.userId === userId) {
        flags.push('Looks the same as one of your earlier photos');
      } else {
        const other = await this.users.findOneBy({ id: r.userId });
        flags.push(`${Math.round((1 - hamming(r.phash, phash) / 64) * 100)}% match with a photo submitted by @${other?.handle ?? 'another member'}`);
        await this.risk.addSignal(userId, 'duplicate_proof', 'Submitted a photo matching another member’s', 35, `photo:${userId}:${r.id}`, r.userId);
      }
      break;
    }
    const key = await this.storage.put('proofs', clean, 'image/jpeg');
    const saved = await this.proofs.save(
      this.proofs.create({ userId, participantId: p.id, challengeId: c.id, period, kind: 'photo', fileKey: key, note: note.slice(0, 500), phash, takenAt, flags, status: 'pending_review' }),
    );
    this.events.emit(Events.ProofSubmitted, { proofId: saved.id, userId, challengeId: c.id } satisfies ProofSubmittedEvent);
    return this.view(saved);
  }

  async submitCamera(userId: string, slug: string, dto: { reps: number; durationSec: number; angles: number[]; startedAt: string }) {
    const { c, p, period } = await this.target(userId, slug, 'camera');
    const exercise = c.verificationConfig.camera?.exercise ?? 'pushups';
    const flags: string[] = [];
    const recount = countReps(dto.angles, exercise);
    if (Math.abs(recount - dto.reps) > Math.max(2, dto.reps * 0.1)) flags.push(`App counted ${dto.reps} reps; the movement trace shows ${recount}`);
    const pace = dto.reps / Math.max(1, dto.durationSec);
    if (pace > MAX_PACE[exercise]) flags.push(`${dto.reps} reps in ${dto.durationSec} seconds, faster than people can do them`);
    if (dto.angles.length < dto.reps * 4) flags.push('Movement trace too short for the number of reps');
    // A small random sample is checked by a person even when nothing looks wrong.
    const audit = !flags.length && randomInt(100) < 5;
    if (audit) flags.push('Random quality check');
    const saved = await this.proofs.save(
      this.proofs.create({
        userId,
        participantId: p.id,
        challengeId: c.id,
        period,
        kind: 'camera',
        value: Math.min(dto.reps, recount || dto.reps),
        durationSec: dto.durationSec,
        payload: { exercise, startedAt: dto.startedAt, samples: dto.angles.length, recount },
        flags,
        status: flags.length ? 'pending_review' : 'auto_approved',
      }),
    );
    if (flags.length && !audit) await this.risk.addSignal(userId, 'implausible_activity', flags[0], 10, `camera:${saved.id}`);
    this.events.emit(Events.ProofSubmitted, { proofId: saved.id, userId, challengeId: c.id } satisfies ProofSubmittedEvent);
    return this.view(saved);
  }

  /**
   * Daily totals from Apple Health / Health Connect, sent by the mobile app. Applies to every
   * health challenge the person is in for that date.
   */
  async syncHealth(userId: string, dto: { date: string; steps?: number; distanceM?: number; source: string; samples?: { start: string; end: string; steps: number }[] }) {
    const flags: string[] = [];
    if ((dto.steps ?? 0) > 70_000) flags.push(`${dto.steps} steps in a day is unusually high`);
    if ((dto.distanceM ?? 0) > 100_000) flags.push(`${Math.round((dto.distanceM ?? 0) / 1000)} km in a day is unusually high`);
    for (const s of dto.samples ?? []) {
      const mins = (new Date(s.end).getTime() - new Date(s.start).getTime()) / 60_000;
      if (mins > 0 && s.steps / mins > 260) {
        flags.push('Step rate faster than running pace for a sustained period');
        break;
      }
    }
    const parts = await this.participants.find({ where: { userId, status: 'active' }, relations: { challenge: true } });
    const updated: string[] = [];
    for (const p of parts) {
      const c = p.challenge!;
      if (!c.providers.includes('health')) continue;
      const dayStart = zonedMidnight(dto.date, c.timezone);
      const period = Math.round((dayStart.getTime() - c.startsAt.getTime()) / (c.periodSecs * 1000));
      if (period < 0 || period >= c.periodCount) continue;
      if (Date.now() > periodEnd(c, period).getTime() + 48 * HOUR) continue; // too late to change
      const metric = c.verificationConfig.health?.metric ?? 'steps';
      const value = metric === 'steps' ? (dto.steps ?? 0) : Math.round(dto.distanceM ?? 0);
      const existing = await this.proofs.findOneBy({ participantId: p.id, period, kind: 'health' });
      const row = existing ?? this.proofs.create({ userId, participantId: p.id, challengeId: c.id, period, kind: 'health' });
      Object.assign(row, {
        value: Math.max(existing?.value ?? 0, value),
        payload: { source: dto.source, date: dto.date, steps: dto.steps, distanceM: dto.distanceM },
        flags,
        status: flags.length ? 'pending_review' : 'auto_approved',
      });
      await this.proofs.save(row);
      updated.push(c.slug);
    }
    if (flags.length) await this.risk.addSignal(userId, 'implausible_activity', flags[0], 10, `health:${userId}:${dto.date}`);
    return { applied: updated, flagged: flags.length > 0 };
  }

  async mine(userId: string, slug: string) {
    const c = await this.challenges.findOneBy({ slug });
    if (!c) throw notFound('challenge');
    const rows = await this.proofs.find({ where: { userId, challengeId: c.id }, order: { createdAt: 'DESC' }, take: 100 });
    return rows.map((r) => this.view(r));
  }

  /** Proof images are private: only the person and reviewers can see them. */
  async file(id: string, viewer: { id: string; admin: boolean }) {
    const p = await this.proofs.findOneBy({ id });
    if (!p?.fileKey) throw notFound('file');
    if (p.userId !== viewer.id && !viewer.admin) throw forbidden();
    return this.storage.get(p.fileKey);
  }

  // ---------- review (admin) ----------

  async queue() {
    const rows = await this.proofs.find({ where: { status: 'pending_review' }, order: { createdAt: 'ASC' }, take: 200 });
    const users = rows.length ? await this.users.findBy({ id: In([...new Set(rows.map((r) => r.userId))]) }) : [];
    const challenges = rows.length ? await this.challenges.findBy({ id: In([...new Set(rows.map((r) => r.challengeId))]) }) : [];
    return rows.map((r) => {
      const u = users.find((x) => x.id === r.userId)!;
      return {
        ...this.view(r),
        user: { name: u.name, handle: u.handle, hue: u.hue, avatarUrl: u.avatarUrl },
        challenge: challenges.find((c) => c.id === r.challengeId)?.title ?? '',
      };
    });
  }

  async review(adminId: string, id: string, approve: boolean, reason: string) {
    const p = await this.proofs.findOneBy({ id });
    if (!p) throw notFound('proof');
    if (p.status !== 'pending_review') throw new AppError('already_reviewed', 'Someone already reviewed this.', HttpStatus.CONFLICT);
    await this.proofs.update({ id }, { status: approve ? 'approved' : 'rejected', reviewedById: adminId, reviewedAt: new Date(), reviewReason: reason });
    await this.audit.log(adminId, approve ? 'Approved proof' : 'Rejected proof', `Proof ${id}`, reason);
    this.events.emit('verification.proof_reviewed', { proofId: id, userId: p.userId, challengeId: p.challengeId, approved: approve, reason });
    return { status: approve ? 'approved' : 'rejected' };
  }

  view(r: ProofSubmission) {
    return {
      id: r.id,
      kind: r.kind,
      day: r.period + 1,
      submitted: r.createdAt.toISOString(),
      note: r.note || undefined,
      value: r.value,
      reps: r.kind === 'camera' ? r.value : undefined,
      flags: r.flags,
      status: r.status,
      reviewReason: r.reviewReason,
      hasFile: Boolean(r.fileKey),
    };
  }
}
