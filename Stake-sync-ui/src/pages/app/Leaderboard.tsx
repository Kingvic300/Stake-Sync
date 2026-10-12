import { ArrowDown, ArrowUp, Info, Minus } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { Tabs } from '../../components/Tabs'
import { Avatar, PageHeader } from '../../components/ui'
import { categories } from '../../data/categories'
import type { OrgRank, PersonRank } from '../../data/types'
import { useAuth } from '../../auth/context'
import { RetryPanel } from '../../components/RetryPanel'
import { PanelSkeleton } from '../../components/Skeleton'
import { useApiData } from '../../lib/useApiData'
import type { Category } from '../../data/types'
import { cx, usd } from '../../lib/format'
import { gsap, prefersMotion, useGSAP } from '../../lib/gsap'
import { Select } from '../../components/Select'

type Tab = 'people' | 'orgs'
type Period = 'month' | 'all'

function Change({ n }: { n: number }) {
  if (n === 0)
    return (
      <span className="inline-flex w-9 items-center text-slate" aria-label="No change">
        <Minus size={14} />
      </span>
    )
  const up = n > 0
  return (
    <span className={cx('inline-flex w-9 items-center gap-0.5 text-xs font-semibold tabular', up ? 'text-calm' : 'text-miss')} aria-label={`${up ? 'Up' : 'Down'} ${Math.abs(n)}`}>
      {up ? <ArrowUp size={13} strokeWidth={3} /> : <ArrowDown size={13} strokeWidth={3} />}
      {Math.abs(n)}
    </span>
  )
}

export function Leaderboard() {
  const [tab, setTab] = useState<Tab>('people')
  const [period, setPeriod] = useState<Period>('month')
  const [cat, setCat] = useState<Category | 'all'>('all')
  const root = useRef<HTMLDivElement>(null)

  // "All time" ranks by challenges completed; this month uses the score.
  const people = useApiData<PersonRank[]>('/leaderboards/people')
  const orgs = useApiData<OrgRank[]>('/leaderboards/orgs')
  const board = people.data ?? []
  const ranked: PersonRank[] = (period === 'all' ? [...board].sort((a, b) => b.completed - a.completed) : board).filter(
    (r) => cat === 'all' || r.top === cat,
  )

  useGSAP(
    () => {
      if (!prefersMotion()) return
      gsap.from('[data-podium] > *', { y: 24, autoAlpha: 0, duration: 0.55, stagger: 0.08, ease: 'power3.out', clearProps: 'all' })
      gsap.from('[data-rows] > *', { y: 10, autoAlpha: 0, duration: 0.35, stagger: 0.03, ease: 'power2.out', clearProps: 'all', delay: 0.15 })
      gsap.utils.toArray<HTMLElement>('[data-score]').forEach((el) => {
        const target = Number(el.dataset.score)
        const n = { v: target * 0.85 }
        gsap.to(n, { v: target, duration: 1, ease: 'power2.out', onUpdate: () => void (el.textContent = String(Math.round(n.v))) })
      })
    },
    { scope: root, dependencies: [tab, period, cat], revertOnUpdate: true },
  )

  return (
    <div ref={root} className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16 sm:py-10">
      <PageHeader title="Leaderboard" intro="Ranked by verified follow-through. How much anyone stakes never counts." />

      <Tabs
        label="Leaderboard"
        tabs={[
          { id: 'people', label: 'People' },
          { id: 'orgs', label: 'Organizations' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-surface p-1 ring-1 ring-line" role="group" aria-label="Time period">
          {(
            [
              ['month', 'This month'],
              ['all', 'All time'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              aria-pressed={period === k}
              onClick={() => setPeriod(k)}
              className={cx('h-9 rounded-lg px-4 text-sm font-semibold transition-colors', period === k ? 'bg-ink text-white' : 'text-slate hover:text-ink')}
            >
              {l}
            </button>
          ))}
        </div>
        {tab === 'people' && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate">Category</span>
            <Select
              look="compact"
              label="Category"
              value={cat}
              onChange={setCat}
              className="h-10 min-w-44"
              options={[{ value: 'all' as const, label: 'All categories' }, ...categories.map((c) => ({ value: c, label: c }))]}
            />
          </label>
        )}
      </div>

      {(tab === 'people' ? people : orgs).data === null ? (
        (tab === 'people' ? people : orgs).error ? (
          <RetryPanel className="mt-6" onRetry={(tab === 'people' ? people : orgs).refresh} />
        ) : (
          <PanelSkeleton className="mt-6" rows={6} />
        )
      ) : tab === 'people' ? (
        ranked.length ? <People rows={ranked} /> : <p className="mt-6 rounded-3xl bg-surface px-6 py-12 text-center text-slate ring-1 ring-line/70">People appear here once they finish challenges.</p>
      ) : (
        <Orgs rows={orgs.data ?? []} />
      )}

      <aside className="mt-10 flex items-start gap-3 rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-6">
        <Info size={20} className="mt-0.5 shrink-0 text-cobalt" />
        <div className="text-[15px]">
          <h2 className="font-sans font-semibold">How rankings work</h2>
          <p className="mt-1 text-slate">
            People are ranked by commitment score, which weighs completion, consistency, challenge difficulty and how
            strongly the work was verified. Organizations are ranked by the share of members who complete what they start.
            Stake size, rewards and sponsorship don’t affect either.
          </p>
        </div>
      </aside>
    </div>
  )
}

/** The signed-in person's handle. */
function useMe() {
  return useAuth().session?.username
}

function People({ rows }: { rows: PersonRank[] }) {
  const me = useMe()
  if (!rows.length) {
    return (
      <div className="mt-6 rounded-3xl bg-surface px-6 py-14 text-center ring-1 ring-line/70">
        <h2 className="text-2xl font-bold">No one ranked here yet</h2>
        <p className="mt-1 text-slate">Finish a challenge in this category to be the first.</p>
      </div>
    )
  }
  const podium = rows.slice(0, 3)
  const youIndex = rows.findIndex((r) => r.person.handle === me)
  const shown = rows.slice(0, 10)

  return (
    <>
      <ol data-podium className="mt-6 grid gap-3 sm:grid-cols-3">
        {podium.map((r, i) => (
          <li
            key={r.person.handle}
            className={cx(
              'relative overflow-hidden rounded-3xl p-5 sm:p-6',
              i === 0 ? 'bg-ink text-white sm:order-2' : 'bg-surface ring-1 ring-line/70',
              i === 1 && 'sm:order-1 sm:mt-6',
              i === 2 && 'sm:order-3 sm:mt-6',
            )}
          >
            <div className="flex items-center justify-between">
              <span className={cx('font-display text-4xl font-bold tabular', i === 0 ? 'text-gold' : 'text-slate/40')}>{i + 1}</span>
              <Change n={r.change} />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Avatar person={r.person} size={48} />
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold">{r.person.handle === me ? 'You' : r.person.name}</div>
                <div className={cx('text-sm', i === 0 ? 'text-white/60' : 'text-slate')}>{r.top}</div>
              </div>
            </div>
            <div className="mt-5 flex items-end justify-between">
              <div>
                <div className={cx('text-sm', i === 0 ? 'text-white/60' : 'text-slate')}>Score</div>
                <div className="font-display text-3xl font-bold tabular" data-score={r.score}>
                  {r.score}
                </div>
              </div>
              <div className={cx('text-right text-sm', i === 0 ? 'text-white/70' : 'text-slate')}>
                {r.completed} finished
                <br />
                {r.streak}-day streak
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 overflow-x-auto rounded-3xl bg-surface ring-1 ring-line/70">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-line text-left text-sm text-slate">
              <th className="w-16 px-4 py-3 font-normal sm:w-20 sm:px-5">Rank</th>
              <th className="py-3 font-normal">Person</th>
              <th className="hidden py-3 font-normal lg:table-cell">Best at</th>
              <th className="hidden py-3 text-right font-normal md:table-cell">Finished</th>
              <th className="hidden py-3 text-right font-normal sm:table-cell">Completion</th>
              <th className="hidden py-3 text-right font-normal md:table-cell">Streak</th>
              <th className="px-5 py-3 text-right font-normal">Score</th>
            </tr>
          </thead>
          <tbody data-rows className="divide-y divide-line">
            {shown.map((r, i) => (
              <PersonRow key={r.person.handle} r={r} rank={i + 1} />
            ))}
          </tbody>
        </table>
        {youIndex >= 10 && (
          <table className="w-full border-t-2 border-line text-[15px]">
            <tbody>
              <PersonRow r={rows[youIndex]} rank={youIndex + 1} />
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function PersonRow({ r, rank }: { r: PersonRank; rank: number }) {
  const you = r.person.handle === useMe()
  return (
    <tr className={cx(you && 'bg-cobalt-soft')}>
      <td className="px-4 py-3.5 sm:px-5">
        <span className="flex items-center gap-2">
          <span className={cx('w-6 font-display font-semibold tabular', rank <= 3 && 'text-gold-ink')}>{rank}</span>
          <Change n={r.change} />
        </span>
      </td>
      <td className="py-3.5">
        <Link to={`/u/${r.person.handle}`} className="flex items-center gap-3 hover:text-cobalt">
          <Avatar person={r.person} size={32} />
          <span>
            <span className="block font-semibold">{you ? 'You' : r.person.name}</span>
            {r.org && <span className="block text-sm text-slate">{r.org}</span>}
          </span>
        </Link>
      </td>
      <td className="hidden py-3.5 text-slate lg:table-cell">{r.top}</td>
      <td className="hidden py-3.5 text-right tabular md:table-cell">{r.completed}</td>
      <td className="hidden py-3.5 text-right tabular sm:table-cell">{r.rate}%</td>
      <td className="hidden py-3.5 text-right tabular md:table-cell">{r.streak}d</td>
      <td className="px-5 py-3.5 text-right font-display text-lg font-semibold tabular">{r.score}</td>
    </tr>
  )
}

function Orgs({ rows }: { rows: OrgRank[] }) {
  return (
    <div className="mt-6 overflow-x-auto rounded-3xl bg-surface ring-1 ring-line/70">
      <table className="w-full text-[15px]">
        <thead>
          <tr className="border-b border-line text-left text-sm text-slate">
            <th className="w-20 px-5 py-3 font-normal">Rank</th>
            <th className="py-3 font-normal">Organization</th>
            <th className="w-32 py-3 font-normal sm:w-56">Completion</th>
            <th className="hidden py-3 text-right font-normal sm:table-cell">Active</th>
            <th className="hidden py-3 text-right font-normal md:table-cell">Challenges</th>
            <th className="hidden px-5 py-3 text-right font-normal md:table-cell">Sponsored</th>
          </tr>
        </thead>
        <tbody data-rows className="divide-y divide-line">
          {rows.map((o, i) => {
            const mine = o.slug === 'superteam-ng' || o.slug === 'unilag-cs'
            return (
              <tr key={o.slug} className={cx(mine && 'bg-cobalt-soft/50')}>
                <td className="px-5 py-3.5">
                  <span className="flex items-center gap-2">
                    <span className={cx('w-6 font-display font-semibold tabular', i < 3 && 'text-gold-ink')}>{i + 1}</span>
                    <Change n={o.change} />
                  </span>
                </td>
                <td className="py-3.5">
                  <span className="flex items-center gap-3">
                    <Avatar person={o.person} size={32} />
                    <span>
                      <span className="block font-semibold">{o.name}</span>
                      {mine && <span className="block text-sm text-cobalt-deep">You’re a member</span>}
                    </span>
                  </span>
                </td>
                <td className="py-3.5 pr-4 sm:pr-6">
                  <span className="flex items-center gap-3">
                    <span className="h-2 flex-1 rounded-full bg-tile">
                      <span className="block h-full rounded-full bg-cobalt" style={{ width: `${o.rate}%` }} />
                    </span>
                    <span className="w-10 text-right font-semibold tabular">{o.rate}%</span>
                  </span>
                </td>
                <td className="hidden py-3.5 text-right tabular sm:table-cell">{o.active.toLocaleString('en-US')}</td>
                <td className="hidden py-3.5 text-right tabular md:table-cell">{o.challenges}</td>
                <td className="hidden px-5 py-3.5 text-right tabular md:table-cell">{o.sponsored ? usd(o.sponsored) : '–'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
