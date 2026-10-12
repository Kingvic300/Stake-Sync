import { AlertTriangle, Lock } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { ReasonSheet } from '../components/ReasonSheet'
import { PanelSkeleton } from '../components/Skeleton'
import { Sheet } from '../components/Sheet'
import { Button, PageHeader, ProviderMark, Tag } from '../components/ui'
import type { AdminChallenge } from '../data/admin'
import { cx, usd } from '../lib/format'
import { api } from '../lib/api'
import { useAdminApi } from '../lib/useAdminApi'
import { useToast } from '../toast/context'

type Filter = 'all' | 'live' | 'flagged' | 'settling'
type Act = 'pause' | 'cancel'

export function Challenges() {
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<Filter>('all')
  const [acting, setActing] = useState<Act | null>(null)
  const { data: challenges, loading, refresh } = useAdminApi<AdminChallenge[]>('/admin/challenges')
  const toast = useToast()
  const allChallenges = challenges ?? []
  const open = allChallenges.find((c) => c.id === params.get('c'))

  const list = allChallenges.filter((c) =>
    filter === 'live' ? c.status === 'Live' || c.status === 'Open' : filter === 'flagged' ? !!c.flagged : filter === 'settling' ? c.status === 'Settling' : true,
  )

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16">
      <PageHeader title="Challenges" intro="Every challenge on the platform. Rules are locked once people join, so admins can pause joining or unlist, never edit." />
      <div className="flex flex-wrap gap-1">
        {(
          [
            ['all', 'All'],
            ['live', 'Open or live'],
            ['flagged', `Flagged (${allChallenges.filter((c) => c.flagged).length})`],
            ['settling', 'Settling'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
            className={cx('h-9 rounded-full px-4 text-sm font-semibold ring-1 ring-inset', filter === k ? 'bg-ink text-white ring-ink' : 'bg-surface ring-line hover:ring-slate/40')}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="mt-5 overflow-x-auto rounded-3xl bg-surface ring-1 ring-line/70">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-line text-left text-sm text-slate">
              <th className="px-5 py-3 font-normal">Challenge</th>
              <th className="py-3 font-normal">Status</th>
              <th className="py-3 text-right font-normal">People</th>
              <th className="hidden py-3 text-right font-normal md:table-cell">In escrow</th>
              <th className="hidden py-3 text-right font-normal lg:table-cell">Sponsor pool</th>
              <th className="hidden py-3 text-right font-normal xl:table-cell">Auto-verified</th>
              <th className="px-5 py-3 text-right font-normal">Disputes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading ? <tr><td colSpan={7} className="px-5 py-4"><PanelSkeleton rows={5} /></td></tr> : list.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-ground/60" onClick={() => setParams({ c: c.id })}>
                <td className="px-5 py-3">
                  <button type="button" className="text-left" onClick={() => setParams({ c: c.id })}>
                    <span className="flex items-center gap-2 font-semibold">
                      {c.title}
                      {c.flagged && <AlertTriangle size={15} className="text-gold-ink" aria-label="Flagged" />}
                    </span>
                    <span className="flex items-center gap-1.5 text-sm text-slate">
                      {c.providers.map((p) => (
                        <ProviderMark key={p} provider={p} size={12} />
                      ))}
                      {c.host}
                    </span>
                  </button>
                </td>
                <td className="py-3">
                  <Tag tone={c.status === 'Paused' ? 'gold' : c.status === 'Live' ? 'cobalt' : 'plain'}>{c.status === 'Paused' ? 'Joining paused' : c.status}</Tag>
                </td>
                <td className="py-3 text-right tabular">{c.participants.toLocaleString('en-US')}</td>
                <td className="hidden py-3 text-right tabular md:table-cell">{usd(c.escrow)}</td>
                <td className="hidden py-3 text-right text-gold-ink tabular lg:table-cell">{c.sponsor ? usd(c.sponsor) : '–'}</td>
                <td className="hidden py-3 text-right tabular xl:table-cell">{c.verifyRate}%</td>
                <td className="px-5 py-3 text-right tabular">{c.disputes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && !acting && <ChallengeSheet c={open} paused={open.status === 'Paused'} canCancel={open.status === 'Open' || open.status === 'Paused'} onClose={() => setParams({})} onAct={setActing} />}
      {open && acting && (
        <ReasonSheet
          title={acting === 'pause' ? (open.status === 'Paused' ? 'Resume new joins' : 'Pause new joins') : 'Cancel challenge'}
          confirm={acting === 'pause' ? (open.status === 'Paused' ? 'Resume joining' : 'Pause joining') : 'Cancel challenge'}
          presets={['Under risk review', 'Misleading description', 'Host asked us to']}
          effect={
            acting === 'pause'
              ? 'Nobody new can join. Everyone already in continues under the same rules, and their stakes are untouched.'
              : 'The challenge is cancelled before it starts. Participants are notified and stakes are returned under the challenge rules.'
          }
          onConfirm={(reason) => {
            const path = acting === 'pause' && open.status === 'Paused' ? `/admin/challenges/${open.id}/pause` : acting === 'pause' ? `/admin/challenges/${open.id}/pause` : `/admin/challenges/${open.id}/cancel`
            const method = acting === 'pause' && open.status === 'Paused' ? 'DELETE' : 'POST'
            void api(path, { method, ...(method === 'POST' ? { body: { reason } } : {}) }).then(() => {
              refresh()
              toast({ title: acting === 'pause' ? (open.status === 'Paused' ? 'Joining resumed' : 'Joining paused') : 'Challenge cancelled', body: open.title })
            }).catch((e) => toast({ tone: 'error', title: 'Couldn’t update challenge', body: e instanceof Error ? e.message : 'Try again.' }))
          }}
          onClose={() => setActing(null)}
        />
      )}
    </div>
  )
}

function ChallengeSheet({ c, paused, canCancel, onClose, onAct }: { c: AdminChallenge; paused: boolean; canCancel: boolean; onClose: () => void; onAct: (a: Act) => void }) {
  return (
    <Sheet title={c.title} onClose={onClose} width={560}>
      <p className="text-slate">Hosted by {c.host}</p>
      {c.flagged && (
        <p className="mt-4 flex items-start gap-2.5 rounded-2xl bg-gold-soft p-4 text-[15px] text-gold-ink">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" /> {c.flagged}
        </p>
      )}
      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line ring-1 ring-line">
        {[
          ['Participants', c.participants.toLocaleString('en-US')],
          ['In escrow', usd(c.escrow)],
          ['Sponsor pool', c.sponsor ? usd(c.sponsor) : 'None'],
          ['Auto-verified', `${c.verifyRate}%`],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface p-4">
            <dt className="text-sm text-slate">{k}</dt>
            <dd className="font-display text-xl font-semibold tabular">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-ground px-4 py-3">
        <span className="flex items-center gap-2 text-[15px]">
          <Lock size={16} className="text-slate" /> Escrow account
        </span>
        <span className="font-display font-semibold tabular">{c.address}</span>
      </div>
      <p className="mt-3 text-sm text-slate">The rules and the money are controlled by the program. Admin tools can’t edit either.</p>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" onClick={() => onAct('pause')}>
          {paused ? 'Resume new joins' : 'Pause new joins'}
        </Button>
        <Button variant="secondary" disabled={!canCancel} onClick={() => onAct('cancel')}>
          Cancel challenge
        </Button>
      </div>
    </Sheet>
  )
}
