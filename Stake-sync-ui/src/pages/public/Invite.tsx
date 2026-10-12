import { Check, Lock, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useAuth } from '../../auth/context'
import { Strikes } from '../../components/DayGrid'
import { Avatar, Button, Providers, Tag } from '../../components/ui'
import { PanelSkeleton } from '../../components/Skeleton'
import type { Challenge } from '../../data/types'
import { api, ApiError } from '../../lib/api'
import { resolveInvite, type InviteInfo } from '../../lib/invite'
import { useApiData } from '../../lib/useApiData'
import { shortDate, usd } from '../../lib/format'
import { gsap, motionOK, useGSAP } from '../../lib/gsap'
import { rememberNext } from '../../lib/next'
import { stakeLabel } from '../../lib/styles'
import { canManage, refreshMyOrgs, type ApiOrg } from '../../lib/useMyOrgs'
import { useToast } from '../../toast/context'

function useEntrance() {
  const root = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      gsap.matchMedia().add(motionOK, () => {
        gsap.from('[data-invite] > *', { y: 20, autoAlpha: 0, duration: 0.6, stagger: 0.08, ease: 'power3.out', clearProps: 'all' })
      })
    },
    { scope: root },
  )
  return root
}

function NotFound({ kind }: { kind: 'challenge' | 'organization' }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-4xl font-bold">This invite doesn’t work</h1>
      <p className="mt-3 text-lg text-slate">
        The {kind} may have ended, the link may have been mistyped, or the invite was turned off. Ask the person who sent it
        for a new one.
      </p>
      <Button to="/" variant="secondary" className="mt-8">
        Go to Stake-Sync
      </Button>
    </div>
  )
}

/** Resolves the code in the URL; `undefined` while checking, null if it doesn't match. */
function useInvite(code: string) {
  const [info, setInfo] = useState<{ code: string; value: InviteInfo | null } | null>(null)
  const toast = useToast()
  useEffect(() => {
    let alive = true
    resolveInvite(code)
      .then((v) => alive && setInfo({ code, value: v }))
      .catch((e) => {
        if (!alive) return
        if (e instanceof ApiError && e.status === 404) return setInfo({ code, value: null })
        toast({ tone: 'error', title: 'Couldn’t open this invite', body: e instanceof ApiError ? e.message : 'Please try again.', inbox: false })
      })
    return () => {
      alive = false
    }
  }, [code, toast])
  return info?.code === code ? info.value : undefined
}

function Loading() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:py-20">
      <PanelSkeleton rows={5} />
    </div>
  )
}

/** Shown to logged-out visitors: create an account or log in, then come straight back. */
function AuthChoice({ next, verb }: { next: string; verb: string }) {
  const navigate = useNavigate()
  const go = (to: string) => {
    rememberNext(next)
    navigate(to)
  }
  return (
    <div className="space-y-2">
      <Button size="lg" className="w-full" onClick={() => go('/signup')}>
        Create an account to {verb}
      </Button>
      <Button size="lg" variant="secondary" className="w-full" onClick={() => go('/login')}>
        I already have an account
      </Button>
    </div>
  )
}

export function ChallengeInvite() {
  const { code = '' } = useParams()
  const info = useInvite(code)
  const id = info?.kind === 'challenge' ? info.id : null
  const src = useApiData<Challenge & { joined?: boolean }>(id ? `/challenges/${encodeURIComponent(id)}?code=${encodeURIComponent(code)}` : null)
  if (info === null || (info && info.kind !== 'challenge') || src.status === 404) return <NotFound kind="challenge" />
  if (!src.data) return <Loading />
  return <ChallengeInviteCard c={src.data} code={code.toUpperCase()} />
}

function ChallengeInviteCard({ c, code }: { c: Challenge & { joined?: boolean }; code: string }) {
  const { session } = useAuth()
  const root = useEntrance()

  if (c.status === 'ended') return <NotFound kind="challenge" />
  const inviter = c.org ? { ...c.creator, name: c.org.name } : c.creator
  const isIn = Boolean(c.joined)
  const open = `/c/${c.id}?code=${encodeURIComponent(code)}`
  const spots = c.limit ? c.limit - c.participants : null

  return (
    <div ref={root} className="mx-auto max-w-xl px-4 py-12 sm:py-20">
      <div data-invite>
        <div className="flex items-center gap-3">
          <Avatar person={inviter} size={40} />
          <p className="text-[15px] text-slate">
            <span className="font-semibold text-ink">{inviter.name}</span> invited you to a challenge
          </p>
        </div>

        <section className="mt-6 overflow-hidden rounded-[28px] bg-surface shadow-(--shadow-lift) ring-1 ring-line/70">
          <div className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone="cobalt">{c.status === 'open' ? `Starts ${shortDate(c.startsAt)}` : 'In progress'}</Tag>
              {c.privacy !== 'public' && (
                <Tag>
                  <Lock size={12} /> {c.privacy === 'org' ? 'Members only' : 'Invite only'}
                </Tag>
              )}
              {c.sponsorPool > 0 && <Tag tone="gold">{usd(c.sponsorPool)} pool</Tag>}
            </div>
            <h1 className="mt-4 text-4xl font-bold sm:text-5xl">{c.title}</h1>
            <p className="mt-3 text-lg text-slate">{c.summary}</p>
            <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-line pt-5">
              <div>
                <dt className="text-sm text-slate">Stake</dt>
                <dd className="font-display text-xl font-semibold tabular">{stakeLabel(c)}</dd>
              </div>
              <div>
                <dt className="text-sm text-slate">Length</dt>
                <dd className="font-display text-xl font-semibold tabular">{c.durationDays} days</dd>
              </div>
              <div>
                <dt className="text-sm text-slate">Free strikes</dt>
                <dd className="mt-1.5">
                  <Strikes total={c.freeStrikes} used={0} size={16} />
                </dd>
              </div>
            </dl>
          </div>
          <div className="space-y-3 border-t border-line bg-ground/60 px-6 py-5 sm:px-8">
            <Providers providers={c.providers} />
            <p className="flex items-center gap-2 text-sm text-slate">
              <Users size={16} />
              {c.participants.toLocaleString('en-US')} joined{spots !== null && `, ${spots} spots left`}
            </p>
          </div>
        </section>

        <div className="mt-6">
          {!session ? (
            <AuthChoice next={`${open}&join=1`} verb="join" />
          ) : isIn ? (
            <Button to={open} size="lg" className="w-full">
              <Check size={18} strokeWidth={3} /> You’re in. Open the challenge
            </Button>
          ) : (
            <Button to={`${open}&join=1`} size="lg" className="w-full">
              Review the rules and join
            </Button>
          )}
          <p className="mt-4 text-center text-sm text-slate">You’ll see every rule before you stake anything.</p>
        </div>
      </div>
    </div>
  )
}

export function OrgInvite() {
  const { code = '' } = useParams()
  const info = useInvite(code)
  const slug = info?.kind === 'org' ? info.slug : null
  const src = useApiData<ApiOrg>(slug ? `/orgs/${encodeURIComponent(slug)}` : null)
  if (info === null || (info && info.kind !== 'org') || src.status === 404) return <NotFound kind="organization" />
  if (!src.data) return <Loading />
  return <OrgInviteCard o={src.data} code={code.toUpperCase()} onJoined={(o) => src.setData(() => o)} />
}

function OrgInviteCard({ o, code, onJoined }: { o: ApiOrg; code: string; onJoined: (o: ApiOrg) => void }) {
  const { session } = useAuth()
  const [justJoined, setJustJoined] = useState(false)
  const [joining, setJoining] = useState(false)
  const toast = useToast()
  const root = useEntrance()
  const role = o.role
  const upcoming = (o.featured ?? []).filter((c) => c.status !== 'ended')

  async function join() {
    setJoining(true)
    try {
      onJoined(await api<ApiOrg>('/orgs/join', { method: 'POST', body: { code } }))
      void refreshMyOrgs()
      toast({ title: `Welcome to ${o.name}` })
      setJustJoined(true)
    } catch (err) {
      toast({ tone: 'error', title: 'Couldn’t join', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    } finally {
      setJoining(false)
    }
  }

  return (
    <div ref={root} className="mx-auto max-w-xl px-4 py-12 sm:py-20">
      <div data-invite className="text-center">
        <div className="mx-auto w-fit">
          <Avatar person={o.person} size={88} />
        </div>
        <p className="mt-6 text-slate">You’ve been invited to join</p>
        <h1 className="mt-1 text-4xl font-bold sm:text-5xl">{o.name}</h1>
        <p className="mx-auto mt-3 max-w-md text-lg text-slate">{o.about}</p>
        <p className="mt-4 inline-flex items-center gap-2 text-[15px] text-slate">
          <Users size={16} /> {o.members.toLocaleString('en-US')} {o.members === 1 ? 'member' : 'members'}
        </p>

        {upcoming.length > 0 && (
          <ul className="mt-8 space-y-2 text-left">
            {upcoming.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 rounded-2xl bg-surface px-5 py-4 ring-1 ring-line/70">
                <span className="font-semibold">{c.title}</span>
                <span className="shrink-0 text-sm text-slate">Starts {shortDate(c.startsAt)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 text-left">
          {!session ? (
            <AuthChoice next={`/join/${code}`} verb="join" />
          ) : role ? (
            <div className="space-y-3">
              <p className="flex items-center justify-center gap-2 rounded-2xl bg-calm-soft px-4 py-3 font-semibold text-calm">
                <Check size={18} strokeWidth={3} /> {justJoined ? `Welcome to ${o.name}` : `You’re a ${role.toLowerCase()} of ${o.name}`}
              </p>
              <Button to={canManage(role) ? `/org/${o.slug}` : '/explore'} size="lg" className="w-full">
                {canManage(role) ? 'Open organization dashboard' : 'See its challenges'}
              </Button>
            </div>
          ) : (
            <Button size="lg" className="w-full" busy={joining} onClick={() => void join()}>
              Join {o.name}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
