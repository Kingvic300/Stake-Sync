import { ArrowUpRight, Check, Clock, Hourglass, KeyRound, Plus, Scale, TrendingUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../../auth/context'
import { Strikes } from '../../components/DayGrid'
import { AddMoneySheet } from '../../components/AddMoneySheet'
import { JoinCodeSheet } from '../../components/JoinCode'
import { Button, Panel, ProviderMark } from '../../components/ui'
import type { Challenge, Notice, Participation } from '../../data/types'
import { useMine, type MineItem } from '../../data/useMine'
import { RetryPanel } from '../../components/RetryPanel'
import { AppPageSkeleton } from '../../components/Skeleton'
import { useApiData } from '../../lib/useApiData'
import { useInbox } from '../../notifications/context'
import { cx, daysUntil, shortDate, usd, usdShort } from '../../lib/format'
import { gsap, useMotion } from '../../lib/gsap'
import { stakeLabel, tileClass } from '../../lib/styles'
import { useCountdown } from '../../lib/useCountdown'
import { useLedger } from '../../state/ledger-context'

/** Short weekday names for the last seven days, ending today. */
const lastSevenDays = () =>
  Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * 86_400_000).toLocaleDateString('en-US', { weekday: 'short' }))

export function Overview() {
  const { session } = useAuth()
  const root = useRef<HTMLDivElement>(null)
  const first = session?.name.split(' ')[0] || 'there'
  const [code, setCode] = useState(false)
  // Read the clock once per visit, not on every render.
  const [today] = useState(() => {
    const now = new Date()
    const h = now.getHours()
    return { date: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }), greeting: h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }
  })
  const { mine, error, refresh } = useMine()
  const items = mine?.active ?? []

  // One load moment: this week's tiles fill in, then the headline numbers count up.
  useMotion(() => {
    gsap.from('[data-week] .day-tile', { scale: 0.5, autoAlpha: 0, duration: 0.35, stagger: 0.025, ease: 'back.out(2)' })
    gsap.utils.toArray<HTMLElement>('[data-count]').forEach((el) => {
      const target = Number(el.dataset.count)
      const digits = Number(el.dataset.digits ?? 0)
      const n = { v: 0 }
      gsap.to(n, {
        v: target,
        duration: 1.1,
        ease: 'power2.out',
        onUpdate: () => {
          el.textContent = (el.dataset.prefix ?? '') + n.v.toFixed(digits) + (el.dataset.suffix ?? '')
        },
      })
    })
  }, root)

  return (
    <div ref={root} className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16 sm:py-10">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-slate">{today.date}</p>
          <h1 className="mt-1 text-4xl font-bold sm:text-5xl">
            {today.greeting}, {first}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setCode(true)}>
            <KeyRound size={17} /> Join with a code
          </Button>
          <Button to="/explore" variant="secondary">
            Find a challenge
          </Button>
          <Button to="/create">
            <Plus size={18} /> Create
          </Button>
        </div>
      </header>

      {!mine ? (
        error ? <RetryPanel className="mt-8" onRetry={refresh} /> : <AppPageSkeleton />
      ) : (
        <>
          <div className="mt-8 grid gap-5 lg:grid-cols-[1.55fr_1fr]">
            <Today items={items} />
            <Balance />
          </div>

          <Stats active={items.length} />

          <div className="mt-5 grid gap-5 lg:grid-cols-[1.55fr_1fr]">
            <ThisWeek items={items} />
            <Activity />
          </div>
        </>
      )}

      <Recommended />
      {code && <JoinCodeSheet onClose={() => setCode(false)} />}
    </div>
  )
}

/* ------------------------------------------------------------------ Today */

/** Before day 1 there's nothing due and no deadline. */
const notStarted = (p: Participation) => p.today < 1 || !p.nextDeadline

function Today({ items }: { items: MineItem[] }) {
  const running = items.filter(({ p }) => !notStarted(p))
  const done = running.filter(({ p }) => p.days[p.today - 1]?.state === 'verified').length
  if (!items.length) {
    return (
      <Panel>
        <h2 className="text-2xl font-bold">Today</h2>
        <p className="mt-2 text-slate">You’re not in a challenge yet. Pick one and your daily checklist shows up here.</p>
        <Button to="/explore" className="mt-5">
          Find a challenge
        </Button>
      </Panel>
    )
  }
  return (
    <Panel flush>
      <div className="flex items-center justify-between gap-4 px-5 pt-5 sm:px-7 sm:pt-7">
        <div>
          <h2 className="text-2xl font-bold">Today</h2>
          <p className="text-slate">
            {running.length ? `${done} of ${running.length} ${running.length === 1 ? 'challenge' : 'challenges'} done today` : 'Nothing due yet. Your challenges haven’t started.'}
          </p>
        </div>
        {running.length > 0 && <Ring value={done} total={running.length} />}
      </div>
      <ul className="mt-4 divide-y divide-line">
        {items.map(({ c, p }) => (
          <TodayRow key={c.id} p={p} c={c} />
        ))}
      </ul>
      <div className="border-t border-line px-5 py-3.5 sm:px-7">
        <Link to="/dashboard" className="text-[15px] font-semibold text-cobalt hover:underline">
          See all progress in My challenges
        </Link>
      </div>
    </Panel>
  )
}

function Ring({ value, total }: { value: number; total: number }) {
  const r = 22
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 56 56" className="size-14 shrink-0 -rotate-90" role="img" aria-label={`${value} of ${total} done`}>
      <circle cx="28" cy="28" r={r} fill="none" strokeWidth="6" className="stroke-tile" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        className="stroke-cobalt"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - value / total)}
      />
    </svg>
  )
}

function TodayRow({ p, c }: { p: Participation; c: Challenge }) {
  const today = p.days[p.today - 1]?.state
  const left = useCountdown(p.nextDeadline)
  const count = c.mode === 'count'

  let status
  if (notStarted(p)) {
    const days = Math.max(1, daysUntil(c.startsAt))
    status = <span className="text-sm text-slate">{days === 1 ? 'Starts tomorrow' : `Starts in ${days} days`}</span>
  } else if (count) {
    status = (
      <span className="text-sm text-slate tabular">
        {p.count} of {c.targetCount} {c.countUnit}
      </span>
    )
  } else if (today === 'verified') {
    status = (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-cobalt-deep">
        <Check size={16} strokeWidth={3} /> Verified
      </span>
    )
  } else {
    status = (
      <span className={cx('inline-flex items-center gap-1.5 text-sm font-semibold', left.urgent ? 'text-gold-ink' : 'text-slate')}>
        <Hourglass size={15} /> {left.label}
      </span>
    )
  }

  return (
    <li>
      <Link to={`/c/${c.id}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-4 transition-colors hover:bg-ground/60 sm:px-7">
        <span className="grid size-11 place-items-center rounded-xl bg-ground">
          <ProviderMark provider={c.providers[c.providers.length - 1]} size={20} />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{c.title}</span>
          <span className="block truncate text-sm text-slate">
            {p.today < 1 || !p.nextDeadline ? `Starts ${shortDate(c.startsAt)}` : count ? `Due ${shortDate(p.nextDeadline)}` : `Day ${p.today} of ${c.durationDays}`}
            {!count && today !== 'verified' && p.history[0] && `. ${p.history[0].detail}`}
          </span>
        </span>
        <span className="text-right">{status}</span>
      </Link>
    </li>
  )
}

/* ---------------------------------------------------------------- Balance */

function Balance() {
  const ledger = useLedger()
  const card = useRef<HTMLDivElement>(null)
  const [adding, setAdding] = useState(false)

  const navigate = useNavigate()

  function claim() {
    // Each claim is a transaction the person's wallet signs; the wallet page lists them.
    navigate('/wallet#claims')
  }

  return (
    <div ref={card} className="relative overflow-hidden rounded-3xl bg-ink p-5 text-white sm:p-7">
      <span data-claim-flash aria-hidden className="pointer-events-none absolute top-6 left-6 size-24 rounded-full bg-calm opacity-0 blur-2xl" />
      <div className="relative">
        <div className="text-sm text-white/60">Available balance</div>
        <div className="mt-1 font-display text-4xl font-bold tabular sm:text-5xl" data-available>
          {usdShort(ledger.available)}
        </div>
        <div className="text-sm text-white/50">USDC</div>

        <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-white/10 pt-5">
          <div>
            <dt className="text-sm text-white/55">In challenges</dt>
            <dd className="font-display text-xl font-semibold tabular">{usd(ledger.locked, { cents: true })}</dd>
          </div>
          <div>
            <dt className="text-sm text-white/55">Ready to claim</dt>
            <dd className={cx('font-display text-xl font-semibold tabular', ledger.claimable > 0 && 'text-gold')}>
              {usd(ledger.claimable, { cents: true })}
            </dd>
          </div>
        </dl>

        <div className="mt-6 grid grid-cols-2 gap-2">
          {ledger.claimable > 0 ? (
            <Button variant="gold" onClick={claim}>
              Claim {usd(ledger.claimable, { cents: true })}
            </Button>
          ) : (
            <Button variant="secondary" className="ring-0" to="/wallet">
              Nothing to claim
            </Button>
          )}
          <Button variant="ghost" className="text-white ring-1 ring-white/20 hover:bg-white/10" onClick={() => setAdding(true)}>
            Add money
          </Button>
        </div>
        {adding && <AddMoneySheet onClose={() => setAdding(false)} />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Stats */

function Stats({ active }: { active: number }) {
  const { session } = useAuth()
  const ledger = useLedger()
  const me = useApiData<{ score: number; entered: number; completed: number; completionRate: number | null }>(
    session?.username ? `/users/${encodeURIComponent(session.username)}` : null,
  ).data
  const score = me?.score ?? 0
  const rate = me?.completionRate ?? 0
  const items = [
    { label: 'Commitment score', count: score, digits: 0, text: String(score), sub: me?.entered ? 'Grows as you finish challenges' : 'Finish a challenge to start building it', up: false },
    { label: 'Completion rate', count: rate, digits: 1, suffix: '%', text: me?.completionRate === null ? '—' : `${rate.toFixed(1)}%`, sub: `${me?.completed ?? 0} of ${me?.entered ?? 0} challenges` },
    { label: 'Active challenges', count: active, digits: 0, text: String(active), sub: `${usd(ledger.locked)} staked` },
    { label: 'Rewards earned', count: ledger.lifetimeRewards, digits: 2, prefix: '$', text: usd(ledger.lifetimeRewards, { cents: true }), sub: 'Lifetime' },
  ]
  return (
    <dl className="mt-5 grid grid-cols-2 overflow-hidden rounded-3xl bg-surface ring-1 ring-line/70 lg:grid-cols-4">
      {items.map((s, i) => (
        <div
          key={s.label}
          className={cx('p-5 sm:p-6', i % 2 === 1 && 'border-l border-line', i >= 2 && 'border-t border-line lg:border-t-0', i === 2 && 'lg:border-l')}
        >
          <dt className="text-sm text-slate">{s.label}</dt>
          <dd className="mt-1 font-display text-3xl font-bold tabular">
            <span data-count={s.count} data-digits={s.digits} data-prefix={s.prefix} data-suffix={s.suffix}>
              {s.text}
            </span>
          </dd>
          <dd className={cx('mt-0.5 inline-flex items-center gap-1 text-sm', s.up ? 'text-calm' : 'text-slate')}>
            {s.up && <TrendingUp size={14} />}
            {s.sub}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/* -------------------------------------------------------------- This week */

function ThisWeek({ items }: { items: MineItem[] }) {
  const [days] = useState(lastSevenDays)
  const rows = items.map(({ c, p }) => {
    const start = Math.max(0, p.today - 7)
    const week = p.days.slice(start, p.today)
    const pad = Array.from({ length: 7 - week.length }, (_, i) => ({ day: -i, state: 'upcoming' as const }))
    return { c, p, week: [...pad, ...week] }
  })
  const verified = rows.reduce((n, r) => n + r.week.filter((d) => d.state === 'verified').length, 0)

  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-2xl font-bold">This week</h2>
        <span className="text-sm text-slate tabular">{verified} days verified</span>
      </div>
      <div data-week className="mt-6 overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-2">
          <thead>
            <tr>
              <th className="w-24 text-left text-sm font-normal text-slate sm:w-40">
                <span className="sr-only">Challenge</span>
              </th>
              {days.map((d, i) => (
                <th key={d} className={cx('pb-1 text-center text-sm font-normal', i === 6 ? 'font-semibold text-ink' : 'text-slate')}>
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, p, week }) => (
              <tr key={c.id}>
                <th scope="row" className="pr-2 text-left text-sm font-medium sm:pr-3 sm:text-[15px]">
                  <span className="line-clamp-1">{c.title}</span>
                  <Strikes total={c.freeStrikes} used={p.strikesUsed} size={12} className="mt-0.5" />
                </th>
                {week.map((d, i) => (
                  <td key={i} className="px-0.5 sm:px-1">
                    <span
                      className={cx('day-tile mx-auto block size-6 rounded-[5px] sm:size-9 sm:rounded-md', tileClass[d.state], i === 6 && 'outline-2 outline-offset-2 outline-ink/80')}
                      title={d.day > 0 ? `Day ${d.day}` : 'Before the challenge'}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* --------------------------------------------------------------- Activity */


const KIND_ICON: Partial<Record<Notice['kind'], { icon: typeof Check; tone: string }>> = {
  verified: { icon: Check, tone: 'bg-cobalt-soft text-cobalt-deep' },
  completed: { icon: Check, tone: 'bg-calm-soft text-calm' },
  leaderboard: { icon: TrendingUp, tone: 'bg-calm-soft text-calm' },
  dispute: { icon: Scale, tone: 'bg-gold-soft text-gold-ink' },
  reward: { icon: TrendingUp, tone: 'bg-gold-soft text-gold-ink' },
}

function ago(iso: string) {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}

function Activity() {
  const inbox = useInbox()
  // The latest notifications are the activity.
  const list = inbox.items.slice(0, 4).map((n) => ({ id: n.id, ...(KIND_ICON[n.kind] ?? { icon: Clock, tone: 'bg-tile text-slate' }), text: n.title, at: ago(n.at) }))
  return (
    <Panel>
      <h2 className="text-2xl font-bold">Activity</h2>
      {list.length === 0 && <p className="mt-4 text-slate">Verified days, rank changes and rewards show up here.</p>}
      <ul className="mt-5 space-y-4">
        {list.map((a) => (
          <li key={a.id} className="flex items-start gap-3">
            <span className={cx('grid size-9 shrink-0 place-items-center rounded-xl', a.tone)}>
              <a.icon size={16} strokeWidth={2.5} />
            </span>
            <span className="flex-1 pt-1 text-[15px]">{a.text}</span>
            <span className="pt-1.5 text-xs text-slate tabular">{a.at}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/* ------------------------------------------------------------ Recommended */

function Recommended() {
  const picks =
    useApiData<Challenge[], { items: Challenge[] }>('/challenges?status=open&sort=trending&limit=3', (r) => r.items).data ?? []
  if (!picks.length) return null
  return (
    <section className="mt-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Recommended for you</h2>
          <p className="text-slate">Popular challenges you can still join</p>
        </div>
        <Link to="/explore" className="hidden text-[15px] font-semibold text-cobalt hover:underline sm:block">
          Explore all
        </Link>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {picks.map((c) => (
          <Link
            key={c.id}
            to={`/c/${c.id}`}
            className="group flex flex-col rounded-3xl bg-surface p-5 ring-1 ring-line/70 transition-shadow hover:shadow-(--shadow-lift)"
          >
            <div className="flex items-center justify-between text-sm text-slate">
              <span className="inline-flex items-center gap-1.5">
                {c.providers.map((p) => (
                  <ProviderMark key={p} provider={p} size={14} />
                ))}
                {c.category}
              </span>
              <ArrowUpRight size={18} className="text-slate transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
            <h3 className="mt-3 text-xl font-semibold group-hover:text-cobalt">{c.title}</h3>
            <p className="mt-1 flex-1 text-[15px] text-slate">{c.summary}</p>
            <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-4 text-sm">
              <div>
                <dt className="text-slate">Stake</dt>
                <dd className="font-display text-base font-semibold tabular">{stakeLabel(c)}</dd>
              </div>
              <div>
                <dt className="text-slate">Pool</dt>
                <dd className="font-display text-base font-semibold text-gold-ink tabular">{c.sponsorPool ? usd(c.sponsorPool) : '–'}</dd>
              </div>
              <div>
                <dt className="text-slate">Length</dt>
                <dd className="font-display text-base font-semibold tabular">{c.durationDays}d</dd>
              </div>
            </dl>
          </Link>
        ))}
      </div>
    </section>
  )
}
