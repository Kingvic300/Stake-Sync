import { Lock, Users } from 'lucide-react'
import { Link } from 'react-router'
import type { Challenge } from '../data/types'
import { compact, cx, relative, usd } from '../lib/format'
import { stakeLabel } from '../lib/styles'
import { ProviderMark, Tag } from './ui'

function timing(c: Challenge) {
  if (c.status === 'open') return `Starts ${relative(c.startsAt)}`
  if (c.status === 'live') return 'In progress'
  if (c.status === 'settling') return 'Settling'
  return 'Ended'
}

/**
 * Row layout for lists: reads like a fixture list, scanning down the money columns.
 * Collapses to a stacked block on phones.
 */
export function ChallengeRow({ c }: { c: Challenge }) {
  return (
    <li>
      <Link
        to={`/c/${c.id}`}
        className="group grid grid-cols-[1fr_auto] gap-x-6 gap-y-3 rounded-2xl px-4 py-5 transition-colors hover:bg-surface sm:px-5 lg:grid-cols-[minmax(0,1fr)_7rem_7rem_6rem_7.5rem] lg:items-center"
      >
        <div className="col-span-2 min-w-0 lg:col-span-1">
          <div className="flex items-center gap-2 text-sm text-slate">
            <span className="inline-flex -space-x-0.5">
              {c.providers.map((p) => (
                <ProviderMark key={p} provider={p} size={14} />
              ))}
            </span>
            <span>{c.category}</span>
            {c.privacy !== 'public' && (
              <span className="inline-flex items-center gap-1">
                <Lock size={12} /> {c.privacy === 'org' ? 'Members' : 'Invite only'}
              </span>
            )}
          </div>
          <h3 className="mt-1 truncate text-lg font-semibold tracking-tight group-hover:text-cobalt sm:text-xl">{c.title}</h3>
          <p className="truncate text-[15px] text-slate">{c.summary}</p>
        </div>
        <RowStat label="Stake" value={stakeLabel(c)} />
        <RowStat label="Sponsor pool" value={c.sponsorPool ? usd(c.sponsorPool) : '–'} gold={c.sponsorPool > 0} />
        <RowStat label="Length" value={`${c.durationDays} days`} className="hidden lg:block" />
        <div className="col-span-2 flex items-center justify-between gap-3 text-sm text-slate lg:col-span-1 lg:block lg:text-right">
          <span className="inline-flex items-center gap-1.5 lg:justify-end">
            <Users size={14} />
            <span className="tabular">{compact(c.participants)}</span>
            {c.limit && <span className="tabular">/ {compact(c.limit)}</span>}
          </span>
          <span className="block lg:mt-0.5">{timing(c)}</span>
        </div>
      </Link>
    </li>
  )
}

function RowStat({ label, value, gold, className }: { label: string; value: string; gold?: boolean; className?: string }) {
  return (
    <div className={cx('lg:text-right', className)}>
      <div className="text-xs text-slate lg:hidden">{label}</div>
      <div className={cx('font-display text-lg font-semibold tabular', gold && 'text-gold-ink')}>{value}</div>
    </div>
  )
}

export function ListHeader() {
  return (
    <div className="hidden grid-cols-[minmax(0,1fr)_7rem_7rem_6rem_7.5rem] gap-x-6 border-b border-line px-5 pb-2 text-sm text-slate lg:grid">
      <span>Challenge</span>
      <span className="text-right">Stake</span>
      <span className="text-right">Sponsor pool</span>
      <span className="text-right">Length</span>
      <span className="text-right">People</span>
    </div>
  )
}

/** Larger block for sponsored challenges: the sponsor and the pool lead. */
export function SponsoredBlock({ c }: { c: Challenge }) {
  return (
    <Link
      to={`/c/${c.id}`}
      className="group relative flex min-h-64 flex-col justify-between overflow-hidden rounded-3xl bg-ink p-6 text-white transition-transform duration-200 hover:-translate-y-0.5 sm:p-7"
    >
      <SponsorTexture />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-white/70">{c.org?.name ?? c.creator.name}</span>
          <Tag tone="gold">Sponsored</Tag>
        </div>
        <h3 className="mt-4 max-w-[18ch] text-2xl font-bold sm:text-3xl">{c.title}</h3>
      </div>
      <dl className="relative mt-8 grid grid-cols-3 gap-4">
        <div>
          <dt className="text-sm text-white/60">Pool</dt>
          <dd className="font-display text-2xl font-semibold text-gold tabular">{usd(c.sponsorPool)}</dd>
        </div>
        <div>
          <dt className="text-sm text-white/60">Stake</dt>
          <dd className="font-display text-2xl font-semibold tabular">{stakeLabel(c)}</dd>
        </div>
        <div>
          <dt className="text-sm text-white/60">Joined</dt>
          <dd className="font-display text-2xl font-semibold tabular">{compact(c.participants)}</dd>
        </div>
      </dl>
    </Link>
  )
}

/** A faint field of day tiles behind dark panels, the brand's one decorative device. */
export function SponsorTexture({ className }: { className?: string }) {
  const lit = new Set([3, 4, 5, 9, 10, 11, 12, 16, 17, 18, 19, 20, 24, 25, 26, 27, 31, 32, 33, 34, 35])
  return (
    <div
      aria-hidden
      className={cx('pointer-events-none absolute -right-6 -bottom-6 hidden grid-cols-7 gap-1.5 opacity-[0.16] sm:grid', className)}
    >
      {Array.from({ length: 42 }, (_, i) => (
        <span key={i} className={cx('size-5 rounded-[4px]', lit.has(i) ? 'bg-gold' : 'bg-white/40')} />
      ))}
    </div>
  )
}
