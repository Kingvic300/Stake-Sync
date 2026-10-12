import { Check, Copy, Eye, Lock, Plus, Snowflake, Trash2, Users, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { AddMoneySheet } from '../../components/AddMoneySheet'
import { Strikes } from '../../components/DayGrid'
import { Avatar, Button, Field, ProviderMark, Tag, Toggle } from '../../components/ui'
import { categories } from '../../data/categories'
import type { Category, Challenge, Criterion, Exercise, Privacy, Provider, VerificationSettings } from '../../data/types'
import { AtStake, RulesMatrix } from '../../components/RulesMatrix'
import { LANGUAGES, matrixRows, outcomes, type MatrixInput } from '../../lib/matrix'
import { cx, usd } from '../../lib/format'
import { feesText } from '../../lib/fees'
import { gsap, prefersMotion, useGSAP } from '../../lib/gsap'
import { inputClass } from '../../lib/styles'
import { canManage, useMyOrgs, type MyOrg } from '../../lib/useMyOrgs'
import { useLedger } from '../../state/ledger-context'
import { useNavigate, useSearchParams } from 'react-router'
import { RetryPanel } from '../../components/RetryPanel'
import { FormPageSkeleton } from '../../components/Skeleton'
import { useApiData } from '../../lib/useApiData'
import { personOf, useAuth } from '../../auth/context'
import { api, ApiError } from '../../lib/api'
import { useToast } from '../../toast/context'
import { signAndSubmit, type SignBytes } from '../../wallet/sendUsdc'

const SignButton = lazy(() => import('../../wallet/SignButton'))
import { Select } from '../../components/Select'
import { DatePicker } from '../../components/DatePicker'

const steps = ['Basics', 'Requirement', 'Rules', 'Stake', 'Strikes', 'Rewards', 'Review'] as const
type Step = (typeof steps)[number]

const templates: Record<Provider, { days: string; count: string; unit: string; ideas: string }> = {
  GitHub: { days: 'qualifying commits or pull requests', count: 'merged pull requests', unit: 'pull requests', ideas: 'Daily coding, shipping a side project, open source' },
  Solana: { days: 'on-chain activity from your linked wallet', count: 'program deployments', unit: 'deployments', ideas: 'Deploy programs, ship a dApp, build on devnet' },
  LeetCode: { days: 'a new accepted submission', count: 'new problems solved', unit: 'problems', ideas: 'Interview prep, DSA practice, contest training' },
  Codeforces: { days: 'a new accepted problem', count: 'new problems solved', unit: 'problems', ideas: 'Competitive programming, contest prep, rating climbs' },
  WakaTime: { days: '60 minutes of tracked coding', count: 'hours of tracked coding', unit: 'hours', ideas: 'Deep work, learning a language, steady coding time' },
  Camera: { days: '100 camera-counted push-ups', count: 'camera-counted push-ups', unit: 'push-ups', ideas: 'Push-ups, sit-ups or squats, counted by the phone camera' },
  Health: { days: '10,000 steps from Apple Health or Health Connect', count: 'kilometres walked', unit: 'km', ideas: 'Steps and walking distance from the phone, via the mobile app' },
  Photo: { days: 'an approved photo of your progress', count: 'approved progress photos', unit: 'photos', ideas: 'Anything without an integration. Photos are reviewed before they count' },
}

// Approved structures only. Creators can't invent their own financial rules.
const presets = {
  gentle: { name: 'Gentle', free: 3, penalties: [5, 10, 15], note: 'Best for first-timers and long challenges' },
  standard: { name: 'Standard', free: 2, penalties: [10, 15, 20], note: 'A balance of forgiveness and pressure' },
  strict: { name: 'Strict', free: 1, penalties: [15, 25, 35], note: 'For short, high-commitment sprints' },
} as const
type Preset = keyof typeof presets

interface Draft {
  /** 'me' or the slug of an organization you manage */
  host: string
  title: string
  description: string
  category: Category
  privacy: Privacy
  limit: string
  provider: Provider
  mode: 'days' | 'count'
  duration: number
  required: number
  target: number
  start: string
  stakeMode: 'none' | 'fixed' | 'range'
  stake: number
  range: [number, number]
  preset: Preset
  freeze: boolean
  freezeDays: number
  pool: number
  split: 'equal' | 'weighted'
  forfeits: boolean
  /** GitHub settings for the verification matrix */
  gh: { minCommits: number; minChangedLines: number; languages: string[]; paths: string[]; repo: string; countPRs: boolean }
  wakaMinutes: number
  lcMin: 'Easy' | 'Medium' | 'Hard'
  /** Which problems count: any new one, LeetCode's daily question, or your own list */
  lcSource: 'any' | 'daily' | 'list'
  /** Your list as typed: one line per day, links or problem names */
  lcList: string
  camera: { exercise: Exercise; reps: number }
  photoInstructions: string
  /** Extra rules beyond what the provider checks */
  criteria: Criterion[]
}

const initial: Draft = {
  host: 'me',
  title: '',
  description: '',
  category: 'Coding',
  privacy: 'public',
  limit: '',
  provider: 'GitHub',
  mode: 'days',
  duration: 30,
  required: 25,
  target: 20,
  // A week from today, so a new challenge has time to fill up.
  start: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
  stakeMode: 'fixed',
  stake: 10,
  range: [5, 50],
  preset: 'gentle',
  freeze: true,
  freezeDays: 2,
  pool: 0,
  split: 'equal',
  forfeits: true,
  gh: { minCommits: 1, minChangedLines: 5, languages: [], paths: [], repo: '', countPRs: true },
  wakaMinutes: 60,
  lcMin: 'Easy',
  lcSource: 'any',
  lcList: '',
  camera: { exercise: 'pushups', reps: 100 },
  photoInstructions: '',
  criteria: [],
}

const DRAFT_KEY = 'stakesync.createDraft'

function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? { ...initial, ...(JSON.parse(raw) as Partial<Draft>) } : null
  } catch {
    return null
  }
}

function saveDraft(d: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d))
  } catch {
    // storage blocked: the draft lasts for this visit only
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // nothing to clear
  }
}

/**
 * Days a participant must complete. With no stake there's no penalty, so the server makes the
 * next miss after the free strikes put you out: needed days rise to match the strikes.
 */
function neededDays(d: Draft) {
  if (d.stakeMode !== 'none') return d.required
  return d.duration - Math.min(presets[d.preset].free, d.duration - d.required)
}

/** The headline requirement, built from the matrix so it says exactly what's checked. */
function requirementText(d: Draft) {
  const t = templates[d.provider]
  if (d.mode !== 'days') return `${d.target} ${t.count} in ${d.duration} days`
  const rows = matrixRows(draftMatrix(d)).filter((r) => r.kind !== 'self' && r.required)
  const first = rows[0]?.rule ?? `${t.days[0].toUpperCase()}${t.days.slice(1)}`
  const scope = rows
    .slice(1)
    .filter((r) => r.key.startsWith('gh-'))
    .map((r) => r.rule.replace(/^Changes are in /, 'in ').replace(/^Changes touch /, 'touching ').replace(/^Commits go to /, 'to '))
  return `${first}${scope.length ? `, ${scope.join(', ')}` : ''}, on at least ${neededDays(d)} of ${d.duration} days`
}

function verificationLevel(d: Draft) {
  const top = d.stakeMode === 'none' ? 0 : d.stakeMode === 'range' ? d.range[1] : d.stake
  if (top === 0 && d.pool === 0) return 'Basic'
  if (top > 50 || d.pool >= 5000) return 'Enhanced'
  return 'Verified user'
}

/** Six months out, the latest start the API accepts. */
const inSixMonths = () => new Date(Date.now() + 179 * 86_400_000).toISOString().slice(0, 10)

/** Tomorrow as YYYY-MM-DD in local time, the earliest start date. */
const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** GET /challenges/:id, with the fields an edit needs to rebuild the form. */
type EditableChallenge = Challenge & { canManage?: boolean; penaltyStructure?: Preset; forfeitsToFinishers?: boolean }

/** The form as it was filled in, from a published challenge. */
function draftFrom(c: EditableChallenge): Draft {
  const v = c.verification ?? {}
  const g = v.github ?? {}
  return {
    ...initial,
    host: c.org ? c.org.slug ?? 'me' : 'me',
    title: c.title,
    description: c.description,
    category: c.category,
    privacy: c.privacy,
    limit: c.limit ? String(c.limit) : '',
    provider: c.providers[0],
    mode: c.mode,
    duration: c.durationDays,
    required: c.requiredDays ?? c.durationDays,
    target: c.targetCount ?? initial.target,
    start: c.startsAt.slice(0, 10),
    stakeMode: c.stakeMode,
    stake: c.stake || initial.stake,
    range: c.stakeRange ?? initial.range,
    preset: c.penaltyStructure && c.penaltyStructure in presets ? c.penaltyStructure : initial.preset,
    freeze: c.freeze.allowed,
    freezeDays: c.freeze.days || initial.freezeDays,
    pool: 0,
    forfeits: c.forfeitsToFinishers ?? true,
    gh: { minCommits: g.minCommits ?? 1, minChangedLines: g.minChangedLines ?? 5, languages: g.languages ?? [], paths: g.paths ?? [], repo: g.repo ?? '', countPRs: g.countPullRequests !== false },
    wakaMinutes: v.wakatime?.minMinutes ?? initial.wakaMinutes,
    lcMin: v.leetcode?.minDifficulty ?? 'Easy',
    lcSource: v.leetcode?.assigned ?? 'any',
    lcList: (v.leetcode?.schedule ?? []).map((day) => day.join(', ')).join('\n'),
    camera: v.camera ?? initial.camera,
    photoInstructions: v.photo?.instructions ?? '',
    criteria: v.criteria ?? [],
  }
}

export function Create() {
  const [params] = useSearchParams()
  const id = params.get('edit')
  const src = useApiData<EditableChallenge>(id ? `/challenges/${encodeURIComponent(id)}` : null)
  if (!id) return <CreateForm />
  if (src.error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24">
        <RetryPanel onRetry={src.refresh} />
      </div>
    )
  }
  if (!src.data) return <FormPageSkeleton />
  if (!src.data.canManage || src.data.participants > 0 || src.data.status !== 'open') {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-3xl font-bold">These rules are locked</h1>
        <p className="mt-3 text-slate">Once someone joins or the challenge starts, nobody can change its rules, the host included. You can still edit the description and banner.</p>
        <Button to={`/c/${src.data.id}`} className="mt-8">
          Back to the challenge
        </Button>
      </div>
    )
  }
  return <CreateForm editing={{ id: src.data.id, draft: draftFrom(src.data) }} />
}

function CreateForm({ editing }: { editing?: { id: string; draft: Draft } }) {
  const ledger = useLedger()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const toast = useToast()
  const hosts = useMyOrgs().filter((o) => canManage(o.role))
  // Decide the starting draft once: an organization preset, a saved draft, or a blank one.
  const [boot] = useState(() => {
    if (editing) return { draft: editing.draft, restored: false }
    const host = params.get('host')
    if (host && hosts.some((h) => h.slug === host)) return { draft: { ...initial, host, privacy: 'org' as const }, restored: false }
    const saved = loadDraft()
    return saved ? { draft: saved, restored: true } : { draft: initial, restored: false }
  })
  const [restored, setRestored] = useState(boot.restored)
  const [d, setD] = useState<Draft>(boot.draft)
  const [topUp, setTopUp] = useState(false)

  // Autosave, so “you can save and come back” is actually true.
  useEffect(() => {
    if (d !== initial && !editing) saveDraft(d)
  }, [d, editing])
  const [step, setStep] = useState<Step>('Basics')
  const [published, setPublished] = useState(false)
  const [banner, setBanner] = useState<{ file: File; url: string } | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [created, setCreated] = useState<{ id: string; inviteCode?: string } | null>(null)
  // Consent isn't saved with the draft: it's given fresh each time you publish.
  const [agreed, setAgreed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const dir = useRef(1)
  const i = steps.indexOf(step)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))

  useGSAP(
    () => {
      if (!prefersMotion()) return
      gsap.from('[data-create-step] > *', { x: 24 * dir.current, autoAlpha: 0, duration: 0.4, stagger: 0.04, ease: 'power3.out', clearProps: 'all' })
    },
    { scope: root, dependencies: [step, published] },
  )

  const valid: Record<Step, boolean> = {
    Basics: d.title.trim().length >= 4 && d.description.trim().length >= 20,
    Requirement: d.mode === 'days' ? d.required <= d.duration : d.target > 0,
    Rules: d.criteria.every((r) => r.text.trim().length >= 5) && (d.provider !== 'LeetCode' || d.mode !== 'days' || d.lcSource !== 'list' || parseProblemList(d.lcList).ok(d.duration)),
    Stake: d.stakeMode !== 'range' || d.range[0] < d.range[1],
    Strikes: true,
    Rewards: d.pool <= ledger.available,
    Review: d.pool <= ledger.available && agreed,
  }

  function go(n: number) {
    dir.current = n > i ? 1 : -1
    setStep(steps[n])
    window.scrollTo({ top: 0, behavior: prefersMotion() ? 'smooth' : 'auto' })
  }

  /** PRD §8 through the API: the rules are fixed and hashed on the server, then the banner uploads. */
  async function publishLive() {
    if (publishing) return
    setPublishing(true)
    try {
      const body = {
        agreeToRules: agreed,
        host: d.host,
        title: d.title.trim(),
        description: d.description.trim(),
        category: d.category,
        privacy: d.privacy,
        ...(d.limit ? { limit: Number(d.limit) } : {}),
        providers: draftMatrix(d).providers.map((p) => p.toLowerCase()),
        verificationConfig: verificationConfig(d),
        requirement: requirementText(d),
        mode: d.mode,
        duration: d.duration,
        ...(d.mode === 'days' ? { required: d.required } : { target: d.target }),
        start: d.start,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        stakeMode: d.stakeMode,
        ...(d.stakeMode === 'fixed' ? { stake: d.stake } : d.stakeMode === 'range' ? { range: d.range } : {}),
        preset: d.preset,
        freeze: d.freeze,
        ...(d.freeze ? { freezeDays: d.freezeDays } : {}),
        ...(d.pool > 0 ? { pool: d.pool } : {}),
        forfeits: d.forfeits,
      }
      if (editing) {
        await api(`/challenges/${encodeURIComponent(editing.id)}/settings`, { method: 'PATCH', body })
        toast({ title: 'Changes saved', body: 'The rules are updated. Your link and invite code still work.' })
        return navigate(`/c/${editing.id}`)
      }
      const c = await api<{ id: string; inviteCode?: string }>('/challenges', { method: 'POST', body })
      if (banner) {
        const form = new FormData()
        form.append('file', banner.file)
        await api(`/challenges/${encodeURIComponent(c.id)}/banner`, { method: 'POST', body: form }).catch(() =>
          toast({ tone: 'error', title: 'Banner didn’t upload', body: 'Your challenge is published; you can add the banner again later.', inbox: false }),
        )
      }
      clearDraft()
      setCreated(c)
      setPublished(true)
      toast({ title: 'Challenge published' })
    } catch (err) {
      toast({ tone: 'error', title: editing ? 'Changes not saved' : 'Couldn’t publish', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    } finally {
      setPublishing(false)
    }
  }

  function publish() {
    void publishLive()
  }

  if (published) return <Published d={d} root={root} created={created} />

  return (
    <div ref={root} className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16 sm:py-10">
      <h1 className="text-4xl font-bold sm:text-5xl">{editing ? 'Edit challenge' : 'Create a challenge'}</h1>
      <p className="mt-2 text-lg text-slate">
        {editing ? 'Change anything until the first person joins. After that, the rules are locked for everyone.' : 'Set the goal, how it’s checked and what’s at stake. Your draft saves as you go.'}
      </p>
      {restored && (
        <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cobalt-soft px-4 py-3 text-[15px]">
          <span>We restored the draft you started earlier.</span>
          <button
            type="button"
            className="font-semibold text-cobalt-deep hover:underline"
            onClick={() => {
              clearDraft()
              setD(initial)
              setStep('Basics')
              setRestored(false)
            }}
          >
            Start over
          </button>
        </div>
      )}

      <ol className="mt-8 flex gap-1 overflow-x-auto" aria-label="Steps">
        {steps.map((s, n) => (
          <li key={s} className="min-w-24 flex-1">
            <button
              type="button"
              onClick={() => n < i && go(n)}
              disabled={n > i}
              aria-current={n === i ? 'step' : undefined}
              className="w-full text-left disabled:cursor-default"
            >
              <span className={cx('block h-1 rounded-full', n <= i ? 'bg-cobalt' : 'bg-tile')} />
              <span className={cx('mt-2 block text-sm font-semibold', n === i ? 'text-ink' : n < i ? 'text-cobalt' : 'text-slate')}>
                <span className="tabular">{n + 1}.</span> {s}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-8">
          <div data-create-step key={step}>
            {step === 'Basics' && <Basics d={d} set={set} hosts={hosts} banner={banner} onBanner={setBanner} />}
            {step === 'Requirement' && <Requirement d={d} set={set} />}
            {step === 'Rules' && <RulesStep d={d} set={set} />}
            {step === 'Stake' && <StakeStep d={d} set={set} />}
            {step === 'Strikes' && <StrikesStep d={d} set={set} />}
            {step === 'Rewards' && <Rewards d={d} set={set} available={ledger.available} onAddMoney={() => setTopUp(true)} />}
            {step === 'Review' && <Review d={d} available={ledger.available} agreed={agreed} onAgree={setAgreed} />}
          </div>
          <div className="sticky bottom-16 z-10 -mx-5 mt-10 flex items-center justify-between gap-3 rounded-b-3xl border-t border-line bg-surface/95 px-5 py-4 backdrop-blur-sm sm:-mx-8 sm:px-8 md:bottom-0">
            <Button variant="ghost" onClick={() => go(i - 1)} disabled={i === 0}>
              Back
            </Button>
            {step === 'Review' ? (
              <Button onClick={publish} disabled={!valid.Review} busy={publishing}>
                {editing ? (publishing ? 'Saving' : 'Save changes') : publishing ? 'Publishing' : 'Publish challenge'}
              </Button>
            ) : (
              <Button onClick={() => go(i + 1)} disabled={!valid[step]}>
                Continue
              </Button>
            )}
          </div>
        </div>
        <Preview d={d} hosts={hosts} />
      </div>
      {topUp && <AddMoneySheet need={Math.max(0, d.pool - ledger.available)} onClose={() => setTopUp(false)} />}
    </div>
  )
}

type SetFn = <K extends keyof Draft>(k: K, v: Draft[K]) => void

function StepHead({ title, intro }: { title: string; intro: string }) {
  return (
    <>
      <h2 className="text-2xl font-bold">{title}</h2>
      <p className="mt-1 text-slate">{intro}</p>
    </>
  )
}

function Choice({ on, onClick, children, className }: { on: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        'rounded-2xl p-4 text-left ring-1 ring-inset transition-[background-color,box-shadow]',
        on ? 'bg-cobalt-soft ring-2 ring-cobalt' : 'bg-surface ring-line hover:ring-slate/40',
        className,
      )}
    >
      {children}
    </button>
  )
}

function Basics({ d, set, hosts, banner, onBanner }: { d: Draft; set: SetFn; hosts: MyOrg[]; banner: { file: File; url: string } | null; onBanner: (b: { file: File; url: string } | null) => void }) {
  const hostOrg = hosts.find((h) => h.slug === d.host)
  const toast = useToast()
  const { session } = useAuth()
  const you = personOf(session)
  function pickBanner(f: File | undefined) {
    if (!f) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return toast({ tone: 'error', title: 'Use a PNG, JPG or WebP image.', inbox: false })
    if (f.size > 8 * 1024 * 1024) return toast({ tone: 'error', title: 'That image is over 8 MB. Try a smaller one.', inbox: false })
    if (banner) URL.revokeObjectURL(banner.url)
    onBanner({ file: f, url: URL.createObjectURL(f) })
  }
  return (
    <div className="space-y-6">
      <StepHead title="The basics" intro="A clear name and a description of what people are signing up for." />
      <fieldset>
        <legend className="text-sm font-semibold">Host as</legend>
        <span className="mt-0.5 block text-sm text-slate">Organization challenges appear on its dashboard and can be limited to its members.</span>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
          <Choice
            on={d.host === 'me'}
            onClick={() => {
              set('host', 'me')
              if (d.privacy === 'org') set('privacy', 'public')
            }}
            className="flex items-center gap-3"
          >
            <Avatar person={you} size={32} />
            <span>
              <span className="block font-semibold">Just me</span>
              <span className="text-sm text-slate">A personal challenge</span>
            </span>
          </Choice>
          {hosts.map((h) => (
            <Choice key={h.slug} on={d.host === h.slug} onClick={() => set('host', h.slug)} className="flex items-center gap-3">
              <Avatar person={h.person} size={32} />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{h.name}</span>
                <span className="text-sm text-slate">
                  {h.role}, {h.members.toLocaleString('en-US')} members
                </span>
              </span>
            </Choice>
          ))}
        </div>
      </fieldset>
      <Field label="Challenge name">
        <input value={d.title} onChange={(e) => set('title', e.target.value)} maxLength={60} placeholder="e.g. 30 Days of Rust" className={inputClass} />
      </Field>
      <Field label="Description" hint="What counts, what doesn’t, and who it’s for. At least 20 characters.">
        <textarea
          value={d.description}
          onChange={(e) => set('description', e.target.value)}
          rows={4}
          placeholder="Ship real Rust code every day for a month. Any public repository counts…"
          className={cx(inputClass, 'resize-y')}
        />
      </Field>
      <Field label="Banner image" hint="Optional. Shown at the top of the challenge. A wide image works best (PNG, JPG or WebP, up to 8 MB).">
        {banner ? (
          <div className="relative overflow-hidden rounded-2xl ring-1 ring-line">
            <img src={banner.url} alt="" className="aspect-[3/1] w-full object-cover" />
            <Button
              size="sm"
              variant="secondary"
              className="absolute top-2 right-2"
              onClick={() => {
                URL.revokeObjectURL(banner.url)
                onBanner(null)
              }}
            >
              Remove
            </Button>
          </div>
        ) : (
          <label className="flex aspect-[3/1] cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-line bg-ground text-[15px] font-semibold text-slate hover:border-slate/40">
            Choose an image
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => {
                pickBanner(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
        )}
      </Field>
      <fieldset>
        <legend className="text-sm font-semibold">Category</legend>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={d.category === c}
              onClick={() => set('category', c)}
              className={cx(
                'h-9 rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition-colors',
                d.category === c ? 'bg-ink text-white ring-ink' : 'bg-surface ring-line hover:ring-slate/40',
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-semibold">Who can join</legend>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
          {(
            [
              ['public', 'Anyone', 'Listed in Explore'],
              ['private', 'Private', 'Only you and people you share the link with'],
              ['org', 'Members only', hostOrg ? `${hostOrg.name} members` : 'Host as an organization first'],
            ] as const
          ).map(([v, t, s]) => (
            <Choice
              key={v}
              on={d.privacy === v}
              onClick={() => v !== 'org' || hostOrg ? set('privacy', v) : undefined}
              className={cx(v === 'org' && !hostOrg && 'cursor-not-allowed opacity-50')}
            >
              <span className="block font-semibold">{t}</span>
              <span className="text-sm text-slate">{s}</span>
            </Choice>
          ))}
        </div>
      </fieldset>
      <Field label="Participant limit" hint="Optional. Leave empty for no limit.">
        <input
          inputMode="numeric"
          value={d.limit}
          onChange={(e) => set('limit', e.target.value.replace(/\D/g, ''))}
          placeholder="No limit"
          className={cx(inputClass, 'max-w-48')}
        />
      </Field>
    </div>
  )
}

function Requirement({ d, set }: { d: Draft; set: SetFn }) {
  const t = templates[d.provider]
  return (
    <div className="space-y-6">
      <StepHead title="What counts, and how it’s checked" intro="Pick the tool that proves progress. Requirements come from templates so they measure real work." />
      <fieldset>
        <legend className="text-sm font-semibold">Verified by</legend>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
          {(Object.keys(templates) as Provider[]).map((p) => (
            <Choice key={p} on={d.provider === p} onClick={() => set('provider', p)} className="flex items-start gap-3">
              <ProviderMark provider={p} size={22} />
              <span>
                <span className="block font-semibold">{p}</span>
                <span className="text-sm text-slate">{templates[p].ideas}</span>
              </span>
            </Choice>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-semibold">Measure</legend>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
          <Choice on={d.mode === 'days'} onClick={() => set('mode', 'days')}>
            <span className="block font-semibold">Active days</span>
            <span className="text-sm text-slate">{t.days} on enough days</span>
          </Choice>
          <Choice on={d.mode === 'count'} onClick={() => set('mode', 'count')}>
            <span className="block font-semibold">A total</span>
            <span className="text-sm text-slate">A number of {t.unit} by the end</span>
          </Choice>
        </div>
      </fieldset>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Length">
          <Select
            label="Length"
            value={String(d.duration)}
            onChange={(v) => {
              const n = Number(v)
              set('duration', n)
              if (d.required > n) set('required', Math.round(n * 0.85))
            }}
            options={[7, 14, 21, 30, 56].map((n) => ({ value: String(n), label: `${n} days` }))}
          />
        </Field>
        <Field label="Starts">
          <DatePicker label="Starts" value={d.start} min={tomorrow()} max={inSixMonths()} onChange={(v) => set('start', v)} />
        </Field>
      </div>
      {d.mode === 'days' ? (
        <Field label={`Days needed: ${d.required} of ${d.duration}`}>
          <input
            type="range"
            min={Math.ceil(d.duration / 2)}
            max={d.duration}
            value={d.required}
            onChange={(e) => set('required', Number(e.target.value))}
            className="w-full accent-[var(--color-cobalt)]"
          />
        </Field>
      ) : (
        <Field label={`Target (${t.unit})`}>
          <input
            inputMode="numeric"
            value={d.target}
            onChange={(e) => set('target', Number(e.target.value.replace(/\D/g, '')) || 0)}
            className={cx(inputClass, 'max-w-48')}
          />
        </Field>
      )}
      <div className="rounded-2xl bg-ground p-4 text-[15px]">
        <span className="text-slate">Requirement: </span>
        <span className="font-semibold">{requirementText(d)}</span>
      </div>
    </div>
  )
}

function StakeStep({ d, set }: { d: Draft; set: SetFn }) {
  return (
    <div className="space-y-6">
      <StepHead title="What’s at stake" intro="Stakes are returned to everyone who finishes. They sit in escrow, never with you or us." />
      <div className="grid gap-2 sm:grid-cols-3">
        {(
          [
            ['none', 'No stake', 'Free to join'],
            ['fixed', 'Fixed', 'Same for everyone'],
            ['range', 'Choose your own', 'Within your limits'],
          ] as const
        ).map(([v, t, s]) => (
          <Choice key={v} on={d.stakeMode === v} onClick={() => set('stakeMode', v)}>
            <span className="block font-semibold">{t}</span>
            <span className="text-sm text-slate">{s}</span>
          </Choice>
        ))}
      </div>
      {d.stakeMode === 'fixed' && (
        <fieldset>
          <legend className="text-sm font-semibold">Stake amount</legend>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {[5, 10, 20, 50].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={d.stake === n}
                onClick={() => set('stake', n)}
                className={cx(
                  'h-12 min-w-20 rounded-xl px-4 font-display text-lg font-semibold tabular ring-1 ring-inset',
                  d.stake === n ? 'bg-ink text-white ring-ink' : 'bg-surface ring-line hover:ring-slate/40',
                )}
              >
                {usd(n)}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {d.stakeMode === 'range' && (
        <div className="grid max-w-md grid-cols-2 gap-4">
          <Field label="Minimum">
            <input inputMode="numeric" value={d.range[0]} onChange={(e) => set('range', [Number(e.target.value.replace(/\D/g, '')) || 0, d.range[1]])} className={inputClass} />
          </Field>
          <Field label="Maximum">
            <input inputMode="numeric" value={d.range[1]} onChange={(e) => set('range', [d.range[0], Number(e.target.value.replace(/\D/g, '')) || 0])} className={inputClass} />
          </Field>
          {d.range[0] >= d.range[1] && <p className="col-span-2 text-sm text-miss">The maximum has to be more than the minimum.</p>}
        </div>
      )}
      <div className="rounded-2xl bg-ground p-4 text-[15px]">
        Participants will need <span className="font-semibold">{verificationLevel(d)}</span> verification. Higher stakes and pools need
        stronger checks to keep things fair.
      </div>
    </div>
  )
}

function StrikesStep({ d, set }: { d: Draft; set: SetFn }) {
  return (
    <div className="space-y-6">
      <StepHead title="Strikes and freezes" intro="Pick one of the approved structures. Free strikes always come before any penalty." />
      <div className="grid gap-2">
        {(Object.keys(presets) as Preset[]).map((k) => {
          const p = presets[k]
          return (
            <Choice key={k} on={d.preset === k} onClick={() => set('preset', k)} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <span>
                <span className="block font-semibold">{p.name}</span>
                <span className="text-sm text-slate">
                  {p.free} free {p.free === 1 ? 'strike' : 'strikes'}, then {p.penalties.join('%, ')}% of the stake. {p.note}.
                </span>
              </span>
              <Strikes total={p.free} used={0} size={18} />
            </Choice>
          )
        })}
      </div>
      {d.stakeMode === 'none' && (
        <p className="text-sm text-slate">
          With no stake, penalties don’t apply. Once the free strikes are used, the next miss takes a participant out of the challenge.
          {d.mode === 'days' && ` They need ${neededDays(d)} of ${d.duration} days.`}
        </p>
      )}
      <div className="flex items-start justify-between gap-6 rounded-2xl bg-ground p-4">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <Snowflake size={17} className="text-cobalt" /> Allow an emergency freeze
          </div>
          <p className="mt-1 text-sm text-slate">One per person. Can’t be used after a day is already missed.</p>
          {d.freeze && (
            <label className="mt-3 flex items-center gap-3 text-sm">
              Up to
              <Select
                look="compact"
                label="Freeze length"
                value={String(d.freezeDays)}
                onChange={(v) => set('freezeDays', Number(v))}
                options={[1, 2, 3, 5, 7].map((n) => ({ value: String(n), label: `${n} ${n === 1 ? 'day' : 'days'}` }))}
              />
            </label>
          )}
        </div>
        <Toggle checked={d.freeze} onChange={(v) => set('freeze', v)} label="Allow an emergency freeze" />
      </div>
    </div>
  )
}

function Rewards({ d, set, available, onAddMoney }: { d: Draft; set: SetFn; available: number; onAddMoney: () => void }) {
  const over = d.pool > available
  return (
    <div className="space-y-6">
      <StepHead title="Rewards" intro="Finishers always get their stake back. Add a sponsor pool to give them something extra." />
      <Field label="Sponsor pool" hint={`Funded from your balance when you publish. You have ${usd(available, { cents: true })}.`}>
        <div className="relative max-w-64">
          <span className="absolute top-1/2 left-4 -translate-y-1/2 font-display text-lg font-semibold text-slate">$</span>
          <input
            inputMode="numeric"
            value={d.pool || ''}
            onChange={(e) => set('pool', Number(e.target.value.replace(/\D/g, '')) || 0)}
            placeholder="0"
            aria-invalid={over}
            className={cx(inputClass, 'pl-8 font-display text-lg font-semibold tabular', over && 'ring-miss')}
          />
        </div>
      </Field>
      {over && (
        <p className="-mt-3 text-sm text-miss">
          That’s more than your balance.{' '}
          <button type="button" onClick={onAddMoney} className="font-semibold underline">
            Add money
          </button>{' '}
          or lower the pool.
        </p>
      )}
      <fieldset>
        <legend className="text-sm font-semibold">How the pool is split</legend>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
          <Choice on={d.split === 'equal'} onClick={() => set('split', 'equal')}>
            <span className="block font-semibold">Equal shares</span>
            <span className="text-sm text-slate">Everyone who finishes gets the same</span>
          </Choice>
          <Choice on={d.split === 'weighted'} onClick={() => set('split', 'weighted')}>
            <span className="block font-semibold">By verified progress</span>
            <span className="text-sm text-slate">More consistent finishers earn more, capped</span>
          </Choice>
        </div>
      </fieldset>
      {d.stakeMode !== 'none' && (
        <div className="flex items-start justify-between gap-6 rounded-2xl bg-ground p-4">
          <div>
            <div className="font-semibold">Share forfeited stakes with finishers</div>
            <p className="mt-1 text-sm text-slate">Only where local rules allow. Otherwise forfeits are returned.</p>
          </div>
          <Toggle checked={d.forfeits} onChange={(v) => set('forfeits', v)} label="Share forfeited stakes with finishers" />
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Rules */

/** Ready-made extra rules, so creators see what a good, checkable rule looks like. */
const RULE_IDEAS: Record<Category, string[]> = {
  Coding: ['Write tests for new code', 'Push a short devlog to the README each week', 'No AI-generated commits'],
  Web3: ['Deploy to devnet before mainnet', 'Share the program address in chat', 'Write one test per instruction'],
  Fitness: ['Show the workout screen with today’s date', 'Stretch for 10 minutes', 'Post your weekly total'],
  Learning: ['Photo of today’s page or lesson screen', 'Write a three-line summary', 'Finish one module each week'],
  Building: ['Photo of today’s progress', 'Share a demo link by the end', 'Post a weekly update'],
  Writing: ['Screenshot of today’s word count', 'Publish one post each week', 'No AI-written text'],
  'Content Creation': ['Link to today’s post', 'Publish one long piece each week', 'Reply to comments'],
  Productivity: ['Photo of today’s finished task list', 'Plan tomorrow before 10 pm', 'Weekly review each Sunday'],
}

/** The verification matrix editor: what's checked automatically, extra rules, and a live preview. */
function RulesStep({ d, set }: { d: Draft; set: SetFn }) {
  const gh = d.gh
  const setGh = (patch: Partial<Draft['gh']>) => set('gh', { ...gh, ...patch })
  const [path, setPath] = useState('')
  const criteria = d.criteria
  const setRule = (i: number, patch: Partial<Criterion>) =>
    set(
      'criteria',
      criteria.map((r, j) => {
        if (j !== i) return r
        const next = { ...r, ...patch }
        // Rules on trust can't be enforced, so they can't decide whether a day counts.
        return next.check === 'self' ? { ...next, required: false } : next
      }),
    )
  const addRule = (text = '') => set('criteria', [...criteria, { text, frequency: d.mode === 'days' ? 'daily' : 'total', check: d.provider === 'Photo' ? 'photo' : 'self', required: d.provider === 'Photo' }])
  const preview = draftMatrix(d)

  return (
    <div className="space-y-8">
      <StepHead
        title="Verification matrix"
        intro="Spell out exactly what’s checked. Participants see this before they stake, and it’s locked for everyone once people join."
      />

      <section className="rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-6">
        <h3 className="flex items-center gap-2 font-sans font-semibold">
          <ProviderMark provider={d.provider} size={18} /> Checked automatically by {d.provider}
        </h3>
        <p className="mt-1 text-sm text-slate">No screenshots needed. {d.provider} is read directly once people link their account.</p>

        {d.provider === 'GitHub' && d.mode === 'days' && (
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Field label="Commits a day" hint="Each one needs real changes">
              <Select label="Commits a day" value={String(gh.minCommits)} onChange={(v) => setGh({ minCommits: Number(v) })} options={[1, 2, 3, 5].map((n) => ({ value: String(n), label: `${n} ${n === 1 ? 'commit' : 'commits'}` }))} />
            </Field>
            <Field label="Changed lines per commit" hint="Lockfiles and formatting don’t count">
              <Select label="Changed lines per commit" value={String(gh.minChangedLines)} onChange={(v) => setGh({ minChangedLines: Number(v) })} options={[1, 5, 20, 50, 100].map((n) => ({ value: String(n), label: `${n}+ lines` }))} />
            </Field>
            <Field label="Languages" hint="Only changes to these files count. Leave empty for any language.">
              <div className="flex flex-wrap gap-1.5">
                {LANGUAGES.map((l) => {
                  const on = gh.languages.includes(l)
                  return (
                    <button
                      key={l}
                      type="button"
                      aria-pressed={on}
                      disabled={!on && gh.languages.length >= 5}
                      onClick={() => setGh({ languages: on ? gh.languages.filter((x) => x !== l) : [...gh.languages, l] })}
                      className={cx('rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset disabled:opacity-40', on ? 'bg-cobalt-soft text-cobalt-deep ring-cobalt' : 'ring-line hover:ring-slate/40')}
                    >
                      {l}
                    </button>
                  )
                })}
              </div>
            </Field>
            <Field label="Files or folders that must change" hint="e.g. src/ or Cargo.toml. Leave empty for anywhere in the repo.">
              <div>
                <div className="flex gap-2">
                  <input
                    value={path}
                    onChange={(e) => setPath(e.target.value.replace(/[^A-Za-z0-9_./-]/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      if (path && !path.includes('..') && gh.paths.length < 5 && !gh.paths.includes(path)) setGh({ paths: [...gh.paths, path] })
                      setPath('')
                    }}
                    placeholder="src/"
                    className={inputClass}
                  />
                  <Button
                    variant="secondary"
                    disabled={!path || path.includes('..') || gh.paths.length >= 5}
                    onClick={() => {
                      if (!gh.paths.includes(path)) setGh({ paths: [...gh.paths, path] })
                      setPath('')
                    }}
                  >
                    Add
                  </Button>
                </div>
                {gh.paths.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {gh.paths.map((p) => (
                      <button key={p} type="button" onClick={() => setGh({ paths: gh.paths.filter((x) => x !== p) })} className="inline-flex items-center gap-1 rounded-full bg-ground px-3 py-1 font-mono text-sm" aria-label={`Remove ${p}`}>
                        {p} <X size={13} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>
            <Field label="Repository" hint="owner/name. Leave empty to count any repository.">
              <input value={gh.repo} onChange={(e) => setGh({ repo: e.target.value.trim() })} placeholder="any repository" className={inputClass} />
            </Field>
            <div className="flex items-start justify-between gap-4 self-end rounded-2xl bg-ground p-4">
              <span>
                <span className="block text-sm font-semibold">A pull request can count for the day</span>
                <span className="text-sm text-slate">Only with the simple one-commit rule</span>
              </span>
              <Toggle checked={gh.countPRs} onChange={(v) => setGh({ countPRs: v })} label="A pull request can count for the day" />
            </div>
          </div>
        )}
        {d.provider === 'WakaTime' && d.mode === 'days' && (
          <div className="mt-5 max-w-xs">
            <Field label="Coding time a day">
              <Select label="Coding time a day" value={String(d.wakaMinutes)} onChange={(v) => set('wakaMinutes', Number(v))} options={[15, 30, 60, 90, 120, 180].map((n) => ({ value: String(n), label: `${n} minutes` }))} />
            </Field>
          </div>
        )}
        {d.provider === 'LeetCode' && d.mode === 'days' && <LeetcodeProblems d={d} set={set} />}
        {d.provider === 'LeetCode' && d.lcSource === 'any' && (
          <div className="mt-5 max-w-xs">
            <Field label="Hardest allowed to skip">
              <Select
                label="Minimum difficulty"
                value={d.lcMin}
                onChange={(v) => set('lcMin', v as Draft['lcMin'])}
                options={(['Easy', 'Medium', 'Hard'] as const).map((l) => ({ value: l, label: l === 'Easy' ? 'Any difficulty' : `${l} or harder` }))}
              />
            </Field>
          </div>
        )}
        {d.provider === 'Camera' && (
          <div className="mt-5 grid max-w-md gap-5 sm:grid-cols-2">
            <Field label="Exercise">
              <Select label="Exercise" value={d.camera.exercise} onChange={(v) => set('camera', { ...d.camera, exercise: v as Draft['camera']['exercise'] })} options={[{ value: 'pushups', label: 'Push-ups' }, { value: 'situps', label: 'Sit-ups' }, { value: 'squats', label: 'Squats' }]} />
            </Field>
            {d.mode === 'days' && (
              <Field label="Reps a day">
                <Select label="Reps a day" value={String(d.camera.reps)} onChange={(v) => set('camera', { ...d.camera, reps: Number(v) })} options={[20, 50, 100, 150, 200].map((n) => ({ value: String(n), label: `${n} reps` }))} />
              </Field>
            )}
          </div>
        )}
        {d.provider === 'Photo' && (
          <div className="mt-5">
            <Field label="What the daily photo must show" hint="Reviewers approve each photo against this. Be specific.">
              <input maxLength={300} value={d.photoInstructions} onChange={(e) => set('photoInstructions', e.target.value)} placeholder="e.g. The book open at today’s page, with today’s date written on a note" className={inputClass} />
            </Field>
          </div>
        )}
      </section>

      <section className="rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-sans font-semibold">Extra rules</h3>
            <p className="mt-1 text-sm text-slate">Anything else you expect. Rules checked by photo can be required; rules on trust are guidance only.</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => addRule()} disabled={criteria.length >= 10}>
            <Plus size={15} /> Add a rule
          </Button>
        </div>

        {criteria.length > 0 && (
          <ul className="mt-4 space-y-3">
            {criteria.map((r, i) => (
              <li key={i} className="rounded-2xl bg-ground p-4">
                <div className="flex items-start gap-2">
                  <input
                    value={r.text}
                    maxLength={200}
                    onChange={(e) => setRule(i, { text: e.target.value })}
                    placeholder="e.g. Read at least 20 pages"
                    aria-label={`Rule ${i + 1}`}
                    aria-invalid={r.text.trim().length > 0 && r.text.trim().length < 5}
                    className={inputClass}
                  />
                  <button type="button" onClick={() => set('criteria', criteria.filter((_, j) => j !== i))} aria-label={`Remove rule ${i + 1}`} className="mt-2 rounded-full p-1.5 text-slate hover:bg-surface hover:text-miss">
                    <Trash2 size={17} />
                  </button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Select
                    label="How often"
                    value={r.frequency}
                    onChange={(v) => setRule(i, { frequency: v as Criterion['frequency'] })}
                    options={[
                      { value: 'daily', label: 'Every day' },
                      { value: 'weekly', label: 'Each week' },
                      { value: 'total', label: 'By the end' },
                    ]}
                  />
                  <Select
                    label="How it’s checked"
                    value={r.check}
                    onChange={(v) => setRule(i, { check: v as Criterion['check'], required: v === 'photo' })}
                    options={[
                      { value: 'photo', label: 'Shown in the daily photo', hint: 'A reviewer approves it' },
                      { value: 'self', label: 'On trust', hint: 'Guidance; never fails a day' },
                    ]}
                  />
                  <label className={cx('flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2 ring-1 ring-line', r.check === 'self' && 'opacity-50')}>
                    <span className="text-sm font-semibold">Required</span>
                    <Toggle checked={r.required} onChange={(v) => setRule(i, { required: v })} label={`Rule ${i + 1} required`} disabled={r.check === 'self'} />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}

        {criteria.some((r) => r.check === 'photo') && d.provider !== 'Photo' && (
          <p className="mt-3 rounded-2xl bg-cobalt-soft p-3 text-sm text-cobalt-deep">
            Photo-checked rules add a daily photo to {d.provider}. A day then needs both: {d.provider} and an approved photo.
          </p>
        )}

        <div className="mt-4">
          <p className="text-sm font-semibold text-slate">Ideas for {d.category.toLowerCase()}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {RULE_IDEAS[d.category].map((idea) => (
              <button key={idea} type="button" disabled={criteria.length >= 10 || criteria.some((r) => r.text === idea)} onClick={() => addRule(idea)} className="rounded-full px-3 py-1 text-sm ring-1 ring-line ring-inset hover:ring-slate/40 disabled:opacity-40">
                + {idea}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h3 className="flex items-center gap-2 font-sans font-semibold">
          <Eye size={17} /> What participants will see
        </h3>
        <div className="mt-3 space-y-3">
          <RulesMatrix rows={matrixRows(preview)} />
          <AtStake o={outcomes({ ...preview, freeStrikes: presets[d.preset].free, penalties: [...presets[d.preset].penalties], staked: d.stakeMode !== 'none' })} />
        </div>
      </section>
    </div>
  )
}

/** A problem list as typed: one line per day; links or slugs separated by commas or spaces. */
function parseProblemList(text: string) {
  const bad: string[] = []
  const days = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((t) => {
          const m = /leetcode\.com\/problems\/([a-z0-9-]+)/i.exec(t)
          const slug = (m ? m[1] : t).toLowerCase()
          if (!/^[a-z0-9-]{1,100}$/.test(slug)) bad.push(t)
          return slug
        }),
    )
  const tooMany = days.findIndex((dd) => dd.length > 5)
  return { days, bad, tooMany, ok: (duration: number) => days.length === duration && !bad.length && tooMany === -1 }
}

/** Where the day's LeetCode problems come from, and the creator's own list. */
function LeetcodeProblems({ d, set }: { d: Draft; set: SetFn }) {
  const parsed = parseProblemList(d.lcList)
  return (
    <div className="mt-5 space-y-4">
      <fieldset>
        <legend className="text-sm font-semibold">Which problems count</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {(
            [
              ['any', 'Any new problem', 'Whatever they choose, as long as it’s new to them'],
              ['daily', 'LeetCode’s daily question', 'Everyone solves the official daily problem'],
              ['list', 'Your problem list', 'You set one or more problems for each day'],
            ] as const
          ).map(([k, t, s]) => (
            <Choice key={k} on={d.lcSource === k} onClick={() => set('lcSource', k)}>
              <span className="block font-semibold">{t}</span>
              <span className="text-sm text-slate">{s}</span>
            </Choice>
          ))}
        </div>
      </fieldset>
      {d.lcSource !== 'any' && <p className="rounded-2xl bg-cobalt-soft p-3 text-sm text-cobalt-deep">Everyone gets the day’s problems each morning, in the app and by email. A day counts once each one has an accepted submission that day.</p>}
      {d.lcSource === 'list' && (
        <Field label={`Problems for each day (${parsed.days.length} of ${d.duration} days)`} hint="One line per day. Paste LeetCode links or problem names; put several on a line, separated by commas, for more than one a day.">
          <textarea
            rows={8}
            value={d.lcList}
            onChange={(e) => set('lcList', e.target.value)}
            placeholder={'https://leetcode.com/problems/two-sum/\nadd-two-numbers, valid-parentheses\nmerge-two-sorted-lists'}
            aria-invalid={parsed.bad.length > 0 || parsed.tooMany >= 0}
            className={cx(inputClass, 'resize-y font-mono text-sm')}
          />
          {parsed.bad.length > 0 && <p className="mt-1.5 text-sm text-miss">These aren’t LeetCode problems: {parsed.bad.slice(0, 3).join(', ')}</p>}
          {parsed.tooMany >= 0 && <p className="mt-1.5 text-sm text-miss">Day {parsed.tooMany + 1} has more than 5 problems.</p>}
          {!parsed.bad.length && parsed.days.length !== d.duration && d.lcList.trim() && (
            <p className="mt-1.5 text-sm text-gold-ink">{parsed.days.length < d.duration ? `Add ${d.duration - parsed.days.length} more ${d.duration - parsed.days.length === 1 ? 'day' : 'days'}.` : `That’s ${parsed.days.length - d.duration} more than the ${d.duration} days.`}</p>
          )}
        </Field>
      )}
    </div>
  )
}

/** The draft as the matrix sees it, the same way participants will. */
function draftMatrix(d: Draft): MatrixInput {
  const photoRules = d.criteria.some((r) => r.check === 'photo') && d.provider !== 'Photo'
  return {
    providers: photoRules ? [d.provider, 'Photo'] : [d.provider],
    mode: d.mode,
    durationDays: d.duration,
    requiredDays: neededDays(d),
    targetCount: d.target,
    countUnit: templates[d.provider].unit,
    // The headline is built from these rows (requirementText), so it isn't an input here.
    requirement: '',
    verification: verificationConfig(d),
  }
}

/** Verification settings for the API, from the draft. Only the chosen method's settings are sent. */
function verificationConfig(d: Draft): VerificationSettings {
  const criteria = d.criteria.filter((r) => r.text.trim().length >= 5).map((r) => ({ ...r, text: r.text.trim() }))
  const v: VerificationSettings = {}
  if (d.provider === 'GitHub') {
    v.github = {
      minCommits: d.gh.minCommits,
      minChangedLines: d.gh.minChangedLines,
      countPullRequests: d.gh.countPRs,
      ...(d.gh.languages.length ? { languages: d.gh.languages } : {}),
      ...(d.gh.paths.length ? { paths: d.gh.paths } : {}),
      ...(/^[\w.-]+\/[\w.-]+$/.test(d.gh.repo) ? { repo: d.gh.repo } : {}),
    }
  }
  if (d.provider === 'WakaTime') v.wakatime = { minMinutes: d.wakaMinutes }
  if (d.provider === 'LeetCode') {
    v.leetcode = { newOnly: true, ...(d.lcMin !== 'Easy' && d.lcSource === 'any' ? { minDifficulty: d.lcMin } : {}) }
    if (d.mode === 'days' && d.lcSource === 'daily') v.leetcode.assigned = 'daily'
    if (d.mode === 'days' && d.lcSource === 'list') Object.assign(v.leetcode, { assigned: 'list', schedule: parseProblemList(d.lcList).days })
  }
  if (d.provider === 'Camera') v.camera = d.camera
  if (d.provider === 'Photo' || criteria.some((r) => r.check === 'photo')) v.photo = { instructions: d.photoInstructions.trim() || 'Show today’s progress clearly' }
  if (criteria.length) v.criteria = criteria
  return v
}

function rulesList(d: Draft): [string, string][] {
  const p = presets[d.preset]
  return [
    ['Requirement', requirementText(d)],
    ['Starts', new Date(d.start).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })],
    ['Stake', d.stakeMode === 'none' ? 'No stake' : d.stakeMode === 'fixed' ? usd(d.stake) : `${usd(d.range[0])}–${usd(d.range[1])}`],
    ['Strikes', d.stakeMode === 'none' ? `${p.name}: ${p.free} free, then the next miss is out` : `${p.name}: ${p.free} free, then ${p.penalties.join('%, ')}%`],
    ['Freeze', d.freeze ? `Up to ${d.freezeDays} days, once` : 'Not allowed'],
    ['Sponsor pool', d.pool ? `${usd(d.pool)}, ${d.split === 'equal' ? 'equal shares' : 'by progress'}` : 'None'],
    ['Verification', `${d.provider}, ${verificationLevel(d)} level`],
    ['Who can join', d.privacy === 'public' ? 'Anyone' : d.privacy === 'private' ? 'Private: only people with your link or code' : 'Organization members only'],
    ['Fees', feesText(d.stakeMode !== 'none')],
  ]
}

function Review({ d, available, agreed, onAgree }: { d: Draft; available: number; agreed: boolean; onAgree: (v: boolean) => void }) {
  return (
    <div className="space-y-6">
      <StepHead title="Review and publish" intro="Once people join, these rules are locked for everyone, you included." />
      <div>
        <h3 className="font-sans text-sm font-semibold">What’s checked</h3>
        <div className="mt-2">
          <RulesMatrix rows={matrixRows(draftMatrix(d))} compact />
        </div>
      </div>
      <dl className="divide-y divide-line border-y border-line">
        {rulesList(d).map(([k, v]) => (
          <div key={k} className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr]">
            <dt className="text-[15px] text-slate">{k}</dt>
            <dd className="text-[15px] font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {d.pool > 0 && (
        <div className="rounded-2xl bg-ground p-4 text-[15px]">
          Publishing moves <span className="font-semibold">{usd(d.pool)}</span> from your balance into this challenge’s escrow.
          Balance after: <span className="font-semibold tabular">{usd(available - d.pool, { cents: true })}</span>.
        </div>
      )}
      <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-surface p-4 text-[15px] ring-1 ring-line">
        <input type="checkbox" checked={agreed} onChange={(e) => onAgree(e.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--color-cobalt)]" />
        <span>
          I agree to these challenge rules and the{' '}
          <a href="/terms" target="_blank" rel="noreferrer" className="font-semibold text-cobalt hover:underline">
            Terms of Service
          </a>
          . I understand the rules can’t be changed once people join.
        </span>
      </label>
      {!agreed && <p className="-mt-3 text-sm text-slate">Tick the box to publish.</p>}
    </div>
  )
}

function Preview({ d, hosts }: { d: Draft; hosts: MyOrg[] }) {
  const me = personOf(useAuth().session)
  const host = hosts.find((h) => h.slug === d.host)
  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <div className="text-sm font-semibold text-slate">Preview</div>
      <div className="mt-3 rounded-3xl bg-surface p-5 ring-1 ring-line/70">
        <div className="flex items-center justify-between gap-2 text-sm text-slate">
          <span className="inline-flex items-center gap-1.5">
            <ProviderMark provider={d.provider} size={14} /> {d.category}
          </span>
          {d.privacy !== 'public' && (
            <Tag>
              <Lock size={12} /> {d.privacy === 'org' ? 'Members' : 'Invite only'}
            </Tag>
          )}
        </div>
        <h3 className={cx('mt-2 text-xl font-semibold', !d.title && 'text-slate/50')}>{d.title || 'Your challenge name'}</h3>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-slate">
          <Avatar person={host?.person ?? me} size={18} /> by {host?.name ?? 'you'}
        </p>
        <p className="mt-2 text-[15px] font-medium">{requirementText(d)}</p>
        {d.description.trim() && <p className="mt-1 line-clamp-3 text-sm text-slate">{d.description.trim()}</p>}
        <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
          {matrixRows(draftMatrix(d))
            .slice(0, 4)
            .map((r) => (
              <li key={r.key} className="flex items-start gap-2">
                <Check size={14} strokeWidth={3} className={cx('mt-0.5 shrink-0', r.required ? 'text-cobalt' : 'text-slate/50')} />
                <span className={cx(!r.required && 'text-slate')}>
                  {r.rule}
                  {!r.required && ' (optional)'}
                </span>
              </li>
            ))}
        </ul>
        <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4 text-sm">
          <div>
            <dt className="text-slate">Stake</dt>
            <dd className="font-display text-base font-semibold tabular">
              {d.stakeMode === 'none' ? 'None' : d.stakeMode === 'fixed' ? usd(d.stake) : `${usd(d.range[0])}+`}
            </dd>
          </div>
          <div>
            <dt className="text-slate">Pool</dt>
            <dd className="font-display text-base font-semibold text-gold-ink tabular">{d.pool ? usd(d.pool) : '–'}</dd>
          </div>
          <div>
            <dt className="text-slate">Length</dt>
            <dd className="font-display text-base font-semibold tabular">{d.duration}d</dd>
          </div>
        </dl>
        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <span className="text-sm text-slate">Free strikes</span>
          <Strikes total={presets[d.preset].free} used={0} size={16} />
        </div>
      </div>
      <p className="mt-3 text-sm text-slate">This is how it appears in Explore and on invites.</p>
    </aside>
  )
}

function Published({ d, root, created }: { d: Draft; root: RefObject<HTMLDivElement | null>; created: { id: string; inviteCode?: string } | null }) {
  const [copied, setCopied] = useState(false)
  const code = created ? (created.inviteCode ?? '') : (d.title.replace(/[^a-z]/gi, '').slice(0, 4) || 'JOIN').toUpperCase() + '-' + String(d.duration).padStart(2, '0')
  const link = created
    ? `${window.location.origin}/${d.privacy === 'public' ? `c/${created.id}` : `i/${created.inviteCode}`}`
    : `${window.location.origin}/c/${d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'new-challenge'}`

  useGSAP(
    () => {
      if (!prefersMotion()) return
      gsap.from('[data-pub-mark]', { scale: 0, rotate: -40, duration: 0.6, ease: 'back.out(2.4)' })
      gsap.from('[data-pub] > *', { y: 14, autoAlpha: 0, stagger: 0.08, duration: 0.45, delay: 0.2, ease: 'power3.out' })
    },
    { scope: root },
  )

  return (
    <div ref={root} className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
      <span data-pub-mark className="mx-auto grid size-16 place-items-center rounded-full bg-calm text-white">
        <Check size={30} strokeWidth={3} />
      </span>
      <div data-pub>
        <h1 className="mt-6 text-4xl font-bold">{d.title} is live</h1>
        <p className="mt-3 text-lg text-slate">
          {d.privacy === 'public' ? 'It’s listed in Explore now.' : 'Share the link or code with the people you want in.'}
          {d.pool > 0 && !created && ` ${usd(d.pool)} is in escrow for the sponsor pool.`}
        </p>
        {created && d.pool > 0 && <FundPool id={created.id} amount={d.pool} />}
        <div className="mt-8 space-y-2 text-left">
          <div className="flex items-center gap-2 rounded-2xl bg-surface p-2 pl-4 ring-1 ring-line">
            <span className="min-w-0 flex-1 truncate text-[15px]">{link}</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(link)
                setCopied(true)
              }}
            >
              <Copy size={15} /> {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
          {d.privacy !== 'public' && code && (
            <div className="flex items-center justify-between rounded-2xl bg-surface p-4 ring-1 ring-line">
              <span className="text-[15px] text-slate">Invite code</span>
              <span className="font-display text-xl font-bold tracking-wider">{code}</span>
            </div>
          )}
        </div>
        <div className="mt-8 flex justify-center gap-2">
          <Button to="/overview" variant="secondary">
            Back to overview
          </Button>
          <Button to={created ? `/c/${created.id}` : '/explore'}>
            <Users size={17} /> {created ? 'Open the challenge' : 'See it in Explore'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * A pledged sponsor pool is paid from the host's wallet into the challenge's escrow. The escrow is
 * created on Solana a moment after publishing, so this waits for that, then the wallet signs.
 */
function FundPool({ id, amount }: { id: string; amount: number }) {
  const toast = useToast()
  const [done, setDone] = useState(false)
  async function fund(sign: SignBytes) {
    try {
      const r = await api<{ status: 'needs_signature'; contributionId: string; transaction: string }>(`/payments/sponsor/${encodeURIComponent(id)}`, { method: 'POST', body: { amount } })
      const signature = await signAndSubmit(r.transaction, sign)
      await api(`/payments/sponsorships/${r.contributionId}/confirm`, { method: 'POST', body: { signature } })
      setDone(true)
      toast({ title: 'Sponsor pool funded', body: `${usd(amount)} is in escrow for the people who finish.` })
    } catch (err) {
      const declined = /reject|declin|cancel/i.test(String(err))
      toast({
        tone: 'error',
        title: declined ? 'Funding cancelled' : 'Pool not funded yet',
        body: err instanceof ApiError ? err.message : declined ? 'Nothing was taken.' : 'Try again in a minute: the challenge may still be setting up.',
        inbox: false,
      })
    }
  }
  if (done) return <p className="mt-6 rounded-2xl bg-calm-soft p-4 text-[15px] font-semibold text-calm">{usd(amount)} sponsor pool funded.</p>
  return (
    <div className="mt-6 rounded-2xl bg-gold-soft p-4 text-left">
      <p className="font-semibold text-gold-ink">One more step: fund the {usd(amount)} sponsor pool</p>
      <p className="mt-1 text-sm text-gold-ink">It goes from your wallet into the challenge’s escrow, for everyone who finishes. Setting up the escrow takes about a minute after publishing.</p>
      <div className="mt-3">
        <Suspense fallback={<Button className="w-full" busy>Fund {usd(amount)}</Button>}>
          <SignButton label={`Fund ${usd(amount)}`} onSign={fund} />
        </Suspense>
      </div>
    </div>
  )
}
