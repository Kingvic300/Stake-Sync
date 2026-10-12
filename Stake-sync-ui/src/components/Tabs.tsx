import { useRef } from 'react'
import { cx } from '../lib/format'
import { gsap, prefersMotion, useGSAP } from '../lib/gsap'

interface Props<T extends string> {
  tabs: { id: T; label: string; count?: number }[]
  active: T
  onChange: (id: T) => void
  label: string
}

/** Underline tabs; the indicator glides to the selected tab. */
export function Tabs<T extends string>({ tabs, active, onChange, label }: Props<T>) {
  const root = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLSpanElement>(null)

  useGSAP(
    () => {
      const el = root.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`)
      if (!el || !bar.current) return
      const to = { x: el.offsetLeft, width: el.offsetWidth }
      if (prefersMotion() && bar.current.dataset.ready) {
        gsap.to(bar.current, { ...to, duration: 0.35, ease: 'power3.out' })
      } else {
        gsap.set(bar.current, to)
        bar.current.dataset.ready = '1'
      }
    },
    { scope: root, dependencies: [active] },
  )

  return (
    <div ref={root} role="tablist" aria-label={label} className="relative -mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          data-tab={t.id}
          aria-selected={t.id === active}
          onClick={() => onChange(t.id)}
          className={cx(
            'relative h-12 shrink-0 px-3 text-[15px] font-semibold transition-colors',
            t.id === active ? 'text-ink' : 'text-slate hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-sm font-medium text-slate tabular">{t.count}</span>}
        </button>
      ))}
      <span ref={bar} aria-hidden className="absolute bottom-0 left-0 h-0.5 w-0 rounded-full bg-ink" />
    </div>
  )
}
