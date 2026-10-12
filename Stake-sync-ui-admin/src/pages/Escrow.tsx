import { AlertTriangle, Check, Clock, Lock } from 'lucide-react'
import { useAdminApi } from '../lib/useAdminApi'
import type { AdminChallenge } from '../data/admin'
import { PageHeader, Tag } from '../components/ui'
import { cx, usd } from '../lib/format'
import { timeAgo } from '../lib/time'

interface EscrowData {
  challenges: { id: string; title: string; vault: string; onChain: number | null; expected: number; matches: boolean | null; settlement: null | { status: 'Ready to settle' | 'Waiting for disputes' | 'Settled'; finishers: number; returned: number; rewards: number; forfeited: number; checks: string[] } }[]
  alerts: { id: string; at: string; kind: string; detail: string; amount: number; severity: 'High' | 'Medium' | 'Low'; signature: string | null }[]
  program: { id: string; cluster: string; adminCanWithdraw: false }
}

interface OverviewData { escrow: number; sponsorPools: number }

/**
 * Read-only by design (PRD §17, §29): admins can see every pool and settlement,
 * but no admin role can move escrowed funds. Settlement is run by the program.
 */
export function Escrow() {
  const { data, loading } = useAdminApi<EscrowData>('/admin/escrow')
  const { data: challenges } = useAdminApi<AdminChallenge[]>('/admin/challenges')
  const { data: overview } = useAdminApi<OverviewData>('/admin/overview')
  const rows = data?.challenges ?? []
  const total = rows.reduce((n, c) => n + (c.onChain ?? 0), 0)
  const bySlug = new Map((challenges ?? []).map((c) => [c.id, c]))
  const settlements = rows.flatMap((c) => c.settlement ? [{ challenge: c.title, ...c.settlement }] : [])
  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16">
      <PageHeader title="Escrow and settlements" intro="Money held by the escrow program, read from the chain. This page is view only." />

      <div className="flex items-start gap-3 rounded-2xl bg-ink p-5 text-white">
        <Lock size={20} className="mt-0.5 shrink-0 text-gold" />
        <p className="text-[15px] text-white/80">
          <span className="font-semibold text-white">No admin role can move escrowed funds.</span> Stakes and sponsor pools are released by the program, using the rules
          locked when each challenge started. Admin authority and financial authority are kept separate.
        </p>
      </div>

      <dl className="mt-6 grid grid-cols-2 overflow-hidden rounded-3xl bg-surface ring-1 ring-line/70 lg:grid-cols-4">
        {[
          ['Total held', usd(total)],
          ['Participant stakes', usd(Math.max(0, (overview?.escrow ?? 0) - (overview?.sponsorPools ?? 0)))],
          ['Sponsor pools', usd(overview?.sponsorPools ?? 0)],
          ['Ready to settle', String(settlements.filter((s) => s.status === 'Ready to settle').length)],
        ].map(([k, v], i) => (
          <div key={k} className={cx('p-5', i % 2 === 1 && 'border-l border-line', i >= 2 && 'border-t border-line lg:border-t-0', i === 2 && 'lg:border-l')}>
            <dt className="text-sm text-slate">{k}</dt>
            <dd className="mt-1 font-display text-3xl font-bold tabular">{v}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-10 text-2xl font-bold">Settlement queue</h2>
      <ul className="mt-4 grid gap-4 lg:grid-cols-3">
        {settlements.map((s) => (
          <li key={s.challenge} className="rounded-3xl bg-surface p-5 ring-1 ring-line/70">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-sans text-lg font-semibold">{s.challenge}</h3>
              <Tag tone={s.status === 'Ready to settle' ? 'cobalt' : s.status === 'Settled' ? 'plain' : 'gold'}>{s.status}</Tag>
            </div>
            {s.finishers > 0 && (
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-slate">Finishers</dt>
                  <dd className="font-display text-lg font-semibold tabular">{s.finishers}</dd>
                </div>
                <div>
                  <dt className="text-slate">Stakes returned</dt>
                  <dd className="font-display text-lg font-semibold tabular">{usd(s.returned)}</dd>
                </div>
                <div>
                  <dt className="text-slate">Rewards</dt>
                  <dd className="font-display text-lg font-semibold text-gold-ink tabular">{usd(s.rewards)}</dd>
                </div>
                <div>
                  <dt className="text-slate">Forfeited</dt>
                  <dd className="font-display text-lg font-semibold tabular">{usd(s.forfeited)}</dd>
                </div>
              </dl>
            )}
            <ul className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
              {s.checks.map((c) => (
                <li key={c} className="flex items-start gap-2">
                  {s.status === 'Waiting for disputes' ? <Clock size={15} className="mt-0.5 text-gold-ink" /> : <Check size={15} strokeWidth={3} className="mt-0.5 text-calm" />}
                  {c}
                </li>
              ))}
            </ul>
            {s.status === 'Ready to settle' && <p className="mt-4 text-sm text-slate">Settles automatically at the next program run. Results are deterministic and can be re-checked on-chain.</p>}
          </li>
        ))}
      </ul>

      <div className="mt-10 grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <section className="overflow-x-auto rounded-3xl bg-surface ring-1 ring-line/70">
          <h2 className="p-5 text-xl font-bold sm:px-6">Pools by challenge</h2>
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-y border-line text-left text-sm text-slate">
                <th className="px-5 py-3 font-normal sm:px-6">Challenge</th>
                <th className="hidden py-3 font-normal md:table-cell">Escrow account</th>
                <th className="py-3 text-right font-normal">Stakes</th>
                <th className="px-5 py-3 text-right font-normal sm:px-6">Sponsor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(loading ? [] : rows).map((c) => {
                const challenge = bySlug.get(c.id)
                const stakeAmount = c.settlement ? c.expected : Math.max(0, c.expected - (challenge?.sponsor ?? 0))
                return (
                <tr key={c.id}>
                  <td className="px-5 py-3 font-semibold sm:px-6">{c.title}</td>
                  <td className="hidden py-3 text-slate tabular md:table-cell">{c.vault}</td>
                  <td className="py-3 text-right tabular">{usd(stakeAmount)}</td>
                  <td className="px-5 py-3 text-right text-gold-ink tabular sm:px-6">{challenge?.sponsor ? usd(challenge.sponsor) : '–'}</td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        <section className="rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-6">
          <h2 className="text-xl font-bold">Transaction alerts</h2>
          <ul className="mt-4 space-y-3">
            {(data?.alerts ?? []).map((t) => (
              <li key={t.id} className="rounded-2xl bg-ground p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 font-semibold">
                    <AlertTriangle size={16} className={t.severity === 'High' ? 'text-miss' : t.severity === 'Medium' ? 'text-gold-ink' : 'text-slate'} />
                    {t.kind}
                  </span>
                  <span className="text-xs text-slate">{timeAgo(t.at)}</span>
                </div>
                <p className="mt-1 text-[15px] text-slate">{t.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
