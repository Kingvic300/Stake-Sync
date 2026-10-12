import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../lib/format'
import { gsap, prefersMotion, useGSAP } from '../lib/gsap'
import { ToastContext, type Toast, type ToastInput } from './context'

const MAX = 3
let seq = 0

const tones = {
  success: { icon: CheckCircle2, bar: 'bg-calm', iconCls: 'text-calm' },
  error: { icon: AlertCircle, bar: 'bg-miss', iconCls: 'text-miss' },
  info: { icon: Info, bar: 'bg-cobalt', iconCls: 'text-cobalt' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const push = useCallback((t: ToastInput) => {
    seq += 1
    const next: Toast = { id: seq, tone: t.tone ?? 'success', title: t.title, body: t.body, action: t.action }
    setToasts((all) => [...all, next].slice(-MAX))
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(
        <section
          aria-label="Notifications"
          className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end lg:bottom-6"
        >
          {toasts.map((t) => (
            <ToastItem key={t.id} t={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </section>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

function ToastItem({ t, onDismiss }: { t: Toast; onDismiss: () => void }) {
  const el = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)
  const leaving = useRef(false)
  const life = t.tone === 'error' ? 8000 : 4500
  const tone = tones[t.tone]

  const { contextSafe } = useGSAP(
    () => {
      if (!prefersMotion()) return
      gsap.from(el.current, { y: 16, scale: 0.96, autoAlpha: 0, duration: 0.35, ease: 'back.out(1.6)' })
      gsap.fromTo('[data-life]', { scaleX: 1 }, { scaleX: 0, duration: life / 1000, ease: 'none', transformOrigin: 'left center' })
    },
    { scope: el },
  )

  function leave() {
    if (leaving.current) return
    leaving.current = true
    if (!prefersMotion()) return onDismiss()
    contextSafe(() => {
      gsap.to(el.current, { x: 24, autoAlpha: 0, duration: 0.22, ease: 'power2.in', onComplete: onDismiss })
    })()
  }

  const leaveRef = useRef(leave)
  useEffect(() => {
    leaveRef.current = leave
  })

  // Auto-dismiss, paused while hovered or focused so people can read and act.
  useEffect(() => {
    if (paused) {
      gsap.getTweensOf(el.current?.querySelector('[data-life]') ?? []).forEach((tw) => tw.pause())
      return
    }
    gsap.getTweensOf(el.current?.querySelector('[data-life]') ?? []).forEach((tw) => tw.resume())
    const id = window.setTimeout(() => leaveRef.current(), life)
    return () => window.clearTimeout(id)
  }, [paused, life])

  const Icon = tone.icon
  return (
    <div
      ref={el}
      role={t.tone === 'error' ? 'alert' : 'status'}
      aria-live={t.tone === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-2xl bg-ink text-white shadow-(--shadow-sheet)"
    >
      <div className="flex items-start gap-3 p-4 pr-3">
        <Icon size={20} className={cx('mt-0.5 shrink-0', tone.iconCls)} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t.title}</p>
          {t.body && <p className="mt-0.5 text-sm text-white/70">{t.body}</p>}
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.onClick()
                leave()
              }}
              className="mt-2 text-sm font-semibold text-gold hover:underline"
            >
              {t.action.label}
            </button>
          )}
        </div>
        <button type="button" onClick={leave} aria-label="Dismiss" className="grid size-7 shrink-0 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
          <X size={16} />
        </button>
      </div>
      <span data-life aria-hidden className={cx('absolute inset-x-0 bottom-0 h-0.5 origin-left', tone.bar)} />
    </div>
  )
}
