import { Bot, Camera, CircleCheck, CircleX, Handshake, Info, ShieldAlert } from 'lucide-react'
import { cx } from '../lib/format'
import type { MatrixRow } from '../lib/matrix'

const KIND = {
  auto: { icon: Bot, label: 'Automatic', tone: 'bg-cobalt-soft text-cobalt-deep' },
  review: { icon: Camera, label: 'Reviewed', tone: 'bg-gold-soft text-gold-ink' },
  self: { icon: Handshake, label: 'On trust', tone: 'bg-tile text-slate' },
} as const

/** The verification matrix: every rule, how it's checked, how often, and whether it decides the day. */
export function RulesMatrix({ rows, compact }: { rows: MatrixRow[]; compact?: boolean }) {
  if (!rows.length) return null
  return (
    <ul className={cx('divide-y divide-line overflow-hidden rounded-2xl ring-1 ring-line', compact ? 'bg-ground' : 'bg-surface')}>
      {rows.map((r) => {
        const k = KIND[r.kind]
        return (
          <li key={r.key} className={cx('grid gap-x-4 gap-y-1.5', compact ? 'p-3.5' : 'p-4 sm:grid-cols-[1fr_auto] sm:items-start')}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{r.rule}</span>
                {!r.required && <span className="rounded-full bg-tile px-2 py-0.5 text-xs font-semibold text-slate">Optional</span>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate">
                <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', k.tone)} title={r.how}>
                  <k.icon size={12} /> {k.label}
                </span>
                <span>{r.how}</span>
              </div>
              {r.note && (
                <p className="mt-1 flex items-start gap-1.5 text-sm text-slate">
                  <Info size={14} className="mt-0.5 shrink-0" /> {r.note}
                </p>
              )}
            </div>
            <span className={cx('text-sm font-semibold whitespace-nowrap text-ink', compact && 'text-slate')}>{r.when}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** Success, failure, strikes and penalties: what's at stake, in plain words. */
export function AtStake({ o, dark, stacked }: { o: { success: string; failure: string; strikes: string; penalties: string }; dark?: boolean; stacked?: boolean }) {
  const items = [
    { icon: CircleCheck, title: 'You succeed if', text: o.success, tone: 'text-calm' },
    { icon: CircleX, title: 'You fail if', text: o.failure, tone: 'text-miss' },
    { icon: ShieldAlert, title: 'Strikes and penalties', text: `${o.strikes} ${o.penalties}`, tone: 'text-gold-ink' },
  ]
  return (
    <dl className={cx('grid gap-3', !stacked && 'sm:grid-cols-3')}>
      {items.map((it) => (
        <div key={it.title} className={cx('rounded-2xl p-4', dark ? 'bg-white/[0.06] ring-1 ring-white/10' : 'bg-ground')}>
          <dt className={cx('flex items-center gap-1.5 text-sm font-semibold', dark ? 'text-white' : it.tone)}>
            <it.icon size={16} /> {it.title}
          </dt>
          <dd className={cx('mt-1.5 text-[15px]', dark ? 'text-white/75' : 'text-ink')}>{it.text}</dd>
        </div>
      ))}
    </dl>
  )
}
