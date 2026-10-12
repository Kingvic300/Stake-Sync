import { Check, Flag } from 'lucide-react'
import { useState } from 'react'
import { ReasonSheet } from '../components/ReasonSheet'
import { Avatar, Button, PageHeader, Tag } from '../components/ui'
import { timeAgo } from '../lib/time'
import { useAdmin } from '../state/context'
import { useToast } from '../toast/context'

type Act = 'Removed message' | 'Warned user' | 'Dismissed report'

export function Reports() {
  const { reports, resolveReport, loading } = useAdmin()
  const toast = useToast()
  const [acting, setActing] = useState<{ id: string; act: Act } | null>(null)
  const list = reports
  const current = acting && reports.find((r) => r.id === acting.id)

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16">
      <PageHeader title="Reports" intro="Chat messages reported by members across all challenges. Organization moderators handle their own; these are platform-wide." />
      {loading ? <div className="rounded-3xl bg-surface px-6 py-16 text-center ring-1 ring-line/70">Loading reports…</div> : list.length === 0 ? (
        <div className="rounded-3xl bg-surface px-6 py-16 text-center ring-1 ring-line/70">
          <Check className="mx-auto text-calm" size={28} />
          <h2 className="mt-3 text-2xl font-bold">No open reports</h2>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((r) => (
            <li key={r.id} className="rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                <Avatar person={r.author} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">@{r.author.handle}</div>
                  <div className="text-sm text-slate">
                    In {r.challenge}, {timeAgo(r.at)}
                  </div>
                </div>
                <Tag tone="gold">
                  <Flag size={12} /> {r.reason}
                </Tag>
                <span className="text-sm text-slate">
                  {r.reporters} {r.reporters === 1 ? 'report' : 'reports'}
                </span>
              </div>
              <blockquote className="mt-4 rounded-2xl bg-ground px-4 py-3 text-[16px]">“{r.body}”</blockquote>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="ink" onClick={() => setActing({ id: r.id, act: 'Removed message' })}>
                  Remove message
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setActing({ id: r.id, act: 'Warned user' })}>
                  Warn @{r.author.handle}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setActing({ id: r.id, act: 'Dismissed report' })}>
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {acting && current && (
        <ReasonSheet
          title={acting.act === 'Removed message' ? 'Remove this message' : acting.act === 'Warned user' ? `Warn @${current.author.handle}` : 'Dismiss this report'}
          confirm={acting.act === 'Removed message' ? 'Remove message' : acting.act === 'Warned user' ? 'Send warning' : 'Dismiss'}
          tone={acting.act === 'Removed message' ? 'danger' : 'primary'}
          presets={
            acting.act === 'Dismissed report'
              ? ['Fair feedback, not abuse', 'Not against community rules']
              : ['Spam or scam', 'Encourages cheating', 'Harassment']
          }
          effect={
            acting.act === 'Removed message'
              ? 'The message disappears from the chat for everyone. The author is told which rule it broke.'
              : acting.act === 'Warned user'
                ? 'The message stays. The author gets a private warning with your reason.'
                : 'The message stays and the reporters are told it was reviewed.'
          }
          onConfirm={(reason) => {
            void resolveReport(acting.id, acting.act, reason).then(() => toast({ title: acting.act })).catch((e) => toast({ tone: 'error', title: 'Couldn’t resolve report', body: e instanceof Error ? e.message : 'Try again.' }))
          }}
          onClose={() => setActing(null)}
        />
      )}
    </div>
  )
}
