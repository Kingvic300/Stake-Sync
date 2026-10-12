import { AlertTriangle, ArrowRight, Camera, Flag, KeyRound, Scale, ShieldAlert } from 'lucide-react'
import { useRef } from 'react'
import { Link } from 'react-router'
import { useAdminAuth } from '../auth/context'
import { ProviderMark } from '../components/ui'
import { cx, usd } from '../lib/format'
import { gsap, useMotion } from '../lib/gsap'
import { useAdmin } from '../state/context'
import { statusStyle } from '../lib/adminStyles'
import { timeAgo, untilLabel } from '../lib/time'
import { useAdminApi } from '../lib/useAdminApi'

interface OverviewData {
  activeChallenges: number
  participants: number
  escrow: number
  sponsorPools: number
  verifyRate: number
  falseFailures: number
  openDisputes: number
  medianDisputeHours: number
  openRiskCases: number
  verificationFailures: number
  flaggedChallenges: number
  weekly: number[]
}

export function Overview() {
  const { session } = useAdminAuth()
  const { disputes, reviews, risks, reports, approvals, audit, providers } = useAdmin()
  const { data: kpis } = useAdminApi<OverviewData>('/admin/overview')
  const root = useRef<HTMLDivElement>(null)
  const first = session?.name.split(' ')[0]
  const openDisputes = disputes.filter((d) => d.status !== 'Approved' && d.status !== 'Failure confirmed')
  const soonest = [...openDisputes].sort((a, b) => a.due.localeCompare(b.due))[0]
  const troubled = providers.filter((p) => p.status !== 'operational')

  useMotion(() => {
    gsap.utils.toArray<HTMLElement>('[data-count]').forEach((el) => {
      const target = Number(el.dataset.count)
      const digits = Number(el.dataset.digits ?? 0)
      const n = { v: 0 }
      gsap.to(n, {
        v: target,
        duration: 1.1,
        ease: 'power2.out',
        onUpdate: () => void (el.textContent = (el.dataset.prefix ?? '') + n.v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + (el.dataset.suffix ?? '')),
      })
    })
    gsap.from('[data-bar]', { scaleY: 0, transformOrigin: 'center bottom', duration: 0.7, stagger: 0.06, ease: 'power3.out' })
  }, root)

  const queues = [
    { to: '/disputes', label: 'Disputes', icon: Scale, n: openDisputes.length, note: soonest ? `Next due ${untilLabel(soonest.due)}` : 'All decided', urgent: !!soonest && soonest.priority === 'High' },
    { to: '/reviews', label: 'Proof reviews', icon: Camera, n: reviews.length, note: `${reviews.filter((r) => r.flags.length).length} flagged by checks`, urgent: false },
    { to: '/risk', label: 'Risk flags', icon: ShieldAlert, n: risks.filter((r) => r.status === 'Open').length, note: `${risks.filter((r) => r.score >= 80 && r.status === 'Open').length} high risk`, urgent: risks.some((r) => r.score >= 90 && r.status === 'Open') },
    { to: '/reports', label: 'Reports', icon: Flag, n: reports.length, note: 'From challenge chats', urgent: false },
    { to: '/approvals', label: 'Waiting for a second admin', icon: KeyRound, n: approvals.length, note: 'Four-eyes actions', urgent: approvals.length > 0 },
  ]

  const metrics = [
    { label: 'Live challenges', value: kpis?.activeChallenges, digits: 0 },
    { label: 'Participants', value: kpis?.participants, digits: 0 },
    { label: 'USDC in escrow', value: kpis?.escrow, digits: 0, prefix: '$', sub: 'Read-only, held on-chain' },
    { label: 'Verified automatically', value: kpis?.verifyRate, digits: 1, suffix: '%', sub: kpis ? `${kpis.falseFailures}% wrongly failed` : undefined },
    { label: 'Median dispute time', value: kpis?.medianDisputeHours, digits: 0, suffix: 'h', sub: 'Target under 24h' },
  ]

  return (
    <div ref={root} className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16">
      <p className="text-slate">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h1 className="mt-1 text-4xl font-bold">Good evening, {first}</h1>

      {troubled.length > 0 && (
        <div role="status" className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl bg-gold-soft px-5 py-4 ring-1 ring-gold/30">
          <AlertTriangle size={20} className="text-gold-ink" />
          <p className="min-w-0 flex-1 text-[15px] text-gold-ink">
            <span className="font-semibold">{troubled.map((t) => t.provider).join(', ')} {troubled.length === 1 ? 'is' : 'are'} having trouble.</span>{' '}
            {troubled[0].incident?.reason ?? 'Checks are retrying.'} Results stay pending, so nobody is penalised.
          </p>
          <Link to="/health" className="text-sm font-semibold text-gold-ink underline">
            Open verification health
          </Link>
        </div>
      )}

      <dl className="mt-6 grid grid-cols-2 overflow-hidden rounded-3xl bg-surface ring-1 ring-line/70 md:grid-cols-3 xl:grid-cols-5">
        {metrics.map((m, i) => (
          <div key={m.label} className={cx('border-line p-5', i > 0 && 'border-l', i >= 2 && 'max-md:border-t', i === 2 && 'max-md:border-l-0', i >= 3 && 'md:max-xl:border-t', i === 3 && 'md:max-xl:border-l-0')}>
            <dt className="text-sm text-slate">{m.label}</dt>
            <dd className="mt-1 font-display text-3xl font-bold tabular">
              <span data-count={m.value} data-digits={m.digits} data-prefix={m.prefix} data-suffix={m.suffix}>
                {m.value === undefined ? '—' : (m.prefix ?? '') + m.value.toLocaleString('en-US', { minimumFractionDigits: m.digits }) + (m.suffix ?? '')}
              </span>
            </dd>
            {m.sub && <dd className="text-sm text-slate">{m.sub}</dd>}
          </div>
        ))}
      </dl>

      <h2 className="mt-10 text-2xl font-bold">Work queues</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {queues.map((q) => (
          <li key={q.to}>
            <Link to={q.to} className="group flex h-full flex-col rounded-3xl bg-surface p-5 ring-1 ring-line/70 transition-shadow hover:shadow-(--shadow-lift)">
              <div className="flex items-center justify-between">
                <span className={cx('grid size-10 place-items-center rounded-xl', q.urgent ? 'bg-miss-soft text-miss' : 'bg-ground text-ink')}>
                  <q.icon size={18} />
                </span>
                <ArrowRight size={18} className="text-slate transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className="mt-4 font-display text-4xl font-bold tabular">{q.n}</div>
              <div className="font-semibold">{q.label}</div>
              <div className={cx('mt-1 text-sm', q.urgent ? 'text-miss' : 'text-slate')}>{q.note}</div>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <section className="rounded-3xl bg-surface ring-1 ring-line/70">
          <div className="flex items-center justify-between p-5 sm:px-6">
            <h2 className="text-xl font-bold">Verification providers</h2>
            <Link to="/health" className="text-sm font-semibold text-cobalt hover:underline">
              Details
            </Link>
          </div>
          <ul className="divide-y divide-line border-t border-line">
            {providers.map((ph) => {
              const st = statusStyle[ph.status]
              return (
                <li key={ph.provider} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-3 sm:px-6">
                  <ProviderMark provider={ph.provider} size={20} />
                  <div className="min-w-0">
                    <div className="font-semibold">{ph.provider}</div>
                    <div className="truncate text-sm text-slate">{ph.incident?.reason ?? `${ph.calls} checks in the last hour`}</div>
                  </div>
                  <div className="text-right">
                    <div className={cx('inline-flex items-center gap-1.5 text-sm font-semibold', st.text)}>
                      <span className={cx('size-2 rounded-full', st.dot)} /> {st.label}
                    </div>
                    <div className="text-xs text-slate tabular">{ph.success}% verified</div>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        <div className="grid gap-5">
          <section className="rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-bold">Active participants</h2>
              <span className="text-sm text-slate">Last 6 weeks</span>
            </div>
            <div className="mt-5 flex h-36 items-end gap-3">
              {(kpis?.weekly ?? []).map((w, i) => (
                <div key={i} className="flex h-full flex-1 flex-col items-center gap-1.5">
                  <span className="text-xs text-slate tabular">{(w / 1000).toFixed(1)}k</span>
                  <span className="relative w-full flex-1">
                    <span data-bar className={cx('absolute inset-x-0 bottom-0 rounded-t-md', i === (kpis?.weekly.length ?? 0) - 1 ? 'bg-cobalt' : 'bg-cobalt/35')} style={{ height: `${(w / Math.max(1, ...(kpis?.weekly ?? [1]))) * 100}%` }} />
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">Latest admin actions</h2>
              <Link to="/audit" className="text-sm font-semibold text-cobalt hover:underline">
                Audit log
              </Link>
            </div>
            <ul className="mt-4 space-y-3">
              {audit.slice(0, 4).map((a) => (
                <li key={a.id} className="text-[15px]">
                  <span className="font-semibold">{a.actor}</span> {a.action.toLowerCase()} <span className="font-semibold">{a.target}</span>
                  <span className="block text-sm text-slate">
                    {timeAgo(a.at)}. {a.reason}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      <p className="mt-8 text-sm text-slate">Escrow totals are read from the chain. No admin role can move escrowed funds. {kpis ? `${usd(kpis.sponsorPools)} of it is sponsor pools.` : ''}</p>
    </div>
  )
}
