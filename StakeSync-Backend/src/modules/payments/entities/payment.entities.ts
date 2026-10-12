import { Column, Entity, Index, PrimaryColumn, Unique, UpdateDateColumn } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity.js';
import { bigintColumn } from '../../../common/money.js';

export type LedgerKind =
  | 'stake_deposited'
  | 'stake_returned'
  | 'reward_claimed'
  | 'refund'
  | 'sponsored'
  | 'sponsorship_reclaimed'
  | 'penalty'
  | 'join_fee'
  | 'sent'
  | 'added'
  | 'cashed_out';

/** Money history shown in the wallet (PRD §16). Amount is signed: negative leaves the person's wallet. */
@Entity('ledger_entries')
export class LedgerEntry extends BaseEntity {
  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  challengeId: string | null;

  @Column({ type: 'varchar', length: 24 })
  kind: LedgerKind;

  @Column({ type: 'numeric', precision: 20, scale: 0, transformer: bigintColumn })
  amount: bigint;

  @Column({ type: 'varchar', length: 100, nullable: true })
  signature: string | null;

  @Column({ type: 'varchar', length: 10, default: 'confirmed' })
  status: 'pending' | 'confirmed' | 'failed';

  /** Idempotency: one entry per on-chain event or provider reference. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 160 })
  ref: string;

  /** Local-currency side of an Onramper top-up or cash-out, for display. */
  @Column({ type: 'numeric', precision: 24, scale: 8, nullable: true })
  fiatAmount: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  fiatCurrency: string | null;

  /** Plain-language status, e.g. why a purchase failed and what to do next. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  detail: string | null;

  /** The provider's reference (Onramper transaction id), for support. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  externalRef: string | null;
}

@Entity('sponsor_contributions')
export class SponsorContribution extends BaseEntity {
  @Index()
  @Column('uuid')
  challengeId: string;

  @Index()
  @Column('uuid')
  sponsorUserId: string;

  @Column({ type: 'uuid', nullable: true })
  orgId: string | null;

  @Column({ type: 'varchar', length: 44 })
  wallet: string;

  @Column({ type: 'numeric', precision: 20, scale: 0, transformer: bigintColumn })
  amount: bigint;

  @Column({ type: 'varchar', length: 100, nullable: true })
  signature: string | null;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: 'pending' | 'confirmed' | 'failed';

  @Column({ default: false })
  reclaimed: boolean;
}

/** Decoded program events, idempotent by (signature, index). */
@Entity('chain_events')
@Unique(['signature', 'idx'])
export class ChainEvent extends BaseEntity {
  @Column({ type: 'varchar', length: 100 })
  signature: string;

  @Column({ type: 'int' })
  idx: number;

  @Column({ type: 'bigint' })
  slot: string;

  @Index()
  @Column({ type: 'varchar', length: 32 })
  name: string;

  @Column({ type: 'jsonb' })
  data: Record<string, unknown>;

  @Column({ default: false })
  processed: boolean;
}

/** Small key/value store: indexer cursor, platform settings (penalty structures, banner, fee). */
@Entity('settings')
export class Setting {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'jsonb' })
  value: unknown;

  @Column({ type: 'uuid', nullable: true })
  updatedById: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
