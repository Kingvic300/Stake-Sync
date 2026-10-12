import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { gsap, prefersMotion, useGSAP } from '../lib/gsap'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Desktop width */
  width?: number
}

// Open sheets, oldest first. Only the top one reacts to Escape when sheets are stacked.
const stack: string[] = []

/**
 * Bottom sheet on phones, centered dialog on larger screens.
 * Mount it to open; the close button plays the exit before calling onClose.
 */
export function Sheet({ title, onClose, children, footer, width = 520 }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const closing = useRef(false)
  const id = useId()

  const { contextSafe } = useGSAP(
    () => {
      if (!prefersMotion()) return
      const phone = window.matchMedia('(max-width: 639px)').matches
      gsap
        .timeline({ defaults: { ease: 'power3.out' } })
        .from('.sheet-scrim', { autoAlpha: 0, duration: 0.25 })
        .from(
          panel.current,
          phone ? { yPercent: 100, duration: 0.45 } : { y: 24, scale: 0.97, autoAlpha: 0, duration: 0.35 },
          0,
        )
    },
    { scope: root },
  )

  function close() {
    if (closing.current) return
    closing.current = true
    if (!prefersMotion()) return onClose()
    contextSafe(() => {
      const phone = window.matchMedia('(max-width: 639px)').matches
      gsap
        .timeline({ defaults: { ease: 'power2.in' }, onComplete: onClose })
        .to(panel.current, phone ? { yPercent: 100, duration: 0.3 } : { y: 16, autoAlpha: 0, duration: 0.2 })
        .to('.sheet-scrim', { autoAlpha: 0, duration: 0.2 }, '<')
    })()
  }

  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  })

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    panel.current?.focus()
    stack.push(id)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stack[stack.length - 1] === id && closeRef.current()
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      stack.splice(stack.indexOf(id), 1)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = stack.length ? 'hidden' : overflow
      prev?.focus()
    }
  }, [id])

  return createPortal(
    <div ref={root} className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="sheet-scrim absolute inset-0 bg-ink/45 backdrop-blur-[2px]" onClick={close} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-surface shadow-(--shadow-sheet) outline-none sm:rounded-3xl"
        style={{ maxWidth: width }}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line sm:hidden" />
        <header className="flex items-center justify-between gap-4 px-6 pt-4 pb-2 sm:pt-6">
          <h2 className="text-xl font-bold">{title}</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-full text-slate transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <X size={18} />
          </button>
        </header>
        <div className="overflow-y-auto px-6 pb-6">{children}</div>
        {footer && <footer className="border-t border-line px-6 py-4">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
