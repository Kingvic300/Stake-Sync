export type Category =
  | 'Coding'
  | 'Web3'
  | 'Fitness'
  | 'Learning'
  | 'Building'
  | 'Writing'
  | 'Content Creation'
  | 'Productivity'

/**
 * How progress is proven. GitHub/Solana/LeetCode/Codeforces/WakaTime are API integrations; Camera counts reps
 * on-device in the app; Health reads Apple Health or Health Connect through the mobile app;
 * Photo is uploaded proof that is checked and reviewed before it counts.
 */
export type Provider = 'GitHub' | 'Solana' | 'LeetCode' | 'Codeforces' | 'WakaTime' | 'Camera' | 'Health' | 'Photo'

export type Exercise = 'pushups' | 'situps' | 'squats'

/** PRD §10: verification is never binary internally. `upcoming` and `frozen` are UI-only. */
export type ProofState =
  | 'verified'
  | 'failed'
  | 'pending'
  | 'unavailable'
  | 'disputed'
  | 'frozen'
  | 'upcoming'

export type Privacy = 'public' | 'private' | 'org'
export type Difficulty = 'Starter' | 'Steady' | 'Hard'
export type VerificationLevel = 'Basic' | 'Verified user' | 'Enhanced'
export type ChallengeStatus = 'open' | 'live' | 'settling' | 'ended'

export interface Person {
  name: string
  handle: string
  hue: number
}

export interface Org {
  name: string
  slug: string
}

export interface Challenge {
  id: string
  title: string
  summary: string
  description: string
  category: Category
  providers: Provider[]
  creator: Person
  org?: Org
  participants: number
  limit?: number
  /** 0 means no stake required */
  stake: number
  stakeMode: 'none' | 'fixed' | 'range'
  stakeRange?: [number, number]
  sponsorPool: number
  durationDays: number
  /** How completion is measured: per-day, or a count over the whole challenge */
  mode: 'days' | 'count'
  requirement: string
  requiredDays?: number
  targetCount?: number
  countUnit?: string
  freeStrikes: number
  /** Additional % of stake lost on each miss after free strikes run out */
  penalties: number[]
  startsAt: string
  joinBy: string
  difficulty: Difficulty
  privacy: Privacy
  verificationLevel: VerificationLevel
  distribution: string
  freeze: { allowed: boolean; days: number }
  status: ChallengeStatus
  /** For Camera challenges: which exercise is counted */
  exercise?: Exercise
  /** For Health challenges: what is read from the phone */
  metric?: 'steps' | 'distance'
}

export interface DayRecord {
  day: number
  state: ProofState
  note?: string
}

export interface Participation {
  challengeId: string
  today: number
  days: DayRecord[]
  count?: number
  strikesUsed: number
  stake: number
  position: number
  freezeUsed: boolean
  nextDeadline: string
  history: VerificationEvent[]
}

export interface VerificationEvent {
  id: string
  at: string
  day?: number
  state: ProofState
  provider: Provider
  detail: string
}

export interface LeaderRow {
  rank: number
  person: Person
  completed: number
  consistency: number
  you?: boolean
}

export interface ChatMessage {
  id: string
  person: Person
  at: string
  body: string
  pinned?: boolean
  announcement?: boolean
  replyTo?: string
  reactions?: { emoji: string; count: number; mine?: boolean }[]
}

export interface FeedItem {
  id: string
  at: string
  text: string
  kind: 'day' | 'rank' | 'milestone'
}

export type NotificationKind =
  | 'starting'
  | 'verified'
  | 'deadline'
  | 'strike'
  | 'penalty'
  | 'message'
  | 'leaderboard'
  | 'completed'
  | 'reward'
  | 'dispute'
  | 'announcement'
  | 'activity'
  | 'problem'

export interface Notice {
  id: string
  kind: NotificationKind
  at: string
  title: string
  body: string
  href: string
  unread?: boolean
}

export interface Dispute {
  id: string
  challengeId: string
  day: number
  opened: string
  status: 'Under review' | 'Needs evidence' | 'Approved' | 'Failure confirmed'
  reason: string
  amountLocked: number
  timeline: { at: string; text: string }[]
}

export interface Txn {
  id: string
  at: string
  kind: 'Stake deposited' | 'Stake returned' | 'Reward claimed' | 'Sponsored' | 'Penalty'
  challengeId: string
  amount: number
  signature: string
}

export interface Achievement {
  id: string
  title: string
  provider: Provider
  earned: string
  detail: string
}
