import { lazy, Suspense, useCallback, useState } from 'react'
import { Link } from 'react-router'
import { useAuth, type WalletPath } from '../auth/context'
import { ApiError } from '../lib/api'
import { embeddedWalletsEnabled, ONRAMP_SOON, onrampEnabled, openOnramp } from '../lib/payments'
import { useToast } from '../toast/context'
import { cx } from '../lib/format'
import { inputBase } from '../lib/styles'
import { WalletSkeleton } from './Skeleton'
import { Button } from './ui'
import { Select } from './Select'
import { OnrampSoon } from './OnrampSoon'

// Currencies people can pay in; the partner quotes the live rate.
const currencies = [
  { code: 'NGN', symbol: '₦', name: 'Nigerian naira', perUsdc: 1545 },
  { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian cedi', perUsdc: 15.6 },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan shilling', perUsdc: 129 },
  { code: 'USD', symbol: '$', name: 'US dollar', perUsdc: 1 },
] as const

// All Solana code lives in this chunk; it only downloads when someone picks the wallet path.
const WalletPanel = lazy(() => import('../wallet/WalletPanel'))
const EmbeddedSetup = lazy(() => import('../wallet/embedded/EmbeddedSetup'))

/** Top up from a connected Solana wallet, or pay in local currency that arrives as USDC. */
export function AddMoney({
  path,
  onDone,
  onSuccess,
  compact,
}: {
  path: WalletPath
  /** Shows a Continue button after success */
  onDone?: (usdc: number) => void
  /** Called on success without adding a button, for flows with their own footer */
  onSuccess?: (usdc: number) => void
  compact?: boolean
}) {
  if (path === 'local') return <FromLocal onDone={onDone} onSuccess={onSuccess} compact={compact} />
  return (
    <Suspense fallback={<WalletSkeleton />}>
      <WalletPanel onDone={onDone} onSuccess={onSuccess} compact={compact} />
    </Suspense>
  )
}

function FromLocal({ compact }: { onDone?: (usdc: number) => void; onSuccess?: (usdc: number) => void; compact?: boolean }) {
  const [code, setCode] = useState<(typeof currencies)[number]['code']>('NGN')
  const [amount, setAmount] = useState('31000')
  const { session } = useAuth()
  const toast = useToast()
  const [opening, setOpening] = useState(false)
  const [ownWallet, setOwnWallet] = useState(!embeddedWalletsEnabled)
  const switchToOwnWallet = useCallback(() => setOwnWallet(true), [])

  const cur = currencies.find((c) => c.code === code)!
  const value = Number(amount) || 0
  // The partner quotes the real rate, so only the amount is checked here.
  const valid = value > 0

  async function toPartner() {
    if (!onrampEnabled) return toast(ONRAMP_SOON)
    setOpening(true)
    try {
      const r = await openOnramp('buy', { fiat: code, amount: value })
      if (!r) return // left for the partner's page
      if (r.paid) return window.location.assign('/wallet?onramp=buy')
      setOpening(false)
      toast({ tone: 'info', title: 'Payment not finished', body: 'Nothing was charged. You can try again whenever you’re ready.', inbox: false })
    } catch (err) {
      setOpening(false)
      toast({ tone: 'error', title: 'Couldn’t open the payment page', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    }
  }


  // The partner sends USDC to the person's own wallet, so one has to be linked first.
  if (!session?.wallets?.length) {
    return (
      <div>
        <p className="text-slate">
          {ownWallet
            ? 'Your USDC goes straight to a wallet only you control. Connect one first (Phantom, Solflare or Backpack are free), then pay in your own currency.'
            : 'Your USDC goes into a wallet that belongs to you. We’ll create one in a few seconds; no app or seed phrase needed.'}
        </p>
        <div className="mt-4">
          <Suspense fallback={<WalletSkeleton />}>{ownWallet ? <WalletPanel compact /> : <EmbeddedSetup onUnavailable={switchToOwnWallet} />}</Suspense>
        </div>
        {embeddedWalletsEnabled && (
          <button type="button" onClick={() => setOwnWallet((v) => !v)} className="mt-3 w-full text-center text-sm font-semibold text-cobalt hover:underline">
            {ownWallet ? 'Create a wallet for me instead' : 'I already have a Solana wallet'}
          </button>
        )}
      </div>
    )
  }

  if (!onrampEnabled) return <OnrampSoon />

  return (
    <div>
      {!compact && (
        <p className="text-slate">
          Pay in your own currency. LocalRamp, our payment partner, converts it to USDC, a digital dollar that follows the US
          dollar rather than the naira.
        </p>
      )}
      <div className="mt-5 grid grid-cols-[7.5rem_1fr] gap-2">
        <label>
          <span className="sr-only">Currency</span>
          <Select
            label="Currency"
            value={code}
            onChange={setCode}
            className="font-semibold"
            options={currencies.map((c) => ({ value: c.code, label: c.code, hint: c.name }))}
          />
        </label>
        <label>
          <span className="sr-only">Amount in {cur.name}</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            className={cx(inputBase, 'font-display text-2xl font-semibold tabular')}
            aria-invalid={!valid}
          />
        </label>
      </div>

      <p className="mt-4 rounded-2xl bg-ground p-4 text-[15px] text-slate">
        Next, LocalRamp shows the exact rate, its fee and how much USDC you’ll get. Nothing is charged until you
        confirm there. The USDC goes straight to your own wallet.
      </p>
      <ul className="mt-3 space-y-1 text-sm text-slate">
        <li>LocalRamp sets the rate and its fee, and shows the final amount before you pay. Cashing out to your bank later costs a similar fee.</li>
        <li>
          USDC is issued by Circle and isn’t a bank deposit.{' '}
          <Link to="/terms#risks" target="_blank" className="font-semibold text-cobalt hover:underline">
            What to know
          </Link>
        </li>
      </ul>


      <p className="mt-4 text-sm text-slate">
        Payments are handled by LocalRamp, which may ask you to verify your identity the first time.
      </p>
      <Button className="mt-5 w-full" onClick={() => void toPartner()} disabled={!valid} busy={opening}>
        {opening ? 'Opening the payment page' : 'Continue to payment'}
      </Button>
    </div>
  )
}
