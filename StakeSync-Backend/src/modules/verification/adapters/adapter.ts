import type { Challenge, Participant, ProviderKey } from '../../challenges/entities/challenge.entities.js';
import type { ProofSubmission } from '../entities/verification.entities.js';

export interface AdapterContext {
  challenge: Challenge;
  participant: Participant;
  /** Window being checked: one period (days mode) or start → now (count mode). */
  from: Date;
  to: Date;
  /** Decrypted access token for OAuth providers. */
  token?: string;
  /** Username/handle on the provider. */
  account?: string;
  /** The person's linked external wallet (Solana activity). */
  wallet?: string;
  /** Uploaded proof in the window (photo, camera, health). */
  proofs: ProofSubmission[];
  now: Date;
}

/**
 * verified / failed are final answers from the provider. `waiting` means the answer isn't in yet
 * (a photo in review, a phone that hasn't synced) and costs nothing. Outages are thrown as
 * ProviderUnavailable and handled by the engine.
 */
export interface DayResult {
  outcome: 'verified' | 'failed' | 'waiting';
  detail: string;
  evidence?: Record<string, unknown>;
  /** Identifiers of the work used as proof (commit SHAs, tx signatures, photo hashes) to catch reuse across accounts. */
  fingerprints?: string[];
  units?: number;
  /** Merged into the participant's baseline once this result is saved. */
  baselinePatch?: Record<string, unknown>;
}

export interface CountResult {
  total: number;
  detail: string;
  evidence?: Record<string, unknown>;
  fingerprints?: string[];
}

/** PRD §9: adapters turn external activity into standard proof. */
export interface VerificationAdapter {
  readonly key: ProviderKey;
  day(ctx: AdapterContext): Promise<DayResult>;
  count(ctx: AdapterContext): Promise<CountResult>;
  /** Snapshot at the start, so only new work counts (e.g. previously unsolved problems). */
  baseline?(ctx: AdapterContext): Promise<Record<string, unknown>>;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
