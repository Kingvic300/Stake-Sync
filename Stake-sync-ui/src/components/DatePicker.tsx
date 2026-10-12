import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cx } from '../lib/format'
import { inputClass } from '../lib/styles'

const pad = (n: number) => String(n).padStart(2, '0')
/** YYYY-MM-DD in local time. */
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

/**
 * A date field with our own calendar instead of the browser's. Values are YYYY-MM-DD, like
 * <input type="date">. Days before `min` or after `max` can't be picked.
 */
export function DatePicker({ value, onChange, min, max, label }: { value: string; onChange: (v: string) => void; min?: string; max?: string; label: string }) {
  const [open, setOpen] = useState(false)
  const selected = parse(value)
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1))
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Monday-first grid with leading blanks.
  const lead = (month.getDay() + 6) % 7
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))]
  const today = ymd(new Date())
  const blocked = (d: Date) => (min ? ymd(d) < min : false) || (max ? ymd(d) > max : false)
  const prevBlocked = min ? ymd(new Date(month.getFullYear(), month.getMonth(), 0)) < min : false
  const nextBlocked = max ? ymd(new Date(month.getFullYear(), month.getMonth() + 1, 1)) > max : false

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${selected.toDateString()}`}
        onClick={() => {
          setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1))
          setOpen((o) => !o)
        }}
        className={cx(inputClass, 'flex items-center justify-between text-left')}
      >
        <span>{selected.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}</span>
        <CalendarDays size={18} className="text-slate" />
      </button>

      {open && (
        <div role="dialog" aria-label={label} className="absolute z-50 mt-2 w-72 rounded-2xl bg-surface p-3 shadow-(--shadow-sheet) ring-1 ring-line/70">
          <div className="flex items-center justify-between">
            <button type="button" aria-label="Previous month" disabled={prevBlocked} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="grid size-8 place-items-center rounded-lg hover:bg-ground disabled:opacity-30">
              <ChevronLeft size={18} />
            </button>
            <span className="font-semibold">{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
            <button type="button" aria-label="Next month" disabled={nextBlocked} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="grid size-8 place-items-center rounded-lg hover:bg-ground disabled:opacity-30">
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-7 text-center text-xs font-semibold text-slate">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1">
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              if (!d) return <span key={`b${i}`} />
              const key = ymd(d)
              const on = key === value
              const off = blocked(d)
              return (
                <button
                  key={key}
                  type="button"
                  disabled={off}
                  aria-pressed={on}
                  aria-label={d.toDateString()}
                  onClick={() => {
                    onChange(key)
                    setOpen(false)
                  }}
                  className={cx(
                    'grid h-9 place-items-center rounded-lg text-sm tabular transition-colors',
                    on ? 'bg-cobalt font-semibold text-white' : off ? 'text-slate/35' : 'hover:bg-ground',
                    !on && key === today && 'ring-1 ring-line ring-inset',
                  )}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
