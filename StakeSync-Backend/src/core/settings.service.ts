import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../modules/payments/entities/payment.entities.js';

export interface PenaltyStructure {
  key: string;
  name: string;
  freeStrikes: number;
  /** Percent of stake added per miss after free strikes; last step repeats. */
  penalties: [number, number, number];
  note: string;
}

/** Approved penalty structures (PRD §8, §19). Creators pick one; they can't write their own. */
export const DEFAULT_STRUCTURES: PenaltyStructure[] = [
  { key: 'gentle', name: 'Gentle', freeStrikes: 3, penalties: [5, 10, 15], note: 'Best for first-timers and long challenges' },
  { key: 'standard', name: 'Standard', freeStrikes: 2, penalties: [10, 15, 20], note: 'A balance of forgiveness and pressure' },
  { key: 'strict', name: 'Strict', freeStrikes: 1, penalties: [15, 25, 35], note: 'For short, high-commitment sprints' },
];

export interface PlatformFees {
  /** Platform's share of forfeited stakes and penalties; finishers split the rest. */
  forfeitBps: number;
  /** On top of each stake when joining. */
  joinBps: number;
}

const DEFAULTS: Record<string, unknown> = {
  penalty_structures: DEFAULT_STRUCTURES,
  /** Platform fees in bps (100 = 1%). Must match the on-chain Config; fixed per challenge at creation. */
  fees: { forfeitBps: 6000, joinBps: 200 },
  banner: null,
  limits: { maxStakeUsd: 500, maxSponsorUsd: 100_000, maxParticipants: 10_000, maxDurationDays: 128 },
};

@Injectable()
export class SettingsService {
  private cache = new Map<string, { value: unknown; at: number }>();

  constructor(@InjectRepository(Setting) private readonly repo: Repository<Setting>) {}

  async get<T>(key: string): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 30_000) return hit.value as T;
    const row = await this.repo.findOneBy({ key });
    const value = row ? row.value : DEFAULTS[key];
    this.cache.set(key, { value, at: Date.now() });
    return value as T;
  }

  async set(key: string, value: unknown, byId: string | null = null) {
    await this.repo.save({ key, value, updatedById: byId });
    this.cache.set(key, { value, at: Date.now() });
  }

  fees() {
    return this.get<PlatformFees>('fees');
  }

  structures() {
    return this.get<PenaltyStructure[]>('penalty_structures');
  }

  limits() {
    return this.get<{ maxStakeUsd: number; maxSponsorUsd: number; maxParticipants: number; maxDurationDays: number }>('limits');
  }
}
