import { createContext, useContext } from 'react'
import type { AdminDispute, AuditEntry, DisputeStatus, ProofReview, ProviderStatus, RiskFlag } from '../data/admin'
import type { Provider } from '../data/types'

export interface Approval {
  id: string
  action: string
  target: string
  reason: string
  requestedBy: string
  requestedById: string
  at: string
}

export interface Outage {
  id: string
  provider: Provider
  from: string
  to: string
  protected: number
  status: ProviderStatus
}

export interface ProviderHealth {
  provider: Provider
  status: ProviderStatus
  success: number
  latency: number
  calls: number
  retrying: number
  incident: { id: string; since: string; reason: string } | null
}

export interface AdminStore {
  loading: boolean
  disputes: AdminDispute[]
  reviews: ProofReview[]
  risks: RiskFlag[]
  reports: { id: string; author: { name: string; handle: string; hue: number }; challenge: string | null; body: string; reason: string; reporters: number; at: string }[]
  audit: AuditEntry[]
  approvals: Approval[]
  outages: Outage[]
  providers: ProviderHealth[]
  health: Record<string, ProviderStatus>
  refresh: () => void
  setDispute: (id: string, status: DisputeStatus, reason: string) => Promise<void>
  resolveReview: (id: string, approved: boolean, reason: string) => Promise<void>
  setRisk: (id: string, status: Extract<RiskFlag['status'], 'Watching' | 'Cleared'>, reason: string) => Promise<void>
  resolveReport: (id: string, action: string, reason: string) => Promise<void>
  decideApproval: (id: string, approve: boolean) => Promise<void>
  declareOutage: (provider: Provider, from: string, to: string, reason: string) => Promise<number>
}

export const AdminStoreContext = createContext<AdminStore | null>(null)

export function useAdmin() {
  const v = useContext(AdminStoreContext)
  if (!v) throw new Error('useAdmin must be used inside <AdminStoreProvider>')
  return v
}
