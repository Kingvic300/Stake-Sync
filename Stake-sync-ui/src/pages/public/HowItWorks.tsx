import { Check, Lock, Snowflake } from 'lucide-react'
import { useRef, type RefObject } from 'react'
import { DayGrid, Strikes } from '../../components/DayGrid'
import { CtaBand, Faq, PageIntro, SectionHead } from '../../components/marketing'
import { Button, ProviderMark, ProofChip } from '../../components/ui'
import type { Challenge } from '../../data/types'
import { useApiData } from '../../lib/useApiData'
import { stakeLabel } from '../../lib/styles'
import type { DayRecord } from '../../data/types'
import { cx, usd } from '../../lib/format'
import { gsap, motionOK, useGSAP } from '../../lib/gsap'
import { useReveal } from '../../lib/useReveal'

const loop = [
  ['Discover', 'Browse challenges by category, stake, reward and how they’re verified.'],
  ['Join', 'Read every rule up front, then accept them before you commit.'],
  ['Stake', 'Put down the stake from your balance. It goes into escrow, not to us.'],
  ['Perform', 'Do the work: code, run, solve, ship.'],
  ['Verify', 'GitHub, Solana, LeetCode, Codeforces or WakaTime confirm it automatically.'],
  ['Interact', 'Chat, cheer people on and watch the leaderboard move.'],
  ['Complete', 'Hit the requirement by the end date.'],
  ['Settle', 'The escrow program pays out by the rules everyone agreed to.'],
  ['Build reputation', 'A verified achievement lands on your profile.'],
]

export function HowItWorks() {
  const root = useRef<HTMLDivElement>(null)
  useReveal(root)
  useLoopLine(root)

  return (
    <div ref={root}>
      <PageIntro
        title="How Stake‑Sync works"
        intro="You pick a goal with clear rules, put a stake behind it, and let the tools you already use prove you did the work. Follow through and you get your stake back, plus rewards."
      >
        <Button to="/signup" size="lg">
          Get started
        </Button>
      </PageIntro>

      <LoopSection />
      <RulesSection />
      <StakeSection />
      <StrikesSection />
      <DisputeSection />
      <RewardsSection />
      <AddMoneySection />

      <section className="mx-auto max-w-[120rem] px-4 py-20 sm:px-6 lg:px-12 2xl:px-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
          <SectionHead title="Questions people ask" />
          <Faq
            items={[
              {
                q: 'What happens if I miss a day?',
                a: 'You use a strike. Most challenges give three free strikes, and nothing is taken from your stake until those run out. The exact rules are on every challenge page before you join.',
              },
              {
                q: 'Can Stake-Sync take my stake?',
                a: 'No. Stakes are held by the escrow program on Solana. It only releases money according to the rules locked in when the challenge started. Admins have no withdrawal access.',
              },
              {
                q: 'What if GitHub or LeetCode is down on my deadline?',
                a: 'That day is marked “provider down” and doesn’t count against you. We keep retrying, and if the provider never recovers you can settle it through a dispute.',
              },
              {
                q: 'Do I need to understand crypto?',
                a: 'No. Soon you’ll be able to add money in naira or your local currency, converted to USDC, a digital dollar, by our payment partner. If you already have a Solana wallet, you can connect it instead.',
              },
              {
                q: 'Why USDC, and what does converting cost?',
                a: 'USDC follows the US dollar, so your balance isn’t eaten by naira inflation during a challenge (it still moves with the dollar and the exchange rate). It’s issued by Circle and isn’t a bank deposit. LocalRamp, our payment partner, charges a fee each way and shows the exact rate and amount before you pay.',
              },
              {
                q: 'Are there challenges without a stake?',
                a: 'Yes. Creators can run no-stake challenges, and many company and community challenges use them. You still get verified achievements for finishing.',
              },
              {
                q: 'Can the rules change after I join?',
                a: 'Not materially. Once participants have committed, the stake, strike and reward rules are fixed unless everyone agrees to a change.',
              },
            ]}
          />
        </div>
      </section>

      <CtaBand title="Pick a goal and put something behind it" body="Create an account, add money your way, and join a challenge that starts this week." />
    </div>
  )
}

function useLoopLine(root: RefObject<HTMLDivElement | null>) {
  useGSAP(
    () => {
      gsap.matchMedia().add(motionOK, () => {
        // The line draws with your scroll and each stop lights as it's reached.
        gsap.from('[data-loop-line]', {
          scaleY: 0,
          transformOrigin: 'top center',
          ease: 'none',
          scrollTrigger: { trigger: '[data-loop]', start: 'top 70%', end: 'bottom 60%', scrub: 0.6 },
        })
        gsap.utils.toArray<HTMLElement>('[data-loop-stop]').forEach((stop) => {
          gsap.from(stop.querySelector('[data-dot]'), {
            backgroundColor: '#e3e7ee',
            color: '#5c6375',
            scale: 0.8,
            duration: 0.35,
            clearProps: 'all',
            scrollTrigger: { trigger: stop, start: 'top 62%', toggleActions: 'play none none reverse' },
          })
        })
      })
    },
    { scope: root },
  )
}

function LoopSection() {
  return (
    <section className="border-y border-line bg-surface">
      <div className="mx-auto grid max-w-[120rem] gap-12 px-4 py-20 sm:px-6 lg:px-12 2xl:px-16 lg:grid-cols-[1fr_1.4fr]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHead
            title="The whole loop, start to finish"
            intro="Every challenge follows the same nine steps. The money and the rules never change halfway."
          />
        </div>
        <ol data-loop className="relative">
          <span data-loop-line aria-hidden className="absolute top-5 bottom-5 left-5 w-0.5 bg-cobalt" />
          {loop.map(([title, body], i) => (
            <li key={title} data-loop-stop className="relative grid grid-cols-[2.5rem_1fr] gap-5 pb-9 last:pb-0">
              <span
                data-dot
                className="relative z-10 grid size-10 place-items-center rounded-full bg-cobalt font-display text-sm font-bold text-white ring-4 ring-surface tabular"
              >
                {i + 1}
              </span>
              <div className="pt-1.5">
                <h3 className="text-xl font-semibold">{title}</h3>
                <p className="mt-1 text-[16px] text-slate">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function RulesSection() {
  // A real challenge that's open right now, shown the way people see it before joining.
  const c = useApiData<Challenge | undefined, { items: Challenge[] }>('/challenges?status=open&limit=1', (r) => r.items[0]).data
  const rules: [string, string][] = c
    ? [
        ['Requirement', c.requirement],
        ['Duration', `${c.durationDays} days, starting ${new Date(`${c.startsAt}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`],
        ['Stake', stakeLabel(c)],
        ...(c.sponsorPool > 0 ? [['Sponsor reward', `${usd(c.sponsorPool)} pool`] as [string, string]] : []),
        ['Reward split', c.distribution],
        ['Strikes', c.penalties.length ? `${c.freeStrikes} free, then ${c.penalties.join('%, ')}% of stake` : `${c.freeStrikes} free`],
        ['Verification', `${c.providers.join(' + ')}, checked daily`],
        ['Disputes', 'Open within 48 hours of a result'],
      ]
    : []
  return (
    <section className="mx-auto grid max-w-[120rem] gap-12 px-4 py-20 sm:px-6 lg:px-12 2xl:px-16 lg:grid-cols-2 lg:items-center">
      <div>
        <SectionHead
          title="You see every rule before you stake"
          intro="Each challenge lists exactly how it’s verified, what a miss costs and how rewards are split. You accept those rules before you join, and they’re locked once people have committed."
        />
        <ul data-reveal-group className="mt-8 space-y-3 text-[16px]">
          {['No hidden conditions or fine print', 'Creators pick from approved penalty structures', 'Material changes need everyone’s consent'].map((t) => (
            <li key={t} className="flex items-start gap-3">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-calm-soft text-calm">
                <Check size={14} strokeWidth={3} />
              </span>
              {t}
            </li>
          ))}
        </ul>
      </div>
      {c && (
        <div className="rounded-3xl bg-surface p-6 shadow-(--shadow-lift) ring-1 ring-line/70 sm:p-8">
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-bold">{c.title}</h3>
            <span className="inline-flex items-center gap-1.5 text-sm text-slate">
              <Lock size={14} /> Rules locked
            </span>
          </div>
          <dl data-reveal-group className="mt-5 divide-y divide-line">
            {rules.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-4 py-3 text-[15px]">
                <dt className="text-slate">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <label className="mt-5 flex items-center gap-3 rounded-2xl bg-ground p-4 text-[15px] font-semibold">
            <span className="grid size-5 place-items-center rounded-md bg-cobalt text-white">
              <Check size={14} strokeWidth={3} />
            </span>
            I’ve read and accept these rules
          </label>
        </div>
      )}
    </section>
  )
}

function StakeSection() {
  const kinds = [
    ['No stake', 'Join for free. Great for team challenges and first-timers.', '$0'],
    ['Fixed stake', 'Everyone puts in the same amount, like $20.', '$20'],
    ['Choose your stake', 'Pick an amount inside the creator’s range.', '$5–$50'],
  ]
  return (
    <section className="border-y border-line bg-surface">
      <div className="mx-auto max-w-[120rem] px-4 py-20 sm:px-6 lg:px-12 2xl:px-16">
        <SectionHead
          title="Your stake is collateral, not a fee"
          intro="It sits in a Solana escrow program for the length of the challenge. Nobody at Stake-Sync can move it. Finish, and it comes back to you."
        />
        <div data-reveal-group className="mt-10 grid gap-4 md:grid-cols-3">
          {kinds.map(([t, b, v]) => (
            <div key={t} className="rounded-3xl bg-ground p-6">
              <div className="font-display text-4xl font-bold tabular">{v}</div>
              <h3 className="mt-4 text-xl font-semibold">{t}</h3>
              <p className="mt-1 text-slate">{b}</p>
            </div>
          ))}
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-4">
          {[
            ['Your stake', 'What you put in, shown on every screen.', 'bg-ink'],
            ['Sponsor pool', 'Prize money added by organizations and brands.', 'bg-gold'],
            ['Forfeited', 'Only what the rules you accepted say can be lost.', 'bg-miss'],
            ['Claimable', 'What you can withdraw once the challenge settles.', 'bg-calm'],
          ].map(([k, v, dot]) => (
            <div key={k} className="border-t-2 border-line pt-4">
              <div className="flex items-center gap-2 font-semibold">
                <span className={cx('size-2.5 rounded-full', dot)} />
                {k}
              </div>
              <p className="mt-1.5 text-[15px] text-slate">{v}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const strikeDays: DayRecord[] = Array.from({ length: 30 }, (_, i) => {
  const day = i + 1
  if ([6, 14].includes(day)) return { day, state: 'failed' }
  if ([20, 21].includes(day)) return { day, state: 'frozen' }
  if (day > 24) return { day, state: 'upcoming' }
  return { day, state: 'verified' }
})

function StrikesSection() {
  return (
    <section className="mx-auto max-w-[120rem] px-4 py-20 sm:px-6 lg:px-12 2xl:px-16">
      <SectionHead
        title="Life happens. The rules allow for it."
        intro="Strikes absorb your first misses. Emergency freezes pause a challenge for a few days when something serious comes up."
      />
      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        <div className="rounded-3xl bg-surface p-6 ring-1 ring-line/70 sm:p-8">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">Strikes before penalties</h3>
            <Strikes total={3} used={2} size={22} />
          </div>
          <DayGrid days={strikeDays} size="md" className="mt-6" />
          <p className="mt-4 text-[15px] text-slate">
            Two misses so far, both covered by strikes. One strike left before the 5% penalty starts.
          </p>
          <table className="mt-5 w-full text-[15px]">
            <caption className="sr-only">Standard penalty structure</caption>
            <tbody className="divide-y divide-line">
              {[
                ['Misses 1 to 3', 'Free'],
                ['4th miss', '5% of stake'],
                ['5th miss', 'another 10%'],
                ['6th miss', 'another 15%'],
              ].map(([k, v], i) => (
                <tr key={k}>
                  <th scope="row" className="py-2.5 text-left font-medium">
                    {k}
                  </th>
                  <td className={cx('py-2.5 text-right font-semibold', i === 0 && 'text-calm')}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-3xl bg-ink p-6 text-white sm:p-8">
          <span className="grid size-12 place-items-center rounded-2xl bg-white/10">
            <Snowflake size={22} />
          </span>
          <h3 className="mt-5 text-xl font-semibold">Emergency freeze</h3>
          <p className="mt-2 text-white/70">
            A freeze pauses your requirements for a set number of days, like days 20 and 21 above. To keep it fair:
          </p>
          <ul data-reveal-group className="mt-5 space-y-3 text-[15px] text-white/85">
            {[
              'One freeze per challenge',
              'A fixed number of days, set by the creator',
              'Can’t be used after a day has already been missed',
              'Only available if the creator allows freezes',
            ].map((t) => (
              <li key={t} className="flex items-start gap-3">
                <Check size={18} className="mt-0.5 shrink-0 text-gold" strokeWidth={2.5} />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function DisputeSection() {
  const steps = [
    ['You open a dispute', 'Choose the result, explain what happened and add links or evidence.', 'disputed'],
    ['A moderator reviews it', 'They inspect the verification data and what the provider reported.', 'pending'],
    ['They decide', 'Approve the day, confirm the miss, or ask you for more evidence.', 'verified'],
  ] as const
  return (
    <section className="border-y border-line bg-surface">
      <div className="mx-auto grid max-w-[120rem] gap-12 px-4 py-20 sm:px-6 lg:px-12 2xl:px-16 lg:grid-cols-[1fr_1.3fr]">
        <SectionHead
          title="If verification gets it wrong, you can contest it"
          intro="Any money affected by a disputed result stays locked until it’s resolved. It can’t be paid out or forfeited in the meantime."
        />
        <ol data-reveal-group className="space-y-4">
          {steps.map(([t, b, s], i) => (
            <li key={t} className="flex gap-5 rounded-3xl bg-ground p-5 sm:p-6">
              <span className="font-display text-3xl font-bold text-slate/40 tabular">{i + 1}</span>
              <div className="flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold">{t}</h3>
                  <ProofChip state={s} />
                </div>
                <p className="mt-1 text-[15px] text-slate">{b}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function RewardsSection() {
  return (
    <section className="mx-auto grid max-w-[120rem] gap-12 px-4 py-20 sm:px-6 lg:px-12 2xl:px-16 lg:grid-cols-2">
      <div>
        <SectionHead title="Where rewards come from" intro="Finishing gets your stake back. Rewards on top come from:" />
        <ul data-reveal-group className="mt-8 divide-y divide-line border-y border-line">
          {[
            ['Sponsors', 'Brands and ecosystems fund prize pools to grow their communities.'],
            ['Organizations', 'Universities and companies reward their own members.'],
            ['Stake-Sync', 'We fund rewards on selected challenges.'],
            ['Forfeited stakes', 'Where the law allows, split between the people who finished.'],
          ].map(([t, b]) => (
            <li key={t} className="py-4">
              <h3 className="font-sans text-lg font-semibold">{t}</h3>
              <p className="text-[15px] text-slate">{b}</p>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <SectionHead
          title="And a reputation you can point to"
          intro="Your commitment score reflects how you follow through. It’s earned, never bought: the size of your stake has no effect on it."
        />
        <div className="mt-8 rounded-3xl bg-surface p-6 ring-1 ring-line/70">
          <div className="flex items-baseline justify-between">
            <span className="text-slate">Commitment score</span>
            <span className="font-display text-5xl font-bold text-cobalt tabular" data-count="941">
              941
            </span>
          </div>
          <ul className="mt-6 space-y-3">
            {[
              ['Completion', 93],
              ['Consistency', 88],
              ['Challenge difficulty', 76],
              ['Verification strength', 95],
            ].map(([k, v]) => (
              <li key={k}>
                <div className="flex justify-between text-[15px]">
                  <span>{k}</span>
                  <span className="text-slate tabular">{v}</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-tile">
                  <span data-grow="x" className="block h-full rounded-full bg-cobalt" style={{ width: `${v}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function AddMoneySection() {
  return (
    <section className="border-y border-line bg-surface">
      <div className="mx-auto max-w-[120rem] px-4 py-20 sm:px-6 lg:px-12 2xl:px-16">
        <SectionHead
          title="Add money the way that suits you"
          intro="When you sign up we ask whether you’ve used a crypto wallet before, then set you up accordingly."
        />
        <div data-reveal-group className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="rounded-3xl bg-ground p-6 sm:p-8">
            <h3 className="text-2xl font-bold">New to crypto</h3>
            <p className="mt-2 text-slate">
              We create a wallet for you behind the scenes. Pay by bank transfer or card in naira, cedi, shilling or
              dollars, and it arrives as USDC.
            </p>
            <div className="mt-6 flex items-center justify-between rounded-2xl bg-surface p-4 ring-1 ring-line">
              <span className="font-display text-xl font-semibold tabular">₦31,000</span>
              <span className="text-slate">becomes</span>
              <span className="font-display text-xl font-semibold tabular">19.76 USDC</span>
            </div>
          </div>
          <div className="rounded-3xl bg-ground p-6 sm:p-8">
            <h3 className="text-2xl font-bold">Already have a wallet</h3>
            <p className="mt-2 text-slate">
              Connect Phantom, Solflare or Backpack and top up in USDC. Your wallet also unlocks Solana-verified
              challenges.
            </p>
            <div className="mt-6 flex items-center gap-3 rounded-2xl bg-surface p-4 ring-1 ring-line">
              <ProviderMark provider="Solana" size={20} />
              <span className="font-semibold">Phantom connected</span>
              <span className="ml-auto text-slate tabular">7Gk3…q9Xa</span>
            </div>
          </div>
        </div>
        <p className="mt-6 text-[15px] text-slate">
          Either way, joining a challenge moves your stake from your balance into escrow. Creating a sponsored challenge
          does the same with the reward pool.
        </p>
      </div>
    </section>
  )
}
