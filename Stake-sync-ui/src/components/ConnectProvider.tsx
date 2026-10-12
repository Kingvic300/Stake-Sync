import { Check, Copy, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useLocation } from 'react-router'
import { useAuth } from '../auth/context'
import type { Provider } from '../data/types'
import { api, ApiError } from '../lib/api'
import { cx } from '../lib/format'
import { startOAuth, type OAuthProvider } from '../lib/oauth'
import { inputClass } from '../lib/styles'
import { useFieldError, useToast } from '../toast/context'
import { HealthAppSheet } from './ProofSheets'
import { Sheet } from './Sheet'
import { Button, Field, ProviderMark } from './ui'

const scopes: Partial<Record<Provider, string[]>> = {
  GitHub: ['Your public profile and username', 'Commits, pull requests and releases on repositories you choose', 'Nothing private, and we can never push code'],
  WakaTime: ['Your coding time per day, by project and language', 'Only summaries: never your code or file contents', 'We can never change your WakaTime settings'],
}

/** Sites without OAuth: ownership is proven by a one-time code placed on the public profile. */
const codeSites: Partial<Record<Provider, { field: string; hint: string; where: string; open: (u: string) => string; openLabel: string; steps: string[]; why: string; find: string; example: string; keep?: string }>> = {
  LeetCode: {
    field: 'LeetCode username',
    why: 'Stake-Sync reads your public LeetCode submissions to check each day automatically. We never ask for your LeetCode password, and we can’t change anything on your account.',
    find: 'On LeetCode, click your picture in the top right. Your username is the grey text under your name, and the last part of your profile link: leetcode.com/u/your-username.',
    example: 'e.g. kingvic',
    keep: 'Keep “Recent AC Problems and Submission Details” turned On (Edit Profile, “Curate your profile”). If it’s off, we can’t see your solved problems and your days can’t be verified.',
    hint: 'From your profile link: leetcode.com/u/username',
    where: 'the ReadMe on your LeetCode profile',
    open: () => 'https://leetcode.com/profile/',
    openLabel: 'Open LeetCode’s Edit Profile page',
    steps: [
      'Copy the code above.',
      'Open LeetCode’s Edit Profile page with the link below (or click the green “Edit Profile” button under your name).',
      'Under “General”, click “ReadMe” (the last row).',
      'Paste the code anywhere in the ReadMe box and click “Save”. No ReadMe? Paste it at the end of your “Display Name” instead.',
      'Come back here and tap “I’ve added the code”. Once you’re connected you can delete it.',
    ],
  },
  Codeforces: {
    field: 'Codeforces handle',
    why: 'Stake-Sync reads your public Codeforces submissions to check each day automatically. We never ask for your Codeforces password.',
    find: 'Your handle is the name shown at the top right when you’re signed in to Codeforces, and the last part of codeforces.com/profile/your-handle.',
    example: 'e.g. tourist',
    hint: 'From your profile link: codeforces.com/profile/handle',
    where: 'your first name, last name or organisation on Codeforces (Settings → Social)',
    open: () => 'https://codeforces.com/settings/social',
    openLabel: 'Open Codeforces Settings → Social',
    steps: [
      'Copy the code above.',
      'On Codeforces, open Settings and choose the “Social” tab (or use the link below).',
      'Paste the code into the “Organization” field (or First name / Last name).',
      'Click “Save changes” at the bottom.',
      'Come back here and tap “I’ve added the code”. Once you’re connected you can delete it.',
    ],
  },
}

const oauthSlug: Partial<Record<Provider, OAuthProvider>> = { GitHub: 'github', WakaTime: 'wakatime' }

function proofSteps(site: NonNullable<(typeof codeSites)[Provider]>) {
  return [
    `Enter your ${site.field}.`,
    'We give you a one-time code.',
    `Paste the code into ${site.where} and save.`,
    'Tap “I’ve added the code”. We check your public profile and connect the account once we find the code. You can delete it afterwards.',
  ]
}

/**
 * Connects a verification account. OAuth providers hand off to the provider's own consent page;
 * LeetCode and Codeforces have no OAuth, so ownership is proven by a short code on the profile.
 */
export function ConnectProviderSheet({ provider, onClose, onConnected }: { provider: Provider; onClose: () => void; onConnected: (provider: Provider) => void }) {
  const toast = useToast()
  const { pathname } = useLocation()
  const { refreshUser } = useAuth()
  const [busy, setBusy] = useState(false)
  const [username, setUsername] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'username' | 'prove'>('username')
  const [error, setError] = useFieldError()

  if (provider === 'Health') return <HealthAppSheet onClose={onClose} />

  const site = codeSites[provider] ?? codeSites.LeetCode!
  const slug = provider.toLowerCase()

  function done() {
    toast({ title: `${provider} connected`, body: 'Challenges that use it will now verify automatically.' })
    onConnected(provider)
    void refreshUser().catch(() => {})
    onClose()
  }

  // Off to the provider's consent page; /auth/callback/:provider brings them back here.
  async function oauth() {
    setBusy(true)
    setError('')
    const to = oauthSlug[provider]
    if (!to) {
      setBusy(false)
      return setError(`${provider} can’t be connected yet.`)
    }
    try {
      await startOAuth(to, 'connect', { redirect: pathname })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `We couldn’t reach ${provider}. Please try again.`)
      setBusy(false)
    }
  }

  async function checkProfile(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (step === 'username') {
      if (!/^[A-Za-z0-9_.-]{2,40}$/.test(username)) return setError(`Enter your ${site.field}, as it appears in your profile link.`)
      setError('')
      setBusy(true)
      try {
        const r = await api<{ code: string }>(`/me/connections/${slug}/code`, { method: 'POST', body: { username } })
        setCode(r.code)
        setStep('prove')
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'We couldn’t get a code. Please try again.')
      } finally {
        setBusy(false)
      }
      return
    }
    setError('')
    setBusy(true)
    try {
      await api(`/me/connections/${slug}/verify`, { method: 'POST' })
      done()
    } catch (err) {
      // An expired code can't be checked again, so start over with a fresh one.
      if (err instanceof ApiError && err.code === 'code_expired') setStep('username')
      setError(err instanceof ApiError ? err.message : 'We couldn’t check your profile. Please try again.')
      setBusy(false)
    }
  }

  return (
    <Sheet title={`Connect ${provider}`} onClose={onClose} width={460}>
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-ground">
          <ProviderMark provider={provider} size={24} />
        </span>
        <p className="text-[15px] text-slate">Each {provider} account can be linked to only one Stake-Sync profile.</p>
      </div>

      {scopes[provider] ? (
        <>
          <h3 className="mt-6 font-sans text-sm font-semibold">Stake-Sync will be able to see</h3>
          <ul className="mt-2 space-y-2">
            {scopes[provider]!.map((s) => (
              <li key={s} className="flex items-start gap-2.5 text-[15px]">
                <ShieldCheck size={17} className="mt-0.5 shrink-0 text-calm" />
                {s}
              </li>
            ))}
          </ul>
          <Button className="mt-6 w-full" busy={busy} onClick={() => void oauth()}>
            {busy ? `Opening ${provider}` : `Continue to ${provider}`}
          </Button>
          <p className="mt-3 text-center text-xs text-slate">You’ll approve this on {provider}’s own page, then come straight back.</p>
        </>
      ) : (
        <form onSubmit={checkProfile} className="mt-6">
          {step === 'username' ? (
            <>
              <p className="rounded-2xl bg-ground p-4 text-[15px] text-slate">{site.why}</p>
              <h3 className="mt-5 font-sans text-sm font-semibold">How connecting works</h3>
              <ol className="mt-2 mb-5 list-decimal space-y-1.5 pl-5 text-[15px] text-slate marker:font-semibold marker:text-ink">
                {proofSteps(site).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <Field label={site.field} hint={site.find}>
                <input
                  placeholder={site.example}
                  value={username}
                  onChange={(e) => setUsername(e.target.value.trim())}
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-invalid={error}
                  className={cx(inputClass, error && 'ring-miss')}
                />
              </Field>
            </>
          ) : (
            <div>
              <p className="text-[15px]">
                To prove <span className="font-semibold">{username}</span> is yours, add this code to {site.where}. You can remove it after we
                check.
              </p>
              <div className="mt-4 flex items-center justify-between rounded-2xl bg-ground p-2 pl-4">
                <span className="font-display text-xl font-bold tracking-wider">{code}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(code)
                    toast({ title: 'Code copied', inbox: false })
                  }}
                >
                  <Copy size={15} /> Copy
                </Button>
              </div>
              <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-[15px] text-slate marker:font-semibold marker:text-ink">
                {site.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <a href={site.open(username)} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-cobalt hover:underline">
                {site.openLabel} ↗
              </a>
              {site.keep && <p className="mt-4 rounded-2xl bg-gold-soft p-3 text-sm text-gold-ink">{site.keep}</p>}
              <p className="mt-3 text-sm text-slate">The code works for 30 minutes. If {provider} hasn’t updated yet when you check, wait a minute and tap the button again.</p>
            </div>
          )}
          <Button type="submit" className="mt-6 w-full" busy={busy}>
            {step === 'username' ? (busy ? 'Getting your code' : 'Continue') : busy ? 'Checking your profile' : 'I’ve added the code'}
          </Button>
          {step === 'prove' && (
            <button
              type="button"
              onClick={() => {
                setError('')
                setStep('username')
              }}
              className="mt-3 w-full text-center text-sm font-semibold text-slate hover:text-ink">
              Use a different username
            </button>
          )}
        </form>
      )}
    </Sheet>
  )
}

export function ConnectedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-calm">
      <Check size={16} strokeWidth={3} /> Connected
    </span>
  )
}
