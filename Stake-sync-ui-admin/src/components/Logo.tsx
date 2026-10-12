import { Link } from 'react-router'
import { cx } from '../lib/format'

export function Logo({ className, to = '/', invert, admin = true }: { className?: string; to?: string; invert?: boolean; admin?: boolean }) {
  return (
    <Link to={to} className={cx('inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap', className)} aria-label="Stake-Sync home">
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
        <rect width="32" height="32" rx="8" className={invert ? 'fill-white' : 'fill-ink'} />
        <rect x="7" y="7" width="8" height="8" rx="2" className="fill-cobalt" />
        <rect x="17" y="7" width="8" height="8" rx="2" className="fill-cobalt" />
        <rect x="7" y="17" width="8" height="8" rx="2" className="fill-cobalt" />
        <rect x="17" y="17" width="8" height="8" rx="2" className="fill-gold" />
      </svg>
      <span className="font-display text-[19px] font-bold tracking-tight">Stake-Sync</span>
      {admin && <span className="rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-white">Admin</span>}
    </Link>
  )
}
