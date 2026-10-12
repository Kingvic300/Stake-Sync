import { BadgeCheck, CalendarPlus, Check, Link2, Share2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../../auth/context'
import { CalendarReminderSheet } from '../../components/CalendarReminder'
import { EditProfileSheet } from '../../components/EditProfile'
import { DayGrid } from '../../components/DayGrid'
import { Tabs } from '../../components/Tabs'
import { Sheet } from '../../components/Sheet'
import { Avatar, Button, ProviderMark, Tag, Toggle } from '../../components/ui'
import { useMine, type PastItem } from '../../data/useMine'
import { api, ApiError, BASE } from '../../lib/api'
import { useApiData } from '../../lib/useApiData'
import { RetryPanel } from '../../components/RetryPanel'
import { ProfilePageSkeleton } from '../../components/Skeleton'
import type { Achievement, Provider } from '../../data/types'
import { cx, usd } from '../../lib/format'
import { useLedger } from '../../state/ledger-context'
import { useToast } from '../../toast/context'
import { gsap, useMotion } from '../../lib/gsap'

type Tab = 'achievements' | 'active' | 'history' | 'settings'

/** GET /me/score: one record per settled challenge, with what moved the score. */
interface ScoreRecord {
  factors: { difficulty: number; consistency: number; strength: number } | null
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** GET /users/:handle */
interface ApiProfile {
  person: { name: string; handle: string; hue: number; avatarUrl?: string | null }
  private: boolean
  bio?: string | null
  score?: number
  joined?: string
  entered?: number
  completed?: number
  completionRate?: number | null
  connected?: { provider: Provider; account: string }[]
  orgs?: { slug: string; name: string }[]
  achievements?: Achievement[]
  history?: PastItem[]
}

export function Profile() {
  const { handle = '' } = useParams()
  const { session } = useAuth()
  const own = handle === session?.username
  const remote = useApiData<ApiProfile>(`/users/${encodeURIComponent(handle)}`)
  if (!remote.data) {
    if (remote.status === 404) return <ProfileGone text="This profile doesn’t exist." />
    return remote.error ? <div className="mx-auto max-w-xl px-4 py-24"><RetryPanel onRetry={remote.refresh} /></div> : <ProfilePageSkeleton />
  }
  if (remote.data.private && !own) return <ProfileGone text="This profile is private." />
  return <ProfileBody handle={handle} own={own} remote={remote.data} />
}

function ProfileGone({ text }: { text: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-3xl font-bold">{text}</h1>
      <Button to="/leaderboard" className="mt-8">
        See the leaderboard
      </Button>
    </div>
  )
}

function ProfileBody({ handle, own, remote }: { handle: string; own: boolean; remote: ApiProfile }) {
  const { session } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const tabs: Tab[] = ['achievements', 'active', 'history', 'settings']
  const asked = params.get('tab') as Tab | null
  const tab: Tab = asked && tabs.includes(asked) && (asked !== 'settings' || own) ? asked : 'achievements'
  const setTab = (t: Tab) => setParams(t === 'achievements' ? {} : { tab: t }, { replace: true })
  const root = useRef<HTMLDivElement>(null)
  const v = {
    person: remote.person,
    score: remote.score ?? 0,
    rate: remote.completionRate === null || remote.completionRate === undefined ? '—' : remote.completionRate.toFixed(1),
    entered: remote.entered ?? 0,
    completed: remote.completed ?? 0,
    bio: remote.bio ?? undefined,
    orgs: (remote.orgs ?? []).map((o) => o.name),
    verified: (remote.connected ?? []).map((a) => a.provider),
    last: ['Score', String(remote.score ?? 0)] as const,
    achievements: remote.achievements ?? [],
  }
  // What builds the score, averaged over settled challenges. Only you see yours.
  const records = useApiData<{ items: ScoreRecord[] }>(own ? '/me/score' : null).data?.items ?? []
  const f = records.flatMap((r) => (r.factors ? [r.factors] : []))
  const breakdown = f.length
    ? ([
        ['Completion', Math.round(remote.completionRate ?? 0), 'Challenges finished out of those started'],
        ['Consistency', Math.round(avg(f.map((x) => x.consistency)) * 100), 'How evenly you hit your days'],
        ['Difficulty', Math.round((avg(f.map((x) => x.difficulty)) / 2) * 100), 'How demanding your challenges were'],
        ['Verification strength', Math.min(100, Math.round(avg(f.map((x) => x.strength)) * 100)), 'How strongly your work was proven'],
      ] as const)
    : []
  const person = v.person
  const rate = v.rate
  const [editing, setEditing] = useState(false)

  useMotion(() => {
    const el = root.current?.querySelector<HTMLElement>('[data-score]')
    const n = { v: 0 }
    gsap.to(n, { v: v.score, duration: 1.3, ease: 'power2.out', onUpdate: () => void (el && (el.textContent = String(Math.round(n.v)))) })
    gsap.from('[data-bar]', { scaleX: 0, transformOrigin: 'left center', duration: 1, ease: 'power3.out', stagger: 0.1, delay: 0.2 })
  }, root)

  return (
    <div ref={root} className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16 sm:py-10">
      <section className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-3xl bg-surface p-6 ring-1 ring-line/70 sm:p-8">
          <div className="grid grid-cols-[1fr_auto] items-start gap-x-5 gap-y-4 sm:grid-cols-[auto_1fr_auto]">
            <div className="order-1">
              <Avatar person={person} size={80} src={own ? session?.avatar : undefined} />
            </div>
            <div className="order-3 col-span-2 min-w-0 sm:order-2 sm:col-span-1">
              <h1 className="text-3xl font-bold sm:text-4xl">{person.name}</h1>
              <p className="text-slate">
                @{own ? (session?.username ?? handle) : handle}, member since {remote.joined ?? ''}
              </p>
              {own && !session?.bio ? (
                <button type="button" onClick={() => setEditing(true)} className="mt-3 text-[15px] font-semibold text-cobalt hover:underline">
                  Add a bio
                </button>
              ) : (
                <p className="mt-3 max-w-lg text-[16px]">{v.bio}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {v.orgs.map((o) => (
                  <Tag key={o}>{o}</Tag>
                ))}
              </div>
            </div>
            {own ? (
              <Button variant="secondary" size="sm" className="order-2 sm:order-3" onClick={() => setEditing(true)}>
                Edit profile
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                className="order-2 sm:order-3"
                onClick={() => {
                  void navigator.clipboard?.writeText(window.location.href)
                  toast({ title: 'Profile link copied', inbox: false })
                }}
              >
                <Share2 size={15} /> Share
              </Button>
            )}
          </div>

          <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line ring-1 ring-line sm:grid-cols-4">
            {[
              ['Entered', String(v.entered)],
              ['Completed', String(v.completed)],
              ['Completion', `${rate}%`],
              [v.last[0], v.last[1]],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface p-4">
                <dt className="text-sm text-slate">{k}</dt>
                <dd className="font-display text-2xl font-semibold tabular">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-6">
            <h2 className="font-sans text-sm font-semibold text-slate">Verified accounts</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {v.verified.map((pr) => (
                <li key={pr} className="inline-flex items-center gap-2 rounded-full bg-ground py-1.5 pr-3.5 pl-2 text-sm font-semibold">
                  <ProviderMark provider={pr} size={16} />
                  {remote.connected?.find((a) => a.provider === pr)?.account ?? pr}
                  <BadgeCheck size={16} className="text-cobalt" />
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="rounded-3xl bg-ink p-6 text-white sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm text-white/60">Commitment score</div>
              <div className="font-display text-6xl font-bold tabular" data-score>
                {v.score}
              </div>
            </div>
          </div>
          {own && breakdown.length === 0 && <p className="mt-6 text-[15px] text-white/65">Finish a challenge to see what builds your score.</p>}
          <ul className="mt-6 space-y-4">
            {breakdown.map(([k, v, hint]) => (
              <li key={k}>
                <div className="flex justify-between text-[15px]">
                  <span title={hint}>{k}</span>
                  <span className="text-white/60 tabular">{v}</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-white/10">
                  <span data-bar className="block h-full rounded-full bg-cobalt" style={{ width: `${v}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-white/55">Earned from verified results. The size of a stake has no effect on it.</p>
        </div>
      </section>

      <div className="mt-10">
        <Tabs
          label="Profile sections"
          tabs={[
            { id: 'achievements', label: 'Achievements', count: v.achievements.length },
            ...(own ? [{ id: 'active' as const, label: 'Active', }] : []),
            { id: 'history', label: 'History' },
            ...(own ? [{ id: 'settings' as const, label: 'Settings' }] : []),
          ]}
          active={tab}
          onChange={setTab}
        />
        <div className="pt-6">
          {tab === 'achievements' && <Achievements list={v.achievements} />}
          {tab === 'active' && own && <Active />}
          {tab === 'history' && <History items={remote.history ?? []} />}
          {tab === 'settings' && own && <Settings />}
        </div>
      </div>
      {editing && <EditProfileSheet onClose={() => setEditing(false)} />}
    </div>
  )
}

function Achievements({ list }: { list: Achievement[] }) {
  const [copied, setCopied] = useState<string | null>(null)
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((a) => (
        <li key={a.id} className="flex flex-col rounded-3xl bg-surface p-6 ring-1 ring-line/70">
          <div className="flex items-center justify-between">
            <span className="grid size-12 place-items-center rounded-2xl bg-ground">
              <ProviderMark provider={a.provider} size={24} />
            </span>
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-cobalt-deep">
              <Check size={15} strokeWidth={3} /> {a.provider} verified
            </span>
          </div>
          <h3 className="mt-5 text-xl font-semibold">{a.title}</h3>
          <p className="text-[15px] text-slate">Completed {a.earned}</p>
          <p className="mt-2 flex-1 text-[15px]">{a.detail}</p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(`${window.location.origin}/a/${a.id}`)
              setCopied(a.id)
            }}
            className="mt-5 inline-flex items-center gap-1.5 self-start text-sm font-semibold text-slate hover:text-ink"
          >
            <Link2 size={15} /> {copied === a.id ? 'Link copied' : 'Copy share link'}
          </button>
        </li>
      ))}
    </ul>
  )
}

function Active() {
  const { mine } = useMine()
  const items = mine?.active ?? []
  if (!mine) return <div className="h-40 animate-pulse rounded-3xl bg-tile" />
  if (!items.length) return <p className="rounded-3xl bg-surface px-6 py-10 text-center text-slate ring-1 ring-line/70">No active challenges right now.</p>
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {items.map(({ c, p }) => {
        return (
          <li key={c.id}>
            <Link to={`/c/${c.id}`} className="block rounded-3xl bg-surface p-5 ring-1 ring-line/70 transition-shadow hover:shadow-(--shadow-lift)">
              <div className="flex items-center gap-1.5 text-sm text-slate">
                {c.providers.map((pr: Provider) => (
                  <ProviderMark key={pr} provider={pr} size={13} />
                ))}
                {c.category}
              </div>
              <h3 className="mt-2 font-semibold">{c.title}</h3>
              <p className="text-sm text-slate">{c.mode === 'count' ? `${p.count} of ${c.targetCount} ${c.countUnit}` : `Day ${p.today} of ${c.durationDays}`}</p>
              <DayGrid days={p.days} size="sm" columns={15} className="mt-4" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function History({ items }: { items: PastItem[] }) {
  if (!items.length) return <p className="rounded-3xl bg-surface px-6 py-10 text-center text-slate ring-1 ring-line/70">Finished challenges show up here.</p>
  return (
    <ul className="divide-y divide-line rounded-3xl bg-surface ring-1 ring-line/70">
      {items.map((h) => (
        <li key={h.id} className="flex items-center gap-4 px-5 py-4 sm:px-6">
          <span className={cx('size-2.5 rounded-full', h.result === 'Completed' ? 'bg-cobalt' : 'bg-miss')} />
          <span className="flex-1 font-semibold">{h.title}</span>
          <span className="hidden text-sm text-slate sm:block">{h.when}</span>
          <span className={cx('w-28 text-right text-sm font-semibold', h.result === 'Completed' ? 'text-cobalt-deep' : 'text-slate')}>{h.result}</span>
        </li>
      ))}
    </ul>
  )
}

/** Notification switches and the notification kinds each one mutes. */
const MUTES: Record<string, string[]> = { reminders: ['deadline', 'starting'], results: ['verified', 'strike'], chat: ['message'], leaderboard: ['leaderboard'], orgs: ['announcement'] }

interface MeSettings {
  privacy: { profile: 'public' | 'members' | 'private'; showOnLeaderboards: boolean; showConnectedAccounts: boolean }
  notificationPrefs: { push: boolean; email: boolean; muted: string[] }
}

function Settings() {
  const toast = useToast()
  const me = useApiData<MeSettings>('/me')
  const { mine } = useMine()
  const [privacy, setPrivacyLocal] = useState({ public: true, active: true, amounts: false, leaderboard: true })
  const [notify, setNotifyLocal] = useState({ reminders: true, results: true, chat: true, leaderboard: false, orgs: true, email: false })
  const [loaded, setLoaded] = useState(false)
  if (me.data && !loaded) {
    const muted = me.data.notificationPrefs.muted ?? []
    setLoaded(true)
    setPrivacyLocal((x) => ({ ...x, public: me.data!.privacy.profile !== 'private', leaderboard: me.data!.privacy.showOnLeaderboards }))
    setNotifyLocal({
      reminders: !MUTES.reminders.some((k) => muted.includes(k)),
      results: !MUTES.results.some((k) => muted.includes(k)),
      chat: !MUTES.chat.some((k) => muted.includes(k)),
      leaderboard: !MUTES.leaderboard.some((k) => muted.includes(k)),
      orgs: !MUTES.orgs.some((k) => muted.includes(k)),
      email: me.data.notificationPrefs.email,
    })
  }

  /** Saves instantly; puts the switch back if the server refuses. */
  function save(body: object, undo: () => void) {
    api('/me', { method: 'PATCH', body }).catch((err) => {
      undo()
      toast({ tone: 'error', title: 'Setting not saved', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    })
  }
  const setPrivacy = (next: typeof privacy) => {
    const before = privacy
    setPrivacyLocal(next)
    save({ privacy: { profile: next.public ? 'public' : 'private', showOnLeaderboards: next.leaderboard } }, () => setPrivacyLocal(before))
  }
  const setNotify = (next: typeof notify) => {
    const before = notify
    setNotifyLocal(next)
    const muted = Object.entries(MUTES).flatMap(([k, kinds]) => (next[k as keyof typeof next] ? [] : kinds))
    save({ notificationPrefs: { email: next.email, muted } }, () => setNotifyLocal(before))
  }
  const [calendar, setCalendar] = useState(false)

  const row = (label: string, hint: string, checked: boolean, onChange: (v: boolean) => void) => (
    <li className="flex items-start justify-between gap-6 py-4">
      <div>
        <div className="font-semibold">{label}</div>
        <div className="text-sm text-slate">{hint}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </li>
  )

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-3xl bg-surface p-6 ring-1 ring-line/70">
        <h2 className="text-xl font-bold">Privacy</h2>
        <ul className="mt-2 divide-y divide-line">
          {row('Public profile', 'Anyone with the link can see your achievements and score', privacy.public, (v) => setPrivacy({ ...privacy, public: v }))}
          {row('Show active challenges', 'List what you’re working on right now', privacy.active, (v) => setPrivacy({ ...privacy, active: v }))}
          {row('Show amounts staked', 'Otherwise only you see your stakes and rewards', privacy.amounts, (v) => setPrivacy({ ...privacy, amounts: v }))}
          {row('Use my name on leaderboards', 'Turn off to appear as an anonymous participant', privacy.leaderboard, (v) => setPrivacy({ ...privacy, leaderboard: v }))}
        </ul>
      </section>
      <section className="rounded-3xl bg-surface p-6 ring-1 ring-line/70">
        <h2 className="text-xl font-bold">Notifications</h2>
        <ul className="mt-2 divide-y divide-line">
          {row('Deadline reminders', 'A nudge a few hours before a day closes', notify.reminders, (v) => setNotify({ ...notify, reminders: v }))}
          {row('Verification results', 'Verified, missed, strikes and penalty warnings', notify.results, (v) => setNotify({ ...notify, results: v }))}
          {row('Replies and mentions', 'When someone replies to you or @mentions you', notify.chat, (v) => setNotify({ ...notify, chat: v }))}
          {row('Leaderboard moves', 'When you move up or down noticeably', notify.leaderboard, (v) => setNotify({ ...notify, leaderboard: v }))}
          {row('Organization announcements', 'From organizations you belong to', notify.orgs, (v) => setNotify({ ...notify, orgs: v }))}
          {row('Weekly email summary', 'Your week in one email', notify.email, (v) => setNotify({ ...notify, email: v }))}
        </ul>
        <div className="mt-2 flex items-start justify-between gap-6 border-t border-line pt-4">
          <div>
            <div className="font-semibold">Calendar reminders</div>
            <div className="text-sm text-slate">Add a daily alert for every active challenge to your phone or Google Calendar</div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setCalendar(true)}>
            <CalendarPlus size={15} /> Set up
          </Button>
        </div>
        {calendar && (
          <CalendarReminderSheet challenges={(mine?.active ?? []).map((x) => x.c)} onClose={() => setCalendar(false)} />
        )}
      </section>
      <AccountSection />
    </div>
  )
}

/** Plain, findable account controls. Closing is blocked only while money is still in play. */
function AccountSection() {
  const ledger = useLedger()
  const [closing, setClosing] = useState(false)
  const [exported, setExported] = useState(false)
  const [exporting, setExporting] = useState(false)
  const { signOut, session } = useAuth()
  const toast = useToast()

  async function downloadData() {
    setExporting(true)
    try {
      const token = session?.accessToken
      const res = await fetch(`${BASE}/me/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null
        throw new ApiError(body?.message ?? 'Couldn’t prepare your data. Please try again.', 'export_failed', res.status)
      }
      const blob = await res.blob()
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'stakesync-data.json'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      setExported(true)
    } catch (err) {
      toast({ tone: 'error', title: 'Download didn’t start', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    } finally {
      setExporting(false)
    }
  }

  async function closeAccount() {
    try {
      await api('/me', { method: 'DELETE' })
      signOut()
    } catch (err) {
      toast({ tone: 'error', title: 'Account not closed', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    }
  }

  const blockers = [
    ledger.locked > 0 && `${usd(ledger.locked, { cents: true })} is still in challenges that need to finish first`,
    ledger.claimable > 0 && `${usd(ledger.claimable, { cents: true })} is waiting to be claimed`,
    ledger.available > 0 && `${usd(ledger.available, { cents: true })} is in your balance. Withdraw it first`,
  ].filter(Boolean) as string[]

  return (
    <section className="rounded-3xl bg-surface p-6 ring-1 ring-line/70 lg:col-span-2">
      <h2 className="text-xl font-bold">Your account</h2>
      <ul className="mt-2 divide-y divide-line">
        <li className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div>
            <div className="font-semibold">Download your data</div>
            <div className="text-sm text-slate">Your profile, challenge history, verifications and transactions as a file</div>
          </div>
          <Button size="sm" variant="secondary" busy={exporting} onClick={() => void downloadData()}>
            {exported ? 'Downloaded' : 'Download'}
          </Button>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div>
            <div className="font-semibold">Close your account</div>
            <div className="text-sm text-slate">Removes your profile and personal data. On-chain records stay public.</div>
          </div>
          <Button size="sm" variant="secondary" className="text-[oklch(52%_0.19_23)]" onClick={() => setClosing(true)}>
            Close account
          </Button>
        </li>
      </ul>

      {closing && (
        <Sheet
          title="Close your account"
          onClose={() => setClosing(false)}
          footer={
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setClosing(false)}>
                Keep my account
              </Button>
              <Button className="flex-1 bg-miss hover:bg-miss/90" disabled={blockers.length > 0} onClick={() => void closeAccount()}>
                Close account
              </Button>
            </div>
          }
        >
          {blockers.length > 0 ? (
            <>
              <p className="text-[15px] text-slate">You can close your account as soon as no money is tied up in it. Right now:</p>
              <ul className="mt-4 space-y-2">
                {blockers.map((b) => (
                  <li key={b} className="rounded-2xl bg-ground px-4 py-3 text-[15px]">
                    {b}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-slate">This protects your stakes. Nothing is charged for closing an account.</p>
            </>
          ) : (
            <p className="text-[15px] text-slate">
              Your profile, achievements and personal data will be deleted. Transactions on Solana are public and can’t be
              removed. This can’t be undone.
            </p>
          )}
        </Sheet>
      )}
    </section>
  )
}
