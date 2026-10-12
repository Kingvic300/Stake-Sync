import { KeyRound } from 'lucide-react'
import { useAdminAuth } from '../auth/context'
import { Button, PageHeader } from '../components/ui'
import { timeAgo } from '../lib/time'
import { useAdmin } from '../state/context'
import { useToast } from '../toast/context'

/** Four-eyes rule: high-impact actions need a second admin, never the person who asked. */
export function Approvals() {
  const { approvals, decideApproval, loading } = useAdmin()
  const { session } = useAdminAuth()
  const toast = useToast()

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16">
      <PageHeader
        title="Approvals"
        intro="High-impact actions wait here for a second admin: restricting accounts, confirming large failures and changing penalty rules. You can’t approve your own request."
      />
      {loading ? <div className="rounded-3xl bg-surface px-6 py-16 text-center ring-1 ring-line/70">Loading approvals…</div> : approvals.length === 0 ? (
        <div className="rounded-3xl bg-surface px-6 py-16 text-center ring-1 ring-line/70">
          <KeyRound className="mx-auto text-slate" size={26} />
          <h2 className="mt-3 text-2xl font-bold">Nothing waiting</h2>
          <p className="mt-1 text-slate">Requests from other admins will appear here.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {approvals.map((a) => {
            const mine = a.requestedById === session?.id
            return (
              <li key={a.id} className="flex flex-col gap-4 rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:flex-row sm:items-center sm:p-6">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gold-soft text-gold-ink">
                  <KeyRound size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold">
                    {a.action}: {a.target}
                  </div>
                  <p className="text-[15px] text-slate">“{a.reason}”</p>
                  <p className="mt-1 text-sm text-slate">
                    Requested by {mine ? 'you' : a.requestedBy}, {timeAgo(a.at)}
                  </p>
                </div>
                {mine ? (
                  <span className="text-sm font-semibold text-slate">Waiting for another admin</span>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        void decideApproval(a.id, false).then(() => toast({ tone: 'info', title: 'Request declined', body: `${a.requestedBy} has been told.` })).catch((e) => toast({ tone: 'error', title: 'Couldn’t decline request', body: e instanceof Error ? e.message : 'Try again.' }))
                      }}
                    >
                      Decline
                    </Button>
                    <Button
                      onClick={() => {
                        void decideApproval(a.id, true).then(() => toast({ title: 'Approved', body: `${a.action} for ${a.target} is now in effect.` })).catch((e) => toast({ tone: 'error', title: 'Couldn’t approve request', body: e instanceof Error ? e.message : 'Try again.' }))
                      }}
                    >
                      Approve
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
