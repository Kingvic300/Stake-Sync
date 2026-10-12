import { ArrowLeft, Check, Eye, EyeOff, Mail } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth, type AuthResult } from '../../auth/context'
import { Bone } from '../../components/Skeleton'
import { Button, Field, ProviderMark } from '../../components/ui'
import { api, ApiError } from '../../lib/api'
import { cx } from '../../lib/format'
import { takeNext } from '../../lib/next'
import { startOAuth } from '../../lib/oauth'
import { inputClass } from '../../lib/styles'
import { useToast } from '../../toast/context'

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

const TERMS_NEEDED = 'Tick the box to agree to the Terms and Privacy Policy first.'

const say = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

/** Where a signed-in person goes next: onboarding first, then where they were headed. */
function landing(onboarded: boolean, wanted?: string | null) {
  if (!onboarded) return '/start'
  return wanted && wanted !== '/' ? wanted : '/overview'
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  )
}

/** Google and GitHub share one row; the visible text stays short so it fits on phones. */
function SocialRow({ verb, onPick, pending }: { verb: 'Log in' | 'Sign up'; onPick?: (provider: 'google' | 'github') => void; pending?: 'google' | 'github' | null }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Button variant="secondary" aria-label={`${verb} with Google`} busy={pending === 'google'} onClick={() => onPick?.('google')}>
        <GoogleMark />
        Google
      </Button>
      <Button variant="secondary" aria-label={`${verb} with GitHub`} busy={pending === 'github'} onClick={() => onPick?.('github')}>
        <ProviderMark provider="GitHub" size={18} />
        GitHub
      </Button>
    </div>
  )
}

function Divider() {
  return (
    <div className="my-6 flex items-center gap-3 text-sm text-slate">
      <span className="h-px flex-1 bg-line" />
      or with email
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

function Password({ value, onChange, error, autoComplete }: { value: string; onChange: (v: string) => void; error?: string; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-invalid={!!error}
        className={cx(inputClass, 'pr-12', error && 'ring-miss')}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-slate hover:text-ink"
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}

/**
 * Problems show as a toast; the field at fault also gets a red outline so it's easy to find.
 * `fail(message)` for a single sentence, `fail(message, title)` when a short title helps.
 */
function useFail() {
  const toast = useToast()
  return useCallback((message: string, title?: string) => toast({ tone: 'error', title: title ?? message, body: title ? message : undefined, inbox: false }), [toast])
}

function Checkbox({ checked, onChange, children, invalid }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; invalid?: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 text-[15px]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className={cx(
          'grid size-5 shrink-0 place-items-center rounded-md ring-1 ring-inset transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-cobalt',
          checked ? 'bg-cobalt text-white ring-cobalt' : cx('bg-surface', invalid ? 'ring-miss' : 'ring-line'),
        )}
      >
        {checked && <Check size={13} strokeWidth={3.5} />}
      </span>
      {children}
    </label>
  )
}

/**
 * Shared frame for log in and sign up. Both forms have the same rows in the same order
 * (social, email, password, one option row, submit, switch link) so the two screens match in length.
 */
function AuthFrame({
  title,
  intro,
  verb,
  onSubmit,
  email,
  password,
  options,
  submit,
  footer,
  onSocial,
  socialPending,
  busy,
}: {
  onSocial?: (provider: 'google' | 'github') => void
  socialPending?: 'google' | 'github' | null
  busy?: boolean
  title: string
  intro: string
  verb: 'Log in' | 'Sign up'
  onSubmit: (e: FormEvent) => void
  email: ReactNode
  password: ReactNode
  options: ReactNode
  submit: string
  footer: ReactNode
}) {
  return (
    <>
      <h1 className="text-4xl font-bold">{title}</h1>
      <p className="mt-2 text-slate">{intro}</p>
      <div className="mt-8">
        <SocialRow verb={verb} onPick={onSocial} pending={socialPending} />
      </div>
      <Divider />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {email}
        {password}
        <div className="flex min-h-6 items-center justify-between gap-4">{options}</div>
        <Button type="submit" className="w-full" busy={busy}>
          {submit}
        </Button>
      </form>
      <p className="mt-8 text-center text-[15px] text-slate">{footer}</p>
    </>
  )
}

export function Login() {
  const { applyAuth } = useAuth()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const fail = useFail()
  const [busy, setBusy] = useState(false)
  const [social, setSocial] = useState<'google' | 'github' | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const next = {
      email: emailOk(email) ? undefined : 'Enter the email you signed up with.',
      password: password ? undefined : 'Enter your password.',
    }
    setErrors(next)
    if (next.email || next.password) return fail((next.email ?? next.password)!)
    setBusy(true)
    try {
      const r = await api<AuthResult>('/auth/login', { method: 'POST', body: { email, password }, token: '' })
      applyAuth(r, { remember })
      navigate(landing(r.user.onboarded, from ?? takeNext()), { replace: true })
    } catch (err) {
      fail(say(err, 'Please try again.'), 'Couldn’t log you in')
      setBusy(false)
    }
  }

  async function pick(provider: 'google' | 'github') {
    setSocial(provider)
    try {
      await startOAuth(provider, 'login', { redirect: from ?? takeNext() ?? undefined })
    } catch (err) {
      fail(say(err, 'Please try again.'), 'Couldn’t start that sign-in')
      setSocial(null)
    }
  }

  return (
    <AuthFrame
      title="Welcome back"
      intro={from ? 'Log in to see that challenge.' : 'Log in to check on today’s progress.'}
      verb="Log in"
      onSubmit={submit}
      onSocial={pick}
      socialPending={social}
      busy={busy}
      email={
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            aria-invalid={!!errors.email}
            className={cx(inputClass, errors.email && 'ring-miss')}
          />
        </Field>
      }
      password={
        <Field label="Password">
          <Password value={password} onChange={setPassword} error={errors.password} autoComplete="current-password" />
        </Field>
      }
      options={
        <>
          <Checkbox checked={remember} onChange={setRemember}>
            Keep me logged in
          </Checkbox>
          <Link to="/forgot" className="text-[15px] font-semibold text-cobalt hover:underline">
            Forgot password?
          </Link>
        </>
      }
      submit={busy ? 'Logging in' : 'Log in'}
      footer={
        <>
          New to Stake-Sync?{' '}
          <Link to="/signup" className="font-semibold text-cobalt hover:underline">
            Create an account
          </Link>
        </>
      }
    />
  )
}

export function Signup() {
  const { applyAuth } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string; agreed?: boolean }>({})
  const fail = useFail()
  const [busy, setBusy] = useState(false)
  const [social, setSocial] = useState<'google' | 'github' | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const next = {
      email: emailOk(email) ? undefined : 'Enter a valid email, like you@example.com.',
      password: password.length >= 8 ? undefined : 'Use at least 8 characters.',
      agreed: !agreed,
    }
    setErrors(next)
    if (next.email || next.password) return fail((next.email ?? next.password)!)
    if (next.agreed) return fail(TERMS_NEEDED)
    setBusy(true)
    try {
      // The API needs a name to create the account; the real one is chosen in onboarding.
      const local = email.split('@')[0].slice(0, 80)
      const r = await api<AuthResult>('/auth/signup', {
        method: 'POST',
        body: { name: local.length >= 2 ? local : 'New member', email, password, acceptTerms: true },
        token: '',
      })
      applyAuth(r, { blankName: true })
      navigate('/start', { replace: true })
    } catch (err) {
      const code = err instanceof ApiError ? err.code : ''
      // Point at the field that needs fixing when there is one.
      if (code === 'weak_password') setErrors((x) => ({ ...x, password: 'weak' }))
      else if (code === 'email_taken') setErrors((x) => ({ ...x, email: 'taken' }))
      fail(say(err, 'Please try again.'), 'Couldn’t create your account')
      setBusy(false)
    }
  }

  async function pick(provider: 'google' | 'github') {
    // Signing up with Google or GitHub needs the same agreement as email.
    if (!agreed) {
      setErrors((e) => ({ ...e, agreed: true }))
      return fail(TERMS_NEEDED)
    }
    setSocial(provider)
    try {
      await startOAuth(provider, 'login', { acceptTerms: true })
    } catch (err) {
      fail(say(err, 'Please try again.'), 'Couldn’t start that sign-up')
      setSocial(null)
    }
  }

  return (
    <AuthFrame
      title="Create your account"
      intro="It takes a minute. Your first challenge can start today."
      verb="Sign up"
      onSubmit={submit}
      onSocial={pick}
      socialPending={social}
      busy={busy}
      email={
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            aria-invalid={!!errors.email}
            className={cx(inputClass, errors.email && 'ring-miss')}
          />
        </Field>
      }
      password={
        <Field label="Password">
          <Password value={password} onChange={setPassword} error={errors.password} autoComplete="new-password" />
        </Field>
      }
      options={
        <Checkbox checked={agreed} onChange={setAgreed} invalid={errors.agreed}>
          <span>
            I agree to the{' '}
            <a href="/terms" target="_blank" rel="noreferrer" className="font-semibold text-cobalt hover:underline">
              Terms
            </a>{' '}
            and{' '}
            <a href="/privacy" target="_blank" rel="noreferrer" className="font-semibold text-cobalt hover:underline">
              Privacy Policy
            </a>
          </span>
        </Checkbox>
      }
      submit={busy ? 'Creating your account' : 'Create account'}
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-cobalt hover:underline">
            Log in
          </Link>
        </>
      }
    />
  )
}

export function Forgot() {
  const fail = useFail()
  const [email, setEmail] = useState('')
  const [error, setError] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [wait, setWait] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (wait <= 0) return
    const id = window.setTimeout(() => setWait((w) => w - 1), 1000)
    return () => window.clearTimeout(id)
  }, [wait])

  async function send(e?: FormEvent) {
    e?.preventDefault()
    if (busy) return
    if (!emailOk(email)) {
      setError(true)
      return fail('Enter the email you signed up with.')
    }
    setError(false)
    setBusy(true)
    try {
      // The answer is the same whether or not the account exists, so this can't be used to find accounts.
      await api('/auth/forgot-password', { method: 'POST', body: { email }, token: '' })
    } catch (err) {
      setBusy(false)
      return fail(say(err, 'Please try again.'), 'Couldn’t send the email')
    }
    setBusy(false)
    setSentTo(email)
    setWait(30)
  }

  return (
    <>
      <Link to="/login" className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate hover:text-ink">
        <ArrowLeft size={17} /> Back to log in
      </Link>
      {sentTo ? (
        <div className="mt-8">
          <span className="grid size-14 place-items-center rounded-2xl bg-cobalt-soft text-cobalt">
            <Mail size={24} />
          </span>
          <h1 className="mt-6 text-4xl font-bold">Check your email</h1>
          <p className="mt-3 text-slate">
            If an account exists for <span className="font-semibold text-ink">{sentTo}</span>, we’ve sent a link to reset your
            password. It works for an hour.
          </p>
          <Button variant="secondary" className="mt-8 w-full" disabled={wait > 0} busy={busy} onClick={() => void send()}>
            {wait > 0 ? `Resend in ${wait}s` : 'Resend the email'}
          </Button>
          <button type="button" onClick={() => setSentTo(null)} className="mt-4 w-full text-center text-[15px] font-semibold text-cobalt hover:underline">
            Use a different email
          </button>
        </div>
      ) : (
        <>
          <h1 className="mt-8 text-4xl font-bold">Reset your password</h1>
          <p className="mt-2 text-slate">Enter your email and we’ll send you a link to choose a new password.</p>
          <form onSubmit={send} noValidate className="mt-8 space-y-4">
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                aria-invalid={error}
                className={cx(inputClass, error && 'ring-miss')}
              />
            </Field>
            <Button type="submit" className="w-full" busy={busy}>
              {busy ? 'Sending' : 'Send reset link'}
            </Button>
          </form>
        </>
      )}
    </>
  )
}

/**
 * One-time links (OAuth codes, email tokens) work once. React runs effects twice in development,
 * so each link's request is made once and shared.
 */
const once = new Map<string, Promise<unknown>>()
function onceFor<T>(key: string, run: () => Promise<T>) {
  if (!once.has(key)) once.set(key, run())
  return once.get(key) as Promise<T>
}

function Working({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label}>
      <Bone className="h-10 w-64 max-w-full" />
      <Bone className="mt-3 h-4 w-72 max-w-full" />
      <Bone className="mt-8 h-11 w-full rounded-xl" />
      <span className="sr-only">{label}</span>
    </div>
  )
}

function Outcome({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <>
      <h1 className="text-4xl font-bold">{title}</h1>
      <p className="mt-3 text-slate">{body}</p>
      <div className="mt-8">{action}</div>
    </>
  )
}

const providerLabel: Record<string, string> = { google: 'Google', github: 'GitHub', wakatime: 'WakaTime' }

type CallbackResult = { connected: string; redirect?: string } | (AuthResult & { created: boolean; redirect?: string })

/** Where Google, GitHub and WakaTime send people back to, for both signing in and connecting. */
export function AuthCallback() {
  const { provider = '' } = useParams()
  const [params] = useSearchParams()
  const { session, applyAuth, refreshUser } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const fail = useFail()
  const label = providerLabel[provider] ?? 'That provider'
  const code = params.get('code')
  const state = params.get('state')
  const home = session ? '/overview' : '/login'

  useEffect(() => {
    let alive = true
    // A cancelled or broken return never reaches the API.
    const bad =
      params.get('error') === 'access_denied'
        ? `You cancelled on ${label}, so nothing was changed.`
        : !code || !state || !(provider in providerLabel)
          ? 'That link didn’t finish. Please try again.'
          : ''
    const run = bad
      ? onceFor(`oauth-bad:${params}`, () => Promise.reject(new ApiError(bad, 'bad_link', 0)))
      : onceFor(`oauth:${code}`, () => api<CallbackResult>(`/auth/oauth/${provider}/callback`, { method: 'POST', body: { code, state } }))
    run
      .then((r) => {
        if (!alive) return
        if ('connected' in r) {
          void refreshUser().catch(() => {})
          toast({ title: `${label} connected`, body: 'Challenges that use it will now verify automatically.' })
          return navigate(r.redirect && r.redirect !== '/' ? r.redirect : '/overview', { replace: true })
        }
        applyAuth(r)
        navigate(landing(r.user.onboarded, r.redirect), { replace: true })
      })
      .catch((err) => {
        if (!alive) return
        fail(say(err, 'Please try again.'), 'That didn’t work')
        navigate(home, { replace: true })
      })
    return () => {
      alive = false
    }
  }, [params, code, state, provider, label, home, applyAuth, refreshUser, navigate, toast, fail])

  return <Working label={`Finishing with ${label}`} />
}

/** The link in the password-reset email: /reset-password?token=… */
export function ResetPassword() {
  const token = useSearchParams()[0].get('token') ?? ''
  const navigate = useNavigate()
  const toast = useToast()
  const fail = useFail()
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [linkFailed, setLinkFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (token) return
    void onceFor('reset-no-token', async () => fail('Open the link from the email again, or ask for a new one.', 'This link is incomplete'))
    navigate('/forgot', { replace: true })
  }, [token, fail, navigate])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (password.length < 8) {
      setError(true)
      return fail('Use at least 8 characters.')
    }
    setError(false)
    setBusy(true)
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password }, token: '' })
    } catch (err) {
      setBusy(false)
      if (err instanceof ApiError && err.code === 'weak_password') setError(true)
      else setLinkFailed(true)
      return fail(say(err, 'Please try again.'), 'Couldn’t change your password')
    }
    toast({ title: 'Password changed', body: 'Log in with your new password. You’ve been signed out everywhere else.' })
    navigate('/login', { replace: true })
  }

  if (!token) return null
  return (
    <>
      <h1 className="text-4xl font-bold">Choose a new password</h1>
      <p className="mt-2 text-slate">Use at least 8 characters. A short phrase only you would think of works well.</p>
      <form onSubmit={submit} noValidate className="mt-8 space-y-4">
        <Field label="New password">
          <Password value={password} onChange={setPassword} error={error ? 'error' : undefined} autoComplete="new-password" />
        </Field>
        <Button type="submit" className="w-full" busy={busy}>
          {busy ? 'Saving' : 'Save new password'}
        </Button>
      </form>
      {linkFailed && (
        <Link to="/forgot" className="mt-4 block text-center text-[15px] font-semibold text-cobalt hover:underline">
          Get a new reset link
        </Link>
      )}
    </>
  )
}

/** The link in the confirm-your-email message: /verify-email?token=… */
export function VerifyEmail() {
  const token = useSearchParams()[0].get('token') ?? ''
  const { session, refreshUser } = useAuth()
  const navigate = useNavigate()
  const fail = useFail()
  const [done, setDone] = useState(false)
  const next = session ? (session.onboarded ? '/overview' : '/start') : '/login'

  useEffect(() => {
    let alive = true
    const run = token
      ? onceFor(`verify:${token}`, () => api('/auth/verify-email', { method: 'POST', body: { token }, token: '' }))
      : onceFor('verify-no-token', () => Promise.reject(new ApiError('This link is incomplete. Open it from the email again.', 'bad_link', 0)))
    run
      .then(() => {
        if (!alive) return
        setDone(true)
        void refreshUser().catch(() => {})
      })
      .catch((err) => {
        if (!alive) return
        fail(`${say(err, 'Please try again.')} You can ask for a new link from your account settings.`, 'Couldn’t confirm your email')
        navigate(next, { replace: true })
      })
    return () => {
      alive = false
    }
  }, [token, next, refreshUser, fail, navigate])

  if (!done) return <Working label="Confirming your email" />
  return (
    <Outcome
      title="Email confirmed"
      body="Thanks. We’ll send challenge reminders and payout receipts here."
      action={
        <Button to={next} className="w-full">
          {session ? 'Continue' : 'Log in'}
        </Button>
      }
    />
  )
}
