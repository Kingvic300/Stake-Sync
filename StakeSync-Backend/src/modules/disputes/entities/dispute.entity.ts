import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity.js';
import { bigintColumn } from '../../../common/money.js';
import type { ProviderKey } from '../../challenges/entities/challenge.entities.js';

export type DisputeStatus = 'new' | 'in_review' | 'waiting_on_user' | 'approved' | 'failure_confirmed';

export interface Evidence {
  kind: 'image' | 'link' | 'text';
  value: string;
  note?: string;
  at: string;
}

export interface TimelineEntry {
  at: string;
  source: 'user' | 'moderator' | 'system' | 'provider';
  text: string;
}

@Entity('disputes')
@Unique(['participantId', 'period'])
export class Dispute extends BaseEntity {
  @Index()
  @Column('uuid')
  participantId: string;

  @Index()
  @Column('uuid')
  challengeId: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column('uuid')
  verificationId: string;

  @Column({ type: 'int' })
  period: number;

  @Column({ type: 'varchar', length: 12 })
  provider: ProviderKey;

  @Column({ type: 'varchar', length: 1000 })
  reason: string;

  @Column({ type: 'jsonb', default: [] })
  evidence: Evidence[];

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'new' })
  status: DisputeStatus;

  @Column({ type: 'varchar', length: 8, default: 'Normal' })
  priority: 'High' | 'Normal';

  /** Review target: before settlement opens, and within 48 hours. */
  @Column({ type: 'timestamptz' })
  dueAt: Date;

  /** The share of the stake this result could cost, held until resolved. */
  @Column({ type: 'numeric', precision: 20, scale: 0, transformer: bigintColumn, default: 0 })
  lockedAmount: bigint;

  @Column({ type: 'jsonb', default: [] })
  timeline: TimelineEntry[];

  @Column({ type: 'uuid', nullable: true })
  assigneeId: string | null;

  @Column({ type: 'uuid', nullable: true })
  decidedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  decisionReason: string | null;

  @Column({ type: 'varchar', length: 10, default: 'none' })
  chainOpenStatus: 'none' | 'sent' | 'confirmed' | 'failed';

  @Column({ type: 'varchar', length: 100, nullable: true })
  chainOpenSig: string | null;

  @Column({ type: 'varchar', length: 10, default: 'none' })
  chainResolveStatus: 'none' | 'queued' | 'sent' | 'confirmed' | 'failed';

  @Column({ type: 'varchar', length: 100, nullable: true })
  chainResolveSig: string | null;
}
