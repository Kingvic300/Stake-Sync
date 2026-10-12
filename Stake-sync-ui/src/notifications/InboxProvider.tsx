import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/context'
import type { Notice } from '../data/types'
import { api } from '../lib/api'
import { InboxContext } from './context'

let seq = 0
const newestFirst = (list: Notice[]) => [...list].sort((a, b) => b.at.localeCompare(a.at))

/**
 * The bell's inbox, loaded from GET /notifications and re-read every minute.
 * In-app actions add local entries too.
 */
export function InboxProvider({ children }: { children: ReactNode }) {
  const { live } = useAuth()
  const [items, setItems] = useState<Notice[]>([])

  useEffect(() => {
    if (!live) return
    let alive = true
    const load = () =>
      api<{ items: Notice[] }>('/notifications')
        .then((r) => {
          if (!alive) return
          // Keep local entries (toasts recorded this session) that the server doesn't know about.
          setItems((all) => newestFirst([...r.items, ...all.filter((n) => n.id.startsWith('local-'))]).slice(0, 50))
        })
        .catch(() => {
          // The bell just keeps what it has; nothing to interrupt the person with.
        })
    void load()
    const t = window.setInterval(load, 60_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [live])

  const add = useCallback((n: Omit<Notice, 'id' | 'at' | 'unread'>) => {
    seq += 1
    setItems((all) => [{ ...n, id: `local-${seq}`, at: new Date().toISOString(), unread: true }, ...all].slice(0, 50))
  }, [])
  const markAll = useCallback(() => {
    setItems((all) => all.map((n) => ({ ...n, unread: false })))
    if (live) void api('/notifications/read-all', { method: 'POST' }).catch(() => {})
  }, [live])
  const markOne = useCallback(
    (id: string) => {
      setItems((all) => all.map((n) => (n.id === id ? { ...n, unread: false } : n)))
      if (live && !id.startsWith('local-')) void api('/notifications/read', { method: 'POST', body: { ids: [id] } }).catch(() => {})
    },
    [live],
  )

  const value = useMemo(() => ({ items, unread: items.filter((n) => n.unread).length, add, markAll, markOne }), [items, add, markAll, markOne])
  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>
}
