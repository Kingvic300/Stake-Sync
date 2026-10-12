import { KeyRound, Search, SlidersHorizontal } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { ChallengeRow, ListHeader, SponsoredBlock } from '../../components/ChallengeItem'
import { JoinCodeSheet } from '../../components/JoinCode'
import { Sheet } from '../../components/Sheet'
import { RetryPanel } from '../../components/RetryPanel'
import { ChallengeRowsSkeleton } from '../../components/Skeleton'
import { Button, ProviderMark } from '../../components/ui'
import { categories } from '../../data/categories'
import type { Category, Challenge, Difficulty, Privacy, Provider } from '../../data/types'
import { cx } from '../../lib/format'
import { gsap, prefersMotion, useGSAP } from '../../lib/gsap'
import { inputBase } from '../../lib/styles'
import { useApiData } from '../../lib/useApiData'
import { Select } from '../../components/Select'

interface Filters {
  stake: 'any' | 'none' | 'under10' | '10to25' | 'over25'
  reward: 'any' | 'sponsored' | 'over5k'
  providers: Provider[]
  duration: 'any' | 'short' | 'month' | 'long'
  difficulty: Difficulty[]
  privacy: Privacy | 'any'
}
const none: Filters = { stake: 'any', reward: 'any', providers: [], duration: 'any', difficulty: [], privacy: 'any' }
const sorts = {
  popular: 'Most joined',
  pool: 'Biggest sponsor pool',
  soon: 'Starting soonest',
  stake: 'Lowest stake',
} as const
type Sort = keyof typeof sorts

function activeCount(f: Filters) {
  return (
    Number(f.stake !== 'any') +
    Number(f.reward !== 'any') +
    f.providers.length +
    Number(f.duration !== 'any') +
    f.difficulty.length +
    Number(f.privacy !== 'any')
  )
}

function matches(c: Challenge, q: string, cat: Category | null, f: Filters) {
  const text = `${c.title} ${c.summary} ${c.org?.name ?? ''} ${c.creator.name}`.toLowerCase()
  if (q && !text.includes(q.toLowerCase())) return false
  if (cat && c.category !== cat) return false
  const s = c.stakeMode === 'none' ? 0 : c.stakeMode === 'range' ? (c.stakeRange?.[0] ?? 0) : c.stake
  if (f.stake === 'none' && c.stakeMode !== 'none') return false
  if (f.stake === 'under10' && !(s > 0 && s < 10)) return false
  if (f.stake === '10to25' && !(s >= 10 && s <= 25)) return false
  if (f.stake === 'over25' && !(s > 25)) return false
  if (f.reward === 'sponsored' && c.sponsorPool === 0) return false
  if (f.reward === 'over5k' && c.sponsorPool < 5000) return false
  if (f.providers.length && !f.providers.some((p) => c.providers.includes(p))) return false
  if (f.duration === 'short' && c.durationDays > 14) return false
  if (f.duration === 'month' && (c.durationDays < 15 || c.durationDays > 31)) return false
  if (f.duration === 'long' && c.durationDays <= 31) return false
  if (f.difficulty.length && !f.difficulty.includes(c.difficulty)) return false
  if (f.privacy !== 'any' && c.privacy !== f.privacy) return false
  return true
}

export function Explore() {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<Category | null>(null)
  const [filters, setFilters] = useState<Filters>(none)
  const [sort, setSort] = useState<Sort>('popular')
  const [sheet, setSheet] = useState<'filters' | 'code' | null>(null)
  const list = useRef<HTMLDivElement>(null)

  // Open and running challenges; filtering and sorting happen here so they respond instantly.
  const source = useApiData('/challenges?limit=50', (r: { items: Challenge[] }) => r.items)
  const visible = useMemo(() => (source.data ?? []).filter((c) => c.status !== 'ended'), [source.data])
  const filtering = q !== '' || cat !== null || activeCount(filters) > 0
  const results = useMemo(() => {
    const r = visible.filter((c) => matches(c, q, cat, filters))
    const by: Record<Sort, (a: Challenge, b: Challenge) => number> = {
      popular: (a, b) => b.participants - a.participants,
      pool: (a, b) => b.sponsorPool - a.sponsorPool,
      soon: (a, b) => a.startsAt.localeCompare(b.startsAt),
      stake: (a, b) => a.stake - b.stake,
    }
    return r.sort(by[sort])
  }, [visible, q, cat, filters, sort])

  // Results settle in whenever the query, filters or sort change.
  useGSAP(
    () => {
      if (!filtering || !prefersMotion()) return
      gsap.from('[data-result] > li', { y: 10, autoAlpha: 0, duration: 0.3, stagger: 0.03, ease: 'power2.out', clearProps: 'all' })
    },
    { scope: list, dependencies: [q, cat, filters, sort, filtering], revertOnUpdate: true },
  )

  const sponsored = visible.filter((c) => c.sponsorPool >= 2500 && c.privacy === 'public').slice(0, 2)
  const soon = visible.filter((c) => c.status === 'open').sort((a, b) => a.joinBy.localeCompare(b.joinBy))
  const trending = visible.filter(isTrending).sort((a, b) => trendScore(b) - trendScore(a))

  return (
    <div ref={list} className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16 sm:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-bold sm:text-5xl">Explore challenges</h1>
          <p className="mt-2 text-lg text-slate">Every challenge shows its full rules before you stake.</p>
        </div>
        <Button variant="secondary" onClick={() => setSheet('code')}>
          <KeyRound size={17} /> Join with a code
        </Button>
      </header>

      <div className="sticky top-16 z-20 -mx-4 mt-8 bg-ground/90 px-4 py-3 backdrop-blur-md sm:mx-0 sm:px-0">
        <div className="flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Search challenges</span>
            <Search size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-slate" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, skill or organization"
              className={cx(inputBase, 'h-12 pl-11 text-[15px]')}
            />
          </label>
          <Button variant="secondary" className="h-12" onClick={() => setSheet('filters')}>
            <SlidersHorizontal size={17} />
            <span className="hidden sm:inline">Filters</span>
            {activeCount(filters) > 0 && (
              <span className="grid size-5 place-items-center rounded-full bg-cobalt text-xs text-white tabular">{activeCount(filters)}</span>
            )}
          </Button>
        </div>
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="group" aria-label="Category">
          <Chip on={cat === null} onClick={() => setCat(null)}>
            All
          </Chip>
          {categories.map((c) => (
            <Chip key={c} on={cat === c} onClick={() => setCat(cat === c ? null : c)}>
              {c}
            </Chip>
          ))}
        </div>
      </div>

      {!source.data ? (
        source.error ? <RetryPanel className="mt-8" onRetry={source.refresh} /> : <ChallengeRowsSkeleton className="mt-8" rows={6} />
      ) : filtering ? (
        <section className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[15px] text-slate" role="status">
              {results.length} {results.length === 1 ? 'challenge' : 'challenges'}
            </p>
            <div className="flex items-center gap-3">
              {(activeCount(filters) > 0 || q || cat) && (
                <button
                  type="button"
                  onClick={() => {
                    setQ('')
                    setCat(null)
                    setFilters(none)
                  }}
                  className="text-sm font-semibold text-cobalt hover:underline"
                >
                  Clear all
                </button>
              )}
              <label className="flex items-center gap-2 text-sm">
                <span className="text-slate">Sort</span>
                <Select
                  look="compact"
                  label="Sort"
                  value={sort}
                  onChange={setSort}
                  options={(Object.entries(sorts) as [Sort, string][]).map(([k, v]) => ({ value: k, label: v }))}
                />
              </label>
            </div>
          </div>
          {results.length ? (
            <div className="mt-4">
              <ListHeader />
              <ul data-result className="divide-y divide-line">
                {results.map((c) => (
                  <ChallengeRow key={c.id} c={c} />
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-6 rounded-3xl bg-surface px-6 py-14 text-center ring-1 ring-line/70">
              <h2 className="text-2xl font-bold">No challenges match yet</h2>
              <p className="mx-auto mt-2 max-w-md text-slate">Try fewer filters, or start the challenge you were looking for.</p>
              <div className="mt-6 flex justify-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQ('')
                    setCat(null)
                    setFilters(none)
                  }}
                >
                  Clear filters
                </Button>
                <Button to="/create">Create a challenge</Button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <>
          {sponsored.length > 0 && (
          <section className="mt-8">
            <h2 className="text-2xl font-bold">Sponsored</h2>
            <p className="text-slate">Backed by organizations and brands, with prize pools on top of your stake.</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {sponsored.map((c) => (
                <SponsoredBlock key={c.id} c={c} />
              ))}
            </div>
          </section>
          )}

          {soon.length > 0 && (
            <Section title="Starting soon" intro="Joining closes before day one.">
              {soon.map((c) => (
                <ChallengeRow key={c.id} c={c} />
              ))}
            </Section>
          )}

          {trending.length > 0 && (
            <Section title="Trending" intro="Drawing the most people right now.">
              {trending.slice(0, 5).map((c) => (
                <ChallengeRow key={c.id} c={c} />
              ))}
            </Section>
          )}

          {!sponsored.length && !soon.length && !trending.length && (
            <p className="mt-12 rounded-3xl bg-surface p-8 text-center text-slate ring-1 ring-line/70">No open challenges yet. Create the first one.</p>
          )}
        </>
      )}

      {sheet === 'filters' && <FilterSheet all={source.data ?? []} value={filters} onApply={setFilters} onClose={() => setSheet(null)} />}
      {sheet === 'code' && <JoinCodeSheet onClose={() => setSheet(null)} />}
    </div>
  )
}

/** Trending needs real pull: a public, joinable challenge with at least this many people. */
const TRENDING_MIN = 5

function isTrending(c: Challenge) {
  return c.privacy === 'public' && (c.status === 'open' || c.status === 'live') && c.participants >= TRENDING_MIN
}

/** More people, a fuller roster and a sponsor pool all push a challenge up. */
function trendScore(c: Challenge) {
  const fill = c.limit ? c.participants / c.limit : 0
  return c.participants * (1 + fill) + Math.min(c.sponsorPool, 10_000) / 100
}

function Section({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-2xl font-bold">{title}</h2>
      <p className="text-slate">{intro}</p>
      <div className="mt-4">
        <ListHeader />
        <ul className="divide-y divide-line">{children}</ul>
      </div>
    </section>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition-colors',
        on ? 'bg-ink text-white ring-ink' : 'bg-surface ring-line hover:ring-slate/40',
      )}
    >
      {children}
    </button>
  )
}

function Group<T extends string>({ legend, options, value, onChange }: { legend: string; options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <fieldset className="mt-6 first:mt-0">
      <legend className="text-sm font-semibold">{legend}</legend>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <Chip key={v} on={value === v} onClick={() => onChange(v)}>
            {l}
          </Chip>
        ))}
      </div>
    </fieldset>
  )
}

function FilterSheet({ all, value, onApply, onClose }: { all: Challenge[]; value: Filters; onApply: (f: Filters) => void; onClose: () => void }) {
  const [f, setF] = useState(value)
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
  const count = all.filter((c) => c.status !== 'ended' && matches(c, '', null, f)).length

  return (
    <Sheet
      title="Filters"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setF(none)}>
            Reset
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              onApply(f)
              onClose()
            }}
          >
            Show {count} {count === 1 ? 'challenge' : 'challenges'}
          </Button>
        </div>
      }
    >
      <Group
        legend="Stake"
        value={f.stake}
        onChange={(stake) => setF({ ...f, stake })}
        options={[
          ['any', 'Any'],
          ['none', 'No stake'],
          ['under10', 'Under $10'],
          ['10to25', '$10–$25'],
          ['over25', 'Over $25'],
        ]}
      />
      <Group
        legend="Rewards"
        value={f.reward}
        onChange={(reward) => setF({ ...f, reward })}
        options={[
          ['any', 'Any'],
          ['sponsored', 'Sponsored'],
          ['over5k', 'Pool over $5,000'],
        ]}
      />
      <fieldset className="mt-6">
        <legend className="text-sm font-semibold">Verified by</legend>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {(['GitHub', 'Solana', 'LeetCode', 'Codeforces', 'WakaTime', 'Camera', 'Health', 'Photo'] as const).map((p) => (
            <Chip key={p} on={f.providers.includes(p)} onClick={() => setF({ ...f, providers: toggle(f.providers, p) })}>
              <ProviderMark provider={p} size={14} tone={!f.providers.includes(p)} /> {p}
            </Chip>
          ))}
        </div>
      </fieldset>
      <Group
        legend="Length"
        value={f.duration}
        onChange={(duration) => setF({ ...f, duration })}
        options={[
          ['any', 'Any'],
          ['short', 'Up to 2 weeks'],
          ['month', 'About a month'],
          ['long', 'Longer'],
        ]}
      />
      <fieldset className="mt-6">
        <legend className="text-sm font-semibold">Difficulty</legend>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {(['Starter', 'Steady', 'Hard'] as const).map((d) => (
            <Chip key={d} on={f.difficulty.includes(d)} onClick={() => setF({ ...f, difficulty: toggle(f.difficulty, d) })}>
              {d}
            </Chip>
          ))}
        </div>
      </fieldset>
      <Group
        legend="Who can join"
        value={f.privacy}
        onChange={(privacy) => setF({ ...f, privacy })}
        options={[
          ['any', 'Anyone I can see'],
          ['public', 'Public'],
          ['private', 'Invite only'],
          ['org', 'My organizations'],
        ]}
      />
    </Sheet>
  )
}
