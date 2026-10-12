import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity.js';
import type { ProviderKey } from '../../challenges/entities/challenge.entities.js';

/** "30 Days of Code — Completed, GitHub verified, October 2026" (PRD §23). */
@Entity('achievements')
@Unique(['userId', 'challengeId'])
export class Achievement extends BaseEntity {
  @Index()
  @Column('uuid')
  userId: string;

  @Column('uuid')
  challengeId: string;

  @Column({ type: 'varchar', length: 90 })
  title: string;

  @Column({ type: 'varchar', length: 12 })
  provider: ProviderKey;

  @Column({ type: 'varchar', length: 200 })
  detail: string;

  @Column({ type: 'timestamptz' })
  earnedAt: Date;
}

/** Every score change with its reasons, so the score is explainable and auditable. */
@Entity('reputation_records')
@Unique(['userId', 'challengeId'])
export class ReputationRecord extends BaseEntity {
  @Index()
  @Column('uuid')
  userId: string;

  @Column('uuid')
  challengeId: string;

  @Column({ type: 'int' })
  delta: number;

  @Column({ type: 'varchar', length: 200 })
  reason: string;

  @Column({ type: 'jsonb' })
  factors: Record<string, number>;
}
