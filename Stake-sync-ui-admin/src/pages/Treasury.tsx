import { AlertTriangle, Check, Copy, ExternalLink, Lock, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Bone } from '../components/Skeleton'
import { Button, PageHeader, Tag } from '../components/ui'
import type { Treasury as TreasuryData } from '../data/treasury'
import { cx, shortDate, usd } from '../lib/format'
import { useTreasury } from '../lib/useTreasury'
import { useToast } from '../toast/context'

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

/** Series colors (validated: colorblind-safe pair). Gold is low-contrast on white, so a table view is always offered. */
const SERIES = [
  { key: 'joinFees', label: 'Joining fees', swatch: 'bg-cobalt' },
  { key: 'forfeitShare', label: 'Share of forfeits', swatch: 'bg-gold' },
] as const

function TreasurySkeleton() {
  return (
    <div role="status" aria-label="Loading the treasury">
      <Bone className="h-44 rounded-3xl" />
      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-3xl lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Bone key={i} className="h-24 rounded-none" />
        ))}
      </div>
      <Bone className="mt-10 h-72 rounded-3xl" />
    </div>
  )
}

/** Is the program paying the wallet this page shows? Settlement fails if not, so say it plainly. */
function WalletStatus({ t }: { t: TreasuryData }) {
  if (!t.wallet)
    return (
      <Callout tone="warn" title="No treasury wallet is set">
        Set <code className="font-mono text-[13px]">TREASURY_WALLET</code> in the API’s settings to the company wallet that should receive revenue. Until then, challenges can’t settle.
      </Callout>
    )
  if (!t.program)
    return (
      <Callout tone="warn" title="The escrow program isn’t set up yet">
        Once the program is deployed, its treasury must be set to this same wallet. The first setup call records it on-chain.
      </Callout>
    )
  if (!t.program.matches)
    return (
      <Callout tone="danger" title="The escrow program pays a different wallet">
        The program sends revenue to <span className="font-mono text-[13px]">{t.program.treasury}</span>, but the API is set to this one. Challenges can’t settle until
        they match. Change whichever one is wrong (see “Changing the treasury” below).
      </Callout>
    )
  return null
}

function Callout({ tone, title, children }: { tone: 'warn' | 'danger'; title: string; children: React.ReactNode }) {
  return (
    <div className={cx('mt-4 flex items-start gap-3 rounded-2xl p-4 text-[15px]', tone === 'danger' ? 'bg-miss-soft text-[oklch(42%_0.16_23)]' : 'bg-gold-soft text-gold-ink')}>
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5">{children}</p>
      </div>
    </div>
  )
}

function MonthlyChart({ monthly }: { monthly: TreasuryData['monthly'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const totals = monthly.map((m) => m.joinFees + m.forfeitShare)
  const max = Math.max(...totals)
  // Three recessive gridlines at round numbers.
  const step = niceStep(max / 3)
  const top = Math.max(step * 3, step)
  const lines = [3, 2, 1].map((i) => step * i)

  return (
    <div className="relative">
      <div className="relative h-64 pl-14">
        {lines.map((v) => (
          <div key={v} className="absolute right-0 left-14 border-t border-line/70" style={{ bottom: `${(v / top) * 100}%` }}>
            <span className="absolute -top-2.5 -left-14 w-12 text-right text-xs text-slate tabular">{usdCompact(v)}</span>
          </div>
        ))}
        <div className="absolute right-0 bottom-0 left-14 border-t border-ink/30" />
        <ol className="relative flex h-full items-end gap-1.5 sm:gap-3">
          {monthly.map((m, i) => (
            <li key={m.month} className="relative flex h-full flex-1 items-end">
              <button
                type="button"
                aria-label={`${m.month}: ${usd(totals[i], { cents: true })} (joining fees ${usd(m.joinFees, { cents: true })}, share of forfeits ${usd(m.forfeitShare, { cents: true })})`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="group flex h-full w-full flex-col justify-end gap-[2px] rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt"
              >
                {m.forfeitShare > 0 && (
                  <span className={cx('block w-full rounded-t-[4px] bg-gold transition-opacity', hover !== null && hover !== i && 'opacity-40')} style={{ height: `${(m.forfeitShare / top) * 100}%` }} />
                )}
                {m.joinFees > 0 && (
                  <span
                    className={cx('block w-full bg-cobalt transition-opacity', m.forfeitShare === 0 && 'rounded-t-[4px]', hover !== null && hover !== i && 'opacity-40')}
                    style={{ height: `${(m.joinFees / top) * 100}%` }}
                  />
                )}
              </button>
              {hover === i && (
                <div
                  role="tooltip"
                  className={cx(
                    'pointer-events-none absolute bottom-full z-10 mb-2 w-52 rounded-xl bg-ink p-3 text-sm text-white shadow-lg',
                    i < 3 ? 'left-0' : i > monthly.length - 4 ? 'right-0' : 'left-1/2 -translate-x-1/2',
                  )}
                >
                  <p className="font-semibold">{m.month}</p>
                  {SERIES.map((s) => (
                    <p key={s.key} className="mt-1 flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-white/75">
                        <span className={cx('size-2.5 rounded-sm', s.swatch)} />
                        {s.label}
                      </span>
                      <span className="tabular">{usd(m[s.key], { cents: true })}</span>
                    </p>
                  ))}
                  <p className="mt-1.5 flex justify-between border-t border-white/15 pt-1.5 font-semibold">
                    <span>Total</span>
                    <span className="tabular">{usd(totals[i], { cents: true })}</span>
                  </p>
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
      <ol className="mt-2 flex gap-1.5 pl-14 sm:gap-3" aria-hidden>
        {monthly.map((m, i) => (
          <li key={m.month} className="flex min-w-0 flex-1 justify-center text-xs whitespace-nowrap text-slate">
            {/* Every other label on phones so they never collide. */}
            <span className={cx(i % 2 === 1 && 'max-sm:invisible')}>{m.month.split(' ')[0]}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function niceStep(raw: number) {
  if (raw <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
}

function usdCompact(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/**
 * Where Stake-Sync's revenue goes (joining fees and the platform share of forfeits). The escrow
 * program pays the treasury wallet directly when each challenge settles. View only: the wallet
 * belongs to the company, and nobody can move money from this app.
 */
export function Treasury() {
  const { data, error, refresh } = useTreasury()
  const toast = useToast()
  const [view, setView] = useState<'chart' | 'table'>('chart')

  useEffect(() => {
    if (error) toast({ tone: 'error', title: 'Couldn’t load the treasury', body: error, action: { label: 'Try again', onClick: refresh }, inbox: false })
  }, [error, refresh, toast])

  function copy(address: string) {
    void navigator.clipboard?.writeText(address).then(
      () => toast({ title: 'Address copied', inbox: false }),
      () => toast({ tone: 'error', title: 'Couldn’t copy the address', body: 'Select it and copy it instead.', inbox: false }),
    )
  }

  const empty = data ? data.monthly.every((m) => m.joinFees + m.forfeitShare === 0) : false

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16">
      <PageHeader
        title="Treasury"
        intro="Stake-Sync’s revenue: the joining fee on every stake and the platform’s share of forfeits. The escrow program pays it straight to the treasury wallet when each challenge settles."
      />
      {!data ? (
        error ? (
          <div className="rounded-3xl bg-surface px-5 py-12 text-center ring-1 ring-line/70">
            <p className="font-semibold">The treasury didn’t load</p>
            <Button variant="secondary" className="mt-4" onClick={refresh}>
              Try again
            </Button>
          </div>
        ) : (
          <TreasurySkeleton />
        )
      ) : (
        <>
          <section className="rounded-3xl bg-ink p-6 text-white sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-2xl bg-white/10">
                  <Wallet size={20} />
                </span>
                <div>
                  <p className="text-sm text-white/65">Treasury wallet · Solana {data.cluster}</p>
                  {data.wallet ? (
                    <p className="mt-0.5 font-mono text-[15px] break-all">{data.wallet.address}</p>
                  ) : (
                    <p className="mt-0.5 font-semibold">Not set</p>
                  )}
                </div>
              </div>
              {data.wallet && (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => copy(data.wallet!.address)}>
                    <Copy size={15} /> Copy
                  </Button>
                  <Button size="sm" variant="secondary" href={data.wallet.explorer}>
                    <ExternalLink size={15} /> Explorer
                  </Button>
                </div>
              )}
            </div>
            <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm text-white/65">USDC in the treasury now</p>
                <p className="mt-1 font-display text-5xl font-bold tabular">{data.wallet?.usdc != null ? usd(data.wallet.usdc, { cents: true }) : '—'}</p>
                {data.wallet && data.wallet.usdc == null && <p className="mt-1 text-sm text-white/65">Balance unavailable: the wallet has no USDC account yet, or the network didn’t answer.</p>}
              </div>
              {data.program?.matches && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold">
                  <Check size={15} strokeWidth={3} className="text-[oklch(80%_0.14_158)]" /> The escrow program pays this wallet
                </span>
              )}
            </div>
          </section>
          <WalletStatus t={data} />

          <div className="mt-4 flex items-start gap-3 rounded-2xl bg-surface p-4 text-[15px] text-slate ring-1 ring-line/70">
            <Lock size={18} className="mt-0.5 shrink-0 text-ink" />
            <p>
              <span className="font-semibold text-ink">Nobody can move this money from the admin app.</span> The treasury is a company wallet (a multisig such as Squads is
              strongly recommended). Spending from it needs the wallet’s own signers, in their wallet app.
            </p>
          </div>

          <dl className="mt-6 grid grid-cols-2 overflow-hidden rounded-3xl bg-surface ring-1 ring-line/70 lg:grid-cols-5">
            {[
              ['Revenue, all time', usd(data.totals.allTime, { cents: true }), `${data.totals.challenges} settled challenge${data.totals.challenges === 1 ? '' : 's'}`],
              ['Last 30 days', usd(data.totals.last30, { cents: true }), null],
              ['Joining fees', usd(data.totals.joinFees, { cents: true }), `${data.program?.joinPercent ?? data.fees.joinPercent}% on top of each stake`],
              ['Share of forfeits', usd(data.totals.forfeitShare, { cents: true }), `${data.program?.platformSharePercent ?? data.fees.platformSharePercent}% of forfeits and penalties`],
              ['Waiting in running challenges', usd(data.totals.heldInEscrow, { cents: true }), 'Joining fees held in escrow until settlement'],
            ].map(([k, v, note], i) => (
              <div key={k} className={cx('p-5', i % 2 === 1 && 'border-l border-line', i >= 2 && 'border-t border-line lg:border-t-0', i >= 1 && 'lg:border-l', i === 4 && 'col-span-2 lg:col-span-1')}>
                <dt className="text-sm text-slate">{k}</dt>
                <dd className="mt-1 font-display text-2xl font-bold tabular">{v}</dd>
                {note && <dd className="mt-1 text-xs text-slate">{note}</dd>}
              </div>
            ))}
          </dl>

          <section className="mt-10 rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-bold">Revenue by month</h2>
              <div className="flex rounded-xl bg-ground p-1 text-sm font-semibold" role="group" aria-label="Show as">
                {(['chart', 'table'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={cx('rounded-lg px-3 py-1.5 capitalize', view === v ? 'bg-surface shadow-sm ring-1 ring-line' : 'text-slate hover:text-ink')}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <ul className={cx('mt-3 flex flex-wrap gap-4 text-sm', empty && 'hidden')}>
              {SERIES.map((s) => (
                <li key={s.key} className="flex items-center gap-2">
                  <span className={cx('size-3 rounded-sm', s.swatch)} />
                  {s.label}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              {empty ? (
                <p className="rounded-2xl bg-ground px-4 py-10 text-center text-slate">No challenge has settled yet. Revenue shows up here after the first one does.</p>
              ) : view === 'chart' ? (
                <MonthlyChart monthly={data.monthly} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[28rem] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-slate">
                        <th className="py-2 font-semibold">Month</th>
                        <th className="py-2 text-right font-semibold">Joining fees</th>
                        <th className="py-2 text-right font-semibold">Share of forfeits</th>
                        <th className="py-2 text-right font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.monthly.map((m) => (
                        <tr key={m.month} className="border-b border-line/60">
                          <td className="py-2">{m.month}</td>
                          <td className="py-2 text-right tabular">{usd(m.joinFees, { cents: true })}</td>
                          <td className="py-2 text-right tabular">{usd(m.forfeitShare, { cents: true })}</td>
                          <td className="py-2 text-right font-semibold tabular">{usd(m.joinFees + m.forfeitShare, { cents: true })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-2xl font-bold">Settled challenges</h2>
            <p className="mt-1 text-slate">What each challenge paid the treasury when it settled, read from the escrow program.</p>
            {data.recent.length === 0 ? (
              <p className="mt-4 rounded-2xl bg-surface px-4 py-10 text-center text-slate ring-1 ring-line/70">Nothing yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-line overflow-hidden rounded-3xl bg-surface ring-1 ring-line/70">
                {data.recent.map((c) => (
                  <li key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 px-5 py-4 sm:grid-cols-[1fr_auto_auto]">
                    <div className="min-w-0">
                      <Link to={`/challenges?c=${c.id}`} className="font-semibold hover:underline">
                        {c.title}
                      </Link>
                      <p className="text-sm text-slate">
                        {c.settledAt ? `Settled ${shortDate(c.settledAt)}` : 'Settled'} · {c.finishers} finisher{c.finishers === 1 ? '' : 's'}
                      </p>
                    </div>
                    <p className="col-span-2 row-start-2 text-sm text-slate tabular sm:col-span-1 sm:col-start-2 sm:row-start-1">
                      {usd(c.joinFees, { cents: true })} fees + {usd(c.forfeitShare, { cents: true })} forfeits
                    </p>
                    <p className="text-right font-display text-lg font-semibold tabular sm:w-28">{usd(c.total, { cents: true })}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-10 rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-6">
            <h2 className="text-2xl font-bold">Changing the treasury</h2>
            <p className="mt-1 text-slate">This is deliberately not a button here: whoever can change it could redirect all revenue.</p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15px] marker:font-semibold">
              <li>Create the new company wallet. A Squads multisig, so no single person can spend, is the safe choice.</li>
              <li>
                The program admin wallet
                {data.program && (
                  <>
                    {' '}
                    (<span className="font-mono text-[13px]">{short(data.program.admin)}</span>)
                  </>
                )}{' '}
                signs the program’s <code className="font-mono text-[13px]">update_config</code> with the new treasury address.
              </li>
              <li>
                Set <code className="font-mono text-[13px]">TREASURY_WALLET</code> in the API’s settings to the same address and restart the API.
              </li>
              <li>Check this page shows “The escrow program pays this wallet”.</li>
            </ol>
            {data.program?.paused && (
              <p className="mt-4">
                <Tag tone="gold">Program paused</Tag> <span className="text-sm text-slate">New challenges and joins are stopped; claims and refunds still work.</span>
              </p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
