import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, apiEnabled, bindSession } from '../lib/api'
import { AdminAuthContext, type AdminSession } from './context'

// Per-tab session (sessionStorage), so closing the tab signs the admin out.
const KEY = 'stakesync.admin'

function load(): AdminSession | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw || !apiEnabled) return null
    const session = JSON.parse(raw) as AdminSession
    return typeof session.accessToken === 'string' && session.accessToken.length > 0 ? session : null
  } catch {
    return null
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(load)
  const current = useRef(session)
  useLayoutEffect(() => {
    current.current = session
    bindSession({
      get: () => current.current,
      update: (t) => setSession((s) => (s ? { ...s, ...t } : s)),
      expire: () => setSession(null),
    })
  }, [session])

  useEffect(() => {
    try {
      if (session) sessionStorage.setItem(KEY, JSON.stringify(session))
      else sessionStorage.removeItem(KEY)
    } catch {
      // this tab only
    }
  }, [session])

  const value = useMemo(
    () => ({
      session,
      signIn: (s: AdminSession) => {
        if (!apiEnabled || !s.accessToken) return
        try {
          sessionStorage.setItem(KEY, JSON.stringify(s))
        } catch {
          // this tab only
        }
        setSession(s)
      },
      signOut: () => {
        // End the session on the server too, so the token stops working everywhere.
        if (apiEnabled && session?.accessToken) void api('/auth/logout', { method: 'POST' }).catch(() => undefined)
        try {
          sessionStorage.removeItem(KEY)
        } catch {
          // nothing stored
        }
        setSession(null)
      },
    }),
    [session],
  )
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}
