import { Column, Entity, Index, JoinColumn, ManyToOne, type Relation, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity.js';
import { bigintColumn } from '../../../common/money.js';

export const PROVIDERS = ['github', 'solana', 'leetcode', 'codeforces', 'wakatime', 'camera', 'health', 'photo'] as const;
export type ProviderKey = (typeof PROVIDERS)[number];

export const CATEGORIES = ['Coding', 'Web3', 'Fitness', 'Learning', 'Building', 'Writing', 'Content Creation', 'Productivity'] as const;
export type Category = (typeof CATEGORIES)[number];

export type Privacy = 'public' | 'private' | 'org';
export type Difficulty = 'Starter' | 'Steady' | 'Hard';
export type VerificationLevel = 'Basic' | 'Verified user' | 'Enhanced';
export type StakeMode = 'none' | 'fixed' | 'range';
/**
 * pending_chain: created here, escrow not yet confirmed on Solana.
 * open: taking joins. live: running. settling: ended, waiting for disputes/settlement.
 * ended: settled. cancelled: called off before start, refunds open.
 */
export type ChallengeStatus = 'pending_chain' | 'open' | 'live' | 'settling' | 'ended' | 'cancelled';

/** Per-provider settings that define what counts (PRD §31: meaningful criteria, not raw counts). */
export interface VerificationConfig {
  github?: {
    minChangedLines?: number;
    countPullRequests?: boolean;
    mergedOnly?: boolean;
    repo?: string;
    /** Commits needed in one day (default 1) */
    minCommits?: number;
    /** Only changes to files in these languages count, e.g. ["Rust"] */
    languages?: string[];
    /** Only changes under these paths count, e.g. ["src/", "Cargo.toml"] */
    paths?: string[];
  };
  solana?: { cluster: 'mainnet-beta' | 'devnet'; activity: 'deploy' | 'transaction' | 'program'; programId?: string };
  leetcode?: {
    newOnly: boolean;
    minDifficulty?: 'Easy' | 'Medium' | 'Hard';
    minMediumHard?: number;
    /** Set problems instead of any new one: LeetCode's daily question, or the creator's list */
    assigned?: 'daily' | 'list';
    /** For "list": problem slugs per day, one or more each day */
    schedule?: string[][];
  };
  codeforces?: { minRating?: number };
  wakatime?: { minMinutes: number };
  camera?: { exercise: 'pushups' | 'situps' | 'squats'; reps: number };
  health?: { metric: 'steps' | 'distance'; threshold: number };
  photo?: { instructions: string };
  /** Extra rules the creator wrote, shown to everyone before they join (the verification matrix). */
  criteria?: Criterion[];
}

/**
 * One line of the verification matrix. "photo" rules are checked by a reviewer from the daily
 * photo proof; "self" rules are guidance people commit to but can't fail a day on their own.
 */
export interface Criterion {
  id: string;
  text: string;
  frequency: 'daily' | 'weekly' | 'total';
  check: 'photo' | 'self';
  required: boolean;
}

@Entity('challenges')
export class Challenge extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  slug: string;

  @Column({ type: 'varchar', length: 90 })
  title: string;

  @Column({ type: 'varchar', length: 160 })
  summary: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 24 })
  category: Category;

  @Column({ type: 'text', array: true })
  providers: ProviderKey[];

  @Column({ type: 'jsonb', default: {} })
  verificationConfig: VerificationConfig;

  @Index()
  @Column('uuid')
  creatorId: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  orgId: string | null;

  @Column({ type: 'varchar', nullable: true })
  bannerUrl: string | null;

  @Column({ type: 'varchar', length: 8, default: 'public' })
  privacy: Privacy;

  @Column({ type: 'int', nullable: true })
  participantLimit: number | null;

  @Column({ type: 'varchar', length: 8 })
  stakeMode: StakeMode;

  @Column({ type: 'numeric', precision: 20, scale: 0, transformer: bigintColumn, default: 0 })
  stakeMin: bigint;

  @Column({ type: 'numeric', precision: 20, scale: 0, transformer: bigintColumn, default: 0 })
  stakeMax: bigint;

  /** Confirmed sponsor deposits (mirrors the on-chain pool). */
  @Column({ type: 'numeric', precision: 20, scale: 0, transformer: bigintColumn, default: 0 })
  sponsorPool: bigint;

  /** What the creator promised to sponsor at creation, shown until it's deposited. */
  @Column({ type: 'numeric', precision: 20, scale: 0, transformer: bigintColumn, default: 0 })
  sponsorPledge: bigint;

  @Column({ type: 'varchar', length: 8 })
  mode: 'days' | 'count';

  @Column({ type: 'int' })
  durationDays: number;

  @Column({ type: 'int', default: 86_400 })
  periodSecs: number;

  @Column({ type: 'int' })
  periodCount: number;

  @Column({ type: 'int' })
  requiredPeriods: number;

  @Column({ type: 'int', nullable: true })
  targetCount: number | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  countUnit: string | null;

  @Column({ type: 'varchar', length: 200 })
  requirement: string;

  @Column({ type: 'varchar', length: 12 })
  penaltyPreset: string;

  @Column({ type: 'int' })
  freeStrikes: number;

  /** Ladder in basis points; the last step repeats. */
  @Column({ type: 'int', array: true })
  penaltiesBps: number[];

  @Column({ type: 'int', default: 0 })
  freezePeriods: number;

  @Column({ type: 'int', default: 172_800 })
  disputeWindowSecs: number;

  @Index()
  @Column({ type: 'timestamptz' })
  startsAt: Date;

  @Column({ type: 'timestamptz' })
  joinBy: Date;

  @Column({ type: 'timestamptz' })
  endsAt: Date;

  @Column({ type: 'varchar', length: 64, default: 'Africa/Lagos' })
  timezone: string;

  @Column({ type: 'varchar', length: 8, default: 'Steady' })
  difficulty: Difficulty;

  @Column({ type: 'varchar', length: 16 })
  verificationLevel: VerificationLevel;

  @Column({ default: true })
  forfeitsToFinishers: boolean;

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'pending_chain' })
  status: ChallengeStatus;

  /** Admin unlisted or paused it (PRD §29). Running escrow is unaffected. */
  @Column({ type: 'varchar', nullable: true })
  moderationHold: string | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 16 })
  inviteCode: string;

  @Column({ type: 'int', default: 0 })
  participantCount: number;

  /** Fee on forfeits in bps, fixed at creation (mirrors the program). */
  @Column({ type: 'int', default: 0 })
  feeBps: number;

  /** Joining fee on top of the stake, in bps. */
  @Column({ type: 'int', default: 0 })
  joinFeeBps: number;

  /** When the host ticked "I agree to the rules" at creation. */
  @Column({ type: 'timestamptz', nullable: true })
  creatorAgreedAt: Date | null;

  /** False for no-money challenges (internal company use): no escrow at all. */
  @Column({ default: true })
  onChain: boolean;

  @Column({ type: 'numeric', precision: 20, scale: 0, transformer: bigintColumn, nullable: true })
  chainId: bigint | null;

  @Column({ type: 'varchar', length: 44, nullable: true })
  challengePda: string | null;

  @Column({ type: 'varchar', length: 44, nullable: true })
  vaultPda: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  createSig: string | null;

  @Column({ type: 'numeric', precision: 20, scale: 0, transformer: bigintColumn, nullable: true })
  rewardPerFinisher: bigint | null;

  @Column({ type: 'int', nullable: true })
  finisherCount: number | null;

  /** Paid to the treasury at settlement: joining fees plus the platform's share of forfeits (from the program). */
  @Column({ type: 'numeric', precision: 20, scale: 0, transformer: bigintColumn, nullable: true })
  platformRevenue: bigint | null;

  /** The joining-fee part of `platformRevenue`. */
  @Column({ type: 'numeric', precision: 20, scale: 0, transformer: bigintColumn, nullable: true })
  platformJoinFees: bigint | null;

  @Column({ type: 'timestamptz', nullable: true })
  settledAt: Date | null;

  /** sha256 hex of the rules document participants accept. */
  @Column({ type: 'varchar', length: 64 })
  rulesHash: string;
}

/** The exact rules document people accept (PRD §7). Immutable once anyone has joined. */
@Entity('challenge_rules')
export class ChallengeRule extends BaseEntity {
  @Index({ unique: true })
  @Column('uuid')
  challengeId: string;

  @Column({ type: 'text' })
  doc: string;

  @Column({ type: 'varchar', length: 64 })
  hash: string;
}

export type ParticipantStatus = 'pending' | 'active' | 'completed' | 'failed' | 'refunded';

@Entity('participants')
@Unique(['challengeId', 'userId'])
export class Participant extends BaseEntity {
  @Index()
  @Column('uuid')
  challengeId: string;

  @ManyToOne(() => Challenge, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'challenge_id' })
  challenge?: Relation<Challenge>;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 44, nullable: true })
  wallet: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  walletKind: 'external' | 'embedded' | null;

  @Column({ type: 'numeric', precision: 20, scale: 0, transformer: bigintColumn, default: 0 })
  stake: bigint;

  /** Joining fee paid on top of the stake (held in escrow, refunded if the challenge is cancelled). */
  @Column({ type: 'numeric', precision: 20, scale: 0, transformer: bigintColumn, default: 0 })
  joinFee: bigint;

  @Column({ type: 'varchar', length: 12, default: 'pending' })
  status: ParticipantStatus;

  @Column({ type: 'varchar', length: 64 })
  acceptedRulesHash: string;

  @Column({ type: 'timestamptz' })
  acceptedAt: Date;

  @Column({ type: 'varchar', length: 44, nullable: true })
  participantPda: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  joinSig: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  activatedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  verifiedCount: number;

  @Column({ type: 'int', default: 0 })
  missedCount: number;

  @Column({ type: 'int', default: 0 })
  excusedCount: number;

  /** Count-mode progress (problems, deployments, reps...). */
  @Column({ type: 'int', default: 0 })
  progress: number;

  @Column({ type: 'timestamptz', nullable: true })
  progressCheckedAt: Date | null;

  /** Provider snapshot taken at join, e.g. LeetCode solved counts, so only new work counts. */
  @Column({ type: 'jsonb', default: {} })
  baseline: Record<string, unknown>;

  @Column({ default: false })
  freezeUsed: boolean;

  @Column({ type: 'int', nullable: true })
  freezeFrom: number | null;

  @Column({ type: 'int', nullable: true })
  rank: number | null;

  @Column({ type: 'int', nullable: true })
  previousRank: number | null;

  @Column({ default: false })
  settled: boolean;

  @Column({ type: 'boolean', nullable: true })
  completed: boolean | null;

  @Column({ type: 'numeric', precision: 20, scale: 0, transformer: bigintColumn, default: 0 })
  penalty: bigint;

  /** stake − penalty + reward, set at finalize (or full stake on cancellation). */
  @Column({ type: 'numeric', precision: 20, scale: 0, transformer: bigintColumn, default: 0 })
  claimable: bigint;

  @Column({ default: false })
  claimed: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  claimSig: string | null;
}
