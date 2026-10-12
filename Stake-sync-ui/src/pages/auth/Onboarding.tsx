import { Check, ChevronLeft, Sparkles, Wallet } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useAuth, type WalletPath } from '../../auth/context'
import { AddMoney } from '../../components/AddMoney'
import { ConnectProviderSheet } from '../../components/ConnectProvider'
import { Button, Field, ProviderMark } from '../../components/ui'
import { categories } from '../../data/categories'
import type { Category, Provider } from '../../data/types'
import { cx } from '../../lib/format'
import { gsap, prefersMotion, useGSAP } from '../../lib/gsap'
import { takeNext } from '../../lib/next'
import { ApiError } from '../../lib/api'
import { embeddedWalletsEnabled, onrampEnabled } from '../../lib/payments'
import { inputClass } from '../../lib/styles'
import { useToast } from '../../toast/context'

type Step = 'profile' | 'experience' | 'money' | 'interests' | 'accounts'
const order: Step[] = ['profile', 'experience', 'money', 'interests', 'accounts']

export function Onboarding() {
  const { session, live, completeOnboarding, updateProfile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [step, setStep] = useState<Step>('profile')
  const [name, setName] = useState(session?.name ?? '')
  const [username, setUsername] = useState(session?.username ?? (session?.email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9_]/g, ''))
  const [bio, setBio] = useState(session?.bio ?? '')
  const [path, setPath] = useState<WalletPath | null>(null)
  const [interests, setInterests] = useState<Category[]>([])
  const [linked, setLinked] = useState<string[]>(session?.connected ?? [])
  const [funded, setFunded] = useState(false)
  const [connecting, setConnecting] = useState<Provider | null>(null)
  const [saving, setSaving] = useState(false)
  const [profileError, setProfileError] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const dir = useRef(1)
  const index = order.indexOf(step)

  useGSAP(
    () => {
      gsap.to('[data-progress]', { scaleX: (index + 1) / order.length, duration: prefersMotion() ? 0.5 : 0, ease: 'power3.out' })
      if (!prefersMotion()) return
      gsap.from('[data-step] > *', {
        x: 28 * dir.current,
        autoAlpha: 0,
        duration: 0.45,
        stagger: 0.05,
        ease: 'power3.out',
        clearProps: 'transform,opacity,visibility',
      })
    },
    { scope: root, dependencies: [step] },
  )

  function go(next: Step) {
    dir.current = order.indexOf(next) > index ? 1 : -1
    setStep(next)
  }

  function finish() {
    completeOnboarding(path ?? 'local')
    navigate(takeNext() ?? '/overview', { replace: true })
  }

  const first = name.trim().split(' ')[0]
  const usernameOk = /^[a-z0-9_]{3,20}$/.test(username)

  // Every step's primary action lives in the same pinned footer, so it never moves.
  const primary: { label: string; disabled?: boolean; form?: string } = {
    profile: { label: saving ? 'Saving' : 'Continue', disabled: !name.trim() || !usernameOk, form: 'profile-form' },
    experience: { label: 'Continue', disabled: !path },
    money: { label: funded ? 'Continue' : 'Skip for now' },
    interests: { label: interests.length ? 'Continue' : 'Skip for now' },
    accounts: { label: 'Go to my dashboard' },
  }[step]

  function onPrimary() {
    if (step === 'experience') go('money')
    else if (step === 'money') go('interests')
    else if (step === 'interests') go('accounts')
    else if (step === 'accounts') finish()
  }

  return (
    <div ref={root} className="flex min-h-[calc(100dvh-5.75rem)] flex-col">
      <div className="mb-8 flex items-center gap-3">
        {index > 0 ? (
          <button
            type="button"
            onClick={() => go(order[index - 1])}
            aria-label="Back"
            className="-ml-2 grid size-9 place-items-center rounded-full text-slate hover:bg-ink/5 hover:text-ink"
          >
            <ChevronLeft size={20} />
          </button>
        ) : null}
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-tile" role="progressbar" aria-valuemin={1} aria-valuemax={order.length} aria-valuenow={index + 1} aria-label={`Step ${index + 1} of ${order.length}`}>
          <span data-progress className="block h-full origin-left scale-x-0 rounded-full bg-cobalt" />
        </div>
        <span className="text-sm text-slate tabular">
          {index + 1} of {order.length}
        </span>
      </div>

      <div data-step key={step}>
        {step === 'profile' && (
          <form
            id="profile-form"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!name.trim() || !usernameOk || saving) return
              setSaving(true)
              setProfileError(false)
              try {
                await updateProfile({ name: name.trim(), username, bio: bio.trim() || undefined })
                go('experience')
              } catch (err) {
                setProfileError(true)
                toast({ tone: 'error', title: err instanceof ApiError ? err.message : 'We couldn’t save that. Please try again.', inbox: false })
              } finally {
                setSaving(false)
              }
            }}
          >
            <h1 className="text-4xl font-bold">What should we call you?</h1>
            <p className="mt-3 text-slate">This is how you’ll appear on leaderboards and in challenge chats.</p>
            <div className="mt-8 space-y-4">
              <Field label="Your name">
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={inputClass} />
              </Field>
              <Field label="Username" hint="3 to 20 letters, numbers or underscores">
                <div className="relative">
                  <span className="absolute top-1/2 left-4 -translate-y-1/2 text-slate">@</span>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    autoComplete="username"
                    aria-invalid={!usernameOk || profileError}
                    className={cx(inputClass, 'pl-9', profileError && 'ring-miss')}
                  />
                </div>
              </Field>
              <Field label="Short bio" hint="Optional. You can change it later.">
                <textarea
                  rows={2}
                  maxLength={160}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="What you’re working on, in a line"
                  className={cx(inputClass, 'resize-none')}
                />
              </Field>
            </div>
          </form>
        )}

        {step === 'experience' && (
          <>
            <h1 className="text-4xl font-bold">Hi {first}. Have you used a crypto wallet before?</h1>
            <p className="mt-3 text-slate">
              Stakes are paid in USDC, a digital dollar. We’ll set you up either way.
            </p>
            <div className="mt-8 space-y-3">
              <Choice
                icon={<Wallet size={22} />}
                title="Yes, I have a Solana wallet"
                body="Connect Phantom, Solflare or Backpack and top up from it."
                selected={path === 'connect'}
                onClick={() => setPath('connect')}
              />
              <Choice
                icon={<Sparkles size={22} />}
                title="No, I’m new to this"
                body={
                  live && !embeddedWalletsEnabled
                    ? `${onrampEnabled ? 'Add money in naira or your local currency.' : 'Paying in naira is coming soon.'} You’ll connect a free wallet app to hold your USDC.`
                    : `We’ll create a wallet for you. ${onrampEnabled ? 'Add money in naira or your local currency and it’s converted to USDC.' : 'Paying in naira is coming soon; until then, receive USDC from a friend or exchange.'}`
                }
                selected={path === 'local'}
                onClick={() => setPath('local')}
              />
            </div>
          </>
        )}

        {step === 'money' && path && (
          <>
            <h1 className="text-4xl font-bold">{path === 'connect' ? 'Connect your wallet' : 'Add money to your account'}</h1>
            {path === 'local' && (!live || !!session?.wallets?.length) && (
              <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-calm">
                <Check size={16} strokeWidth={3} /> {live ? 'Your wallet is linked.' : 'Your Stake-Sync wallet is ready.'} Only you can move what’s in it.
              </p>
            )}
            <div className="mt-6">
              <AddMoney path={path} onSuccess={() => setFunded(true)} />
            </div>
          </>
        )}

        {step === 'interests' && (
          <>
            <h1 className="text-4xl font-bold">What do you want to get better at?</h1>
            <p className="mt-3 text-slate">Pick a few. We’ll recommend challenges that fit.</p>
            <div className="mt-8 flex flex-wrap gap-2">
              {categories.map((c) => {
                const on = interests.includes(c)
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setInterests((v) => (on ? v.filter((x) => x !== c) : [...v, c]))}
                    className={cx(
                      'inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold ring-1 ring-inset transition-colors',
                      on ? 'bg-ink text-white ring-ink' : 'bg-surface ring-line hover:ring-slate/40',
                    )}
                  >
                    {on && <Check size={15} strokeWidth={3} />}
                    {c}
                  </button>
                )
              })}
            </div>
          </>
        )}

        {step === 'accounts' && (
          <>
            <h1 className="text-4xl font-bold">Connect the tools that prove your progress</h1>
            <p className="mt-3 text-slate">
              Challenges check these automatically. Each account can only be linked to one Stake-Sync profile.
            </p>
            <ul className="mt-8 space-y-2">
              {(
                [
                  ['GitHub', 'Commits, pull requests and releases'],
                  ['LeetCode', 'Accepted submissions'],
                  ['Codeforces', 'Accepted solutions and problem ratings'],
                  ['WakaTime', 'Minutes of coding a day'],
                ] as const
              ).map(([p, what]) => {
                const on = linked.includes(p)
                return (
                  <li key={p} className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 ring-1 ring-line">
                    <ProviderMark provider={p} size={22} />
                    <div className="flex-1">
                      <div className="font-semibold">{p}</div>
                      <div className="text-sm text-slate">{what}</div>
                    </div>
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
            {path === 'connect' && (
              <p className="mt-4 text-sm text-slate">Your Solana wallet is already linked for on-chain challenges.</p>
            )}
          </>
        )}
      </div>

      <div className="sticky bottom-0 -mx-4 mt-auto bg-ground/95 px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
        <Button
          type={primary.form ? 'submit' : 'button'}
          form={primary.form}
          className="w-full"
          size="lg"
          disabled={primary.disabled}
          busy={step === 'profile' && saving}
          onClick={primary.form ? undefined : onPrimary}
        >
          {primary.label}
        </Button>
      </div>
    </div>
  )
}

function Choice({ icon, title, body, selected, onClick }: { icon: ReactNode; title: string; body: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        'flex w-full items-start gap-4 rounded-2xl p-5 text-left ring-1 ring-inset transition-[background-color,box-shadow]',
        selected ? 'bg-cobalt-soft ring-2 ring-cobalt' : 'bg-surface ring-line hover:ring-slate/40',
      )}
    >
      <span className={cx('grid size-11 shrink-0 place-items-center rounded-xl', selected ? 'bg-cobalt text-white' : 'bg-ground text-ink')}>
        {icon}
      </span>
      <span>
        <span className="block text-lg font-semibold">{title}</span>
        <span className="mt-0.5 block text-[15px] text-slate">{body}</span>
      </span>
    </button>
  )
}
