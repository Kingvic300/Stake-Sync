import { useEffect, useSyncExternalStore } from 'react'
import { useAuth } from '../auth/context'
import type { OrgRole, Person } from '../data/types'
import { api } from './api'

/** An organization as GET /orgs/:slug and GET /me/orgs return it. */
export interface ApiOrg {
  slug: string
  name: string
  kind: string
  person: Person
  about: string
  website?: string | null
  verification?: string
  members: number
  /** Your role, or null if you're not a member */
  role: OrgRole | null
  /** Only for members */
  inviteCode?: string
  challenges: string[]
  featured?: { id: string; title: string; startsAt: string; status: string }[]
  sponsored: number
}

export type MyOrg = ApiOrg & { role: OrgRole }

// One copy shared by every screen, so joining or creating shows up everywhere at once.
let orgs: MyOrg[] | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Re-reads GET /me/orgs, e.g. after creating or joining one. */
export function refreshMyOrgs() {
  loading ??= api<MyOrg[]>('/me/orgs')
    .then((list) => {
      orgs = list
      emit()
    })
    .catch(() => {
      // Keep what we have; menus just show fewer links.
    })
    .finally(() => {
      loading = null
    })
  return loading
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Organizations you belong to. Empty until loaded. */
export function useMyOrgs(): MyOrg[] {
  const { live, session } = useAuth()
  const list = useSyncExternalStore(subscribe, () => orgs)
  const who = session?.username
  useEffect(() => {
    if (!live) {
      orgs = null
      return
    }
    void refreshMyOrgs()
  }, [live, who])
  return live ? (list ?? []) : []
}

export function canManage(role: OrgRole) {
  return role === 'Owner' || role === 'Admin'
}
