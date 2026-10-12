import type { Person, Provider } from './types'

export type AdminRole = 'Super admin' | 'Moderator' | 'Risk analyst' | 'Support' | 'Finance (view only)'

export const permissions: { action: string; roles: AdminRole[] }[] = [
  { action: 'Decide disputes', roles: ['Super admin', 'Moderator'] },
  { action: 'Review photo and camera proof', roles: ['Super admin', 'Moderator', 'Support'] },
  { action: 'Restrict an account', roles: ['Super admin', 'Risk analyst'] },
  { action: 'Declare a provider outage', roles: ['Super admin', 'Risk analyst'] },
  { action: 'Unlist or pause a challenge', roles: ['Super admin', 'Moderator'] },
  { action: 'Approve organizations', roles: ['Super admin', 'Support'] },
  { action: 'View escrow and transactions', roles: ['Super admin', 'Risk analyst', 'Finance (view only)'] },
  { action: 'View server and error logs', roles: ['Super admin', 'Risk analyst'] },
  { action: 'Move escrowed funds', roles: [] },
  { action: 'Manage team and roles', roles: ['Super admin'] },
]

export type ProviderStatus = 'operational' | 'degraded' | 'outage'
export type DisputeStatus = 'New' | 'In review' | 'Waiting on user' | 'Approved' | 'Failure confirmed'

export interface AdminDispute {
  id: string
  user: Person
  challenge: string
  provider: Provider
  day: number
  opened: string
  due: string
  status: DisputeStatus
  priority: 'High' | 'Normal'
  reason: string
  locked: number
  evidence: string[]
  events: { at: string; source: string; text: string }[]
}

export interface ProofReview {
  id: string
  user: Person
  challenge: string
  kind: 'photo' | 'camera'
  submitted: string
  note?: string
  reps?: number
  flags: string[]
  hue: number
  hasFile: boolean
}

export interface RiskFlag {
  id: string
  user: Person
  userId: string
  score: number
  status: 'Open' | 'Watching' | 'Restricted' | 'Cleared'
  signals: string[]
  linked: Person[]
  value: number
  raised: string
}

export interface AdminUser {
  id: string
  person: Person
  email: string | null
  joined: string
  level: 'Basic' | 'Verified user' | 'Enhanced'
  active: number
  completed: number
  staked: number
  risk: number
  status: 'Active' | 'Restricted' | 'Suspended'
  statusReason?: string | null
  accounts: Provider[]
}

export interface AdminChallenge {
  id: string
  title: string
  host: string
  status: 'Open' | 'Live' | 'Settling' | 'Ended' | 'Paused'
  participants: number
  escrow: number
  sponsor: number
  verifyRate: number
  disputes: number
  flagged?: string
  providers: Provider[]
  address: string
  vault?: string | null
}

export interface AdminOrg {
  name: string
  slug: string
  kind: string
  members: number
  challenges: number
  sponsored: number
  plan: 'Community' | 'Organization' | 'Sponsored campaign'
  verification: 'Verified' | 'Pending' | 'Rejected'
  applied: string
  hue: number
}

export interface AuditEntry {
  id: string
  at: string
  actor: string
  action: string
  target: string
  reason: string
}
