import { Heart } from 'lucide-react'
import type { DayRecord, ProofState } from '../data/types'
import { cx } from '../lib/format'
import { proofMeta, tileClass } from '../lib/styles'

const sizes = {
  lg: 'gap-1.5 sm:gap-2 [&>li]:rounded-md',
  md: 'gap-1 sm:gap-1.5 [&>li]:rounded-[5px]',
  sm: 'gap-[3px] [&>li]:rounded-[3px]',
}

interface Props {
  days: DayRecord[]
  today?: number
  size?: keyof typeof sizes
  columns?: number
  className?: string
}

/** The challenge calendar: one tile per day, colored by proof state. */
export function DayGrid({ days, today, size = 'md', columns = 10, className }: Props) {
  return (
    <ol
      className={cx('grid', sizes[size], className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      aria-label="Daily progress"
    >
      {days.map((d) => (
        <li
          key={d.day}
          data-day={d.day}
          data-state={d.state}
          title={`Day ${d.day}: ${proofMeta[d.state].label}`}
          className={cx(
            'day-tile aspect-square',
            tileClass[d.state],
            d.day === today && 'outline-2 outline-offset-2 outline-ink',
          )}
        >
          <span className="sr-only">
            Day {d.day}: {proofMeta[d.state].label}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function GridLegend({ states }: { states: ProofState[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-slate">
      {states.map((s) => (
        <li key={s} className="inline-flex items-center gap-1.5">
          <span className={cx('size-3 rounded-[3px]', tileClass[s])} />
          {s === 'unavailable' ? 'Provider down' : proofMeta[s].label}
        </li>
      ))}
    </ul>
  )
}

export function Strikes({
  total,
  used,
  size = 20,
  className,
}: {
  total: number
  used: number
  size?: number
  className?: string
}) {
  if (total === 0) return <span className="text-sm text-slate">No free strikes</span>
  const left = total - used
  return (
    <span
      className={cx('inline-flex items-center gap-1', className)}
      role="img"
      aria-label={`${left} of ${total} strikes left`}
    >
      {Array.from({ length: total }, (_, i) => {
        const alive = i < left
        return (
          <Heart
            key={i}
            data-heart={i}
            size={size}
            strokeWidth={2.2}
            className={cx('heart', alive ? 'fill-miss text-miss' : 'fill-transparent text-line')}
          />
        )
      })}
    </span>
  )
}
