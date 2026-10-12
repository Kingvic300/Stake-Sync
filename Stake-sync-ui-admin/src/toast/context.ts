import { createContext, useContext } from 'react'

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastInput {
  tone?: ToastTone
  title: string
  body?: string
  /** Optional single action, e.g. Undo or View */
  action?: { label: string; onClick: () => void }
  /** Also record it in the notifications inbox. Default true; turn off for trivial confirmations. */
  inbox?: boolean
  /** Where the inbox entry links to */
  href?: string
}

export interface Toast extends Required<Pick<ToastInput, 'tone' | 'title'>> {
  id: number
  body?: string
  action?: ToastInput['action']
}

export const ToastContext = createContext<((t: ToastInput) => void) | null>(null)

/** Show a short confirmation or error. `toast({ title: 'Money claimed' })` */
export function useToast() {
  const push = useContext(ToastContext)
  if (!push) throw new Error('useToast must be used inside <ToastProvider>')
  return push
}
