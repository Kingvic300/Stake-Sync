import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity.js';
import type { ProviderKey } from '../../challenges/entities/challenge.entities.js';

/**
 * PRD §10 proof states. `excused` is final "couldn't verify, not your fault" (on-chain Excused);
 * `unavailable` is temporary and retried.
 */
export type ProofState = 'pending' | 'verified' | 'failed' | 'unavailable' | 'disputed' | 'excused';
export type ChainOutcome = 'verified' | 'missed' | 'excused';
export type ChainStatus = 'none' | 'queued' | 'sent' | 'confirmed' | 'failed';

/** One period's result for one participant. Also the PRD's ProgressRecord/Strike source. */
@Entity('verifications')
@Unique(['participantId', 'period'])
export class Verification extends BaseEntity {
  @Index()
  @Column('uuid')
  participantId: string;

  @Index()
  @Column('uuid')
  challengeId: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'int' })
  period: number;

  @Index()
  @Column({ type: 'varchar', length: 12, default: 'pending' })
  state: ProofState;

  @Column({ type: 'varchar', length: 12 })
  provider: ProviderKey;

  /** Plain-language detail shown in the day's history, e.g. "3 commits to ladipo/escrow-cli". */
  @Column({ type: 'varchar', length: 300, default: '' })
  detail: string;

  /** Raw facts the decision was based on, for moderators (PRD §21). */
  @Column({ type: 'jsonb', default: {} })
  evidence: Record<string, unknown>;

  /** Count-mode: units this period contributed. */
  @Column({ type: 'int', default: 0 })
  units: number;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  firstUnavailableAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  chainOutcome: ChainOutcome | null;

  @Index()
  @Column({ type: 'varchar', length: 10, default: 'none' })
  chainStatus: ChainStatus;

  @Column({ type: 'varchar', length: 100, nullable: true })
  chainSig: string | null;

  @Column({ type: 'varchar', nullable: true })
  chainError: string | null;
}

export type ProofKind = 'photo' | 'camera' | 'health';
export type ReviewStatus = 'pending_review' | 'approved' | 'rejected' | 'auto_approved';

/** Proof the app uploads: photos, camera-counted sets, phone health summaries. */
@Entity('proof_submissions')
export class ProofSubmission extends BaseEntity {
  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column('uuid')
  participantId: string;

  @Index()
  @Column('uuid')
  challengeId: string;

  @Column({ type: 'int' })
  period: number;

  @Column({ type: 'varchar', length: 8 })
  kind: ProofKind;

  @Column({ type: 'varchar', nullable: true })
  fileKey: string | null;

  @Column({ type: 'varchar', length: 500, default: '' })
  note: string;

  /** Camera reps, steps, or metres. */
  @Column({ type: 'int', nullable: true })
  value: number | null;

  @Column({ type: 'int', nullable: true })
  durationSec: number | null;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  /** 64-bit perceptual hash (hex) for duplicate photo detection. */
  @Index()
  @Column({ type: 'varchar', length: 16, nullable: true })
  phash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  takenAt: Date | null;

  @Column({ type: 'text', array: true, default: '{}' })
  flags: string[];

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'pending_review' })
  status: ReviewStatus;

  @Column({ type: 'uuid', nullable: true })
  reviewedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  reviewReason: string | null;
}

/** Declared or detected provider problems. Checks inside the window are protected (PRD §32). */
@Entity('provider_incidents')
export class ProviderIncident extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 12 })
  provider: ProviderKey;

  @Column({ type: 'varchar', length: 10 })
  status: 'degraded' | 'outage';

  @Column({ type: 'timestamptz' })
  startsAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  /** null means the system detected it. */
  @Column({ type: 'uuid', nullable: true })
  declaredById: string | null;

  @Column({ type: 'int', default: 0 })
  protectedCount: number;
}
