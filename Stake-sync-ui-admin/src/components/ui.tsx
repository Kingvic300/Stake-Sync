import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'
import type { Person, ProofState, Provider } from '../data/types'
import { cx } from '../lib/format'
import { buttonClass, proofMeta, verifiedBy, type Size, type Variant } from '../lib/styles'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  /** In-app route */
  to?: string
  /** External or mailto link */
  href?: string
  /** Work is in progress: keeps the label, shows a sheen, ignores further taps */
  busy?: boolean
}

export function Button({ variant, size, to, href, busy, className, children, ...rest }: ButtonProps) {
  const cls = buttonClass(variant, size, cx(className, busy && 'is-busy'))
  if (href) {
    const external = /^https?:/.test(href)
    return (
      <a
        href={href}
        className={cls}
        onClick={rest.onClick as unknown as React.MouseEventHandler<HTMLAnchorElement>}
        {...(external && { target: '_blank', rel: 'noreferrer' })}
      >
        {children}
      </a>
    )
  }
  if (to) {
    return (
      <Link to={to} className={cls}>
        {children}
      </Link>
    )
  }
  return (
    <button type="button" className={cls} aria-busy={busy || undefined} {...rest}>
      {children}
    </button>
  )
}

export function Avatar({ person, size = 36, src }: { person: Person; size?: number; src?: string }) {
  const initials = person.name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
  if (src) {
    return <img src={src} alt="" aria-hidden width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  }
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-full font-display font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `oklch(90% 0.06 ${person.hue})`,
        color: `oklch(34% 0.11 ${person.hue})`,
      }}
    >
      {initials}
    </span>
  )
}

const marks: Record<Provider, ReactNode> = {
  Camera: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="3" r="1.6" />
      <path d="M3 8.5h4l2.5-2.5 3.5 1M7 8.5 5.5 13M9.5 6l1 7" />
    </g>
  ),
  Health: (
    <path fill="currentColor" d="M8 14.2 2.6 9C1.1 7.5 1.1 5 2.6 3.6a3.2 3.2 0 0 1 4.6 0L8 4.4l.8-.8a3.2 3.2 0 0 1 4.6 0c1.5 1.4 1.5 3.9 0 5.4L8 14.2Z" />
  ),
  Photo: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <rect x="1.5" y="3" width="13" height="10" rx="2" />
      <circle cx="8" cy="8" r="2.4" />
    </g>
  ),
  GitHub: (
    <path
      fill="currentColor"
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
    />
  ),
  Solana: (
    <g fill="currentColor">
      <path d="M3.2 3h11l-2.4 2.4h-11z" />
      <path d="M3.2 6.8h11l-2.4 2.4h-11z" transform="matrix(-1 0 0 1 15.4 0)" />
      <path d="M3.2 10.6h11L11.8 13h-11z" />
    </g>
  ),
  LeetCode: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2.5 4 8l5.5 5.5" />
      <path d="M7 8h6.5" />
    </g>
  ),
  Codeforces: (
    <g fill="currentColor">
      <rect x="1.5" y="6" width="3.6" height="8.5" rx="1" />
      <rect x="6.2" y="1.5" width="3.6" height="13" rx="1" />
      <rect x="10.9" y="4" width="3.6" height="10.5" rx="1" />
    </g>
  ),
  WakaTime: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.3" />
      <path d="M8 4.5V8l2.4 1.6" />
    </g>
  ),
}

const markColor: Record<Provider, string> = {
  Camera: 'text-[oklch(55%_0.17_160)]',
  Health: 'text-[oklch(60%_0.2_15)]',
  Photo: 'text-[oklch(50%_0.12_250)]',
  GitHub: 'text-ink',
  Solana: 'text-[oklch(55%_0.2_300)]',
  LeetCode: 'text-[oklch(65%_0.16_60)]',
  Codeforces: 'text-[oklch(55%_0.16_250)]',
  WakaTime: 'text-ink',
}

export function ProviderMark({ provider, size = 16, tone = true }: { provider: Provider; size?: number; tone?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden
      className={cx('shrink-0', tone && markColor[provider])}
    >
      {marks[provider]}
    </svg>
  )
}

export function Providers({ providers, className }: { providers: Provider[]; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2 text-sm text-slate', className)}>
      <span className="inline-flex -space-x-1">
        {providers.map((p) => (
          <span key={p} className="grid size-6 place-items-center rounded-full bg-surface ring-2 ring-ground">
            <ProviderMark provider={p} size={13} />
          </span>
        ))}
      </span>
      <span>Verified by {verifiedBy(providers)}</span>
    </span>
  )
}

export function ProofChip({ state }: { state: ProofState }) {
  const m = proofMeta[state]
  return (
    <span className={cx('inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold', m.chip)}>
      {m.icon}
      {m.label}
    </span>
  )
}

export function Tag({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'gold' | 'cobalt' | 'ink' }) {
  const tones = {
    plain: 'bg-ink/[0.06] text-ink',
    gold: 'bg-gold-soft text-gold-ink',
    cobalt: 'bg-cobalt-soft text-cobalt-deep',
    ink: 'bg-ink text-white',
  }
  return (
    <span className={cx('inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-semibold', tones[tone])}>
      {children}
    </span>
  )
}

export function Fact({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-sm text-slate">{label}</dt>
      <dd className="mt-0.5 font-display text-xl font-semibold tabular">{value}</dd>
      {sub && <dd className="text-sm text-slate">{sub}</dd>}
    </div>
  )
}

export function Panel({
  children,
  className,
  as: As = 'section',
  flush,
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article' | 'aside'
  /** No inner padding, for panels whose rows run edge to edge */
  flush?: boolean
}) {
  return <As className={cx('rounded-3xl bg-surface ring-1 ring-line/70', !flush && 'p-5 sm:p-7', className)}>{children}</As>
}

export function PageHeader({ title, intro, actions }: { title: string; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 pb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-bold sm:text-5xl">{title}</h1>
        {intro && <p className="mt-3 text-lg text-slate">{intro}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-cobalt' : 'bg-line',
      )}
    >
      <span
        className={cx(
          'inline-block size-5 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      {hint && <span className="mt-0.5 block text-sm text-slate">{hint}</span>}
      <span className="mt-2 block">{children}</span>
    </label>
  )
}

