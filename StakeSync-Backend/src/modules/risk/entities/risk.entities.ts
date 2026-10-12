import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity.js';
import { bigintColumn } from '../../../common/money.js';

export type SignalKind =
  | 'shared_funding'
  | 'shared_device'
  | 'shared_ip'
  | 'burst_signup'
  | 'duplicate_proof'
  | 'new_external_account'
  | 'linked_account_attempt'
  | 'implausible_activity'
  | 'rapid_join_claim'
  | 'reported';

/** One observation about an account. Deduplicated by `ref`. */
@Entity('risk_signals')
export class RiskSignal extends BaseEntity {
  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 24 })
  kind: SignalKind;

  @Column({ type: 'varchar', length: 300 })
  detail: string;

  /** 0–100 contribution to the risk score. */
  @Column({ type: 'int' })
  weight: number;

  @Column({ type: 'uuid', nullable: true })
  linkedUserId: string | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 200 })
  ref: string;
}

export type RiskStatus = 'open' | 'watching' | 'restricted' | 'cleared';

/** A case for the risk team, raised when an account's score crosses the threshold. */
@Entity('risk_flags')
export class RiskFlag extends BaseEntity {
  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'int' })
  score: number;

  @Index()
  @Column({ type: 'varchar', length: 10, default: 'open' })
  status: RiskStatus;

  @Column({ type: 'text', array: true, default: '{}' })
  signals: string[];

  @Column({ type: 'uuid', array: true, default: '{}' })
  linkedUserIds: string[];

  /** USDC the account currently has at stake. */
  @Column({ type: 'numeric', precision: 20, scale: 0, transformer: bigintColumn, default: 0 })
  value: bigint;

  @Column({ type: 'uuid', nullable: true })
  decidedById: string | null;

  @Column({ type: 'varchar', nullable: true })
  decisionReason: string | null;
}
