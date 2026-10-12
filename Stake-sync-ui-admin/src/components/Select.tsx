import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../lib/format'
import { gsap, prefersMotion } from '../lib/gsap'

export interface Option<T extends string> {
  value: T
  label: string
  hint?: string
  icon?: ReactNode
}

const looks = {
  /** Full-width form field, same chrome as text inputs */
  field: 'h-12 w-full rounded-xl bg-surface px-4 text-[15px] ring-1 ring-inset ring-line hover:ring-slate/40',
  /** Compact control for toolbars and table cells */
  compact: 'h-9 rounded-lg bg-surface px-3 text-sm font-semibold ring-1 ring-line hover:ring-slate/40',
  /** Big heading-style switcher, e.g. the organization name */
  title: 'max-w-full rounded-xl px-1 py-1 font-display text-2xl font-bold tracking-tight hover:bg-ink/5 sm:text-4xl',
}

/**
 * Custom dropdown that looks the same on every device. The list renders in a portal with fixed
 * positioning, so tables and cards with overflow never clip it, and it flips up near the screen bottom.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  placeholder = 'Choose',
  look = 'field',
  className,
  invalid,
}: {
  value: T | ''
  onChange: (v: T) => void
  options: Option<T>[]
  /** Accessible name; also read by screen readers */
  label: string
  placeholder?: string
  look?: keyof typeof looks
  className?: string
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const id = useId()
  const selected = options.find((o) => o.value === value)

  function place() {
    const r = trigger.current?.getBoundingClientRect()
    if (!r) return
    const room = window.innerHeight - r.bottom
    const up = room < 280 && r.top > room
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 220) - 8)), top: up ? r.top - 6 : r.bottom + 6, width: Math.max(r.width, 220), up })
  }

  function show() {
    place()
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }

  function choose(i: number) {
    const o = options[i]
    if (!o) return
    onChange(o.value)
    setOpen(false)
    trigger.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open || !list.current || !prefersMotion()) return
    gsap.fromTo(list.current, { opacity: 0, y: pos?.up ? 6 : -6, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.18, ease: 'power2.out' })
  }, [open, pos?.up])

  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!trigger.current?.contains(t) && !list.current?.contains(t)) setOpen(false)
    }
    const onMove = () => place()
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  function onKey(e: KeyboardEvent) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        show()
      }
      return
    }
    if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') return (e.preventDefault(), setActive((a) => Math.min(a + 1, options.length - 1)))
    if (e.key === 'ArrowUp') return (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
    if (e.key === 'Home') return (e.preventDefault(), setActive(0))
    if (e.key === 'End') return (e.preventDefault(), setActive(options.length - 1))
    if (e.key === 'Enter' || e.key === ' ') return (e.preventDefault(), choose(active))
    // Type-ahead: jump to the first option starting with what was typed
    if (e.key.length === 1) {
      const now = Date.now()
      typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : '') + e.key.toLowerCase(), at: now }
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text))
      if (hit >= 0) setActive(hit)
    }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={label}
        aria-invalid={invalid || undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        className={cx(
          'inline-flex items-center justify-between gap-2 text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt',
          looks[look],
          open && look !== 'title' && 'ring-2 ring-cobalt',
          invalid && 'ring-miss',
          className,
        )}
      >
        <span className={cx('flex min-w-0 items-center gap-2 truncate', !selected && 'text-slate')}>
          {selected?.icon}
          <span className="truncate">{selected?.label ?? placeholder}</span>
        </span>
        <ChevronDown size={look === 'title' ? 22 : 16} className={cx('shrink-0 text-slate transition-transform', open && 'rotate-180')} />
      </button>

      {open &&
        pos &&
        createPortal(
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            onKeyDown={onKey}
            style={{ left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
            className="fixed z-[90] max-h-72 overflow-y-auto rounded-2xl bg-surface p-1.5 shadow-(--shadow-sheet) ring-1 ring-line"
          >
            {options.map((o, i) => {
              const on = o.value === value
              return (
                <li
                  key={o.value}
                  data-i={i}
                  role="option"
                  aria-selected={on}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(i)}
                  className={cx('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-[15px]', i === active && 'bg-ground')}
                >
                  {o.icon}
                  <span className="min-w-0 flex-1">
                    <span className={cx('block truncate', on && 'font-semibold')}>{o.label}</span>
                    {o.hint && <span className="block truncate text-sm text-slate">{o.hint}</span>}
                  </span>
                  {on && <Check size={16} strokeWidth={3} className="shrink-0 text-cobalt" />}
                </li>
              )
            })}
          </ul>,
          document.body,
        )}
    </>
  )
}
