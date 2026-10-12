import { Check, Copy, Download, Megaphone, Pin, Plus, Search, UserPlus } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../../auth/context'
import { RetryPanel } from '../../components/RetryPanel'
import { Strikes } from '../../components/DayGrid'
import { Sheet } from '../../components/Sheet'
import { AppPageSkeleton, PanelSkeleton } from '../../components/Skeleton'
import { Tabs } from '../../components/Tabs'
import { Avatar, Button, Field, Tag, Toggle } from '../../components/ui'
import type { Challenge, OrgRole, Person } from '../../data/types'
import { api, ApiError, BASE } from '../../lib/api'
import { canManage, useMyOrgs, type ApiOrg } from '../../lib/useMyOrgs'
import { useApiData } from '../../lib/useApiData'
import { cx, usd } from '../../lib/format'
import { gsap, prefersMotion, useMotion } from '../../lib/gsap'
import { inputClass } from '../../lib/styles'
import { useToast } from '../../toast/context'
import { Select } from '../../components/Select'

type Tab = 'overview' | 'challenges' | 'members' | 'announcements'

/** GET /orgs/:slug/dashboard */
interface Dashboard {
  org: ApiOrg
  stats: { active: number; onTrack: number; atRisk: number; out: number; dailyCompletion: number[] }
  challenges: Challenge[]
  atRisk: { person: Person; challengeId: string; strikesUsed: number; lastVerified: string | null }[]
}

const STATUS: Record<Challenge['status'], string> = { open: 'Open', live: 'Live', settling: 'Settling', ended: 'Ended' }
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0)

export function OrgDashboard() {
  const { slug = '' } = useParams()
  const managed = useMyOrgs().filter((m) => canManage(m.role))
  const src = useApiData<Dashboard>(`/orgs/${encodeURIComponent(slug)}/dashboard`)
  const [tab, setTab] = useState<Tab>('overview')
  const [sheet, setSheet] = useState<'invite' | 'export' | null>(null)

  if (src.status === 403 || src.status === 404 || (src.data && !(src.data.org.role && canManage(src.data.org.role)))) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-4xl font-bold">You’re not an admin here</h1>
        <p className="mt-3 text-slate">Only organization admins can open this dashboard. Ask an admin to change your role.</p>
        <Button to="/overview" className="mt-8">
          Back to overview
        </Button>
      </div>
    )
  }
  if (src.error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24">
        <RetryPanel onRetry={src.refresh} />
      </div>
    )
  }
  if (!src.data) return <AppPageSkeleton />
  const d = src.data
  const o = d.org
  const role = o.role as OrgRole

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16 sm:py-10">
      <div className="flex flex-col gap-5 pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="shrink-0">
            <Avatar person={o.person} size={56} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <OrgSwitcher current={o} managed={managed} />
              <Tag tone="cobalt">{role}</Tag>
            </div>
            <p className="mt-1 text-slate">
              {o.members.toLocaleString('en-US')} members, {d.challenges.length} {d.challenges.length === 1 ? 'challenge' : 'challenges'}
              {o.sponsored > 0 && `, ${usd(o.sponsored)} sponsored to date`}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button to={`/create?host=${o.slug}`} className="col-span-2 sm:order-3">
            <Plus size={18} /> New challenge
          </Button>
          <Button variant="secondary" onClick={() => setSheet('export')} disabled={!d.challenges.length}>
            <Download size={17} /> Export
          </Button>
          <Button variant="secondary" onClick={() => setSheet('invite')}>
            <UserPlus size={17} /> Invite
          </Button>
        </div>
      </div>

      <Tabs
        label="Organization sections"
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'challenges', label: 'Challenges', count: d.challenges.length },
          { id: 'members', label: 'Members', count: o.members },
          { id: 'announcements', label: 'Announcements' },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="pt-6">
        {tab === 'overview' && (d.challenges.length ? <OrgOverview d={d} /> : <FirstChallenge o={o} />)}
        {tab === 'challenges' && <Challenges list={d.challenges} />}
        {tab === 'members' && <Members o={o} onInvite={() => setSheet('invite')} />}
        {tab === 'announcements' && <Announcements o={o} list={d.challenges} />}
      </div>

      {sheet === 'invite' && <InviteSheet o={o} onClose={() => setSheet(null)} />}
      {sheet === 'export' && <ExportSheet o={o} list={d.challenges} onClose={() => setSheet(null)} />}
    </div>
  )
}

/* -------------------------------------------------------------- Overview */

function OrgOverview({ d }: { d: Dashboard }) {
  const root = useRef<HTMLDivElement>(null)
  const s = d.stats
  const c = d.challenges.find((x) => x.status === 'live') ?? d.challenges.find((x) => x.status !== 'ended') ?? d.challenges[0]
  const [now] = useState(() => Date.now())
  const day = Math.min(c.durationDays, Math.max(0, Math.floor((now - new Date(`${c.startsAt}T00:00:00`).getTime()) / 86_400_000) + 1))
  const finishers = Math.max(1, s.onTrack)

  useMotion(() => {
    gsap.from('[data-bar]', { scaleY: 0, transformOrigin: 'center bottom', duration: 0.7, stagger: 0.06, ease: 'power3.out' })
    gsap.from('[data-health] > span', { scaleX: 0, transformOrigin: 'left center', duration: 0.9, stagger: 0.12, ease: 'power3.out' })
  }, root)

  return (
    <div ref={root} className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface px-5 py-3 ring-1 ring-line/70">
        <span className="text-[15px]">
          Showing <span className="font-semibold">{c.title}</span>
          {day > 0 ? `, day ${day} of ${c.durationDays}` : ', not started yet'}
        </span>
        <Link to={`/c/${c.id}`} className="text-sm font-semibold text-cobalt hover:underline">
          Open challenge page
        </Link>
      </div>

      <dl className="grid grid-cols-2 overflow-hidden rounded-3xl bg-surface ring-1 ring-line/70 lg:grid-cols-4">
        {[
          ['Participants', s.active.toLocaleString('en-US'), c.limit ? `of ${c.limit} spots in ${c.title}` : 'Across live challenges'],
          ['On track today', `${pct(s.onTrack, s.active)}%`, `${s.onTrack} ${s.onTrack === 1 ? 'person' : 'people'}`],
          ['Sponsor pool', usd(c.sponsorPool), 'Held in escrow'],
          ['Est. per finisher', usd(c.sponsorPool / finishers, { cents: true }), `If ~${finishers} finish, from the sponsor pool`],
        ].map(([k, v, sub], i) => (
          <div key={k} className={cx('p-5 sm:p-6', i % 2 === 1 && 'border-l border-line', i >= 2 && 'border-t border-line lg:border-t-0', i === 2 && 'lg:border-l')}>
            <dt className="text-sm text-slate">{k}</dt>
            <dd className="mt-1 font-display text-3xl font-bold tabular">{v}</dd>
            <dd className="text-sm text-slate">{sub}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-7">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-bold">Daily completion</h2>
            <span className="text-sm text-slate">% verified, last {s.dailyCompletion.length} days</span>
          </div>
          <div className="mt-6 flex h-52 items-end gap-2 sm:gap-4">
            {s.dailyCompletion.map((v, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-center gap-2">
                <span className="text-xs font-semibold tabular">{v}%</span>
                <span className="relative w-full flex-1">
                  <span data-bar className="absolute inset-x-0 bottom-0 rounded-t-lg bg-cobalt" style={{ height: `${v}%` }} />
                </span>
                <span className="text-xs text-slate">{s.dailyCompletion.length - i === 1 ? 'Yesterday' : `${s.dailyCompletion.length - i}d ago`}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-7">
          <h2 className="text-xl font-bold">Participant health</h2>
          <div data-health className="mt-5 flex h-3 overflow-hidden rounded-full bg-tile">
            <span className="bg-cobalt" style={{ width: `${pct(s.onTrack, s.active)}%` }} />
            <span className="bg-gold" style={{ width: `${pct(s.atRisk, s.active)}%` }} />
            <span className="bg-miss" style={{ width: `${pct(s.out, s.active)}%` }} />
          </div>
          <ul className="mt-5 space-y-3 text-[15px]">
            {(
              [
                ['On track', s.onTrack, 'bg-cobalt'],
                ['At risk, close to running out of strikes', s.atRisk, 'bg-gold'],
                ['Out of strikes', s.out, 'bg-miss'],
              ] as const
            ).map(([k, v, dot]) => (
              <li key={k} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2">
                  <span className={cx('size-2.5 rounded-full', dot)} />
                  {k}
                </span>
                <span className="font-semibold tabular">{v}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-3xl bg-surface ring-1 ring-line/70">
        <div className="p-5 sm:px-7">
          <h2 className="text-xl font-bold">Needs a nudge</h2>
          <p className="text-sm text-slate">Participants close to running out of strikes. Post an announcement to encourage them.</p>
        </div>
        {d.atRisk.length === 0 ? (
          <p className="border-t border-line px-5 py-6 text-[15px] text-slate sm:px-7">Nobody is at risk right now.</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {d.atRisk.map((r) => {
              const ch = d.challenges.find((x) => x.id === r.challengeId)
              return (
                <li key={`${r.person.handle}-${r.challengeId}`} className="flex items-center gap-3 px-5 py-3.5 sm:px-7">
                  <Avatar person={r.person} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{r.person.name}</span>
                    <span className="block text-sm text-slate">
                      {ch?.title}
                      {r.lastVerified ? `, last verified ${new Date(r.lastVerified).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ', no verified days yet'}
                    </span>
                  </span>
                  <Strikes total={ch?.freeStrikes ?? r.strikesUsed} used={r.strikesUsed} size={16} />
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------ Challenges */

function Challenges({ list }: { list: Challenge[] }) {
  const rows = list.map((c) => ({ c, live: c.status === 'live' || c.status === 'open', label: STATUS[c.status] }))
  return (
    <>
      {/* Phones: one card per challenge so nothing is cut off */}
      <ul className="space-y-3 md:hidden">
        {rows.map(({ c, live, label }) => (
          <li key={c.id} className="rounded-3xl bg-surface p-5 ring-1 ring-line/70">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to={`/c/${c.id}`} className="font-semibold hover:text-cobalt">
                  {c.title}
                </Link>
                <div className="text-sm text-slate">
                  {c.durationDays} days, {c.providers.join(' + ')}
                </div>
              </div>
              <Tag tone={live ? 'cobalt' : 'plain'}>{label}</Tag>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4 text-sm">
              <div>
                <dt className="text-slate">People</dt>
                <dd className="font-display text-lg font-semibold tabular">{c.participants}</dd>
              </div>
              <div>
                <dt className="text-slate">Pool</dt>
                <dd className="font-display text-lg font-semibold text-gold-ink tabular">{usd(c.sponsorPool)}</dd>
              </div>
            </dl>
            <Button size="sm" variant="secondary" to={`/c/${c.id}`} className="mt-4 w-full">
              {live ? 'Manage' : 'See results'}
            </Button>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-3xl bg-surface ring-1 ring-line/70 md:block">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-line text-left text-sm text-slate">
              <th className="px-6 py-3 font-normal">Challenge</th>
              <th className="py-3 font-normal">Status</th>
              <th className="py-3 text-right font-normal">People</th>
              <th className="py-3 text-right font-normal">Pool</th>
              <th className="px-6 py-3 text-right font-normal">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ c, live, label }) => (
              <tr key={c.id}>
                <td className="px-6 py-4">
                  <Link to={`/c/${c.id}`} className="font-semibold hover:text-cobalt">
                    {c.title}
                  </Link>
                  <div className="text-sm text-slate">
                    {c.durationDays} days, {c.providers.join(' + ')}
                  </div>
                </td>
                <td className="py-4">
                  <Tag tone={live ? 'cobalt' : 'plain'}>{label}</Tag>
                </td>
                <td className="py-4 text-right tabular">{c.participants}</td>
                <td className="py-4 text-right font-display font-semibold text-gold-ink tabular">{usd(c.sponsorPool)}</td>
                <td className="px-6 py-4 text-right">
                  <Button size="sm" variant="ghost" to={`/c/${c.id}`}>
                    {live ? 'Manage' : 'Results'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* --------------------------------------------------------------- Members */

interface Member {
  person: Person
  role: OrgRole
  joined: string
  challenges: number
  completion: number | null
}

function Members({ o, onInvite }: { o: ApiOrg; onInvite: () => void }) {
  const [q, setQ] = useState('')
  const toast = useToast()
  const { session } = useAuth()
  const src = useApiData<Member[]>(`/orgs/${encodeURIComponent(o.slug)}/members`)
  if (!src.data) return src.error ? <RetryPanel onRetry={src.refresh} /> : <PanelSkeleton rows={5} />
  const list = src.data.filter((m) => `${m.person.name} ${m.person.handle}`.toLowerCase().includes(q.toLowerCase()))

  async function changeRole(m: Member, role: OrgRole) {
    const before = m.role
    src.setData((all) => all?.map((x) => (x.person.handle === m.person.handle ? { ...x, role } : x)) ?? null)
    try {
      await api(`/orgs/${encodeURIComponent(o.slug)}/members/${encodeURIComponent(m.person.handle)}`, { method: 'PATCH', body: { role } })
      toast({ title: 'Role updated', body: `${m.person.name} is now ${role === 'Admin' ? 'an' : 'a'} ${role.toLowerCase()}.` })
    } catch (err) {
      src.setData((all) => all?.map((x) => (x.person.handle === m.person.handle ? { ...x, role: before } : x)) ?? null)
      toast({ tone: 'error', title: 'Role not changed', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative max-w-sm flex-1">
          <span className="sr-only">Search members</span>
          <Search size={17} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-slate" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members" className={cx(inputClass, 'pl-11')} />
        </label>
        <Button variant="secondary" onClick={onInvite}>
          <UserPlus size={17} /> Invite members
        </Button>
      </div>
      <div className="mt-4 overflow-x-auto rounded-3xl bg-surface ring-1 ring-line/70">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-line text-left text-sm text-slate">
              <th className="px-6 py-3 font-normal">Member</th>
              <th className="py-3 font-normal">Role</th>
              <th className="hidden py-3 text-right font-normal md:table-cell">Challenges</th>
              <th className="hidden py-3 text-right font-normal sm:table-cell">Completion</th>
              <th className="hidden px-6 py-3 text-right font-normal lg:table-cell">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((m) => {
              const you = m.person.handle === session?.username
              return (
                <tr key={m.person.handle}>
                  <td className="px-4 py-3.5 sm:px-6">
                    <span className="flex items-center gap-3">
                      <Avatar person={m.person} size={34} />
                      <span>
                        <span className="block font-semibold">{you ? `${m.person.name} (you)` : m.person.name}</span>
                        <span className="block text-sm text-slate">@{m.person.handle}</span>
                      </span>
                    </span>
                  </td>
                  <td className="py-3.5">
                    {m.role === 'Owner' || you ? (
                      <Tag tone="ink">{m.role}</Tag>
                    ) : (
                      <Select
                        look="compact"
                        label={`Role for ${m.person.name}`}
                        value={m.role}
                        onChange={(v) => void changeRole(m, v)}
                        options={(['Admin', 'Moderator', 'Member'] as const).map((r) => ({ value: r, label: r }))}
                      />
                    )}
                  </td>
                  <td className="hidden py-3.5 text-right tabular md:table-cell">{m.challenges}</td>
                  <td className="hidden py-3.5 text-right tabular sm:table-cell">{m.completion === null ? 'None yet' : `${m.completion}%`}</td>
                  <td className="hidden px-6 py-3.5 text-right text-slate lg:table-cell">{new Date(m.joined).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="border-t border-line px-6 py-3 text-sm text-slate">
          Showing {list.length} of {src.data.length.toLocaleString('en-US')} members
        </p>
      </div>
    </div>
  )
}

/* --------------------------------------------------------- Announcements */

interface Announcement {
  id: string
  challengeId: string | null
  body: string
  at: string
  pinned: boolean
  reach: number
}

const EVERYONE = 'all'

function Announcements({ o, list: challenges }: { o: ApiOrg; list: Challenge[] }) {
  const src = useApiData<Announcement[]>(`/orgs/${encodeURIComponent(o.slug)}/announcements`)
  const [body, setBody] = useState('')
  const [pin, setPin] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const [target, setTarget] = useState(challenges.find((c) => c.status !== 'ended')?.id ?? EVERYONE)
  const list = useRef<HTMLUListElement>(null)

  async function post() {
    if (!body.trim() || busy) return
    setBusy(true)
    const challengeId = target === EVERYONE ? undefined : target
    try {
      const r = await api<{ id: string; reach: number }>(`/orgs/${encodeURIComponent(o.slug)}/announcements`, { method: 'POST', body: { body: body.trim(), challengeId, pinned: pin } })
      src.setData((v) => [{ id: r.id, challengeId: challengeId ?? null, body: body.trim(), at: new Date().toISOString(), pinned: pin, reach: r.reach }, ...(v ?? [])])
      setBody('')
      setPin(false)
      toast({ title: 'Announcement posted', body: `${r.reach} ${r.reach === 1 ? 'person has' : 'people have'} been notified.` })
      requestAnimationFrame(() => {
        const first = list.current?.firstElementChild
        if (first && prefersMotion()) gsap.from(first, { y: -10, autoAlpha: 0, duration: 0.4, ease: 'power2.out' })
      })
    } catch (err) {
      toast({ tone: 'error', title: 'Announcement not posted', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    } finally {
      setBusy(false)
    }
  }

  const title = (id: string | null) => (id ? (challenges.find((c) => c.id === id)?.title ?? 'A challenge') : `Everyone in ${o.name}`)

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
      <section className="rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-7 lg:self-start">
        <h2 className="text-xl font-bold">New announcement</h2>
        <p className="mt-1 text-sm text-slate">Notifies everyone in the challenge you pick, or every member.</p>
        <div className="mt-5 space-y-4">
          <Field label="Send to">
            <Select
              label="Send to"
              value={target}
              onChange={setTarget}
              options={[{ value: EVERYONE, label: `Everyone in ${o.name}` }, ...challenges.filter((c) => c.status !== 'ended').map((c) => ({ value: c.id, label: c.title }))]}
            />
          </Field>
          <Field label="Message">
            <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Share an update, a deadline or some encouragement" className={cx(inputClass, 'resize-y')} />
          </Field>
          <div className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-2 text-[15px] font-semibold">
              <Pin size={16} /> Pin it
            </span>
            <Toggle checked={pin} onChange={setPin} label="Pin it" />
          </div>
          <Button className="w-full" onClick={() => void post()} disabled={!body.trim()} busy={busy}>
            <Megaphone size={17} /> Post announcement
          </Button>
        </div>
      </section>
      {!src.data ? (
        src.error ? <RetryPanel onRetry={src.refresh} /> : <PanelSkeleton rows={3} />
      ) : src.data.length === 0 ? (
        <p className="rounded-3xl bg-surface p-6 text-center text-slate ring-1 ring-line/70">Announcements you post show up here.</p>
      ) : (
        <ul ref={list} className="space-y-3">
          {src.data.map((a) => (
            <li key={a.id} className="rounded-3xl bg-surface p-5 ring-1 ring-line/70">
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate">
                <span className="font-semibold text-ink">{title(a.challengeId)}</span>
                {a.pinned && (
                  <Tag tone="gold">
                    <Pin size={11} /> Pinned
                  </Tag>
                )}
                <span className="ml-auto">{new Date(a.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </div>
              <p className="mt-2 text-[15px]">{a.body}</p>
              <p className="mt-3 text-sm text-slate">Sent to {a.reach} {a.reach === 1 ? 'person' : 'people'}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- Sheets */

function InviteSheet({ o, onClose }: { o: ApiOrg; onClose: () => void }) {
  const code = o.inviteCode ?? ''
  const link = `${window.location.origin}/join/${code}`
  const [copied, setCopied] = useState<'link' | 'code' | null>(null)
  const [emails, setEmails] = useState('')
  const [sent, setSent] = useState(0)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const valid = emails.split(/[\s,]+/).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))

  const copy = (what: 'link' | 'code', text: string) => {
    void navigator.clipboard?.writeText(text)
    setCopied(what)
  }

  async function send() {
    setBusy(true)
    try {
      const r = await api<{ invited: number }>(`/orgs/${encodeURIComponent(o.slug)}/invitations`, { method: 'POST', body: { emails: valid } })
      setSent(r.invited)
      toast({ title: `${r.invited} ${r.invited === 1 ? 'invite' : 'invites'} sent` })
      setEmails('')
    } catch (err) {
      toast({ tone: 'error', title: 'Invites not sent', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Invite members" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-2xl bg-ground p-2 pl-4">
          <span className="min-w-0 flex-1 truncate text-[15px]">{link}</span>
          <Button size="sm" variant="secondary" onClick={() => copy('link', link)}>
            <Copy size={15} /> {copied === 'link' ? 'Copied' : 'Copy link'}
          </Button>
        </div>
        <div className="flex items-center gap-2 rounded-2xl bg-ground p-2 pl-4">
          <span className="flex-1 text-[15px] text-slate">
            Invite code <span className="ml-2 font-display text-lg font-bold tracking-wider text-ink">{code}</span>
          </span>
          <Button size="sm" variant="secondary" onClick={() => copy('code', code)}>
            <Copy size={15} /> {copied === 'code' ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
      <div className="mt-6">
        <Field label="Or invite by email" hint="Separate addresses with commas or new lines">
          <textarea rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="ada@example.com, tunde@example.com" className={cx(inputClass, 'resize-y')} />
        </Field>
        <Button className="mt-4 w-full" disabled={!valid.length} busy={busy} onClick={() => void send()}>
          Send {valid.length || ''} {valid.length === 1 ? 'invite' : 'invites'}
        </Button>
        {sent > 0 && (
          <p role="status" className="mt-3 inline-flex items-center gap-1.5 text-sm text-calm">
            <Check size={15} strokeWidth={3} /> {sent} {sent === 1 ? 'invite' : 'invites'} sent.
          </p>
        )}
      </div>
    </Sheet>
  )
}

function ExportSheet({ o, list, onClose }: { o: ApiOrg; list: Challenge[]; onClose: () => void }) {
  const toast = useToast()
  const { session } = useAuth()
  const [target, setTarget] = useState(list[0]?.id ?? '')
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    try {
      const res = await fetch(`${BASE}/orgs/${encodeURIComponent(o.slug)}/challenges/${encodeURIComponent(target)}/export`, {
        headers: session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {},
      })
      if (!res.ok) throw new Error(String(res.status))
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `${target}-results.csv`
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: 'Results downloaded', body: name })
      onClose()
    } catch {
      toast({ tone: 'error', title: 'Couldn’t download the results', body: 'Please try again.', inbox: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      title="Export results"
      onClose={onClose}
      footer={
        <Button className="w-full" onClick={() => void download()} disabled={!target} busy={busy}>
          <Download size={17} /> Download CSV
        </Button>
      }
    >
      <div className="space-y-5">
        <Field label="Challenge">
          <Select label="Challenge" value={target} onChange={setTarget} options={list.map((c) => ({ value: c.id, label: c.title }))} />
        </Field>
        <p className="text-[15px] text-slate">One row per participant: rank, verified and missed days, progress, stake, penalty and payout.</p>
      </div>
    </Sheet>
  )
}

/** Switch between organizations you manage. */
function OrgSwitcher({ current, managed }: { current: ApiOrg; managed: ApiOrg[] }) {
  const navigate = useNavigate()
  if (managed.length < 2) return <h1 className="text-2xl font-bold sm:text-4xl">{current.name}</h1>
  return (
    <Select
      look="title"
      label="Organization"
      value={current.slug}
      onChange={(slug) => navigate(`/org/${slug}`)}
      options={managed.map((m) => ({ value: m.slug, label: m.name, hint: `${m.members.toLocaleString('en-US')} members` }))}
    />
  )
}

/** A brand-new organization: one clear next step instead of empty charts. */
function FirstChallenge({ o }: { o: ApiOrg }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="rounded-3xl bg-surface p-8 ring-1 ring-line/70">
        <h2 className="text-3xl font-bold">Launch your first challenge</h2>
        <p className="mt-2 max-w-lg text-slate">
          Pick a goal for your members, how it’s verified and whether there’s a stake. Progress, completion and health will show up here once people join.
        </p>
        <Button to={`/create?host=${o.slug}`} className="mt-6">
          <Plus size={18} /> Create a challenge
        </Button>
      </div>
      <div className="rounded-3xl bg-ink p-8 text-white">
        <h3 className="text-xl font-bold">Invite your members</h3>
        <p className="mt-2 text-white/65">Share this code or the invite link from the Invite button above.</p>
        <div className="mt-5 font-display text-3xl font-bold tracking-wider">{o.inviteCode}</div>
      </div>
    </div>
  )
}
