import { useWallet } from '@solana/wallet-adapter-react'
import { useEffect, useState } from 'react'
import { CopyAddress } from '../components/CopyAddress'
import { useAuth } from '../auth/context'
import { Button, Field } from '../components/ui'
import { ApiError } from '../lib/api'
import { cx } from '../lib/format'
import { inputClass } from '../lib/styles'
import { linkWallet } from '../lib/payments'
import { makeMainWallet } from './walletApi'
import { useLedger } from '../state/ledger-context'
import { useToast } from '../toast/context'
import { cluster, newConnection, shortAddress } from './config'
import { buildSwap, quoteSolToUsdc, SOL_RESERVE, type SwapQuote } from './jupiter'
import { adapterSigner, signAndSubmit } from './sendUsdc'
import { useWalletUi } from './context'
import { SolanaProvider } from './SolanaProvider'
import { useBalances } from './useBalances'

function money(n: number, digits = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/**
 * Lazy-loaded entry for everything Solana. Mounting it brings in the wallet adapter,
 * web3.js and the wallet picker; autoConnect restores a wallet the person already approved.
 */
export default function WalletPanel(props: { onDone?: (usdc: number) => void; onSuccess?: (usdc: number) => void; compact?: boolean }) {
  return (
    <SolanaProvider>
      <WalletBody {...props} />
    </SolanaProvider>
  )
}

function WalletBody({ onDone, onSuccess, compact }: { onDone?: (usdc: number) => void; onSuccess?: (usdc: number) => void; compact?: boolean }) {
  const { publicKey, wallet, disconnect, connecting } = useWallet()
  const { openModal } = useWalletUi()
  const { usdc, sol, loading, error, refresh } = useBalances()
  const toast = useToast()

  useEffect(() => {
    if (error) toast({ tone: 'error', title: 'Couldn’t load your balance', body: error, action: { label: 'Try again', onClick: refresh }, inbox: false })
  }, [error, refresh, toast])

  // A connected wallet counts as set up once it's linked to the account (stakes and payouts need that).
  const { session, live } = useAuth()
  const ready = !!publicKey && (!live || !!session?.wallets?.includes(publicKey.toBase58()))
  useEffect(() => {
    if (ready) onSuccess?.(usdc ?? 0)
  }, [ready, usdc, onSuccess])

  if (!publicKey) {
    return (
      <div>
        {!compact && (
          <p className="text-slate">
            Connect Phantom, Solflare, Backpack or any Solana wallet. Your stake is taken from it only when you join a
            challenge, and only after you approve.
          </p>
        )}
        <Button className="mt-5 w-full" onClick={openModal} busy={connecting}>
          {connecting ? 'Waiting for your wallet' : 'Choose your wallet'}
        </Button>
      </div>
    )
  }

  const empty = usdc === 0
  return (
    <div>
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-calm-soft px-4 py-3 text-sm">
        <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-calm">
          {wallet && <img src={wallet.adapter.icon} alt="" className="size-5 rounded-md" />}
          <span className="truncate">{wallet?.adapter.name} connected</span>
        </span>
        <span className="flex items-center gap-3">
          <CopyAddress address={publicKey.toBase58()} />
          <button
            type="button"
            onClick={() => {
              // Let go of this one, then pick another from the list.
              void disconnect().finally(openModal)
            }}
            className="font-semibold text-slate hover:text-ink"
          >
            Switch
          </button>
          <button type="button" onClick={() => disconnect()} className="font-semibold text-slate hover:text-ink">
            Disconnect
          </button>
        </span>
      </div>

      <LinkWallet address={publicKey.toBase58()} />
      <NotMainWallet address={publicKey.toBase58()} />

      <dl className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-surface p-4 ring-1 ring-line">
          <dt className="text-sm text-slate">USDC for stakes</dt>
          <dd className="mt-1 font-display text-2xl font-semibold tabular">
            {loading ? <span className="inline-block h-7 w-20 animate-pulse rounded-md bg-tile" /> : money(usdc ?? 0)}
          </dd>
        </div>
        <div className="rounded-2xl bg-surface p-4 ring-1 ring-line">
          <dt className="text-sm text-slate">SOL (optional)</dt>
          <dd className="mt-1 font-display text-2xl font-semibold tabular">
            {loading ? <span className="inline-block h-7 w-16 animate-pulse rounded-md bg-tile" /> : money(sol ?? 0, 4)}
          </dd>
          <dd className="mt-1 text-xs text-slate">Stake-Sync pays network fees, so you don’t need SOL.</dd>
        </div>
      </dl>
      {!loading && sol !== null && <SwapSol sol={sol} onSwapped={refresh} />}

      {!loading && empty && (
        <p className="mt-4 rounded-2xl bg-gold-soft p-4 text-[15px] text-gold-ink">
          This wallet has no USDC yet. Send some to {shortAddress(publicKey.toBase58())} from an exchange or
          another wallet.
          {cluster === 'devnet' && (
            <>
              {' '}
              On devnet, get test USDC from{' '}
              <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="font-semibold underline">
                Circle’s faucet
              </a>
              .
            </>
          )}
        </p>
      )}
      {!loading && !empty && (
        <p className="mt-4 text-[15px] text-slate">
          Joining a challenge moves its stake from this wallet into escrow. You’ll approve each one in {wallet?.adapter.name}.
        </p>
      )}

      {onDone && (
        <Button className="mt-5 w-full" disabled={!ready} onClick={() => onDone(usdc ?? 0)}>
          Continue
        </Button>
      )}
      {cluster !== 'mainnet-beta' && (
        <p className="mt-3 text-center text-xs text-slate">Connected to Solana {cluster}</p>
      )}
    </div>
  )
}


/**
 * With the API, a connected wallet must also be linked to the account before money can be added to
 * it or sent from it. Signing a message proves it's theirs; it's free and moves no money.
 */
/** A linked wallet that isn't the main one: stakes and payouts would use a different address. */
function NotMainWallet({ address }: { address: string }) {
  const { session, refreshUser } = useAuth()
  const ledger = useLedger()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const main = session?.wallets?.[0]
  if (!main || main === address || !session?.wallets?.includes(address)) return null

  async function switchMain() {
    setBusy(true)
    try {
      await makeMainWallet(address)
      await refreshUser()
      ledger.refresh()
      toast({ title: 'Main wallet changed', body: `${shortAddress(address)} now holds your balance and is used for new stakes.` })
    } catch (err) {
      toast({ tone: 'error', title: 'Main wallet not changed', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-2xl bg-gold-soft p-4 text-gold-ink">
      <p className="font-semibold">This isn’t your main wallet</p>
      <p className="mt-1 text-[15px]">
        Your balance and new stakes use {shortAddress(main)}. Make {shortAddress(address)} your main wallet to use it instead. Money already in challenges stays where it is.
      </p>
      <Button className="mt-3 w-full" onClick={() => void switchMain()} busy={busy}>
        Make this my main wallet
      </Button>
    </div>
  )
}

function LinkWallet({ address }: { address: string }) {
  const { session, live, refreshUser } = useAuth()
  const ledger = useLedger()
  const { signMessage, wallet } = useWallet()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!live || session?.wallets?.includes(address)) return null

  async function link() {
    if (!signMessage) {
      return toast({ tone: 'error', title: 'This wallet can’t sign messages', body: 'Try Phantom, Solflare or Backpack instead.', inbox: false })
    }
    setBusy(true)
    try {
      await linkWallet(address, signMessage)
      // You connected this wallet to use it, so it becomes the main one.
      if (session?.wallets?.length) await makeMainWallet(address)
      await refreshUser()
      ledger.refresh()
      toast({ title: 'Wallet linked', body: 'It’s now your main wallet: your balance, stakes and payouts use it.' })
    } catch (err) {
      toast({
        tone: 'error',
        title: 'Wallet not linked',
        body: err instanceof ApiError ? err.message : /reject|declin/i.test(String(err)) ? 'You declined the request in your wallet.' : 'Please try again.',
        inbox: false,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-2xl bg-cobalt-soft p-4">
      <p className="font-semibold">One more step: confirm this wallet is yours</p>
      <p className="mt-1 text-[15px] text-slate">
        {wallet?.adapter.name ?? 'Your wallet'} will ask you to sign a short message. It’s free and doesn’t move any money.
      </p>
      <Button className="mt-3 w-full" onClick={() => void link()} busy={busy}>
        {busy ? 'Waiting for your wallet' : 'Confirm it’s mine'}
      </Button>
    </div>
  )
}

/**
 * Turns spare SOL into USDC through Jupiter, a Solana exchange. The person's own wallet signs the
 * swap and pays its small fee in SOL; Stake-Sync never holds the money. Jupiter only trades on
 * mainnet, so devnet points to Circle's faucet for test USDC instead.
 */
function SwapSol({ sol, onSwapped }: { sol: number; onSwapped: () => void }) {
  const { publicKey, signTransaction, wallet } = useWallet()
  const ledger = useLedger()
  const toast = useToast()
  const max = Math.max(0, Math.floor((sol - SOL_RESERVE) * 10_000) / 10_000)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(String(max))
  const [quote, setQuote] = useState<{ for: number; q: SwapQuote } | null>(null)
  const [busy, setBusy] = useState(false)
  const value = Number(amount) || 0
  const amountOk = value > 0 && value <= max

  // A fresh price shortly after the amount stops changing.
  useEffect(() => {
    if (!open || !amountOk) return
    let alive = true
    const t = window.setTimeout(() => {
      quoteSolToUsdc(value)
        .then((q) => alive && setQuote({ for: value, q }))
        .catch(() => alive && toast({ tone: 'error', title: 'Couldn’t get a price', body: 'Please try again in a moment.', inbox: false }))
    }, 400)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [open, amountOk, value, toast])

  if (max <= 0) return null
  if (cluster !== 'mainnet-beta') {
    return (
      <p className="mt-4 rounded-2xl bg-ground p-4 text-[15px] text-slate">
        Converting SOL to USDC works on mainnet. On devnet, get test USDC from{' '}
        <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="font-semibold text-cobalt underline">
          Circle’s faucet
        </a>
        .
      </p>
    )
  }
  if (!open) {
    return (
      <Button variant="secondary" className="mt-4 w-full" onClick={() => setOpen(true)}>
        Convert SOL to USDC
      </Button>
    )
  }

  const current = quote && quote.for === value ? quote.q : null
  async function swap() {
    if (!publicKey || !signTransaction || !current) return
    setBusy(true)
    try {
      const sign = adapterSigner(signTransaction, wallet?.adapter, publicKey.toBase58())
      const tx = await buildSwap(current, publicKey)
      const signature = await signAndSubmit(tx, sign)
      await newConnection().confirmTransaction(signature, 'confirmed')
      toast({ title: 'Converted to USDC', body: `${money(value, 4)} SOL became about ${money(current.usdc)} USDC.` })
      setOpen(false)
      onSwapped()
      ledger.refresh()
    } catch (err) {
      const declined = /reject|declin|cancel/i.test(String(err))
      toast({
        tone: 'error',
        title: declined ? 'Conversion cancelled' : 'Couldn’t convert',
        body: err instanceof ApiError ? err.message : declined ? 'You declined it in your wallet, so nothing changed.' : 'The price may have moved. Nothing was converted; please try again.',
        inbox: false,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 space-y-3 rounded-2xl bg-ground p-4">
      <Field label="SOL to convert" hint={`Up to ${money(max, 4)}. We leave ${SOL_RESERVE} SOL for fees.`}>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          aria-invalid={!amountOk}
          className={cx(inputClass, 'tabular', !amountOk && amount !== '' && 'ring-miss')}
        />
      </Field>
      <p className="text-[15px] text-slate">
        {!amountOk ? (
          'Enter an amount to see the price.'
        ) : current ? (
          <>
            You get about <span className="font-semibold text-ink">{money(current.usdc)} USDC</span>, at least {money(current.minUsdc)}.
          </>
        ) : (
          <span className="inline-block h-5 w-48 animate-pulse rounded-md bg-tile align-middle" />
        )}
      </p>
      <p className="text-sm text-slate">Jupiter, a Solana exchange, makes the swap. Your wallet signs it and pays a small network fee in SOL.</p>
      <Button className="w-full" disabled={!amountOk || !current || !signTransaction} busy={busy} onClick={() => void swap()}>
        {busy ? 'Waiting for your wallet' : current && amountOk ? `Convert to ${money(current.usdc)} USDC` : 'Convert'}
      </Button>
    </div>
  )
}
