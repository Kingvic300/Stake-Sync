import { ArrowLeft, CalendarPlus, Check, Lock, Settings2, UserPlus, Users } from 'lucide-react'
import { TodayProblems } from '../../components/TodayProblems'
import { ChallengeChat } from '../../components/ChallengeChat'
import { AtStake, RulesMatrix } from '../../components/RulesMatrix'
import { matrixFor, matrixRows, outcomes } from '../../lib/matrix'
import { Fragment, lazy, Suspense, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Strikes } from '../../components/DayGrid'
import { CalendarReminderSheet } from '../../components/CalendarReminder'
import { HealthAppSheet, PhotoProofSheet } from '../../components/ProofSheets'
import { AddMoneySheet } from '../../components/AddMoneySheet'
import { ShareSheet } from '../../components/ShareSheet'
import { Sheet } from '../../components/Sheet'
import { Tabs } from '../../components/Tabs'
import { useAuth } from '../../auth/context'
import { ConnectProviderSheet } from '../../components/ConnectProvider'
import { RetryPanel } from '../../components/RetryPanel'
import { DetailPageSkeleton, PanelSkeleton } from '../../components/Skeleton'
import { Avatar, Button, Providers, ProviderMark, Tag } from '../../components/ui'
import type { Challenge, FeedItem, LeaderRow, Participation, Provider } from '../../data/types'
import { api, ApiError } from '../../lib/api'
import { cx, daysUntil, shortDate, usd } from '../../lib/format'
import { FEES, feesText, joinFee } from '../../lib/fees'
import { gsap, prefersMotion, useGSAP } from '../../lib/gsap'
import { howChecked, stakeLabel } from '../../lib/styles'
import { useApiData } from '../../lib/useApiData'
import { useCountdown } from '../../lib/useCountdown'
import { useLedger } from '../../state/ledger-context'
import { useToast } from '../../toast/context'
import { signAndSubmit, type SignBytes } from '../../wallet/sendUsdc'

const SignButton = lazy(() => import('../../wallet/SignButton'))

type Tab = 'overview' | 'leaderboard' | 'chat' | 'progress'

function endDate(c: Challenge) {
  const d = new Date(c.startsAt)
  d.setDate(d.getDate() + c.durationDays - 1)
  return d.toISOString()
}

/** What the API adds to a challenge for the person viewing it. */
type ViewedChallenge = Challenge & { joined?: boolean; inviteCode?: string; canManage?: boolean }

export function ChallengeDetail() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const code = params.get('code')
  const src = useApiData<ViewedChallenge | null>(`/challenges/${encodeURIComponent(id)}${code ? `?code=${encodeURIComponent(code)}` : ''}`)
  if (!src.data && !src.error) return <DetailPageSkeleton />
  if (src.error && src.status !== 404) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24">
        <RetryPanel onRetry={src.refresh} />
      </div>
    )
  }
  if (!src.data) return <NotAvailable />
  return <ChallengeBody c={src.data} accessCode={code} onChanged={src.refresh} />
}

function NotAvailable() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-4xl font-bold">This challenge isn’t available</h1>
      <p className="mt-3 text-slate">It may have ended, or the link may be private. Check with whoever shared it.</p>
      <Button to="/explore" className="mt-8">
        Browse challenges
      </Button>
    </div>
  )
}

function ChallengeBody({ c, accessCode, onChanged }: { c: ViewedChallenge; accessCode: string | null; onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [params, setParams] = useSearchParams()
  // Invite links land here with ?join=1, which opens the join flow straight away.
  const [joining, setJoining] = useState(() => params.get('join') === '1' && !c.joined)
  const [sharing, setSharing] = useState(false)

  // The API only returns challenges this person may see, so nothing is gated here.
  const joined = Boolean(c.joined)
  const status = { open: 'Open for joining', live: 'In progress', settling: 'Settling', ended: 'Ended' }[c.status]

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16 sm:py-10">
      <div className="flex items-center justify-between gap-4">
        <Link to="/explore" className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate hover:text-ink">
          <ArrowLeft size={17} /> Explore
        </Link>
        <div className="flex gap-2">
          {c.canManage && c.status === 'open' && c.participants === 0 && (
            <Button size="sm" variant="ghost" to={`/create?edit=${encodeURIComponent(c.id)}`}>
              <Settings2 size={16} /> Edit settings
            </Button>
          )}
          {c.status !== 'ended' && (
            <Button size="sm" variant="secondary" onClick={() => setSharing(true)}>
              <UserPlus size={16} /> Invite people
            </Button>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone={c.status === 'ended' ? 'plain' : 'cobalt'}>{status}</Tag>
            {c.sponsorPool > 0 && <Tag tone="gold">Sponsored</Tag>}
            {c.privacy !== 'public' && (
              <Tag>
                <Lock size={12} /> {c.privacy === 'org' ? 'Members only' : 'Invite only'}
              </Tag>
            )}
            <span className="text-sm text-slate">{c.category}</span>
          </div>
          <h1 className="mt-3 text-4xl font-bold sm:text-5xl">{c.title}</h1>
          <div className="mt-4 flex items-center gap-2.5 text-[15px]">
            <Avatar person={c.org ? { ...c.creator, name: c.org.name } : c.creator} size={28} />
            <span>
              by <span className="font-semibold">{c.org?.name ?? c.creator.name}</span>
              {c.org && <span className="text-slate"> · created by {c.creator.name}</span>}
            </span>
          </div>
          <p className="mt-4 max-w-2xl text-lg text-slate">{c.summary}</p>

          <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line ring-1 ring-line sm:grid-cols-4">
            {[
              ['Stake', stakeLabel(c), ''],
              ['Sponsor pool', c.sponsorPool ? usd(c.sponsorPool) : 'None', c.sponsorPool ? 'text-gold-ink' : ''],
              ['Length', `${c.durationDays} days`, ''],
              ['People', `${c.participants.toLocaleString('en-US')}${c.limit ? ` / ${c.limit}` : ''}`, ''],
            ].map(([k, v, tone]) => (
              <div key={k} className="bg-surface p-4">
                <dt className="text-sm text-slate">{k}</dt>
                <dd className={cx('mt-0.5 font-display text-xl font-semibold tabular', tone)}>{v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-10">
            <Tabs
              label="Challenge sections"
              tabs={[
                { id: 'overview', label: 'Rules' },
                { id: 'leaderboard', label: 'Leaderboard' },
                { id: 'chat', label: 'Chat', },
                { id: 'progress', label: 'Progress' },
              ]}
              active={tab}
              onChange={setTab}
            />
            <div className="pt-6">
              {tab === 'overview' && <Rules c={c} />}
              {tab === 'leaderboard' && <Leaderboard id={c.id} />}
              {tab === 'chat' && <ChallengeChat id={c.id} joined={joined} canModerate={c.canManage} />}
              {tab === 'progress' && <Progress id={c.id} />}
            </div>
          </div>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          {joined ? (
            <>
              <InCard c={c} />
              {c.verification?.leetcode?.assigned && <TodayProblems challengeId={c.id} />}
            </>
          ) : (
            <JoinCard c={c} onJoin={() => setJoining(true)} />
          )}
        </aside>
      </div>

      {!joined && c.status !== 'ended' && <div aria-hidden className="h-20 lg:hidden" />}
      {!joined && c.status !== 'ended' && (
        <div className="fixed inset-x-0 bottom-16 z-20 border-t border-line bg-surface/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-slate">Stake</div>
              <div className="font-display text-lg font-semibold tabular">{stakeLabel(c)}</div>
            </div>
            <Button onClick={() => setJoining(true)} disabled={c.status !== 'open' && c.status !== 'live'}>
              {c.stakeMode === 'none' ? 'Join for free' : `Join for ${usd(c.stakeMode === 'range' ? (c.stakeRange?.[0] ?? c.stake) : c.stake)}`}
            </Button>
          </div>
        </div>
      )}

      {joining && (
        <JoinSheet
          c={c}
          accessCode={accessCode}
          onJoined={onChanged}
          onClose={() => {
            setJoining(false)
            if (params.has('join')) setParams({}, { replace: true })
          }}
        />
      )}
      {sharing && (
        <ShareSheet
          title={`Invite people to ${c.title}`}
          intro={
            c.privacy === 'public'
              ? 'Anyone with the link can see the rules and join.'
              : 'This challenge is invite only. People need this link or code to join.'
          }
          link={c.inviteCode ? `${window.location.origin}/i/${c.inviteCode}` : `${window.location.origin}/c/${c.id}`}
          code={c.inviteCode}
          message={`Join me in ${c.title} on Stake-Sync. ${c.summary}`}
          challengeId={c.id}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- Rules */

/** PRD §7: everything a challenge must show before anyone stakes. The API supplies exact wording. */
type RulesChallenge = Challenge & { disputeRules?: string; eligibility?: string; endsAt?: string; fees?: { summary: string } }

function Rules({ c }: { c: RulesChallenge }) {
  const finishers = Math.max(1, Math.round(c.participants * 0.62))
  // Sponsor prizes go entirely to finishers; their share of forfeits is added at settlement.
  const share = c.sponsorPool / finishers
  const penalties = c.penalties.length
    ? c.penalties.map((p, i) => `${i === 0 ? '' : 'another '}${p}%`).join(', then ')
    : 'None. Missing the requirement forfeits the stake'
  const privacy = c.privacy === 'public' ? 'Public: anyone can find and join it' : c.privacy === 'org' ? `Members of ${c.org?.name ?? 'the organization'} only` : 'Private: invite only'
  const rows: [string, string][] = [
    ['Created by', c.org ? `${c.creator.name}, for ${c.org.name}` : c.creator.name],
    ['Requirement', c.requirement],
    ['Dates', `${shortDate(c.startsAt)} to ${shortDate(endDate(c))}. Join by ${shortDate(c.joinBy)}`],
    ['Ends', `After day ${c.durationDays}. Results settle once the dispute window closes and every day has a result`],
    ['Stake', c.stakeMode === 'none' ? 'No stake' : c.stakeMode === 'range' ? `Choose ${stakeLabel(c)}` : `${usd(c.stake)}, the same for everyone`],
    ['Sponsor reward', c.sponsorPool ? `${usd(c.sponsorPool)} from ${c.org?.name ?? 'the sponsor'}` : 'None'],
    ['Reward split', c.distribution],
    ['Fees', c.fees?.summary ?? feesText(c.stakeMode !== 'none')],
    ['Free strikes', c.freeStrikes ? `${c.freeStrikes} missed ${c.mode === 'days' ? 'days' : 'checkpoints'} cost nothing` : 'None'],
    ['Penalties after that', penalties],
    ['Emergency freeze', c.freeze.allowed ? `One freeze of up to ${c.freeze.days} days` : 'Not allowed'],
    ['Verification', howChecked(c.providers)],
    ['Disputes', c.disputeRules ?? 'Open within 48 hours of a result. Affected money stays locked until resolved'],
    ['Who can join', c.eligibility ?? `${c.verificationLevel} level. ${c.privacy === 'public' ? 'Open to everyone' : c.privacy === 'org' ? 'Organization members only' : 'Invite only'}`],
    ['Privacy', privacy],
    ['Participants', `${c.participants.toLocaleString('en-US')}${c.limit ? ` of ${c.limit} places` : ', no limit'}`],
  ]
  return (
    <div className="space-y-8">
      <p className="max-w-2xl text-[17px]">{c.description}</p>

      {c.stakeMode !== 'none' && (
        <div className="grid gap-4 rounded-3xl bg-ink p-6 text-white sm:grid-cols-3 sm:p-7">
          <div className="sm:col-span-3">
            <h2 className="text-xl font-semibold">If you finish</h2>
          </div>
          <div>
            <div className="text-sm text-white/60">Your stake back</div>
            <div className="font-display text-3xl font-bold tabular">{usd(c.stake)}</div>
          </div>
          <div>
            <div className="text-sm text-white/60">Estimated reward</div>
            <div className="font-display text-3xl font-bold text-gold tabular">{c.sponsorPool ? `+${usd(share, { cents: true })}` : '+ share of forfeits'}</div>
          </div>
          <p className="text-sm text-white/60 sm:self-end">
            Estimate assumes about {finishers.toLocaleString('en-US')} finishers, plus {100 - FEES.platformSharePct}% of forfeited stakes shared at settlement.
          </p>
        </div>
      )}

      <section>
        <h2 className="text-2xl font-bold">What’s checked</h2>
        <p className="mt-1 text-slate">Every rule below is checked {c.mode === 'days' ? 'for each day' : 'over the challenge'}. Optional rules never cost you a day.</p>
        <div className="mt-4">
          <RulesMatrix rows={matrixRows(matrixFor(c))} />
        </div>
        <div className="mt-4">
          <AtStake o={outcomes({ ...matrixFor(c), freeStrikes: c.freeStrikes, penalties: c.penalties, staked: c.stakeMode !== 'none' })} />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-2xl font-bold">The rules</h2>
          <span className="inline-flex items-center gap-1.5 text-sm text-slate">
            <Lock size={14} /> Locked once people join
          </span>
        </div>
        <dl className="mt-4 divide-y divide-line border-y border-line">
          {rows.map(([k, v]) => (
            <div key={k} className="grid gap-1 py-3.5 sm:grid-cols-[12rem_1fr] sm:gap-6">
              <dt className="text-[15px] text-slate">{k}</dt>
              <dd className="text-[15px] font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}

/* ----------------------------------------------------------- Leaderboard */

function Leaderboard({ id }: { id: string }) {
  const src = useApiData<LeaderRow[]>(`/challenges/${encodeURIComponent(id)}/leaderboard`)
  if (!src.data) return src.error ? <RetryPanel onRetry={src.refresh} /> : <PanelSkeleton rows={5} />
  const rows = src.data
  if (!rows.length) return <p className="rounded-2xl bg-ground p-6 text-center text-slate">The leaderboard fills in once people start verifying days.</p>
  return (
    <div>
      <p className="text-[15px] text-slate">Ranked by verified days, then consistency. How much someone staked never affects rank.</p>
      <table className="mt-4 w-full text-[15px]">
        <thead>
          <tr className="border-b border-line text-left text-sm text-slate">
            <th className="w-14 py-2 font-normal">Rank</th>
            <th className="py-2 font-normal">Participant</th>
            <th className="py-2 text-right font-normal">Verified</th>
            <th className="hidden py-2 text-right font-normal sm:table-cell">Consistency</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <Fragment key={r.rank}>
              {i > 0 && r.rank - rows[i - 1].rank > 1 && (
                <tr aria-hidden>
                  <td colSpan={4} className="py-1 text-center text-slate">
                    ⋯
                  </td>
                </tr>
              )}
              <tr className={cx('border-b border-line', r.you && 'bg-cobalt-soft')}>
                <td className={cx('py-3 pl-2 font-display font-semibold tabular', r.rank <= 3 && 'text-gold-ink')}>{r.rank}</td>
                <td className="py-3">
                  <span className="flex items-center gap-2.5">
                    <Avatar person={r.person} size={30} />
                    <span className="font-medium">{r.you ? 'You' : r.person.name}</span>
                  </span>
                </td>
                <td className="py-3 text-right tabular">{r.completed} days</td>
                <td className="hidden py-3 pr-2 text-right tabular sm:table-cell">{r.consistency}%</td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ Chat */



/* -------------------------------------------------------------- Progress */

function Progress({ id }: { id: string }) {
  const src = useApiData<FeedItem[]>(`/challenges/${encodeURIComponent(id)}/feed`)
  if (!src.data) return src.error ? <RetryPanel onRetry={src.refresh} /> : <PanelSkeleton rows={4} />
  if (!src.data.length) return <p className="rounded-2xl bg-ground p-6 text-center text-slate">Progress from everyone in the challenge shows up here.</p>
  return (
    <ul className="space-y-3">
      {src.data.map((f) => (
        <li key={f.id} className="flex items-center gap-3 rounded-2xl bg-surface p-4 ring-1 ring-line/70">
          <span className={cx('size-2.5 rounded-full', f.kind === 'milestone' ? 'bg-gold' : f.kind === 'rank' ? 'bg-calm' : 'bg-cobalt')} />
          <span className="flex-1 text-[15px]">
            {f.text}
            {f.kind === 'day' && ' 🔥'}
          </span>
          <span className="text-xs text-slate">{new Date(f.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
        </li>
      ))}
    </ul>
  )
}

/* ----------------------------------------------------------- Side cards */


function JoinCard({ c, onJoin }: { c: Challenge; onJoin: () => void }) {
  const ledger = useLedger()
  const closes = useCountdown(`${c.joinBy}T23:59:00+01:00`)
  const spots = c.limit ? c.limit - c.participants : null
  const open = c.status === 'open' || (c.status === 'live' && daysUntil(c.joinBy) >= 0)

  return (
    <div className="hidden rounded-3xl bg-surface p-6 shadow-(--shadow-lift) ring-1 ring-line/70 lg:block">
      <div className="text-sm text-slate">Stake to join</div>
      <div className="mt-0.5 font-display text-4xl font-bold tabular">{stakeLabel(c)}</div>
      <p className="mt-1 text-sm text-slate">Returned when you finish. Held in escrow, not by us.</p>
      <ul className="mt-5 space-y-2.5 border-t border-line pt-5 text-[15px]">
        <li className="flex justify-between">
          <span className="text-slate">Your balance</span>
          <span className="font-semibold tabular">{usd(ledger.available, { cents: true })}</span>
        </li>
        <li className="flex justify-between">
          <span className="text-slate">Joining closes</span>
          <span className="font-semibold">{open ? closes.label.replace(' left', '') : 'Closed'}</span>
        </li>
        {spots !== null && (
          <li className="flex justify-between">
            <span className="text-slate">Spots left</span>
            <span className="font-semibold tabular">{spots}</span>
          </li>
        )}
      </ul>
      <Button className="mt-6 w-full" size="lg" onClick={onJoin} disabled={!open}>
        {c.stakeMode === 'none' ? 'Join for free' : 'Review rules and join'}
      </Button>
      <div className="mt-4">
        <Providers providers={c.providers} />
      </div>
    </div>
  )
}

function InCard({ c }: { c: Challenge }) {
  const src = useApiData<Participation | null>(`/challenges/${encodeURIComponent(c.id)}/progress`)
  const p = src.data
  const [remind, setRemind] = useState(false)
  const [proof, setProof] = useState<'photo' | 'health' | null>(null)
  const toast = useToast()
  const [submitted, setSubmitted] = useState(false)
  return (
    <div className="rounded-3xl bg-ink p-6 text-white">
      <div className="flex items-center gap-2 text-sm font-semibold text-calm">
        <span className="size-2 rounded-full bg-calm" /> You’re in
      </div>
      {p ? (
        <>
          <div className="mt-2 font-display text-4xl font-bold tabular">
            {c.mode === 'count' ? `${p.count} / ${c.targetCount}` : `Day ${p.today} / ${c.durationDays}`}
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
            <span className="text-sm text-white/60">Strikes left</span>
            <Strikes total={c.freeStrikes} used={p.strikesUsed} size={18} className="[&_.heart.text-line]:text-white/25" />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-white/60">Your stake</span>
            <span className="font-semibold tabular">{usd(p.stake)}</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-white/60">Position</span>
            <span className="font-semibold tabular">{p.position ? `#${p.position}` : '—'}</span>
          </div>
        </>
      ) : (
        <p className="mt-2 text-white/70">Day 1 starts {shortDate(c.startsAt)}. We’ll remind you the day before.</p>
      )}
      {c.providers.includes('Camera') && (
        <Button to={`/workout/${c.id}`} variant="gold" className="mt-6 w-full">
          Start today’s set
        </Button>
      )}
      {c.providers.includes('Photo') && (
        <Button variant="gold" className="mt-6 w-full" disabled={submitted} onClick={() => setProof('photo')}>
          {submitted ? 'Today’s photo is being reviewed' : 'Submit today’s photo'}
        </Button>
      )}
      {c.providers.includes('Health') && (
        <Button variant="gold" className="mt-6 w-full" onClick={() => setProof('health')}>
          Sync steps from my phone
        </Button>
      )}
      <Button to="/dashboard" variant="secondary" className={cx('w-full ring-0', ['Camera', 'Photo', 'Health'].some((x) => c.providers.includes(x as never)) ? 'mt-2' : 'mt-6')}>
        Open my progress
      </Button>
      <Button variant="ghost" className="mt-2 w-full text-white hover:bg-white/10" onClick={() => setRemind(true)}>
        <CalendarPlus size={17} /> Daily calendar reminder
      </Button>
      {remind && <CalendarReminderSheet challenges={[c]} onClose={() => setRemind(false)} />}
      {proof === 'photo' && <PhotoProofSheet c={c} onClose={() => setProof(null)} onSubmitted={() => {
            setSubmitted(true)
            toast({ title: 'Photo sent for review', body: 'Today counts as checking until a reviewer approves it.' })
          }} />}
      {proof === 'health' && <HealthAppSheet onClose={() => setProof(null)} />}
    </div>
  )
}

/* ------------------------------------------------------------- Join flow */

type JoinStep = 'rules' | 'accounts' | 'stake' | 'done'

function JoinSheet({ c, accessCode, onJoined, onClose }: { c: Challenge; accessCode?: string | null; onJoined?: () => void; onClose: () => void }) {
  const ledger = useLedger()
  const toast = useToast()
  const { session } = useAuth()
  const steps: JoinStep[] = c.stakeMode === 'none' ? ['rules', 'accounts', 'done'] : ['rules', 'accounts', 'stake', 'done']
  const [step, setStep] = useState<JoinStep>('rules')
  const [accepted, setAccepted] = useState(false)
  const [linked, setLinked] = useState<string[]>(session?.connected ?? [])
  const [amount, setAmount] = useState(c.stakeMode === 'range' ? (c.stakeRange?.[0] ?? c.stake) : c.stake)
  const [paying, setPaying] = useState(false)
  const [remind, setRemind] = useState(false)
  const [topUp, setTopUp] = useState(false)
  const [connecting, setConnecting] = useState<Provider | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const idx = steps.indexOf(step)
  const allLinked = c.providers.every((p) => linked.includes(p))
  const fee = c.stakeMode === 'none' ? 0 : joinFee(amount)
  const total = amount + fee
  const enough = ledger.available >= total

  useGSAP(
    () => {
      if (!prefersMotion()) return
      if (step === 'done') {
        gsap.from('[data-done-mark]', { scale: 0, rotate: -40, duration: 0.6, ease: 'back.out(2.4)' })
        gsap.from('[data-done-copy] > *', { y: 10, autoAlpha: 0, stagger: 0.08, duration: 0.4, delay: 0.25 })
      } else {
        gsap.from('[data-join-step] > *', { x: 20, autoAlpha: 0, duration: 0.35, stagger: 0.04, ease: 'power3.out', clearProps: 'all' })
      }
    },
    { scope: body, dependencies: [step] },
  )

  const q = accessCode ? `?code=${encodeURIComponent(accessCode)}` : ''
  const path = `/challenges/${encodeURIComponent(c.id)}`

  /**
   * The real join: accept the exact rules document (by its hash), then, for a stake, the person's
   * wallet signs the escrow deposit and we confirm it. Backing out of the signature undoes the join.
   */
  async function joinLive(sign?: SignBytes) {
    try {
      const rules = await api<{ hash: string }>(`${path}/rules${q}`)
      const r = await api<{ status: 'active' | 'needs_signature'; transaction?: string }>(`${path}/join`, {
        method: 'POST',
        body: { acceptedRulesHash: rules.hash, ...(c.stakeMode !== 'none' ? { stake: amount } : {}), ...(accessCode ? { code: accessCode } : {}) },
      })
      if (r.status === 'needs_signature') {
        if (!sign || !r.transaction) throw new ApiError('Connect your wallet to join this challenge.', 'needs_wallet', 0)
        try {
          const signature = await signAndSubmit(r.transaction, sign)
          await api(`${path}/join/confirm`, { method: 'POST', body: { signature } })
        } catch (e) {
          void api(`${path}/join`, { method: 'DELETE' }).catch(() => {})
          throw e
        }
      }
      ledger.refresh()
      onJoined?.()
      toast({ title: `You’re in ${c.title}`, body: c.stakeMode === 'none' ? 'No stake needed. Good luck.' : `${usd(amount)} is in escrow, plus a ${usd(fee, { cents: true })} joining fee.` })
      setStep('done')
    } catch (err) {
      const code = err instanceof ApiError ? err.code : ''
      const declined = /reject|declin|cancel/i.test(String(err))
      if (code === 'insufficient_balance') setTopUp(true)
      toast({
        tone: 'error',
        title: declined ? 'Join cancelled' : 'Couldn’t join',
        body: err instanceof ApiError ? err.message : declined ? 'You declined it in your wallet, so nothing was taken.' : 'Nothing was taken. Please try again.',
        inbox: false,
      })
    }
  }

  async function joinFree() {
    setPaying(true)
    await joinLive()
    setPaying(false)
  }

  // Optimistic: you're in immediately; the escrow transaction confirms in the background.

  const footer =
    step === 'rules' ? (
      <Button className="w-full" disabled={!accepted} onClick={() => setStep('accounts')}>
        Continue
      </Button>
    ) : step === 'accounts' ? (
      <Button className="w-full" disabled={!allLinked} busy={paying} onClick={() => (c.stakeMode === 'none' ? void joinFree() : setStep('stake'))}>
        {c.stakeMode === 'none' ? 'Join challenge' : 'Continue'}
      </Button>
    ) : step === 'stake' ? (
      enough ? (
        <Suspense fallback={<Button className="w-full" busy>Pay {usd(total, { cents: true })} and join</Button>}>
          <SignButton label={`Pay ${usd(total, { cents: true })} and join`} busyLabel="Waiting for your wallet" onSign={joinLive} />
        </Suspense>
      ) : (
        <Button className="w-full" onClick={() => setTopUp(true)}>
          Add {usd(total - ledger.available, { cents: true })} to continue
        </Button>
      )
    ) : (
      <Button className="w-full" to="/dashboard">
        Go to my progress
      </Button>
    )

  return (
    <>
    <Sheet title={step === 'done' ? 'You’re in' : `Join ${c.title}`} onClose={onClose} footer={footer}>
      <div ref={body}>
        {step !== 'done' && (
          <div className="mb-5 flex gap-1.5" aria-label={`Step ${idx + 1} of ${steps.length - 1}`}>
            {steps.slice(0, -1).map((s, i) => (
              <span key={s} className={cx('h-1 flex-1 rounded-full', i <= idx ? 'bg-cobalt' : 'bg-tile')} />
            ))}
          </div>
        )}

        {step === 'rules' && (
          <div data-join-step>
            <p className="text-[15px] text-slate">These rules are locked for everyone once the challenge starts.</p>
            <h3 className="mt-4 font-sans text-sm font-semibold">What’s checked</h3>
            <div className="mt-2">
              <RulesMatrix rows={matrixRows(matrixFor(c))} compact />
            </div>
            <h3 className="mt-5 font-sans text-sm font-semibold">What’s at stake</h3>
            <div className="mt-2">
              <AtStake o={outcomes({ ...matrixFor(c), freeStrikes: c.freeStrikes, penalties: c.penalties, staked: c.stakeMode !== 'none' })} stacked />
            </div>
            <ul className="mt-4 divide-y divide-line rounded-2xl bg-ground px-4 text-[15px]">
              {[c.distribution, `Fees: ${feesText(c.stakeMode !== 'none')}`].map((r) => (
                <li key={r} className="flex items-start gap-2.5 py-3">
                  <Check size={17} strokeWidth={3} className="mt-0.5 shrink-0 text-cobalt" />
                  {r}
                </li>
              ))}
            </ul>
            <label className="mt-5 flex cursor-pointer items-start gap-3 text-[15px]">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-1 size-4 accent-[var(--color-cobalt)]" />
              I’ve read the full rules and accept them, including how penalties and rewards work.
            </label>
          </div>
        )}

        {step === 'accounts' && (
          <div data-join-step>
            <p className="text-[15px] text-slate">This challenge checks your progress with these accounts.</p>
            <ul className="mt-4 space-y-2">
              {c.providers.map((p) => {
                const on = linked.includes(p)
                return (
                  <li key={p} className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 ring-1 ring-line">
                    <ProviderMark provider={p} size={22} />
                    <span className="flex-1 font-semibold">{p}</span>
                    {on ? (
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-calm">
                        <Check size={16} strokeWidth={3} /> Connected
                      </span>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => setConnecting(p)}>
                        Connect
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
            {connecting && (
              <ConnectProviderSheet provider={connecting} onClose={() => setConnecting(null)} onConnected={(x) => setLinked((v) => [...v, x])} />
            )}
          </div>
        )}

        {step === 'stake' && (
          <div data-join-step>
            {c.stakeMode === 'range' && c.stakeRange && (
              <label className="block">
                <span className="text-sm font-semibold">Choose your stake</span>
                <div className="mt-3 flex items-center gap-4">
                  <input
                    type="range"
                    min={c.stakeRange[0]}
                    max={c.stakeRange[1]}
                    step={1}
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="flex-1 accent-[var(--color-cobalt)]"
                  />
                  <span className="w-16 text-right font-display text-xl font-semibold tabular">{usd(amount)}</span>
                </div>
                <span className="mt-1 block text-sm text-slate">A bigger stake doesn’t change your rank or reward share.</span>
              </label>
            )}
            <dl className="mt-5 space-y-2.5 rounded-2xl bg-ground p-4 text-[15px]">
              <div className="flex justify-between">
                <dt className="text-slate">Available balance</dt>
                <dd className="tabular">{usd(ledger.available, { cents: true })}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate">Stake, held in escrow</dt>
                <dd className="tabular">−{usd(amount, { cents: true })}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate">Joining fee ({FEES.joinPct}%, refunded if cancelled)</dt>
                <dd className="tabular">−{usd(fee, { cents: true })}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-2.5 font-semibold">
                <dt>Balance after</dt>
                <dd className={cx('tabular', !enough && 'text-miss')}>{usd(ledger.available - total, { cents: true })}</dd>
              </div>
            </dl>
            {!enough && <p className="mt-3 text-sm text-miss">You need {usd(total - ledger.available, { cents: true })} more to join.</p>}
            <p className="mt-4 text-sm text-slate">
              Your stake comes back when you finish (less any penalties), plus your share of the rewards. You can see it under “In challenges” in your wallet the whole time.
            </p>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center py-4 text-center">
            <span data-done-mark className="grid size-16 place-items-center rounded-full bg-calm text-white">
              <Check size={30} strokeWidth={3} />
            </span>
            <div data-done-copy>
              <h3 className="mt-5 text-2xl font-bold">Welcome to {c.title}</h3>
              <p className="mt-2 text-slate">
                {c.stakeMode === 'none' ? 'No stake needed.' : `${usd(amount)} is going into escrow.`}{' '}
                {c.status === 'open' ? `Day 1 starts ${shortDate(c.startsAt)}.` : 'Your first check runs tonight.'}
              </p>
              {c.stakeMode !== 'none' && (
                <p role="status" className={cx('mx-auto mt-3 w-fit rounded-full px-3 py-1 text-sm font-semibold', paying ? 'is-busy bg-tile text-slate' : 'bg-calm-soft text-calm')}>
                  {paying ? 'Confirming on Solana' : 'Stake confirmed on Solana'}
                </p>
              )}
              <p className="mt-4 inline-flex items-center gap-1.5 text-sm text-slate">
                <Users size={15} /> {c.participants.toLocaleString('en-US')} others are in. Say hi in the chat.
              </p>
              <button
                type="button"
                onClick={() => setRemind(true)}
                className="mt-5 flex w-full items-center gap-3 rounded-2xl bg-ground p-4 text-left transition-colors hover:bg-tile"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-cobalt text-white">
                  <CalendarPlus size={19} />
                </span>
                <span>
                  <span className="block font-semibold">Add a daily reminder to your calendar</span>
                  <span className="text-sm text-slate">Get an alert before each day’s deadline</span>
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
    {remind && <CalendarReminderSheet challenges={[c]} onClose={() => setRemind(false)} />}
    {topUp && <AddMoneySheet need={amount - ledger.available} onClose={() => setTopUp(false)} />}
    </>
  )
}
