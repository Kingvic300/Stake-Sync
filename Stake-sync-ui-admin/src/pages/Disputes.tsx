import { Check, Clock, FileText, Keyboard, Link2, Lock, MessageSquare, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ReasonSheet } from '../components/ReasonSheet'
import { PanelSkeleton } from '../components/Skeleton'
import { Tabs } from '../components/Tabs'
import { Avatar, Button, PageHeader, ProviderMark } from '../components/ui'
import type { AdminDispute, DisputeStatus } from '../data/admin'
import { cx, usd } from '../lib/format'
import { gsap, prefersMotion, useGSAP } from '../lib/gsap'
import { isOverdue, stamp, untilLabel } from '../lib/time'
import { useAdmin } from '../state/context'
import { useToast } from '../toast/context'

type Filter = 'open' | 'waiting' | 'decided'
type Action = 'approve' | 'fail' | 'evidence'

const FOUR_EYES_OVER = 50

const statusTone: Record<DisputeStatus, string> = {
  New: 'bg-cobalt-soft text-cobalt-deep',
  'In review': 'bg-gold-soft text-gold-ink',
  'Waiting on user': 'bg-tile text-slate',
  Approved: 'bg-calm-soft text-calm',
  'Failure confirmed': 'bg-miss-soft text-[oklch(45%_0.17_23)]',
}

export function Disputes() {
  const { disputes, setDispute, loading } = useAdmin()
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>('open')
  const [selected, setSelected] = useState<string | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const detail = useRef<HTMLDivElement>(null)

  const groups: Record<Filter, AdminDispute[]> = {
    open: disputes.filter((d) => d.status === 'New' || d.status === 'In review'),
    waiting: disputes.filter((d) => d.status === 'Waiting on user'),
    decided: disputes.filter((d) => d.status === 'Approved' || d.status === 'Failure confirmed'),
  }
  const list = [...groups[filter]].sort((a, b) => (a.priority === b.priority ? a.due.localeCompare(b.due) : a.priority === 'High' ? -1 : 1))
  const current = list.find((d) => d.id === selected) ?? list[0]
  const decided = current && (current.status === 'Approved' || current.status === 'Failure confirmed')

  useGSAP(
    () => {
      if (!prefersMotion() || !current) return
      gsap.from('[data-case] > *', { y: 8, autoAlpha: 0, duration: 0.3, stagger: 0.04, ease: 'power2.out', clearProps: 'all' })
    },
    { scope: detail, dependencies: [current?.id] },
  )

  // Queue shortcuts: J/K move, A approve, F confirm failure, E request evidence.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (action || t.closest('input, textarea, select, [role="dialog"]') || e.metaKey || e.ctrlKey) return
      const i = list.findIndex((d) => d.id === current?.id)
      if (e.key === 'j') setSelected(list[Math.min(i + 1, list.length - 1)]?.id ?? null)
      if (e.key === 'k') setSelected(list[Math.max(i - 1, 0)]?.id ?? null)
      if (!current || decided) return
      if (e.key === 'a') setAction('approve')
      if (e.key === 'f') setAction('fail')
      if (e.key === 'e') setAction('evidence')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [list, current, decided, action])

  async function decide(a: Action, reason: string) {
    if (!current) return
    try {
      if (a === 'approve') {
        await setDispute(current.id, 'Approved', reason)
        toast({ title: 'Completion approved', body: `Day ${current.day} counts for ${current.user.name}. ${usd(current.locked)} released back to their stake.` })
      } else if (a === 'fail') {
        await setDispute(current.id, 'Failure confirmed', reason)
        if (current.locked > FOUR_EYES_OVER) {
        toast({ tone: 'info', title: 'Sent for a second approval', body: 'The failure takes effect once another admin approves it.' })
        } else {
        toast({ title: 'Failure confirmed', body: `${current.user.name} has been told why. The challenge rules now apply.` })
        }
      } else {
        await setDispute(current.id, 'Waiting on user', reason)
        toast({ title: 'Evidence requested', body: `${current.user.name} has been notified. The SLA pauses until they reply.` })
      }
    } catch (e) {
      toast({ tone: 'error', title: 'Couldn’t update dispute', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16">
      <PageHeader
        title="Disputes"
        intro="Users contesting a verification result. Money affected stays locked until you decide. Aim to decide within 24 hours."
        actions={
          <span className="hidden items-center gap-2 text-sm text-slate md:inline-flex">
            <Keyboard size={16} /> J / K to move, A approve, F fail, E evidence
          </span>
        }
      />
      <Tabs
        label="Dispute queues"
        tabs={[
          { id: 'open', label: 'To decide', count: groups.open.length },
          { id: 'waiting', label: 'Waiting on user', count: groups.waiting.length },
          { id: 'decided', label: 'Decided', count: groups.decided.length },
        ]}
        active={filter}
        onChange={(f) => {
          setFilter(f)
          setSelected(null)
        }}
      />

      {loading ? <div className="mt-6"><PanelSkeleton rows={6} /></div> : list.length === 0 ? (
        <div className="mt-6 rounded-3xl bg-surface px-6 py-16 text-center ring-1 ring-line/70">
          <Check className="mx-auto text-calm" size={28} />
          <h2 className="mt-3 text-2xl font-bold">Nothing here</h2>
          <p className="mt-1 text-slate">{filter === 'open' ? 'Every dispute has been decided or is waiting on the user.' : 'No disputes in this list.'}</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[22rem_1fr]">
          <ul className="space-y-2 lg:sticky lg:top-24 lg:self-start" aria-label="Disputes">
            {list.map((d) => {
              const on = d.id === current?.id
              const late = isOverdue(d.due) && filter === 'open'
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    aria-current={on}
                    onClick={() => setSelected(d.id)}
                    className={cx(
                      'w-full rounded-2xl p-4 text-left ring-1 ring-inset transition-[background-color,box-shadow]',
                      on ? 'bg-surface shadow-(--shadow-lift) ring-cobalt' : 'bg-surface/60 ring-line hover:bg-surface',
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Avatar person={d.user} size={28} />
                      <span className="min-w-0 flex-1 truncate font-semibold">{d.user.name}</span>
                      {d.priority === 'High' && <span className="rounded-md bg-miss-soft px-1.5 py-0.5 text-xs font-bold text-miss">High</span>}
                    </div>
                    <div className="mt-2 truncate text-sm text-slate">
                      {d.challenge}, day {d.day}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className={cx('inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold', statusTone[d.status])}>{d.status}</span>
                      {filter !== 'decided' && (
                        <span className={cx('inline-flex items-center gap-1 text-xs font-semibold tabular', late ? 'text-miss' : 'text-slate')}>
                          <Clock size={13} /> {untilLabel(d.due)}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>

          {current && (
            <div ref={detail}>
              <article data-case className="space-y-5 rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-7">
                <header className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Avatar person={current.user} size={44} />
                    <div>
                      <h2 className="text-2xl font-bold">
                        {current.challenge}, day {current.day}
                      </h2>
                      <p className="flex items-center gap-1.5 text-sm text-slate">
                        <ProviderMark provider={current.provider} size={14} /> {current.provider}. @{current.user.handle} opened {stamp(current.opened)}. {current.id.toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <span className={cx('inline-flex h-8 items-center rounded-full px-3.5 text-sm font-semibold', statusTone[current.status])}>{current.status}</span>
                </header>

                {current.locked > 0 && (
                  <div className="flex items-start gap-3 rounded-2xl bg-ground p-4 text-[15px]">
                    <Lock size={18} className="mt-0.5 shrink-0 text-slate" />
                    <span>
                      <span className="font-semibold">{usd(current.locked)} is locked in escrow</span> until this is decided. You record the decision; the program releases or
                      applies it. You can’t move the money yourself.
                    </span>
                  </div>
                )}

                <section>
                  <h3 className="font-sans text-sm font-semibold text-slate">What the user says</h3>
                  <p className="mt-1.5 flex gap-2 text-[16px]">
                    <MessageSquare size={18} className="mt-1 shrink-0 text-slate" />“{current.reason}”
                  </p>
                </section>

                <section>
                  <h3 className="font-sans text-sm font-semibold text-slate">Evidence from the user</h3>
                  <ul className="mt-2 space-y-2">
                    {current.evidence.map((e) => (
                      <li key={e} className="flex items-center gap-2.5 rounded-xl bg-ground px-3.5 py-2.5 text-[15px]">
                        {e.startsWith('http') ? <Link2 size={16} className="shrink-0 text-cobalt" /> : <FileText size={16} className="shrink-0 text-slate" />}
                        <span className="truncate">{e}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section>
                  <h3 className="font-sans text-sm font-semibold text-slate">Verification data</h3>
                  <ol className="mt-3 space-y-0 overflow-hidden rounded-2xl ring-1 ring-line">
                    {current.events.map((e, i) => (
                      <li key={i} className="grid gap-1 border-b border-line bg-surface px-4 py-3 text-[15px] last:border-0 sm:grid-cols-[9.5rem_8rem_1fr] sm:gap-4">
                        <span className="text-sm text-slate tabular">{stamp(e.at)}</span>
                        <span className="text-sm font-semibold">{e.source}</span>
                        <span>{e.text}</span>
                      </li>
                    ))}
                  </ol>
                </section>

                {!decided && (
                  <div className="flex flex-wrap gap-2 border-t border-line pt-5">
                    <Button onClick={() => setAction('approve')}>
                      <Check size={17} strokeWidth={3} /> Approve completion
                    </Button>
                    <Button variant="secondary" onClick={() => setAction('evidence')}>
                      Request evidence
                    </Button>
                    <Button variant="secondary" className="text-[oklch(52%_0.19_23)]" onClick={() => setAction('fail')}>
                      <X size={17} strokeWidth={3} /> Confirm failure
                    </Button>
                  </div>
                )}
              </article>
            </div>
          )}
        </div>
      )}

      {action && current && (
        <ReasonSheet
          title={action === 'approve' ? 'Approve completion' : action === 'fail' ? 'Confirm failure' : 'Request more evidence'}
          confirm={action === 'approve' ? 'Approve' : action === 'fail' ? 'Confirm failure' : 'Send request'}
          tone={action === 'fail' ? 'danger' : 'primary'}
          fourEyes={action === 'fail' && current.locked > FOUR_EYES_OVER}
          presets={
            action === 'approve'
              ? ['Activity verified in provider data', 'Late sync, activity inside the window', 'Provider error, not the user']
              : action === 'fail'
                ? ['No qualifying activity found', 'Activity outside the window', 'Evidence doesn’t match the account']
                : ['Please share links to the submissions', 'Please share a screenshot with timestamps']
          }
          effect={
            action === 'approve' ? (
              <>Day {current.day} will count as verified for {current.user.name}. The {usd(current.locked)} on hold returns to their stake.</>
            ) : action === 'fail' ? (
              <>Day {current.day} stays missed for {current.user.name}. Their strikes and the challenge’s penalty rules then apply. They’ll see your reason.</>
            ) : (
              <>{current.user.name} will be asked for more evidence. The money stays locked and the SLA pauses until they reply.</>
            )
          }
          onConfirm={(r) => decide(action, r)}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  )
}
