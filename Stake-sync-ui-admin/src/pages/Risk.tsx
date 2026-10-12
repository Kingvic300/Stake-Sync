import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { ReasonSheet } from '../components/ReasonSheet'
import { PanelSkeleton } from '../components/Skeleton'
import { Tabs } from '../components/Tabs'
import { Avatar, Button, PageHeader } from '../components/ui'
import type { RiskFlag } from '../data/admin'
import { cx, usd } from '../lib/format'
import { timeAgo } from '../lib/time'
import { useAdmin } from '../state/context'
import { useToast } from '../toast/context'
import { api } from '../lib/api'

type Act = 'clear' | 'watch' | 'restrict'

function scoreTone(n: number) {
  return n >= 80 ? { bar: 'bg-miss', text: 'text-miss', label: 'High' } : n >= 50 ? { bar: 'bg-gold', text: 'text-gold-ink', label: 'Medium' } : { bar: 'bg-calm', text: 'text-calm', label: 'Low' }
}

/** Tiny graph: the flagged account in the middle, linked accounts around it. */
function Cluster({ r }: { r: RiskFlag }) {
  const n = r.linked.length
  return (
    <svg viewBox="0 0 160 110" className="h-28 w-full" role="img" aria-label={`${n} linked ${n === 1 ? 'account' : 'accounts'}`}>
      {r.linked.map((l, i) => {
        const a = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2
        const x = 80 + Math.cos(a) * 52
        const y = 55 + Math.sin(a) * 38
        return (
          <g key={l.handle}>
            <line x1="80" y1="55" x2={x} y2={y} className="stroke-miss/50" strokeWidth="2" strokeDasharray="4 3" />
            <circle cx={x} cy={y} r="11" fill={`oklch(88% 0.06 ${l.hue})`} />
            <text x={x} y={y + 4} textAnchor="middle" className="fill-ink text-[9px] font-bold">
              {l.handle.slice(0, 2).toUpperCase()}
            </text>
          </g>
        )
      })}
      <circle cx="80" cy="55" r="16" className="fill-ink" />
      <text x="80" y="59" textAnchor="middle" className="fill-white text-[10px] font-bold">
        {r.user.handle.slice(0, 2).toUpperCase()}
      </text>
    </svg>
  )
}

export function Risk() {
  const { risks, setRisk, loading, refresh } = useAdmin()
  const toast = useToast()
  const [tab, setTab] = useState<'Open' | 'Watching' | 'Restricted' | 'Cleared'>('Open')
  const [acting, setActing] = useState<{ r: RiskFlag; act: Act } | null>(null)
  const list = risks.filter((r) => r.status === tab).sort((a, b) => b.score - a.score)

  async function decide(r: RiskFlag, act: Act, reason: string) {
    try {
      if (act === 'restrict') {
        await api(`/admin/risk/${r.id}`, { method: 'POST', body: { status: 'restricted', reason } })
        toast({ tone: 'info', title: 'Sent for a second approval', body: `@${r.user.handle} is restricted once another admin approves.` })
      } else {
        await setRisk(r.id, act === 'clear' ? 'Cleared' : 'Watching', reason)
        toast({ title: act === 'clear' ? 'Flag cleared' : 'Moved to watching', body: `@${r.user.handle}` })
      }
      refresh()
    } catch (e) {
      toast({ tone: 'error', title: 'Couldn’t update risk case', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16">
      <PageHeader
        title="Risk and Sybil"
        intro="Accounts flagged by the risk checks: shared funding, linked accounts, identical proof and unusual activity. Look at the signals before acting."
      />
      <Tabs
        label="Risk status"
        tabs={(['Open', 'Watching', 'Restricted', 'Cleared'] as const).map((s) => ({ id: s, label: s, count: risks.filter((r) => r.status === s).length }))}
        active={tab}
        onChange={setTab}
      />
      {loading ? <div className="mt-6"><PanelSkeleton rows={5} /></div> : list.length === 0 ? (
        <div className="mt-6 rounded-3xl bg-surface px-6 py-16 text-center ring-1 ring-line/70">
          <ShieldAlert className="mx-auto text-slate" size={26} />
          <h2 className="mt-3 text-2xl font-bold">Nothing {tab.toLowerCase()}</h2>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {list.map((r) => {
            const t = scoreTone(r.score)
            return (
              <li key={r.id} className="grid gap-6 rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-6 lg:grid-cols-[1fr_12rem_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar person={r.user} size={40} />
                    <div>
                      <div className="text-lg font-semibold">@{r.user.handle}</div>
                      <div className="text-sm text-slate">
                        Flagged {timeAgo(r.raised)}. {r.value > 0 ? `${usd(r.value)} staked` : 'Nothing staked'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <div className="h-2 w-40 rounded-full bg-tile">
                      <span className={cx('block h-full rounded-full', t.bar)} style={{ width: `${r.score}%` }} />
                    </div>
                    <span className={cx('text-sm font-bold tabular', t.text)}>
                      {r.score} {t.label}
                    </span>
                  </div>
                  <ul className="mt-4 space-y-1.5 text-[15px]">
                    {r.signals.map((s) => (
                      <li key={s} className="flex items-start gap-2">
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-miss" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate">Linked accounts</div>
                  {r.linked.length ? <Cluster r={r} /> : <p className="mt-2 text-sm text-slate">None found</p>}
                </div>
                {(tab === 'Open' || tab === 'Watching') && (
                  <div className="flex flex-row gap-2 lg:flex-col lg:justify-center">
                    <Button size="sm" variant="secondary" onClick={() => setActing({ r, act: 'clear' })}>
                      Clear flag
                    </Button>
                    {tab === 'Open' && (
                      <Button size="sm" variant="secondary" onClick={() => setActing({ r, act: 'watch' })}>
                        Watch
                      </Button>
                    )}
                    <Button size="sm" variant="ink" onClick={() => setActing({ r, act: 'restrict' })}>
                      Restrict
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {acting && (
        <ReasonSheet
          title={acting.act === 'clear' ? 'Clear this flag' : acting.act === 'watch' ? 'Keep watching' : `Restrict @${acting.r.user.handle}`}
          confirm={acting.act === 'clear' ? 'Clear flag' : 'Move to watching'}
          tone={acting.act === 'restrict' ? 'danger' : 'primary'}
          fourEyes={acting.act === 'restrict'}
          presets={
            acting.act === 'clear'
              ? ['Signals explained by a shared office network', 'Verified identity, false positive']
              : acting.act === 'restrict'
                ? ['Funding cluster with linked accounts', 'Duplicate proof across accounts']
                : ['Not enough evidence yet']
          }
          effect={
            acting.act === 'restrict' ? (
              <>@{acting.r.user.handle} won’t be able to join challenges or receive payouts while restricted. Their escrowed stakes stay where they are; nothing is moved or taken.</>
            ) : acting.act === 'clear' ? (
              <>The flag is closed. @{acting.r.user.handle} isn’t told they were reviewed.</>
            ) : (
              <>The account stays fully active. New signals will reopen the flag automatically.</>
            )
          }
          onConfirm={(reason) => decide(acting.r, acting.act, reason)}
          onClose={() => setActing(null)}
        />
      )}
    </div>
  )
}
