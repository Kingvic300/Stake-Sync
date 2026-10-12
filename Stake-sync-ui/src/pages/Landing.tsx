import { CloudOff, RotateCcw, ShieldCheck } from 'lucide-react'
import { useRef, type RefObject } from 'react'
import { Link } from 'react-router'
import { ChallengeRow, ListHeader, SponsorTexture } from '../components/ChallengeItem'
import { DayGrid, Strikes } from '../components/DayGrid'
import { Avatar, Button, ProviderMark, ProofChip } from '../components/ui'
import type { Achievement, Challenge, OrgRank, PersonRank } from '../data/types'
import { useApiData } from '../lib/useApiData'
import { Bone } from '../components/Skeleton'
import type { DayRecord, Provider } from '../data/types'
import { cx, usd } from '../lib/format'
import { buttonClass } from '../lib/styles'
import { gsap, motionOK, useGSAP } from '../lib/gsap'
import { color } from '../lib/tokens'

export function Landing() {
  const root = useRef<HTMLDivElement>(null)
  useScrollStory(root)
  return (
    <div ref={root}>
      <Hero />
      <OpenNow />
      <MoneyPath />
      <Forgiveness />
      <Verification />
      <Organizations />
      <Reputation />
      <Closing />
    </div>
  )
}

/**
 * Scroll-driven reveals. Markup always renders the finished state, so with reduced
 * motion (or no JS timing) everything is simply there.
 */
function useScrollStory(root: RefObject<HTMLDivElement | null>) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(motionOK, () => {
        const at = (trigger: string, start = 'top 78%') => ({ trigger, start, once: true })
        const rise = { y: 22, autoAlpha: 0, duration: 0.6, ease: 'power3.out' }

        gsap.from('[data-reveal="rows"] > li', { ...rise, stagger: 0.07, scrollTrigger: at('[data-reveal="rows"]') })

        gsap
          .timeline({ scrollTrigger: at('[data-reveal="money"]', 'top 72%') })
          .from('[data-money-line]', { scaleX: 0, transformOrigin: 'left center', duration: 1.5, ease: 'none' })
          .from('[data-money-step]', { ...rise, stagger: 0.42 }, 0)
          .from('[data-money-token]', { scale: 0.4, duration: 0.6, ease: 'back.out(2.6)', stagger: 0.42 }, 0)
          .from('[data-money-terms] > div', { ...rise, y: 12, stagger: 0.08 }, '-=0.3')

        // Three free misses each break a heart, then the paid rows arrive.
        const ladder = gsap.timeline({ scrollTrigger: at('[data-reveal="ladder"]', 'top 68%') })
        ladder.from('[data-ladder-row]', { x: -14, autoAlpha: 0, duration: 0.4, ease: 'power2.out', stagger: 0.22 })
        ;[2, 1, 0].forEach((heart, i) => {
          const t = 0.22 * i + 0.2
          ladder
            .fromTo(
              `[data-reveal="ladder"] [data-heart="${heart}"]`,
              { color: color.miss, fill: color.miss },
              { color: color.line, fill: 'rgba(0,0,0,0)', duration: 0.25, immediateRender: false },
              t,
            )
            .fromTo(
              `[data-reveal="ladder"] [data-heart="${heart}"]`,
              { scale: 1.3 },
              { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)', immediateRender: false },
              t,
            )
        })

        gsap.from('[data-reveal="proofs"] > li', { ...rise, y: 12, stagger: 0.1, scrollTrigger: at('[data-reveal="proofs"]') })
        gsap.from('[data-reveal="providers"] > li', { ...rise, stagger: 0.08, scrollTrigger: at('[data-reveal="providers"]') })

        // Numbers count up from zero the first time they scroll into view.
        gsap.utils.toArray<HTMLElement>('[data-count]').forEach((el) => {
          const target = Number(el.dataset.count)
          const fmt = (n: number) => (el.dataset.format === 'usd' ? usd(Math.round(n)) : Math.round(n).toLocaleString('en-US'))
          const n = { v: 0 }
          gsap.to(n, {
            v: target,
            duration: 1.4,
            ease: 'power2.out',
            scrollTrigger: at(`[data-count="${el.dataset.count}"]`, 'top 90%'),
            onStart: () => {
              el.textContent = fmt(0)
            },
            onUpdate: () => {
              el.textContent = fmt(n.v)
            },
          })
        })
      })
    },
    { scope: root },
  )
}

/* ------------------------------------------------------------------ Hero */

const MISSED = [9, 21]
const demoDays: DayRecord[] = Array.from({ length: 30 }, (_, i) => ({
  day: i + 1,
  state: MISSED.includes(i + 1) ? 'failed' : 'verified',
}))

function Hero() {
  const root = useRef<HTMLElement>(null)
  const tl = useRef<gsap.core.Timeline | null>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(motionOK, () => {
        const step = 0.085
        const counter = { d: 0, v: 0 }
        const dayEl = root.current!.querySelector<HTMLElement>('[data-counter="day"]')!
        const doneEl = root.current!.querySelector<HTMLElement>('[data-counter="done"]')!

        const t = gsap.timeline({ delay: 0.35 })
        t.from('[data-hero-line]', { yPercent: 40, autoAlpha: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out' }, 0)
          .from('[data-demo]', { y: 24, autoAlpha: 0, duration: 0.7, ease: 'power3.out' }, 0.15)
          .set('[data-result]', { autoAlpha: 0 }, 0)
          .addLabel('days', 0.75)
          .fromTo(
            '.day-tile',
            { backgroundColor: color.tile, scale: 0.7 },
            {
              // GSAP can't blend oklch(), so tween between hex and hand back to the stylesheet after
              backgroundColor: (_: number, el: HTMLElement) => (el.dataset.state === 'failed' ? color.miss : color.cobalt),
              scale: 1,
              duration: 0.32,
              ease: 'back.out(2.2)',
              stagger: step,
              clearProps: 'backgroundColor,transform',
            },
            'days',
          )
          .to(
            counter,
            {
              d: 30,
              v: 28,
              duration: step * 30,
              ease: 'none',
              onUpdate() {
                const d = Math.max(1, Math.round(counter.d))
                dayEl.textContent = String(d)
                doneEl.textContent = String(d - MISSED.filter((m) => m <= d).length)
              },
            },
            'days',
          )

        // Each miss costs a heart, never money: strikes absorb the first three.
        MISSED.forEach((day, i) => {
          const at = `days+=${(day - 1) * step + 0.12}`
          t.fromTo(
            `[data-heart="${2 - i}"]`,
            { color: color.miss, fill: color.miss },
            { color: color.line, fill: 'rgba(0,0,0,0)', duration: 0.25 },
            at,
          )
            .fromTo(
              `[data-heart="${2 - i}"]`,
              { scale: 1.35 },
              { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)', immediateRender: false },
              at,
            )
        })

        const pay = { v: 0 }
        const payEl = root.current!.querySelector<HTMLElement>('[data-payout]')!
        t.fromTo('[data-result]', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.55, ease: 'power3.out' })
          .to(pay, { v: 25.94, duration: 0.9, ease: 'power2.out', onUpdate: () => {
            payEl.textContent = usd(pay.v, { cents: true })
          } }, '<0.1')
        tl.current = t
      })
    },
    { scope: root },
  )


  return (
    <section ref={root} className="relative overflow-hidden">
      <div className="mx-auto grid max-w-[120rem] items-center gap-12 px-4 pt-12 pb-16 sm:px-6 lg:px-12 2xl:px-16 md:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-24">
        <div>
          <h1 className="text-[clamp(2.75rem,7vw,5.25rem)] leading-[0.98] font-extrabold tracking-[-0.035em]">
            <span data-hero-line className="block">Commit to it.</span>
            <span data-hero-line className="block">Prove it.</span>
            <span data-hero-line className="block">Get paid for it.</span>
          </h1>
          <p className="mt-6 max-w-[34rem] text-lg text-slate sm:text-xl">
            Join coding, fitness and learning challenges with a USDC stake. GitHub, LeetCode, Codeforces, WakaTime and Solana
            confirm your progress automatically. Finish, and your stake comes back with a share of the sponsor rewards.
          </p>
          <div className="mt-8 grid gap-3 sm:flex">
            <Button to="/signup" size="lg">
              Get started
            </Button>
            <Button to="/how-it-works" size="lg" variant="secondary">
              See how it works
            </Button>
          </div>
          <p className="mt-6 flex items-center gap-2 text-sm text-slate">
            <ShieldCheck size={16} className="text-calm" />
            Stakes sit in a Solana escrow program. Nobody at Stake-Sync can move them.
          </p>
        </div>

        <figure data-demo className="relative">
          <div className="rounded-[28px] bg-surface p-5 shadow-(--shadow-lift) ring-1 ring-line/70 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm text-slate">
                  <ProviderMark provider="GitHub" size={14} />
                  30 Days of Code
                </div>
                <div className="mt-1 font-display text-3xl font-bold tabular sm:text-4xl">
                  Day <span data-counter="day">30</span>
                  <span className="text-slate/60"> / 30</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-slate">Strikes left</div>
                <Strikes total={3} used={2} size={22} className="mt-1.5" />
              </div>
            </div>

            <DayGrid days={demoDays} size="lg" className="mt-6" />
            <p className="mt-3 text-sm text-slate">Needs 25 of 30 days. Three free strikes.</p>

            <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-5">
              <div>
                <dt className="text-sm text-slate">Verified</dt>
                <dd className="font-display text-2xl font-semibold tabular">
                  <span data-counter="done">28</span>
                  <span className="text-base font-medium text-slate"> days</span>
                </dd>
              </div>
              <div>
                <dt className="text-sm text-slate">Your stake</dt>
                <dd className="font-display text-2xl font-semibold tabular">$20</dd>
              </div>
              <div>
                <dt className="text-sm text-slate">Penalties</dt>
                <dd className="font-display text-2xl font-semibold tabular">$0</dd>
              </div>
            </dl>
          </div>

          <div
            data-result
            className="relative z-10 mx-4 -mt-5 flex items-center justify-between gap-4 rounded-2xl bg-ink px-5 py-4 text-white shadow-(--shadow-sheet) sm:mx-8"
          >
            <div>
              <div className="text-sm text-white/65">Challenge complete. Ready to claim</div>
              <div className="font-display text-2xl font-bold tabular">
                <span data-payout>$25.94</span>
                <span className="block text-sm font-medium text-white/60 sm:ml-2 sm:inline sm:text-base">
                  $20 stake + $5.94 reward
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => tl.current?.restart(true, false)}
              aria-label="Replay the demo"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 motion-reduce:hidden"
            >
              <RotateCcw size={18} />
            </button>
          </div>
          <figcaption className="sr-only">
            Example: 30 Days of Code. 28 of 30 days verified, two misses covered by free strikes, $20 stake returned with
            a $5.94 reward.
          </figcaption>
        </figure>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------- Open now */

function OpenNow() {
  const list = useApiData<Challenge[], { items: Challenge[] }>('/challenges?status=open&limit=5', (r) => r.items).data
  if (list && !list.length) return null
  return (
    <section className="mx-auto max-w-[120rem] px-4 pt-4 pb-20 sm:px-6 lg:px-12 2xl:px-16">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h2 className="text-3xl font-bold sm:text-4xl">Open for joining</h2>
          <p className="mt-2 text-slate">Every challenge shows its full rules before you stake a cent.</p>
        </div>
        <div className="hidden sm:block">
          <Link to="/explore" className={buttonClass('secondary', 'md')}>
            Browse all challenges
          </Link>
        </div>
      </div>
      <div className="mt-8">
        <ListHeader />
        <ul data-reveal="rows" className="divide-y divide-line">
          {list
            ? list.map((c) => <ChallengeRow key={c.id} c={c} />)
            : Array.from({ length: 3 }, (_, i) => (
                <li key={i} className="py-5">
                  <Bone className="h-6 w-2/3" />
                </li>
              ))}
        </ul>
      </div>
      <Link to="/explore" className={buttonClass('secondary', 'md', 'mt-6 w-full sm:hidden')}>
        Browse all challenges
      </Link>
    </section>
  )
}

/* ----------------------------------------------------------- Money path */

const moneySteps = [
  { title: 'You stake $20', body: 'USDC moves from your wallet into this challenge’s escrow when you join.', amount: '$20', tone: 'ink' },
  { title: 'It’s locked, not ours', body: 'The escrow program holds it. Admins can’t withdraw it and the rules can’t change.', amount: '$20', tone: 'line' },
  { title: 'Your days get verified', body: 'GitHub confirms each day. Misses use your free strikes before any penalty.', amount: '$20', tone: 'cobalt' },
  { title: 'Settle and claim', body: 'Your stake comes back with your share of the $5,000 sponsor pool.', amount: '$25.94', tone: 'gold' },
] as const

function MoneyPath() {
  return (
    <section className=" border-y border-line bg-surface">
      <div className="mx-auto max-w-[120rem] px-4 py-20 sm:px-6 lg:px-12 2xl:px-16">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold sm:text-4xl">You always know where your money is</h2>
          <p className="mt-3 text-lg text-slate">
            Here’s the full path of a $20 stake in 30 Days of Code, from the moment you join to the moment you claim.
          </p>
          <Link to="/how-it-works" className="mt-4 inline-block font-semibold text-cobalt hover:underline">
            Read how Stake-Sync works
          </Link>
        </div>
        <ol data-reveal="money" className="relative mt-12 grid gap-10 md:grid-cols-4 md:gap-6">
          <span data-money-line aria-hidden className="absolute top-7 right-[12%] left-[12%] hidden h-0.5 bg-line md:block" />
          {moneySteps.map((s, i) => (
            <li key={s.title} data-money-step className="relative grid grid-cols-[3.5rem_1fr] gap-4 md:block">
              <span
                data-money-token
                className={cx(
                  'relative grid size-14 place-items-center rounded-2xl font-display text-[15px] font-bold tabular ring-4 ring-surface',
                  s.tone === 'ink' && 'bg-ink text-white',
                  s.tone === 'line' && 'bg-tile text-ink',
                  s.tone === 'cobalt' && 'bg-cobalt text-white',
                  s.tone === 'gold' && 'bg-gold text-ink',
                )}
              >
                {s.amount}
              </span>
              <div className="md:mt-5">
                <div className="text-sm text-slate tabular">Step {i + 1}</div>
                <h3 className="mt-0.5 text-xl font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-[15px] text-slate">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <dl data-money-terms className="mt-14 grid gap-px overflow-hidden rounded-2xl bg-line ring-1 ring-line sm:grid-cols-4">
          {[
            ['Your stake', 'What you put in. Shown on every screen.'],
            ['Sponsor pool', 'Prize money added by organizations and brands.'],
            ['Forfeited', 'Only what the rules you accepted say can be lost.'],
            ['Claimable', 'What you can withdraw once the challenge settles.'],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface p-5">
              <dt className="font-semibold">{k}</dt>
              <dd className="mt-1 text-sm text-slate">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------- Forgiveness */

function Forgiveness() {
  const ladder = [
    { miss: '1st miss', cost: 'Free', note: 'Strike used', free: true },
    { miss: '2nd miss', cost: 'Free', note: 'Strike used', free: true },
    { miss: '3rd miss', cost: 'Free', note: 'Last strike', free: true },
    { miss: '4th miss', cost: '5%', note: 'of your stake' },
    { miss: '5th miss', cost: '+10%', note: 'of your stake' },
    { miss: '6th miss', cost: '+15%', note: 'of your stake' },
  ]
  return (
    <section className="mx-auto grid max-w-[120rem] gap-6 px-4 py-20 sm:px-6 lg:px-12 2xl:px-16 lg:grid-cols-2">
      <div data-reveal="ladder" className="rounded-3xl bg-surface p-6 ring-1 ring-line/70 sm:p-8">
        <Strikes total={3} used={0} size={30} />
        <h2 className="mt-5 text-3xl font-bold">One bad day won’t cost you</h2>
        <p className="mt-3 text-slate">
          Most challenges give you three free strikes. Penalties only start after those run out, and creators pick from
          approved structures, never their own.
        </p>
        <table className="mt-6 w-full text-[15px]">
          <caption className="sr-only">Standard penalty structure</caption>
          <tbody className="divide-y divide-line">
            {ladder.map((r) => (
              <tr key={r.miss} data-ladder-row>
                <th scope="row" className="py-2.5 text-left font-medium">
                  {r.miss}
                </th>
                <td className={cx('py-2.5 text-right font-display font-semibold tabular', r.free ? 'text-calm' : 'text-ink')}>
                  {r.cost}
                </td>
                <td className="w-32 py-2.5 pl-4 text-right text-sm text-slate">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-3xl bg-ink p-6 text-white sm:p-8">
        <span className="grid size-12 place-items-center rounded-2xl bg-white/10">
          <CloudOff size={22} />
        </span>
        <h2 className="mt-5 text-3xl font-bold">If GitHub goes down, you don’t</h2>
        <p className="mt-3 text-white/70">
          A verification is never just pass or fail. When a provider is unreachable we keep retrying, and nothing counts
          against you until there’s real evidence either way.
        </p>
        <ul data-reveal="proofs" className="mt-6 space-y-3">
          {(
            [
              ['verified', 'The requirement was proven.'],
              ['pending', 'We’re still checking.'],
              ['unavailable', 'The provider was down. Retrying, not counted.'],
              ['disputed', 'You contested the result. Funds stay put until it’s resolved.'],
              ['failed', 'Reliable evidence shows the day was missed.'],
            ] as const
          ).map(([state, text]) => (
            <li key={state} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
              <span className="w-56 shrink-0">
                <ProofChip state={state} />
              </span>
              <span className="text-[15px] text-white/75">{text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* --------------------------------------------------------- Verification */

const providerTitle: Partial<Record<Provider, string>> & Record<'GitHub' | 'Solana' | 'LeetCode' | 'Codeforces' | 'WakaTime' | 'Camera' | 'Health' | 'Photo', string> = {
  GitHub: 'GitHub',
  Solana: 'Solana',
  LeetCode: 'LeetCode',
  Codeforces: 'Codeforces',
  WakaTime: 'WakaTime',
  Camera: 'Phone camera',
  Health: 'Phone health data',
  Photo: 'Photo proof',
}

const checks: { provider: keyof typeof providerTitle & Provider; what: string[] }[] = [
  { provider: 'GitHub', what: ['Commits with real diffs', 'Pull requests and merges', 'Releases'] },
  { provider: 'Solana', what: ['Program deployments', 'Transactions', 'Contract interactions'] },
  { provider: 'LeetCode', what: ['Accepted submissions', 'Difficulty', 'Problems you hadn’t solved before'] },
  { provider: 'Codeforces', what: ['Accepted solutions', 'Problem rating', 'Problems you hadn’t solved before'] },
  { provider: 'WakaTime', what: ['Minutes of coding a day', 'Tracked in your editor', 'Hard to fake'] },
  { provider: 'Camera', what: ['Push-ups, sit-ups and squats', 'Counted on your phone', 'Video never uploaded'] },
  { provider: 'Health', what: ['Daily steps', 'Walking and running distance', 'Apple Health or Health Connect'] },
  { provider: 'Photo', what: ['Anything without an integration', 'Checked for edits and reuse', 'Reviewed before it counts'] },
]

function Verification() {
  return (
    <section className="border-y border-line bg-surface">
      <div className="mx-auto max-w-[120rem] px-4 py-20 sm:px-6 lg:px-12 2xl:px-16">
        <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
          <div>
            <h2 className="text-3xl font-bold sm:text-4xl">Your work proves itself</h2>
            <p className="mt-3 text-lg text-slate">
              No honour system. Connect the account you already use, or let your phone count your reps and steps, and
              progress is checked against meaningful criteria. Commit spam and recycled answers don’t count.
            </p>
            <Link to="/verification" className="mt-4 inline-block font-semibold text-cobalt hover:underline">
              See what each integration checks
            </Link>
          </div>
          <ul data-reveal="providers" className="grid gap-px overflow-hidden rounded-2xl bg-line ring-1 ring-line sm:grid-cols-2">
            {checks.map((c) => (
              <li key={c.provider} className="bg-surface p-6">
                <div className="flex items-center gap-2.5">
                  <ProviderMark provider={c.provider} size={22} />
                  <h3 className="font-sans text-lg font-semibold">{providerTitle[c.provider]}</h3>
                </div>
                <ul className="mt-3 space-y-1 text-[15px] text-slate">
                  {c.what.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

/* -------------------------------------------------------- Organizations */

function Organizations() {
  const top = useApiData<OrgRank[]>('/leaderboards/orgs').data?.[0]
  return (
    <section className="mx-auto max-w-[120rem] px-4 py-20 sm:px-6 lg:px-12 2xl:px-16">
      <div className="relative overflow-hidden rounded-[32px] bg-ink px-6 py-10 text-white sm:px-10 sm:py-14">
        <SponsorTexture className="opacity-[0.12]" />
        <div className="relative grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-end">
          <div>
            <h2 className="max-w-[16ch] text-4xl font-bold sm:text-5xl">Run a challenge for your community</h2>
            <p className="mt-4 max-w-xl text-lg text-white/70">
              Universities, companies, developer ecosystems and brands use Stake-Sync to run public competitions and
              private team challenges, with or without a stake.
            </p>
            <ul className="mt-6 grid gap-2 text-[15px] text-white/85 sm:grid-cols-2">
              {[
                'Sponsor a reward pool',
                'Invite members by link or code',
                'Track everyone’s progress live',
                'Post announcements in chat',
                'Moderate your community',
                'Export results when it ends',
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-gold" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button to="/signup" variant="gold" size="lg">
                Set up your organization
              </Button>
              <Link to="/organizations" className={buttonClass('ghost', 'lg', 'text-white hover:bg-white/10')}>
                Learn more
              </Link>
            </div>
          </div>

          {top && (
            <div className="rounded-3xl bg-white/[0.06] p-6 ring-1 ring-white/10">
              <div className="flex items-center gap-3">
                <Avatar person={top.person} size={40} />
                <div>
                  <div className="font-semibold">{top.name}</div>
                  <div className="text-sm text-white/60">Top organization this month</div>
                </div>
              </div>
              <dl className="mt-6 grid grid-cols-3 gap-3">
                {(
                  [
                    ['Active', top.active, 'int'],
                    ['Challenges', top.challenges, 'int'],
                    ['Sponsored', top.sponsored, 'usd'],
                  ] as const
                ).map(([k, v, f]) => (
                  <div key={k}>
                    <dt className="text-sm text-white/55">{k}</dt>
                    <dd className="font-display text-xl font-semibold tabular sm:text-2xl">{f === 'usd' ? usd(v) : v.toLocaleString('en-US')}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-6">
                <div className="flex justify-between text-sm text-white/60">
                  <span>Completion rate</span>
                  <span className="tabular">{Math.round(top.rate)}%</span>
                </div>
                <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-white/10">
                  <span className="bg-cobalt" style={{ width: `${Math.min(100, top.rate)}%` }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------- Reputation */

function Reputation() {
  const top = useApiData<PersonRank[]>('/leaderboards/people').data?.[0]
  const achievements = useApiData<Achievement[], { achievements?: Achievement[] }>(top ? `/users/${encodeURIComponent(top.person.handle)}` : null, (r) => r.achievements ?? []).data ?? []
  return (
    <section className="mx-auto grid max-w-[120rem] gap-10 px-4 pb-20 sm:px-6 lg:px-12 2xl:px-16 lg:grid-cols-[1fr_1.1fr] lg:items-center">
      <div>
        <h2 className="text-3xl font-bold sm:text-4xl">A record of doing what you said</h2>
        <p className="mt-3 text-lg text-slate">
          Every finished challenge adds a verified achievement to your profile. Your commitment score weighs difficulty,
          consistency and verification strength. How much you stake never buys you reputation.
        </p>
      </div>

      {top && (
        <div className="rounded-3xl bg-surface p-6 ring-1 ring-line/70 sm:p-8">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar person={top.person} size={56} />
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold">{top.person.name}</div>
              <div className="text-sm text-slate">
                {top.completed} challenges completed, {top.rate.toFixed(1)}%
              </div>
            </div>
            <div className="flex w-full items-baseline justify-between border-t border-line pt-4 sm:block sm:w-auto sm:border-0 sm:pt-0 sm:text-right">
              <div className="order-2 font-display text-4xl font-bold text-cobalt tabular">{top.score}</div>
              <div className="text-sm text-slate">Commitment score</div>
            </div>
          </div>
          {achievements.length > 0 && (
            <ul className="mt-6 divide-y divide-line border-t border-line">
              {achievements.slice(0, 3).map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-3.5">
                  <span className="grid size-9 place-items-center rounded-xl bg-ground">
                    <ProviderMark provider={a.provider} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{a.title}</div>
                    <div className="truncate text-sm text-slate">{a.detail}</div>
                  </div>
                  <span className="text-sm text-slate">{a.earned}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

/* -------------------------------------------------------------- Closing */

function Closing() {
  return (
    <section className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-[120rem] flex-col items-start gap-8 px-4 py-20 sm:px-6 lg:px-12 2xl:px-16 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="max-w-[20ch] text-4xl font-bold sm:text-5xl">Pick something you keep putting off</h2>
          <p className="mt-3 text-lg text-slate">Create an account in a minute. Most challenges start this week.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button to="/signup" size="lg">
            Create your account
          </Button>
          <Button to="/login" size="lg" variant="secondary">
            Log in
          </Button>
        </div>
      </div>
    </section>
  )
}
