import { CalendarPlus, Check, ChevronDown, Hourglass, Plus, Share2, Snowflake, Trophy } from 'lucide-react'
import { ShareSheet } from '../../components/ShareSheet'
import { lazy, Suspense, useRef, useState } from 'react'
import { Link } from 'react-router'
import { DayGrid, GridLegend, Strikes } from '../../components/DayGrid'
import { CalendarReminderSheet } from '../../components/CalendarReminder'
import { Sheet } from '../../components/Sheet'
import { Tabs } from '../../components/Tabs'
import { Button, PageHeader, ProofChip, ProviderMark } from '../../components/ui'
import { useMine, type PastItem } from '../../data/useMine'
import { RetryPanel } from '../../components/RetryPanel'
import { PanelSkeleton } from '../../components/Skeleton'
import type { Challenge, Participation } from '../../data/types'
import { cx, shortDate, usd } from '../../lib/format'
import { gsap, useMotion } from '../../lib/gsap'
import { color } from '../../lib/tokens'
import { useCountdown } from '../../lib/useCountdown'
import { useAuth } from '../../auth/context'
import { api, ApiError } from '../../lib/api'
import { useToast } from '../../toast/context'
import { signAndSubmit, type SignBytes } from '../../wallet/sendUsdc'

const SignButton = lazy(() => import('../../wallet/SignButton'))

type Tab = 'active' | 'completed'

export function MyChallenges() {
  const [tab, setTab] = useState<Tab>('active')
  const { mine, error, refresh } = useMine()
  const active = mine?.active ?? []
  const finished = mine?.finished ?? []
  const root = useRef<HTMLDivElement>(null)

  useMotion(
    () => {
      if (tab !== 'active') return
      gsap.fromTo(
        '.day-tile[data-state="verified"], .day-tile[data-state="failed"], .day-tile[data-state="disputed"]',
        { backgroundColor: color.tile },
        {
          backgroundColor: (_: number, el: HTMLElement) =>
            el.dataset.state === 'failed' ? color.miss : el.dataset.state === 'disputed' ? color.gold : color.cobalt,
          duration: 0.3,
          stagger: 0.012,
          ease: 'power1.out',
          clearProps: 'backgroundColor',
        },
      )
    },
    root,
    [tab],
  )

  return (
    <div ref={root} className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16 sm:py-10">
      <PageHeader
        title="My challenges"
        intro="Your progress, strikes and stake for everything you’ve joined."
        actions={
          <>
            <Button to="/explore" variant="secondary">
              Join a challenge
            </Button>
            <Button to="/create">
              <Plus size={18} /> Create a challenge
            </Button>
          </>
        }
      />
      <Tabs
        label="Challenges"
        tabs={[
          { id: 'active', label: 'Active', count: mine ? active.length : undefined },
          { id: 'completed', label: 'Finished', count: mine ? finished.length : undefined },
        ]}
        active={tab}
        onChange={setTab}
      />
      {!mine ? (
        error ? <RetryPanel className="mt-6" onRetry={refresh} /> : <PanelSkeleton className="mt-6" rows={4} />
      ) : tab === 'active' ? (
        active.length ? (
          <div className="mt-6 space-y-5">
            {active.map(({ c, p }) => (
              <ChallengeProgress key={c.id} p={p} c={c} onChanged={refresh} />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-3xl bg-surface px-6 py-14 text-center ring-1 ring-line/70">
            <h2 className="text-2xl font-bold">You’re not in a challenge yet</h2>
            <p className="mx-auto mt-2 max-w-md text-slate">Find one that fits, or start your own.</p>
            <div className="mt-6 flex justify-center gap-2">
              <Button to="/explore">Explore challenges</Button>
              <Button to="/create" variant="secondary">
                Create one
              </Button>
            </div>
          </div>
        )
      ) : (
        <Finished items={finished} />
      )}
    </div>
  )
}

function ChallengeProgress({ p, c, onChanged }: { p: Participation; c: Challenge; onChanged?: () => void }) {
  const [freeze, setFreeze] = useState(false)
  const [frozen, setFrozen] = useState(p.freezeUsed)
  const toast = useToast()
  const [history, setHistory] = useState(false)
  const [remind, setRemind] = useState(false)
  const [sharing, setSharing] = useState(false)
  const inviteCode = (c as { inviteCode?: string }).inviteCode
  const left = useCountdown(p.nextDeadline)
  const count = c.mode === 'count'
  const verified = p.days.filter((d) => d.state === 'verified').length
  const missed = p.days.filter((d) => d.state === 'failed').length
  const strikesLeft = c.freeStrikes - p.strikesUsed
  const todayState = p.days[p.today - 1]?.state
  // Before day 1 there's no deadline or rank yet.
  const notStarted = p.today < 1 || !p.nextDeadline
  const pct = count ? (p.count ?? 0) / (c.targetCount ?? 1) : 0

  return (
    <article className="overflow-hidden rounded-3xl bg-surface ring-1 ring-line/70">
      <header className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-7">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-slate">
            {c.providers.map((pr) => (
              <ProviderMark key={pr} provider={pr} size={14} />
            ))}
            {c.org?.name ?? c.category}
          </div>
          <Link to={`/c/${c.id}`} className="mt-1 block text-2xl font-bold hover:text-cobalt sm:text-3xl">
            {c.title}
          </Link>
        </div>
        <div className="text-right">
          <div className="font-display text-3xl font-bold tabular">
            {count ? (
              <>
                {p.count}
                <span className="text-slate/60"> / {c.targetCount}</span>
              </>
            ) : (
              <>
                {notStarted ? `Starts ${shortDate(c.startsAt)}` : <>Day {p.today}</>}
                <span className="text-slate/60"> / {c.durationDays}</span>
              </>
            )}
          </div>
          <div className="text-sm text-slate">{count ? c.countUnit : `${c.requiredDays} days needed`}</div>
        </div>
      </header>

      <div className="grid gap-6 border-t border-line p-5 sm:p-7 lg:grid-cols-[1.4fr_1fr]">
        <div>
          {count ? (
            <div>
              <div className="h-4 overflow-hidden rounded-full bg-tile">
                <span className="block h-full rounded-full bg-cobalt" style={{ width: `${pct * 100}%` }} />
              </div>
              <p className="mt-3 text-[15px] text-slate">
                {(c.targetCount ?? 0) - (p.count ?? 0)} {c.countUnit} to go. {c.requirement}.
              </p>
              <DayGrid days={p.days} today={p.today} size="sm" className="mt-6" columns={15} />
            </div>
          ) : (
            <DayGrid days={p.days} today={p.today} size="md" />
          )}
          <div className="mt-4">
            <GridLegend states={['verified', 'failed', 'pending', 'disputed', 'upcoming']} />
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div
            className={cx(
              'flex items-center gap-3 rounded-2xl p-4',
              todayState === 'verified' ? 'bg-cobalt-soft' : left.urgent ? 'bg-gold-soft' : 'bg-ground',
            )}
          >
            {todayState === 'verified' ? (
              <Check size={20} strokeWidth={3} className="text-cobalt-deep" />
            ) : (
              <Hourglass size={20} className={left.urgent ? 'text-gold-ink' : 'text-slate'} />
            )}
            <div className="min-w-0">
              <div className="font-semibold">
                {notStarted ? `Starts ${shortDate(c.startsAt)}. Nothing is due yet.` : todayState === 'verified' ? 'Today is verified' : count ? `Due in ${left.label.replace(' left', '')}` : `Today: ${left.label}`}
              </div>
              <div className="truncate text-sm text-slate">{p.history[0]?.detail}</div>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
            {!count && (
              <>
                <Stat label="Verified" value={String(verified)} />
                <Stat label="Missed" value={String(missed)} />
              </>
            )}
            <div>
              <dt className="text-sm text-slate">Strikes left</dt>
              <dd className="mt-1">
                <Strikes total={c.freeStrikes} used={p.strikesUsed} size={20} />
              </dd>
            </div>
            <Stat label="Your stake" value={usd(p.stake)} sub={strikesLeft > 0 || c.freeStrikes === 0 ? 'No penalties yet' : 'Penalties apply'} />
            <Stat label="Position" value={p.position ? `#${p.position}` : '—'} sub={p.position ? `of ${c.participants.toLocaleString('en-US')}` : 'Ranked once days are verified'} />
          </dl>

          <div className="mt-auto flex flex-wrap gap-2">
            <Button to={`/c/${c.id}`} size="sm" variant="secondary">
              Open challenge
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSharing(true)}>
              <Share2 size={15} /> Share
            </Button>
            {c.freeze.allowed && (
              <Button size="sm" variant="ghost" onClick={() => setFreeze(true)} disabled={frozen}>
                <Snowflake size={15} /> {frozen ? 'Freeze scheduled' : 'Emergency freeze'}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setRemind(true)}>
              <CalendarPlus size={15} /> Reminder
            </Button>
            <Button to="/disputes" size="sm" variant="ghost">
              Dispute a result
            </Button>
          </div>
        </div>
      </div>

      <div className="border-t border-line">
        <button
          type="button"
          aria-expanded={history}
          onClick={() => setHistory((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-4 text-left text-[15px] font-semibold sm:px-7"
        >
          Verification history
          <ChevronDown size={18} className={cx('transition-transform', history && 'rotate-180')} />
        </button>
        {history && (
          <ul className="divide-y divide-line border-t border-line">
            {p.history.map((h) => (
              <li key={h.id} className="grid gap-2 px-5 py-3.5 sm:grid-cols-[9rem_14rem_1fr] sm:items-center sm:px-7">
                <span className="text-sm text-slate tabular">
                  {new Date(h.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
                <span>
                  <ProofChip state={h.state} />
                </span>
                <span className="text-[15px]">
                  {h.day && <span className="text-slate">Day {h.day}. </span>}
                  {h.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {remind && <CalendarReminderSheet challenges={[c]} onClose={() => setRemind(false)} />}
      {sharing && (
        <ShareSheet
          title={`Share ${c.title}`}
          intro={c.privacy === 'public' ? 'Anyone with the link can see the rules and join.' : 'This challenge is invite only. People need this link or code to join.'}
          link={inviteCode ? `${window.location.origin}/i/${inviteCode}` : `${window.location.origin}/c/${c.id}`}
          code={inviteCode}
          message={`I’m doing ${c.title} on Stake-Sync. Join me: ${c.summary}`}
          challengeId={c.id}
          onClose={() => setSharing(false)}
        />
      )}
      {freeze && (
        <FreezeSheet
          c={c}
          p={p}
          onClose={() => setFreeze(false)}
          onConfirm={() => {
            setFrozen(true)
            toast({ title: 'Freeze scheduled', body: `Days ${p.today + 1}–${p.today + c.freeze.days} of ${c.title} are paused.` })
            onChanged?.()
          }}
        />
      )}
    </article>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-sm text-slate">{label}</dt>
      <dd className="font-display text-2xl font-semibold tabular">{value}</dd>
      {sub && <dd className="text-sm text-slate">{sub}</dd>}
    </div>
  )
}

function FreezeSheet({ c, p, onClose, onConfirm }: { c: Challenge; p: Participation; onClose: () => void; onConfirm: () => void }) {
  const [done, setDone] = useState(false)
  const { live } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  // Challenges with money in escrow record the freeze on-chain, signed by the person's wallet.
  const onChain = Boolean((c as { escrow?: unknown }).escrow)
  const missedToday = p.days[p.today - 1]?.state === 'failed'
  const from = p.today + 1
  const to = p.today + c.freeze.days

  async function freezeLive(sign?: SignBytes) {
    setBusy(true)
    const path = `/challenges/${encodeURIComponent(c.id)}`
    try {
      const r = await api<{ status: string; transaction?: string }>(`${path}/freeze`, { method: 'POST', body: { day: from } })
      if (r.status === 'needs_signature' && r.transaction && sign) {
        const signature = await signAndSubmit(r.transaction, sign)
        await api(`${path}/freeze/confirm`, { method: 'POST', body: { signature } })
      }
      onConfirm()
      setDone(true)
    } catch (err) {
      const declined = /reject|declin|cancel/i.test(String(err))
      toast({ tone: 'error', title: declined ? 'Freeze cancelled' : 'Couldn’t freeze', body: err instanceof ApiError ? err.message : declined ? 'Nothing changed.' : 'Please try again.', inbox: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      title={done ? 'Freeze scheduled' : 'Use your emergency freeze?'}
      onClose={onClose}
      footer={
        done ? (
          <Button className="w-full" onClick={onClose}>
            Done
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              Not now
            </Button>
            {live && onChain ? (
              <div className="flex-1">
                <Suspense fallback={<Button className="w-full" busy>Freeze days {from}–{to}</Button>}>
                  <SignButton label={`Freeze days ${from}–${to}`} disabled={missedToday} onSign={(sign) => freezeLive(sign)} />
                </Suspense>
              </div>
            ) : (
              <Button
                className="flex-1"
                disabled={missedToday}
                busy={busy}
                onClick={() => {
                  if (live) return void freezeLive()
                  onConfirm()
                  setDone(true)
                }}
              >
                Freeze days {from}–{to}
              </Button>
            )}
          </div>
        )
      }
    >
      {done ? (
        <p className="text-[15px] text-slate">
          Days {from} to {to} of {c.title} are paused. Nothing is checked on those days and the challenge picks up again on
          day {to + 1}.
        </p>
      ) : (
        <>
          <p className="text-[15px] text-slate">
            A freeze pauses your requirements for {c.freeze.days} days when something serious comes up. You get one per
            challenge, and it can’t be undone.
          </p>
          <ul className="mt-5 space-y-2.5 text-[15px]">
            {[
              `Pauses days ${from} to ${to}, starting tomorrow`,
              'Your strikes and stake are unaffected',
              'Can’t be used on a day that has already been missed',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <Snowflake size={17} className="mt-0.5 shrink-0 text-cobalt" />
                {t}
              </li>
            ))}
          </ul>
          {missedToday && (
            <p className="mt-4 rounded-2xl bg-miss-soft p-3.5 text-[15px]">Today was already missed, so a freeze can’t start now.</p>
          )}
        </>
      )}
    </Sheet>
  )
}

function Finished({ items }: { items: PastItem[] }) {
  if (!items.length) return <p className="mt-6 rounded-3xl bg-surface px-6 py-12 text-center text-slate ring-1 ring-line/70">Finished challenges and what you earned show up here.</p>
  return (
    <ul className="mt-6 divide-y divide-line overflow-hidden rounded-3xl bg-surface ring-1 ring-line/70">
      {items.map((h) => {
        const ok = h.result === 'Completed'
        return (
          <li key={h.id} className="flex items-center gap-4 px-5 py-4 sm:px-7">
            <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', ok ? 'bg-gold-soft text-gold-ink' : 'bg-tile text-slate')}>
              <Trophy size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{h.title}</div>
              <div className="text-sm text-slate">
                {h.result}, {h.when}
              </div>
            </div>
            <div className={cx('font-display text-lg font-semibold tabular', h.earned >= 0 ? 'text-calm' : 'text-miss')}>
              {h.earned >= 0 ? '+' : '−'}
              {usd(Math.abs(h.earned), { cents: true })}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
