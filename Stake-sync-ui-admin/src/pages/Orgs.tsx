import { useState } from 'react'
import { ReasonSheet } from '../components/ReasonSheet'
import { PanelSkeleton } from '../components/Skeleton'
import { Avatar, Button, PageHeader, Tag } from '../components/ui'
import type { AdminOrg } from '../data/admin'
import { api } from '../lib/api'
import { usd } from '../lib/format'
import { timeAgo } from '../lib/time'
import { useAdminApi } from '../lib/useAdminApi'
import { useToast } from '../toast/context'

type Org = AdminOrg

export function Orgs() {
  const toast = useToast()
  const { data: orgs, loading, refresh } = useAdminApi<Org[]>('/admin/orgs')
  const [acting, setActing] = useState<{ o: Org; approve: boolean } | null>(null)
  const pending = (orgs ?? []).filter((o) => o.verification === 'Pending')
  const rest = (orgs ?? []).filter((o) => o.verification !== 'Pending')

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16">
      <PageHeader title="Organizations" intro="Communities, universities, companies and brands. New organizations need approval before they can sponsor rewards." />

      {pending.length > 0 && (
        <section>
          <h2 className="text-xl font-bold">Waiting for approval</h2>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {pending.map((o) => (
              <li key={o.slug} className="rounded-3xl bg-surface p-5 ring-1 ring-gold/40">
                <div className="flex items-center gap-3">
                  <Avatar person={{ name: o.name, handle: o.slug, hue: o.hue }} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{o.name}</div>
                    <div className="text-sm text-slate">
                      {o.kind}, applied {timeAgo(o.applied)}. Wants the {o.plan} plan
                    </div>
                  </div>
                </div>
                <p className="mt-4 text-sm text-slate">Application status: pending review.</p>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" onClick={() => setActing({ o, approve: true })}>
                    Approve
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setActing({ o, approve: false })}>
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 overflow-x-auto rounded-3xl bg-surface ring-1 ring-line/70">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-line text-left text-sm text-slate">
              <th className="px-5 py-3 font-normal">Organization</th>
              <th className="hidden py-3 font-normal lg:table-cell">Plan</th>
              <th className="py-3 text-right font-normal">Members</th>
              <th className="hidden py-3 text-right font-normal xl:table-cell">Challenges</th>
              <th className="py-3 text-right font-normal">Sponsored</th>
              <th className="px-5 py-3 font-normal">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading ? <tr><td colSpan={6} className="px-5 py-4"><PanelSkeleton rows={4} /></td></tr> : rest.map((o) => (
              <tr key={o.slug}>
                <td className="px-5 py-3">
                  <span className="flex items-center gap-3">
                    <Avatar person={{ name: o.name, handle: o.slug, hue: o.hue }} size={32} />
                    <span>
                      <span className="block font-semibold">{o.name}</span>
                      <span className="block text-sm text-slate">{o.kind}</span>
                    </span>
                  </span>
                </td>
                <td className="hidden py-3 lg:table-cell">{o.plan}</td>
                <td className="py-3 text-right tabular">{o.members.toLocaleString('en-US')}</td>
                <td className="hidden py-3 text-right tabular xl:table-cell">{o.challenges}</td>
                <td className="py-3 text-right tabular">{o.sponsored ? usd(o.sponsored) : '–'}</td>
                <td className="px-5 py-3">
                  <Tag tone={o.verification === 'Verified' ? 'cobalt' : 'plain'}>{o.verification}</Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {acting && (
        <ReasonSheet
          title={acting.approve ? `Approve ${acting.o.name}` : `Reject ${acting.o.name}`}
          confirm={acting.approve ? 'Approve' : 'Reject'}
          tone={acting.approve ? 'primary' : 'danger'}
          presets={acting.approve ? ['Business documents verified', 'Known community partner'] : ['Documents don’t match', 'Couldn’t verify the organization']}
          effect={
            acting.approve
              ? `${acting.o.name} can create challenges, invite members and sponsor rewards.`
              : `${acting.o.name} is told why and can reapply with new documents.`
          }
          onConfirm={(reason) => {
            void api(`/admin/orgs/${acting.o.slug}/decision`, { method: 'POST', body: { approve: acting.approve, reason } }).then(() => {
              refresh()
              toast({ title: acting.approve ? 'Organization approved' : 'Application rejected', body: acting.o.name })
            }).catch((e) => toast({ tone: 'error', title: 'Couldn’t update organization', body: e instanceof Error ? e.message : 'Try again.' }))
          }}
          onClose={() => setActing(null)}
        />
      )}
    </div>
  )
}
