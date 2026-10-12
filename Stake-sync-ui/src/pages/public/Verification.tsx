import { Check, CloudOff, Eye, KeyRound, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { useRef } from 'react'
import { CtaBand, PageIntro, SectionHead } from '../../components/marketing'
import { Button, ProviderMark, ProofChip } from '../../components/ui'
import type { ProofState, Provider } from '../../data/types'
import { cx } from '../../lib/format'
import { useReveal } from '../../lib/useReveal'

const titles: Record<Provider, string> = {
  GitHub: 'GitHub',
  Solana: 'Solana',
  LeetCode: 'LeetCode',
  Codeforces: 'Codeforces',
  WakaTime: 'WakaTime',
  Camera: 'Phone camera',
  Health: 'Phone health data',
  Photo: 'Photo proof',
}

const adapters: { provider: Provider; counts: string[]; ignored: string[]; example: string }[] = [
  {
    provider: 'GitHub',
    counts: ['Commits with real code changes', 'Opened and merged pull requests', 'Published releases', 'Activity on the days you need it'],
    ignored: ['Empty or formatting-only commits', 'Bulk commits backdated to fill gaps', 'Activity on repositories you don’t own or contribute to'],
    example: '30 Days of Code: qualifying activity on 25 of 30 days',
  },
  {
    provider: 'Solana',
    counts: ['Program deployments and upgrades', 'Transactions from your linked wallet', 'Interactions with specific programs', 'Activity on devnet or mainnet'],
    ignored: ['Transactions from wallets you haven’t linked', 'Self-transfers designed to look like activity'],
    example: '30-Day Solana Builder: one devnet deployment every week',
  },
  {
    provider: 'LeetCode',
    counts: ['Accepted submissions', 'Number of problems solved', 'Difficulty: Easy, Medium, Hard', 'Problems you hadn’t solved before'],
    ignored: ['Resubmitting a problem you already solved', 'Submissions that didn’t pass'],
    example: 'A campus DSA sprint: 50 new problems, 10 or more Medium or Hard',
  },
  {
    provider: 'Codeforces',
    counts: ['Accepted solutions', 'Number of problems solved', 'A minimum problem rating', 'Problems you hadn’t solved before'],
    ignored: ['Resubmitting a problem you already solved', 'Submissions that didn’t pass'],
    example: 'Contest Prep Sprint: one new 1200+ rated problem a day',
  },
  {
    provider: 'WakaTime',
    counts: ['Minutes of coding tracked in your editor', 'Coding time on the days you need it', 'Time per project and language'],
    ignored: ['Time with the editor open but idle', 'Time added by hand'],
    example: 'Code an Hour a Day: 60 tracked minutes on 25 of 30 days',
  },
  {
    provider: 'Camera',
    counts: ['Full push-ups, sit-ups and squats', 'Reps counted live by your phone camera', 'Sets spread across the day'],
    ignored: ['Half reps that don’t go all the way down', 'Arm pumps while standing instead of push-ups', 'Video: it never leaves your phone'],
    example: '100 Push-ups a Day: 100 camera-counted reps on 18 of 21 days',
  },
  {
    provider: 'Health',
    counts: ['Daily steps from Apple Health or Health Connect', 'Walking and running distance', 'Data recorded by your phone or watch'],
    ignored: ['Steps you typed in by hand', 'Data added by other apps after the day ended'],
    example: '10,000 Steps a Day: synced each evening by the Stake-Sync mobile app',
  },
  {
    provider: 'Photo',
    counts: ['A photo taken today of your progress', 'Approved by reviewers within hours', 'Anything without an integration'],
    ignored: ['Old, edited or duplicate photos', 'The same photo used twice or by two accounts'],
    example: 'Read 20 Pages a Day: a photo of the page you reached, reviewed by other readers',
  },
]

const outage: { time: string; state: ProofState; text: string }[] = [
  { time: '8:55 pm', state: 'pending', text: 'Daily check starts for day 16' },
  { time: '8:55 pm', state: 'unavailable', text: 'GitHub API not responding. Day 16 is not counted against you.' },
  { time: '9:40 pm', state: 'unavailable', text: 'Retry 3 of 12. Still down. Outage flagged across all GitHub challenges.' },
  { time: '11:10 pm', state: 'verified', text: 'GitHub is back. 3 commits found from earlier today. Day 16 verified.' },
]

export function Verification() {
  const root = useRef<HTMLDivElement>(null)
  useReveal(root)

  return (
    <div ref={root}>
      <PageIntro
        title="Proof, not promises"
        intro="No honour system. Stake-Sync reads your progress from the tools you already use or counts it with your phone, checks it against meaningful criteria, and never penalises you for someone else’s outage. Photos are a last resort, and always reviewed."
      >
        <Button to="/signup" size="lg">
          Get started
        </Button>
      </PageIntro>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[120rem] px-4 py-20 sm:px-6 lg:px-12 2xl:px-16">
          <SectionHead
            title="What each integration checks"
            intro="Every challenge spells out which of these it uses. Counting raw actions is easy to game, so each one looks for real work."
          />
          <div className="mt-12 space-y-4">
            {adapters.map((a) => (
              <article key={a.provider} className="grid gap-6 rounded-3xl bg-ground p-6 sm:p-8 lg:grid-cols-[13rem_1fr_1fr]">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="grid size-12 place-items-center rounded-2xl bg-surface ring-1 ring-line">
                      <ProviderMark provider={a.provider} size={24} />
                    </span>
                    <h3 className="text-2xl font-bold">{titles[a.provider]}</h3>
                  </div>
                  {a.provider === 'Health' && (
                    <span className="mt-3 inline-flex rounded-full bg-cobalt-soft px-2.5 py-1 text-xs font-semibold text-cobalt-deep">Mobile app</span>
                  )}
                  <p className="mt-4 text-sm text-slate">{a.example}</p>
                </div>
                <div>
                  <h4 className="font-sans text-sm font-semibold">Counts</h4>
                  <ul data-reveal-group className="mt-3 space-y-2 text-[15px]">
                    {a.counts.map((c) => (
                      <li key={c} className="flex items-start gap-2.5">
                        <Check size={17} strokeWidth={3} className="mt-0.5 shrink-0 text-cobalt" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="font-sans text-sm font-semibold">Doesn’t count</h4>
                  <ul data-reveal-group className="mt-3 space-y-2 text-[15px] text-slate">
                    {a.ignored.map((c) => (
                      <li key={c} className="flex items-start gap-2.5">
                        <X size={17} strokeWidth={3} className="mt-0.5 shrink-0 text-miss" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[120rem] px-4 py-20 sm:px-6 lg:px-12 2xl:px-16">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <SectionHead
              title="Five states, not pass or fail"
              intro="A result is only “missed” when there’s reliable evidence. Everything in between is handled separately, so a technical problem never becomes your problem."
            />
            <ul data-reveal-group className="mt-8 space-y-4">
              {(
                [
                  ['verified', 'The requirement was proven.'],
                  ['failed', 'Reliable evidence shows it wasn’t done.'],
                  ['pending', 'The check hasn’t finished yet.'],
                  ['unavailable', 'The provider was down. Not counted, and retried.'],
                  ['disputed', 'You contested the result. Money stays locked until it’s settled.'],
                ] as const
              ).map(([s, t]) => (
                <li key={s} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
                  <span className="w-56 shrink-0">
                    <ProofChip state={s} />
                  </span>
                  <span className="text-[15px] text-slate">{t}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-3xl bg-ink p-6 text-white sm:p-8">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl bg-white/10">
                <CloudOff size={20} />
              </span>
              <div>
                <h3 className="text-xl font-semibold">An outage, as you’d see it</h3>
                <p className="text-sm text-white/60">30 Days of Code, day 16</p>
              </div>
            </div>
            <ol data-reveal-group className="relative mt-7 space-y-6 border-l border-white/15 pl-6">
              {outage.map((o, i) => (
                <li key={i} className="relative">
                  <span
                    className={cx(
                      'absolute top-1.5 -left-[29px] size-2.5 rounded-full ring-4 ring-ink',
                      o.state === 'verified' ? 'bg-cobalt' : o.state === 'unavailable' ? 'bg-white/40' : 'bg-gold',
                    )}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-white/55 tabular">{o.time}</span>
                    <ProofChip state={o.state} />
                  </div>
                  <p className="mt-1.5 text-[15px] text-white/85">{o.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[120rem] px-4 py-20 sm:px-6 lg:px-12 2xl:px-16">
          <SectionHead title="Built for when things break" intro="External services fail now and then. The platform plans for it." />
          <div data-reveal-group className="mt-10 grid gap-px overflow-hidden rounded-3xl bg-line ring-1 ring-line sm:grid-cols-2 lg:grid-cols-3">
            {[
              [RefreshCw, 'Automatic retries', 'Failed checks retry with backoff for up to 24 hours.'],
              [CloudOff, 'Outage detection', 'When many checks fail at once, the provider is flagged and nobody is penalised.'],
              [Eye, 'Delayed verification', 'Activity that shows up late, like a slow health-data sync, still counts for its day.'],
              [ShieldCheck, 'Cached results', 'Once a day is verified it stays verified, even if the provider goes down later.'],
              [KeyRound, 'Manual fallback', 'If automation can’t decide, a moderator reviews it through a dispute.'],
              [Check, 'No automatic penalties', 'A technical failure can never trigger a financial penalty on its own.'],
            ].map(([Icon, t, b]) => {
              const I = Icon as typeof Check
              return (
                <div key={t as string} className="bg-surface p-6">
                  <I size={22} className="text-cobalt" />
                  <h3 className="mt-4 font-sans text-lg font-semibold">{t as string}</h3>
                  <p className="mt-1 text-[15px] text-slate">{b as string}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[120rem] px-4 py-20 sm:px-6 lg:px-12 2xl:px-16">
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <SectionHead
              title="One person, one identity"
              intro="Because real money is involved, we make it hard to farm rewards with extra accounts."
            />
            <ul data-reveal-group className="mt-8 space-y-4 text-[16px]">
              {[
                'Each GitHub, LeetCode, Codeforces or WakaTime account, or wallet, can belong to only one Stake-Sync profile.',
                'We look for repeated funding patterns, identical proofs and coordinated farming.',
                'Suspicious activity is reviewed by a person before any action is taken on your money.',
              ].map((t) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-cobalt" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div data-reveal-group className="space-y-3">
            {[
              ['Basic verification', 'Free and low-value challenges', 'Email and one connected account', 1],
              ['Verified user', 'Most staked challenges', 'Phone, wallet and an established provider account', 2],
              ['Enhanced verification', 'High-value sponsored competitions', 'Everything above, plus identity checks where required', 3],
            ].map(([t, when, needs, level]) => (
              <div key={t as string} className="rounded-3xl bg-surface p-6 ring-1 ring-line/70">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="font-sans text-lg font-semibold">{t as string}</h3>
                  <span className="flex gap-1" aria-label={`Level ${level} of 3`}>
                    {[1, 2, 3].map((n) => (
                      <span key={n} className={cx('h-2 w-6 rounded-full', n <= (level as number) ? 'bg-cobalt' : 'bg-tile')} />
                    ))}
                  </span>
                </div>
                <p className="mt-1 text-[15px] text-slate">
                  For {(when as string).toLowerCase()}. Needs {(needs as string).toLowerCase()}.
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-[120rem] gap-10 px-4 py-20 sm:px-6 lg:px-12 2xl:px-16 lg:grid-cols-2">
          <SectionHead
            title="Read-only, always"
            intro="We ask for the narrowest access each provider offers. We can see your activity; we can’t act on your behalf."
          />
          <dl data-reveal-group className="grid gap-px overflow-hidden rounded-3xl bg-line ring-1 ring-line sm:grid-cols-2">
            <div className="bg-surface p-6">
              <dt className="font-semibold text-calm">We can</dt>
              <dd className="mt-2 space-y-1.5 text-[15px] text-slate">
                <p>Read public activity and contribution history</p>
                <p>Read workout summaries you’ve synced</p>
                <p>Read transactions from wallets you link</p>
              </dd>
            </div>
            <div className="bg-surface p-6">
              <dt className="font-semibold text-[oklch(50%_0.18_23)]">We never</dt>
              <dd className="mt-2 space-y-1.5 text-[15px] text-slate">
                <p>Push code or open pull requests</p>
                <p>Post to your accounts</p>
                <p>Move funds from your wallet without your approval</p>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="h-20" />
      <CtaBand title="Let your work speak for itself" body="Connect GitHub, Solana, LeetCode, Codeforces or WakaTime once, and every challenge verifies itself." />
    </div>
  )
}
