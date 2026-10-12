import { ShieldCheck } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { useAdminAuth, type AdminSession } from '../auth/context'
import { Logo } from '../components/Logo'
import { Button, Field } from '../components/ui'
import type { AdminRole } from '../data/admin'
import { api, apiEnabled, ApiError } from '../lib/api'
import { cx } from '../lib/format'
import { inputBase, inputClass } from '../lib/styles'

interface LoginResponse {
  accessToken: string
  refreshToken: string
  twoFactorRequired?: boolean
  user: { id: string; name: string; email: string; adminRole: AdminRole }
}

type Step = 'password' | 'code' | 'enroll'

/**
 * Email and password, then a 6-digit authenticator code. An admin without two-step verification
 * sets it up here before getting in.
 */
export function Login() {
  const { session, signIn } = useAdminAuth()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/'
  const [step, setStep] = useState<Step>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<LoginResponse | null>(null)
  const [enroll, setEnroll] = useState<{ secret: string; qr: string } | null>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step !== 'password') codeRef.current?.focus()
  }, [step, enroll])

  if (session) return <Navigate to="/" replace />

  function finish(r: LoginResponse, accessToken = r.accessToken) {
    const s: AdminSession = { id: r.user.id, name: r.user.name, email: r.user.email, role: r.user.adminRole, accessToken, refreshToken: r.refreshToken }
    signIn(s)
    navigate(from, { replace: true })
  }

  async function startEnrollment(r: LoginResponse) {
    const setup = await api<{ secret: string; otpauthUrl: string }>('/auth/admin/2fa/setup', { method: 'POST', token: r.accessToken })
    const qr = await QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 220 })
    setPending(r)
    setEnroll({ secret: setup.secret, qr })
    setCode('')
    setStep('enroll')
  }

  async function submitApi() {
    if (step === 'enroll') {
      if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code your authenticator app shows.')
      const r = await api<{ accessToken: string }>('/auth/admin/2fa/enable', { method: 'POST', token: pending!.accessToken, body: { code } })
      return finish(pending!, r.accessToken)
    }
    if (step === 'code' && !/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from your authenticator app.')
    try {
      const r = await api<LoginResponse>('/auth/admin/login', { method: 'POST', body: { email: email.trim(), password, ...(step === 'code' ? { code } : {}) }, token: '' })
      if (r.twoFactorRequired) return await startEnrollment(r)
      finish(r)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'two_factor_required') {
        setError('')
        return setStep('code')
      }
      throw e
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!apiEnabled) {
      setError('Admin sign-in is unavailable because the API is not configured.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await submitApi()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const titles: Record<Step, [string, string]> = {
    password: ['Admin sign in', 'For Stake-Sync staff only. Every action here is recorded.'],
    code: ['Two-step verification', 'Open your authenticator app and enter the current code.'],
    enroll: ['Set up two-step verification', 'Admins need it before using the console. Scan the code with an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code it shows.'],
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,44%)]">
      <div className="flex flex-col px-4 py-6 sm:px-10">
        <Logo />
        <main id="main" className="flex flex-1 items-center justify-center py-10">
          <form onSubmit={submit} noValidate className="w-full max-w-[24rem]">
            <h1 className="text-4xl font-bold">{titles[step][0]}</h1>
            <p className="mt-2 text-slate">{titles[step][1]}</p>
            <div className="mt-8 space-y-4">
              {step === 'password' && (
                <>
                  <Field label="Work email">
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" className={inputClass} />
                  </Field>
                  <Field label="Password">
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={inputClass} />
                  </Field>
                </>
              )}
              {step === 'enroll' && enroll && (
                <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface p-5 ring-1 ring-line/70">
                  <img src={enroll.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-lg" />
                  <p className="text-center text-sm text-slate">
                    Can’t scan? Enter this key:
                    <span className="mt-1 block font-mono text-[13px] font-semibold tracking-wider break-all text-ink select-all">{enroll.secret}</span>
                  </p>
                </div>
              )}
              {step !== 'password' && (
                <Field label="Authentication code">
                  <input
                    ref={codeRef}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className={cx(inputBase, 'h-14 text-center font-display text-3xl font-bold tracking-[0.4em] tabular')}
                  />
                </Field>
              )}
              {error && (
                <p role="alert" className="text-sm text-miss">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" size="lg" busy={busy}>
                {step === 'password' ? 'Continue' : step === 'enroll' ? 'Turn on and sign in' : 'Verify and sign in'}
              </Button>
              {step !== 'password' && (
                <button
                  type="button"
                  onClick={() => {
                    setStep('password')
                    setCode('')
                    setError('')
                  }}
                  className="w-full text-center text-sm font-semibold text-slate hover:text-ink"
                >
                  Use a different account
                </button>
              )}
            </div>
          </form>
        </main>
      </div>
      <aside className="hidden flex-col justify-end bg-ink p-12 text-white lg:flex">
        <ShieldCheck size={36} className="text-gold" />
        <p className="mt-6 max-w-md font-display text-4xl leading-tight font-bold">Fair calls, on the record.</p>
        <ul className="mt-6 max-w-md space-y-2 text-white/70">
          <li>Every decision needs a reason and is written to the audit log.</li>
          <li>High-impact actions need a second admin.</li>
          <li>No one here can move escrowed funds. Settlement runs on-chain.</li>
        </ul>
      </aside>
    </div>
  )
}
