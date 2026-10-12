import { Column, Entity, Index, JoinColumn, ManyToOne, type Relation, Unique } from 'typeorm';
import type { AdminRole } from '../../../common/auth.js';
import { BaseEntity } from '../../../common/base.entity.js';

export type UserStatus = 'active' | 'restricted' | 'suspended' | 'closed';
export type ProfileVisibility = 'public' | 'members' | 'private';

export interface PrivacySettings {
  profile: ProfileVisibility;
  showOnLeaderboards: boolean;
  showConnectedAccounts: boolean;
}

export interface NotificationPrefs {
  email: boolean;
  push: boolean;
  /** Per-kind opt-out. Missing means on. */
  muted: string[];
}

@Entity('users')
export class User extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 320, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', nullable: true })
  passwordHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 40 })
  handle: string;

  /** Avatar colour when there's no picture. */
  @Column({ type: 'int', default: 225 })
  hue: number;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'varchar', length: 280, default: '' })
  bio: string;

  @Column({ type: 'varchar', length: 64, default: 'Africa/Lagos' })
  timezone: string;

  @Column({ type: 'text', array: true, default: '{}' })
  interests: string[];

  /** Onboarding answer: knows how to fund a Solana wallet, or pays in local currency. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  fundingPreference: 'wallet' | 'local' | null;

  @Column({ type: 'timestamptz', nullable: true })
  onboardedAt: Date | null;

  /** When the person ticked "I agree to the Terms of Service and Privacy Policy", and which version. */
  @Column({ type: 'timestamptz', nullable: true })
  termsAcceptedAt: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  termsVersion: string | null;

  @Column({ type: 'jsonb', default: { profile: 'public', showOnLeaderboards: true, showConnectedAccounts: true } })
  privacy: PrivacySettings;

  @Column({ type: 'jsonb', default: { email: true, push: true, muted: [] } })
  notificationPrefs: NotificationPrefs;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: UserStatus;

  @Column({ type: 'varchar', nullable: true })
  statusReason: string | null;

  /** Cached commitment score (PRD §22); recomputed from reputation records. */
  @Column({ type: 'int', default: 0 })
  score: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  adminRole: AdminRole | null;

  /** Encrypted TOTP secret for admin sign-in. */
  @Column({ type: 'varchar', nullable: true })
  totpSecret: string | null;

  @Column({ default: false })
  totpEnabled: boolean;

  /** Last accepted TOTP time step, so a code can't be used twice. */
  @Column({ type: 'int', nullable: true })
  totpLastStep: number | null;

  /** Failed sign-ins in a row; the account locks for a while after too many. */
  @Column({ type: 'int', default: 0 })
  failedLogins: number;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  /** Hashed, for Sybil signals only. Never shown. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  signupIpHash: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  deviceHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastActiveAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  /** Last "download my data" export; at most one an hour, enforced in the database. */
  @Column({ type: 'timestamptz', nullable: true })
  dataExportedAt: Date | null;
}

/**
 * Verification-provider and sign-in accounts. One external account can only ever belong to one
 * Stake-Sync identity (PRD §11).
 */
export type ConnectionProvider = 'github' | 'google' | 'leetcode' | 'codeforces' | 'wakatime';

@Entity('connected_accounts')
@Unique(['provider', 'externalId'])
@Unique(['userId', 'provider'])
export class ConnectedAccount extends BaseEntity {
  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: Relation<User>;

  @Column({ type: 'varchar', length: 24 })
  provider: ConnectionProvider;

  @Column({ type: 'varchar' })
  externalId: string;

  @Column({ type: 'varchar' })
  username: string;

  @Column({ type: 'text', nullable: true })
  accessToken: string | null;

  @Column({ type: 'text', nullable: true })
  refreshToken: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  tokenExpiresAt: Date | null;

  @Column({ type: 'varchar', default: '' })
  scopes: string;

  /** Provider-side account creation date, a Sybil signal (brand-new GitHub accounts). */
  @Column({ type: 'timestamptz', nullable: true })
  externalCreatedAt: Date | null;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'needs_reconnect';
}

@Entity('wallets')
export class Wallet extends BaseEntity {
  @Index()
  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: Relation<User>;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 44 })
  address: string;

  /**
   * external: a wallet app the person already uses (Phantom, Solflare...). embedded: created for them
   * at sign-in by the frontend's embedded-wallet provider. Either way only the person can sign:
   * Stake-Sync never holds keys.
   */
  @Column({ type: 'varchar', length: 10 })
  kind: 'external' | 'embedded';

  @Column({ default: false })
  primary: boolean;

  /** Proven by signing a message (external wallets). */
  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  /** Address that first funded this wallet with SOL, a Sybil signal (PRD §11). */
  @Index()
  @Column({ type: 'varchar', length: 44, nullable: true })
  fundedBy: string | null;

  /** SOL rent top-ups sent to this wallet today (capped), and the day they count for. */
  @Column({ type: 'int', default: 0 })
  rentDripsToday: number;

  @Column({ type: 'varchar', length: 10, nullable: true })
  rentDripDay: string | null;
}
