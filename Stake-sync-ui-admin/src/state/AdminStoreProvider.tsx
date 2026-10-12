import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAdminAuth } from '../auth/context'
import type { AdminDispute, AuditEntry, ProofReview, ProviderStatus, RiskFlag } from '../data/admin'
import type { Provider } from '../data/types'
import { api, apiEnabled } from '../lib/api'
import { useToast } from '../toast/context'
import { AdminStoreContext, type AdminStore, type Approval, type Outage, type ProviderHealth } from './context'

type HealthResponse = {
  providers: { provider: string; status: ProviderStatus; success: number; latency: number; calls: number; retrying: number; incident: { id: string; since: string; reason: string } | null }[]
  incidents: { id: string; provider: string; status: ProviderStatus; startsAt: string; endsAt: string | null; protectedCount: number; reason: string }[]
}

const labels: Record<string, Provider> = {
  github: 'GitHub', solana: 'Solana', leetcode: 'LeetCode', codeforces: 'Codeforces',
  wakatime: 'WakaTime', camera: 'Camera', health: 'Health', photo: 'Photo',
}

/** Shared API-backed queues and writes used across the admin console. */
export function AdminStoreProvider({ children }: { children: ReactNode }) {
  const { session } = useAdminAuth()
  const toast = useToast()
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(Boolean(apiEnabled && session?.accessToken))
  const [disputes, setDisputes] = useState<AdminDispute[]>([])
  const [reviews, setReviews] = useState<ProofReview[]>([])
  const [risks, setRisks] = useState<RiskFlag[]>([])
  const [reports, setReports] = useState<AdminStore['reports']>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [outages, setOutages] = useState<Outage[]>([])
  const [providers, setProviders] = useState<ProviderHealth[]>([])
  const refresh = useCallback(() => setRevision((n) => n + 1), [])

  useEffect(() => {
    if (!apiEnabled || !session?.accessToken) {
      setDisputes([]); setReviews([]); setRisks([]); setReports([]); setAudit([]); setApprovals([]); setOutages([]); setProviders([]); setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const load = async <T,>(path: string, set: (value: T) => void, title: string) => {
      try { set(await api<T>(path, { signal: controller.signal })) }
      catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        toast({ tone: 'error', title, body: e instanceof Error ? e.message : 'Try again.' })
      }
    }
    const canReview = ['Super admin', 'Moderator', 'Support'].includes(session.role)
    const canModerateReports = ['Super admin', 'Moderator'].includes(session.role)
    void Promise.all([
      load<AdminDispute[]>('/admin/disputes', setDisputes, 'Couldn’t load disputes'),
      canReview ? load<ProofReview[]>('/admin/reviews', (rows) => setReviews(rows.map((r) => ({ ...r, hue: r.user.hue, hasFile: r.hasFile ?? false }))), 'Couldn’t load proof reviews') : Promise.resolve(setReviews([])),
      Promise.all([
        api<RiskFlag[]>('/admin/risk', { signal: controller.signal }),
        api<RiskFlag[]>('/admin/risk?status=cleared', { signal: controller.signal }),
      ]).then(([open, cleared]) => setRisks([...open, ...cleared])).catch((e) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) toast({ tone: 'error', title: 'Couldn’t load risk cases', body: e instanceof Error ? e.message : 'Try again.' })
      }),
      canModerateReports ? load<AdminStore['reports']>('/admin/reports', setReports, 'Couldn’t load reports') : Promise.resolve(setReports([])),
      load<AuditEntry[]>('/admin/audit', setAudit, 'Couldn’t load audit log'),
      load<Approval[]>('/admin/approvals', setApprovals, 'Couldn’t load approvals'),
      load<HealthResponse>('/admin/health', (data) => {
        setProviders(data.providers.map((p) => ({ ...p, provider: labels[p.provider] ?? p.provider as Provider })))
        setOutages(data.incidents.map((i) => ({ id: i.id, provider: labels[i.provider] ?? i.provider as Provider, from: i.startsAt, to: i.endsAt ?? 'Ongoing', protected: i.protectedCount, status: i.status })))
      }, 'Couldn’t load provider health'),
    ]).finally(() => !controller.signal.aborted && setLoading(false))
    return () => controller.abort()
  }, [revision, session?.accessToken, session?.role, toast])

  const setDispute = useCallback(async (id: string, status: AdminDispute['status'], reason: string) => {
    if (status === 'Waiting on user') await api(`/admin/disputes/${id}/request-evidence`, { method: 'POST', body: { message: reason } })
    else if (status === 'Approved' || status === 'Failure confirmed') await api(`/admin/disputes/${id}/decide`, { method: 'POST', body: { upheld: status === 'Approved', reason } })
    refresh()
  }, [refresh])

  const resolveReview = useCallback(async (id: string, approve: boolean, reason: string) => {
    await api(`/admin/reviews/${id}`, { method: 'POST', body: { approve, reason } })
    refresh()
  }, [refresh])

  const setRisk = useCallback(async (id: string, status: 'Watching' | 'Cleared', reason: string) => {
    await api(`/admin/risk/${id}`, { method: 'POST', body: { status: status.toLowerCase(), reason } })
    refresh()
  }, [refresh])

  const resolveReport = useCallback(async (id: string, action: string, reason: string) => {
    const actionCode = action === 'Removed message' ? 'remove' : action === 'Warned user' ? 'mute' : 'dismiss'
    await api(`/admin/reports/${id}`, { method: 'POST', body: { action: actionCode, reason } })
    refresh()
  }, [refresh])

  const decideApproval = useCallback(async (id: string, approve: boolean) => {
    await api(`/admin/approvals/${id}`, { method: 'POST', body: { approve } })
    refresh()
  }, [refresh])

  const declareOutage = useCallback(async (provider: Provider, from: string, to: string, reason: string) => {
    const result = await api<{ protectedIds: string[] }>('/admin/outages', { method: 'POST', body: { provider: provider.toLowerCase(), from: new Date(from).toISOString(), to: new Date(to).toISOString(), reason } })
    refresh()
    return result.protectedIds.length
  }, [refresh])

  const value = useMemo(() => ({
    loading, disputes, reviews, risks, reports, audit, approvals, outages, providers,
    health: Object.fromEntries(providers.map((p) => [p.provider, p.status])), refresh,
    setDispute, resolveReview, setRisk, resolveReport, decideApproval, declareOutage,
  }), [loading, disputes, reviews, risks, reports, audit, approvals, outages, providers, refresh, setDispute, resolveReview, setRisk, resolveReport, decideApproval, declareOutage])

  return <AdminStoreContext.Provider value={value}>{children}</AdminStoreContext.Provider>
}
