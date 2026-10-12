import { AlertTriangle, Camera, Check, Image as ImageIcon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ReasonSheet } from '../components/ReasonSheet'
import { Avatar, Button, PageHeader } from '../components/ui'
import type { ProofReview } from '../data/admin'
import { cx } from '../lib/format'
import { timeAgo } from '../lib/time'
import { apiBlob } from '../lib/api'
import { useAdmin } from '../state/context'
import { useToast } from '../toast/context'

function ProofFile({ id, hasFile }: { id: string; hasFile: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!hasFile) return
    let objectUrl: string | null = null
    const controller = new AbortController()
    void apiBlob(`/admin/reviews/${id}/file`, { signal: controller.signal }).then((blob) => {
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(() => undefined)
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id, hasFile])
  return (
    url ? <img src={url} alt="Submitted proof" className="aspect-[4/3] w-full rounded-xl object-cover" /> :
      <div className="grid aspect-[4/3] w-full place-items-center rounded-xl bg-ground text-sm text-slate">{hasFile ? 'Loading proof…' : 'No image attached'}</div>
  )
}

export function Reviews() {
  const { reviews, resolveReview } = useAdmin()
  const toast = useToast()
  const [rejecting, setRejecting] = useState<ProofReview | null>(null)
  const [filter, setFilter] = useState<'all' | 'flagged'>('all')
  const list = filter === 'flagged' ? reviews.filter((r) => r.flags.length) : reviews

  async function approve(r: ProofReview) {
    try {
      await resolveReview(r.id, true, 'Meets the requirement')
      toast({ title: 'Proof approved', body: `${r.user.name}’s day now counts.` })
    } catch (e) {
      toast({ tone: 'error', title: 'Couldn’t approve proof', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16">
      <PageHeader
        title="Proof reviews"
        intro="Photo proof and camera sets that need a person to check them. Pending reviews never count as a miss for the user."
        actions={
          <div className="flex gap-1 rounded-xl bg-surface p-1 ring-1 ring-line" role="group" aria-label="Filter">
            {(
              [
                ['all', `All (${reviews.length})`],
                ['flagged', `Flagged (${reviews.filter((r) => r.flags.length).length})`],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                aria-pressed={filter === k}
                onClick={() => setFilter(k)}
                className={cx('h-9 rounded-lg px-4 text-sm font-semibold', filter === k ? 'bg-ink text-white' : 'text-slate hover:text-ink')}
              >
                {l}
              </button>
            ))}
          </div>
        }
      />

      {list.length === 0 ? (
        <div className="rounded-3xl bg-surface px-6 py-16 text-center ring-1 ring-line/70">
          <Check className="mx-auto text-calm" size={28} />
          <h2 className="mt-3 text-2xl font-bold">All caught up</h2>
          <p className="mt-1 text-slate">New photo and camera proof will appear here.</p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {list.map((r) => (
            <li key={r.id} className={cx('flex flex-col rounded-3xl bg-surface p-5 ring-1', r.flags.length ? 'ring-miss/40' : 'ring-line/70')}>
              <div className="flex items-center gap-3">
                <Avatar person={r.user} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{r.user.name}</div>
                  <div className="truncate text-sm text-slate">{r.challenge}</div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-ground px-2.5 py-1 text-xs font-semibold">
                  {r.kind === 'photo' ? <ImageIcon size={13} /> : <Camera size={13} />}
                  {r.kind === 'photo' ? 'Photo' : `${r.reps} reps`}
                </span>
              </div>

              <div className="mt-4">{r.kind === 'photo' ? <ProofFile id={r.id} hasFile={r.hasFile} /> : <div className="grid aspect-[4/3] place-items-center rounded-xl bg-ground text-sm text-slate">{r.reps ?? 0} reps recorded</div>}</div>

              {r.note && <p className="mt-3 text-[15px]">“{r.note}”</p>}
              <p className="mt-1 text-sm text-slate">Submitted {timeAgo(r.submitted)}</p>

              {r.flags.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {r.flags.map((f) => (
                    <li key={f} className="flex items-start gap-2 rounded-xl bg-miss-soft px-3 py-2 text-sm text-[oklch(45%_0.17_23)]">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-auto flex gap-2 pt-5">
                <Button className="flex-1" variant={r.flags.length ? 'secondary' : 'primary'} onClick={() => void approve(r)}>
                  <Check size={16} strokeWidth={3} /> Approve
                </Button>
                <Button className="flex-1" variant={r.flags.length ? 'primary' : 'secondary'} onClick={() => setRejecting(r)}>
                  <X size={16} strokeWidth={3} /> Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {rejecting && (
        <ReasonSheet
          title="Reject this proof"
          confirm="Reject"
          tone="danger"
          presets={['Photo isn’t from today', 'Duplicate of another submission', 'Doesn’t show the requirement', 'Reps don’t match the snapshots']}
          effect={
            <>
              {rejecting.user.name}’s day will be marked missed and they’ll see your reason. They can dispute it within 48 hours.
            </>
          }
          onConfirm={(reason) => {
            void resolveReview(rejecting.id, false, reason).then(() => toast({ title: 'Proof rejected', body: `${rejecting.user.name} has been told why and can dispute it.` })).catch((e) => toast({ tone: 'error', title: 'Couldn’t reject proof', body: e instanceof Error ? e.message : 'Try again.' }))
          }}
          onClose={() => setRejecting(null)}
        />
      )}
    </div>
  )
}
