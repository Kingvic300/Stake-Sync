import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity.js';
import { bigintColumn } from '../../../common/money.js';
import type { OnrampDirection, OnrampState } from '../onramp-mapping.js';

/**
 * One widget link we signed. Its random `partnerContext` comes back in Onramper's webhooks, which is
 * how a transaction is tied to the person and wallet the link was made for.
 */
@Entity('onramp_sessions')
export class OnrampSession extends BaseEntity {
  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 44 })
  walletAddress: string;

  @Column({ type: 'varchar', length: 4 })
  mode: OnrampDirection;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  partnerContext: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  fiatCurrency: string | null;

  @Column({ type: 'numeric', precision: 24, scale: 8, nullable: true })
  requestedAmount: string | null;
}

/** Latest known state of an Onramper transaction. Money history is projected from it. */
@Entity('onramp_transactions')
export class OnrampTransaction extends BaseEntity {
  /** Onramper's id. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  transactionId: string;

  @Column({ type: 'uuid', nullable: true })
  sessionId: string | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 4 })
  direction: OnrampDirection;

  /** The on-ramp that handled it (Onramper's `onramp` field) and its own reference. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  provider: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  providerTransactionId: string | null;

  /** Exactly as received. */
  @Column({ type: 'varchar', length: 24 })
  providerStatus: string;

  @Column({ type: 'varchar', length: 12 })
  state: OnrampState;

  @Column({ type: 'timestamptz' })
  statusDate: Date;

  /** Furthest point reached: 0 new, 1 pending, 2 paid, 3 completed. A failure after 2 means money was taken. */
  @Column({ type: 'smallint', default: 0 })
  progress: number;

  @Column({ type: 'numeric', precision: 20, scale: 0, nullable: true, transformer: bigintColumn })
  usdcAmount: bigint | null;

  @Column({ type: 'numeric', precision: 24, scale: 8, nullable: true })
  fiatAmount: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  fiatCurrency: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  walletAddress: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  transactionHash: string | null;

  /** True only when we read the USDC credit to the person's wallet on-chain ourselves. */
  @Column({ default: false })
  chainVerified: boolean;

  @Column({ type: 'varchar', length: 300, nullable: true })
  statusReason: string | null;

  @Column({ type: 'uuid', nullable: true })
  ledgerEntryId: string | null;

  /** State the person was last notified about; differs from `state` while a notification is owed. */
  @Column({ type: 'varchar', length: 12, nullable: true })
  notifiedState: OnrampState | null;

  /** Set when an event couldn't be applied safely (e.g. a failure after completion). Needs a person to look. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  reviewReason: string | null;
}

export type OnrampEventOutcome = 'applied' | 'duplicate' | 'stale' | 'review' | 'parked' | 'invalid';

/**
 * Inbox of authenticated Onramper payloads, stored before processing so nothing is lost if processing
 * fails. Identical deliveries are stored once. Unprocessed rows are retried; parked rows can be
 * requeued (processed_at = NULL) once the reason is resolved.
 */
@Entity('onramp_events')
export class OnrampEvent extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  transactionId: string | null;

  /**
   * webhook / poll: Onramper (signed push / fetched with our secret).
   * lr_hook / lr_poll: LocalRamp (token-checked push / fetched with our secret key), stored in
   * Onramper's shape so one pipeline handles both.
   */
  @Column({ type: 'varchar', length: 8 })
  source: 'webhook' | 'poll' | 'lr_hook' | 'lr_poll';

  @Index({ unique: true })
  @Column({ type: 'char', length: 64 })
  bodySha256: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  status: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  statusDate: Date | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  outcome: OnrampEventOutcome | null;

  /** Why it was parked, staled or sent to review. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  lastError: string | null;
}
