import { useCallback, useEffect, useState } from 'react'
import type { ErrorDetail, ErrorGroupRow, LogDetail, LogEntry, LogStats } from '../data/logs'
import { api, apiEnabled } from './api'

export interface LogFilters {
  kind?: string
  level?: string
  status?: string
  q?: string
  user?: string
  requestId?: string
}

const query = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

interface Page {
  key: string
  items: LogEntry[]
  next: string | null
  error: string
}

export function useServerLogs(filters: LogFilters, live: boolean) {
  const key = JSON.stringify(filters)
  const [page, setPage] = useState<Page | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(
    (signal?: AbortSignal) =>
      api<{ items: LogEntry[]; nextBefore: string | null }>(`/admin/logs${query({ ...filters, limit: 100 })}`, { signal })
        .then((r) => setPage({ key, items: r.items, next: r.nextBefore, error: '' }))
        .catch((e) => {
          if (e instanceof DOMException) return
          setPage((p) => ({ key, items: p?.key === key ? p.items : [], next: null, error: e instanceof Error ? e.message : 'Couldn’t load the log.' }))
        }),
    [filters, key],
  )

  useEffect(() => {
    if (!apiEnabled) {
      setPage({ key, items: [], next: null, error: '' })
      return
    }
    const ctl = new AbortController()
    void load(ctl.signal)
    if (!live) return () => ctl.abort()
    const timer = setInterval(() => void load(), 10_000)
    return () => {
      ctl.abort()
      clearInterval(timer)
    }
  }, [key, live, load])

  const loadMore = useCallback(async () => {
    if (!page?.next || !apiEnabled) return
    setLoadingMore(true)
    try {
      const r = await api<{ items: LogEntry[]; nextBefore: string | null }>(`/admin/logs${query({ ...filters, limit: 100, before: page.next })}`)
      setPage((p) => (p && p.key === key ? { ...p, items: [...p.items, ...r.items], next: r.nextBefore } : p))
    } catch (e) {
      setPage((p) => (p ? { ...p, error: e instanceof Error ? e.message : 'Couldn’t load more.' } : p))
    } finally {
      setLoadingMore(false)
    }
  }, [page, filters, key])

  const current = page?.key === key ? page : null
  return {
    items: current && !(current.error && !current.items.length) ? current.items : null,
    error: current?.error && !current.items.length ? current.error : '',
    hasMore: Boolean(current?.next),
    loadMore,
    loadingMore,
    retry: () => void load(),
  }
}

export function useLogStats(): LogStats | null {
  const [stats, setStats] = useState<LogStats | null>(null)
  useEffect(() => {
    if (!apiEnabled) return
    let alive = true
    const get = () => api<LogStats>('/admin/logs/stats').then((s) => alive && setStats(s)).catch(() => undefined)
    void get()
    const timer = setInterval(get, 30_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return stats
}

export function fetchLogDetail(id: string): Promise<LogDetail> {
  return api<LogDetail>(`/admin/logs/${id}`)
}

export function useErrorGroups(status: string, q: string) {
  const key = `${status}|${q}`
  const [state, setState] = useState<{ key: string; items: ErrorGroupRow[]; error: string } | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!apiEnabled) {
      setState({ key, items: [], error: '' })
      return
    }
    const ctl = new AbortController()
    api<ErrorGroupRow[]>(`/admin/errors${query({ status: status === 'all' ? undefined : status, q })}`, { signal: ctl.signal })
      .then((items) => setState({ key, items, error: '' }))
      .catch((e) => !(e instanceof DOMException) && setState({ key, items: [], error: e instanceof Error ? e.message : 'Couldn’t load errors.' }))
    return () => ctl.abort()
  }, [status, q, key, tick])

  const setItems = useCallback((fn: (list: ErrorGroupRow[] | null) => ErrorGroupRow[] | null) => {
    setState((s) => (s?.key === key ? { ...s, items: fn(s.items) ?? [] } : s))
  }, [key])

  const current = state?.key === key ? state : null
  return {
    items: current && !current.error ? current.items : apiEnabled ? null : [],
    error: current?.error ?? '',
    refresh: () => setTick((n) => n + 1),
    setItems,
  }
}

export function fetchErrorDetail(id: string): Promise<ErrorDetail> {
  return api<ErrorDetail>(`/admin/errors/${id}`)
}

export async function setErrorStatus(id: string, resolve: boolean, reason?: string) {
  await api(`/admin/errors/${id}/${resolve ? 'resolve' : 'reopen'}`, { method: 'POST', body: resolve ? { reason } : undefined })
}
