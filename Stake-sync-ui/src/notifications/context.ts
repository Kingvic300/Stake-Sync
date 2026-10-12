import { createContext, useContext } from 'react'
import type { Notice } from '../data/types'

export interface Inbox {
  items: Notice[]
  unread: number
  add: (n: Omit<Notice, 'id' | 'at' | 'unread'>) => void
  markAll: () => void
  markOne: (id: string) => void
}

export const InboxContext = createContext<Inbox | null>(null)

export function useInbox() {
  const v = useContext(InboxContext)
  if (!v) throw new Error('useInbox must be used inside <InboxProvider>')
  return v
}
