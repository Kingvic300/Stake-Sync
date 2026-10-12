import { createContext, useCallback, useContext, useState } from 'react'

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

/**
 * Error state for a form field. The message shows as a toast; `failed` only outlines the field so
 * it's easy to find. `setError('')` clears the outline.
 */
export function useFieldError() {
  const toast = useToast()
  const [failed, setFailed] = useState(false)
  const setError = useCallback(
    (message: string) => {
      setFailed(Boolean(message))
      if (message) toast({ tone: 'error', title: message, inbox: false })
    },
    [toast],
  )
  return [failed, setError] as const
}
