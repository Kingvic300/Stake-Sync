import { createContext, useContext } from 'react'
import type { AdminRole } from '../data/admin'

export interface AdminSession {
  id: string
  name: string
  email: string
  role: AdminRole
  /** Present when signed in against the real API. */
  accessToken?: string
  refreshToken?: string
}

export interface AdminAuth {
  session: AdminSession | null
  signIn: (s: AdminSession) => void
  signOut: () => void
}

export const AdminAuthContext = createContext<AdminAuth | null>(null)

export function useAdminAuth() {
  const v = useContext(AdminAuthContext)
  if (!v) throw new Error('useAdminAuth must be used inside <AdminAuthProvider>')
  return v
}
