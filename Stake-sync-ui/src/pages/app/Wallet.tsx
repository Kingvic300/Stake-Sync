import { ArrowDownLeft, ArrowUpRight, Landmark, Lock, Plus, Trophy, Wallet as WalletIcon } from 'lucide-react'
import { LinkedWallets } from '../../wallet/LinkedWallets'
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useAuth } from '../../auth/context'
import { AddMoneySheet } from '../../components/AddMoneySheet'
import { Sheet } from '../../components/Sheet'
import { OnrampSoon } from '../../components/OnrampSoon'
import { Bone, WalletSkeleton } from '../../components/Skeleton'
import { Button, Field, PageHeader } from '../../components/ui'
import { useMine } from '../../data/useMine'
import { useApiData } from '../../lib/useApiData'
import { signAndSubmit, type SignBytes } from '../../wallet/sendUsdc'
import { cx, usd, usdShort } from '../../lib/format'
import { prefersMotion } from '../../lib/gsap'
import { inputBase } from '../../lib/styles'
import { useLedger } from '../../state/ledger-context'
import { api, ApiError } from '../../lib/api'
import { embeddedWalletsEnabled, ONRAMP_SOON, onrampEnabled, openOnramp } from '../../lib/payments'
import { useToast } from '../../toast/context'

const SendPanel = lazy(() => import('../../wallet/SendPanel'))
const SignButton = lazy(() => import('../../wallet/SignButton'))
const EmbeddedSend = lazy(() => import('../../wallet/embedded/EmbeddedSend'))
const WalletPanel = lazy(() => import('../../wallet/WalletPanel'))
// Kept local so this page doesn't load the Solana library until someone sends money.
const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

type Filter = 'all' | 'in' | 'out'

export function Wallet() {
  const ledger = useLedger()
  const { session } = useAuth()
  const toast = useToast()
  const [sheet, setSheet] = useState<'add' | 'withdraw' | 'switch' | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const root = useRef<HTMLDivElement>(null)
  const [params, setParams] = useSearchParams()
  const returned = params.get('onramp')
  const { refresh, failed, ready } = ledger
  // Money in linked wallets other than the main one can't be staked until it's made main.
  const others = Object.entries(ledger.walletBalances).filter(([a, v]) => a !== session?.wallets?.[0] && (v ?? 0) > 0)
  const elsewhere = others.reduce((sum, [, v]) => sum + (v ?? 0), 0)
  const otherCount = others.length
  const announced = useRef(false)

  useEffect(() => {
    if (failed) toast({ tone: 'error', title: 'Couldn’t read your wallet', body: ready ? 'Your balance may be out of date.' : 'Your balance will show once we can reach the network.', action: { label: 'Try again', onClick: refresh }, inbox: false })
  }, [failed, ready, refresh, toast])

  // Back from the payment partner. The money moves on their side; the balance follows when it lands.
  useEffect(() => {
    if (returned !== 'buy' && returned !== 'sell') return
    if (announced.current) return
    announced.current = true
    toast(
      returned === 'buy'
        ? { title: 'Payment submitted', body: 'Once the payment partner confirms it, your USDC usually arrives within a few minutes. Your balance updates when it does.' }
        : { title: 'Cash-out started', body: 'Our payment partner pays your bank once your USDC reaches it, usually within a few hours.' },
    )
    setParams({}, { replace: true })
    refresh()
    const later = window.setTimeout(refresh, 60_000)
    return () => window.clearTimeout(later)
  }, [returned, setParams, toast, refresh])

  const { mine } = useMine()
  const stakes = (mine?.active ?? []).map(({ c, p }) => ({ c, p }))
  const history = useApiData<HistoryRow[]>('/payments/history')
  const claimsData = useApiData<Claim[], { claims: Claim[] }>('/payments/wallet', (r) => r.claims)
  const claims = claimsData.data ?? []

  function claim() {
    // Each payout is a transaction the person's wallet signs; they're listed under Ready to claim.
    document.getElementById('claims')?.scrollIntoView({ behavior: prefersMotion() ? 'smooth' : 'auto' })
  }

  const txns = (history.data ?? []).filter((t) => (filter === 'all' ? true : filter === 'in' ? t.amount > 0 : t.amount < 0))

  return (
    <div ref={root} className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16 sm:py-10">
      <PageHeader title="Wallet" intro="Every dollar, where it is, and when you can take it out." />

      <section className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-3xl bg-ink p-6 text-white sm:p-8">
          <div className="text-sm text-white/60">Available balance</div>
          {ledger.ready ? (
            <div className="mt-1 font-display text-5xl font-bold tabular sm:text-6xl" data-available>
              {usdShort(ledger.available)}
            </div>
          ) : ledger.failed ? (
            <div className="mt-1 font-display text-5xl font-bold text-white/40 sm:text-6xl">—</div>
          ) : (
            <Bone dark className="mt-2 h-14 w-56" />
          )}
          <div className="text-sm text-white/50">USDC in your main wallet, ready to stake or withdraw. SOL isn’t counted.</div>
          {elsewhere > 0 && (
            <p className="mt-2 text-sm text-gold">
              {usd(elsewhere, { cents: true })} is in your other {otherCount === 1 ? 'wallet' : 'wallets'}. Make {otherCount === 1 ? 'it' : 'one'} your main wallet below to use it.
            </p>
          )}
          <div className="mt-8 flex flex-wrap gap-2">
            <Button variant="gold" onClick={() => setSheet('add')}>
              <Plus size={18} /> Add money
            </Button>
            <Button variant="ghost" className="text-white ring-1 ring-white/20 hover:bg-white/10" onClick={() => setSheet('withdraw')}>
              <ArrowUpRight size={18} /> Withdraw
            </Button>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl bg-line ring-1 ring-line">
          <Tile icon={<Lock size={16} />} label="In challenges" value={ledger.locked} sub="Locked in escrow until settlement" />
          <div data-claim-tile className="flex flex-col bg-surface p-5">
            <dt className="flex items-center gap-2 text-sm text-slate">
              <Trophy size={16} /> Ready to claim
            </dt>
            <dd className={cx('mt-2 font-display text-2xl font-semibold tabular', ledger.claimable > 0 && 'text-gold-ink')}>
              {usd(ledger.claimable, { cents: true })}
            </dd>
            <dd className="mt-auto pt-3">
              <Button size="sm" variant={ledger.claimable > 0 ? 'gold' : 'secondary'} disabled={ledger.claimable === 0} onClick={claim}>
                {ledger.claimable > 0 ? 'Claim now' : 'Nothing to claim'}
              </Button>
            </dd>
          </div>
          <Tile icon={<ArrowDownLeft size={16} />} label="Forfeited" value={ledger.forfeited} sub="Lost under rules you accepted" />
          <Tile icon={<Trophy size={16} />} label="Rewards earned" value={ledger.lifetimeRewards} sub="Lifetime, on top of stakes" />
        </dl>
      </section>

      <LinkedWallets onAdd={() => setSheet('switch')} />

      <section className="mt-10">
        <h2 className="text-2xl font-bold">Stakes by challenge</h2>
        <div className="mt-4 overflow-x-auto rounded-3xl bg-surface ring-1 ring-line/70">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-line text-left text-sm text-slate">
                <th className="px-5 py-3 font-normal sm:px-6">Challenge</th>
                <th className="py-3 text-right font-normal">Stake</th>
                <th className="py-3 pl-4 font-normal sm:pl-8">Status</th>
                <th className="hidden px-5 py-3 text-right font-normal sm:table-cell sm:px-6">Unlocks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {stakes.map(({ c, p }) => {
                const end = new Date(c.startsAt)
                end.setDate(end.getDate() + c.durationDays)
                return (
                  <tr key={c.id}>
                    <td className="px-5 py-4 sm:px-6">
                      <Link to={`/c/${c.id}`} className="font-semibold hover:text-cobalt">
                        {c.title}
                      </Link>
                    </td>
                    <td className="py-4 text-right font-display font-semibold tabular">{p.stake > 0 ? usd(p.stake) : 'No stake'}</td>
                    <td className="py-4 pl-4 sm:pl-8">
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        {p.stake > 0 ? <><Lock size={14} className="text-slate" /> In escrow</> : <span className="text-slate">Free to join, nothing held</span>}
                        {p.days.some((d) => d.state === 'disputed') && <span className="text-gold-ink">, dispute open</span>}
                      </span>
                    </td>
                    <td className="hidden px-5 py-4 text-right text-slate sm:table-cell sm:px-6">{end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                  </tr>
                )
              })}
              {stakes.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-slate sm:px-6">
                    Stakes for challenges you join show up here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {claims.length > 0 && (
        <section id="claims" className="mt-10 scroll-mt-24">
          <h2 className="text-2xl font-bold">Ready to claim</h2>
          <p className="mt-1 text-slate">Your wallet signs each payout from the challenge’s escrow. Stake-Sync pays the network fee.</p>
          <ul className="mt-4 divide-y divide-line rounded-3xl bg-surface ring-1 ring-line/70">
            {claims.map((cl) => (
              <ClaimRow
                key={cl.challengeId}
                claim={cl}
                onClaimed={() => {
                  ledger.refresh()
                  history.refresh()
                  claimsData.refresh()
                }}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10 grid gap-5 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <h2 className="text-2xl font-bold">How you add money</h2>
          <p className="mt-1 text-slate">Switch any time. Both end up as USDC in your balance.</p>
          <ul className="mt-4 space-y-2">
            <PayMethod
              icon={<Landmark size={18} />}
              title="Local currency"
              body="Bank transfer or card in NGN, GHS, KES or USD"
              active={onrampEnabled && session?.walletPath !== 'connect'}
              soon={!onrampEnabled}
            />
            <PayMethod
              icon={<WalletIcon size={18} />}
              title="Solana wallet"
              body="Phantom, Solflare, Backpack and others"
              active={!onrampEnabled || session?.walletPath === 'connect'}
            />
          </ul>
        </div>

        <div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-2xl font-bold">History</h2>
            <div className="flex gap-1" role="group" aria-label="Filter transactions">
              {(
                [
                  ['all', 'All'],
                  ['in', 'Money in'],
                  ['out', 'Money out'],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={filter === k}
                  onClick={() => setFilter(k)}
                  className={cx('h-8 rounded-full px-3 text-sm font-semibold', filter === k ? 'bg-ink text-white' : 'text-slate hover:bg-ink/5')}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {!history.data ? (
            <div className="mt-4 h-40 animate-pulse rounded-3xl bg-tile" />
          ) : txns.length ? (
            <ul className="mt-4 divide-y divide-line rounded-3xl bg-surface ring-1 ring-line/70">
              {txns.map((t) => (
                <TxnRow key={t.id} t={t} />
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-3xl bg-surface px-5 py-10 text-center text-slate ring-1 ring-line/70">Money in and out shows up here.</p>
          )}
        </div>
      </section>

      {sheet === 'add' && <AddMoneySheet onClose={() => setSheet(null)} />}
      {sheet === 'withdraw' && <WithdrawSheet onClose={() => setSheet(null)} />}
      {sheet === 'switch' && (
        <Sheet title="Switch wallet" onClose={() => setSheet(null)} width={480}>
          <p className="mb-4 text-[15px] text-slate">Tap Switch to pick another wallet (or Disconnect, then choose one). Confirm it’s yours and it becomes your main wallet.</p>
          <Suspense fallback={<WalletSkeleton />}>
            <WalletPanel compact />
          </Suspense>
        </Sheet>
      )}
    </div>
  )
}

function Tile({ icon, label, value, sub }: { icon: ReactNode; label: string; value: number; sub: string }) {
  return (
    <div className="bg-surface p-5">
      <dt className="flex items-center gap-2 text-sm text-slate">
        {icon} {label}
      </dt>
      <dd className="mt-2 font-display text-2xl font-semibold tabular">{usd(value, { cents: true })}</dd>
      <dd className="mt-1 text-sm text-slate">{sub}</dd>
    </div>
  )
}

function PayMethod({ icon, title, body, active, soon }: { icon: ReactNode; title: string; body: string; active: boolean; soon?: boolean }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-surface p-4 ring-1 ring-line/70">
      <span className="grid size-10 place-items-center rounded-xl bg-ground">{icon}</span>
      <span className="flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="text-sm text-slate">{body}</span>
      </span>
      {soon ? (
        <span className="rounded-full bg-gold-soft px-2.5 py-1 text-xs font-semibold text-gold-ink">Coming soon</span>
      ) : (
        active && <span className="rounded-full bg-calm-soft px-2.5 py-1 text-xs font-semibold text-calm">Default</span>
      )}
    </li>
  )
}

/** A money-history line, from GET /payments/history. */
interface HistoryRow {
  id: string
  at: string
  kind: string
  challenge: string | null
  amount: number
  signature: string | null
  status?: 'pending' | 'confirmed' | 'failed'
  fiatAmount?: number | null
  fiatCurrency?: string | null
  detail?: string | null
}

interface Claim {
  challengeId: string
  title: string
  amount: number
  kind: 'claim' | 'refund'
}


function ClaimRow({ claim, onClaimed }: { claim: Claim; onClaimed: () => void }) {
  const toast = useToast()
  const [done, setDone] = useState(false)
  async function run(sign: SignBytes) {
    const path = `/payments/claims/${encodeURIComponent(claim.challengeId)}`
    try {
      const r = await api<{ transaction: string }>(path, { method: 'POST' })
      const signature = await signAndSubmit(r.transaction, sign)
      const c = await api<{ status: 'claimed' | 'pending' }>(`${path}/confirm`, { method: 'POST', body: { signature } })
      setDone(true)
      toast(
        c.status === 'pending'
          ? { tone: 'info', title: 'Claim sent', body: `The network is still confirming ${usd(claim.amount, { cents: true })} from ${claim.title}. It shows in your wallet once it lands.` }
          : { title: claim.kind === 'refund' ? 'Refund received' : 'Money claimed', body: `${usd(claim.amount, { cents: true })} from ${claim.title} is in your wallet.` },
      )
      onClaimed()
    } catch (err) {
      const declined = /reject|declin|cancel/i.test(String(err))
      toast({ tone: 'error', title: declined ? 'Claim cancelled' : 'Couldn’t claim', body: err instanceof ApiError ? err.message : declined ? 'Nothing moved. You can claim any time.' : 'Your money is safe in escrow. Please try again.', inbox: false })
    }
  }
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold-ink">
        <Trophy size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{claim.title}</div>
        <div className="text-sm text-slate">{claim.kind === 'refund' ? 'Cancelled: your stake and joining fee back' : 'Your stake back plus your reward'}</div>
      </div>
      <div className="w-full sm:w-56">
        {done ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-calm">Claimed</span>
        ) : (
          <Suspense fallback={<Button className="w-full" busy>Claim {usd(claim.amount, { cents: true })}</Button>}>
            <SignButton label={`Claim ${usd(claim.amount, { cents: true })}`} onSign={run} />
          </Suspense>
        )}
      </div>
    </li>
  )
}

function TxnRow({ t }: { t: HistoryRow }) {
  const incoming = t.amount > 0
  const local = t.fiatAmount && t.fiatCurrency ? `${t.fiatAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${t.fiatCurrency}` : null
  return (
    <li className="flex items-center gap-3 px-5 py-4">
      <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', incoming ? 'bg-calm-soft text-calm' : 'bg-ground text-ink')}>
        {incoming ? <ArrowDownLeft size={18} /> : <Lock size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">
          {t.kind}
          {t.status === 'pending' && <span className="ml-2 text-sm font-normal text-gold-ink">Pending</span>}
          {t.status === 'failed' && <span className="ml-2 text-sm font-normal text-miss">Didn’t go through</span>}
        </div>
        <div className="truncate text-sm text-slate">
          {[t.challenge ?? local, new Date(t.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })].filter(Boolean).join(', ')}
        </div>
        {t.detail && <div className="mt-0.5 text-sm text-slate">{t.detail}</div>}
      </div>
      <div className="text-right">
        <div className={cx('font-display font-semibold tabular', incoming && 'text-calm')}>
          {incoming ? '+' : '−'}
          {usd(Math.abs(t.amount), { cents: true })}
        </div>
        {t.signature && (
          <div className="text-xs text-slate tabular" title="Solana transaction">
            {t.signature.length > 16 ? `${t.signature.slice(0, 4)}…${t.signature.slice(-4)}` : t.signature}
          </div>
        )}
      </div>
    </li>
  )
}

/**
 * The money is in the person's own wallet. Cashing out to a bank goes through the payment partner
 * (they collect bank details, quote the rate and pay out); sending to a wallet is signed by theirs.
 */
function WithdrawSheet({ onClose }: { onClose: () => void }) {
  const ledger = useLedger()
  const toast = useToast()
  const { session } = useAuth()
  const [amount, setAmount] = useState(String(Math.floor(ledger.available)))
  const [to, setTo] = useState<'bank' | 'wallet'>(onrampEnabled ? 'bank' : 'wallet')
  const [opening, setOpening] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const value = Number(amount) || 0
  const amountOk = value >= 1 && value <= ledger.available
  // The wallet holding the money signs: Privy for wallets we created, otherwise their wallet app.
  const primary = session?.wallets?.[0]
  const embedded = embeddedWalletsEnabled && !!primary && !!session?.embeddedWallets?.includes(primary)
  const sendProps = {
    amount: value,
    amountOk,
    onSent: (address: string) => {
      setSentTo(address)
      ledger.refresh()
      toast({ title: 'Money sent', body: `${usd(value, { cents: true })} USDC to ${shortAddress(address)}.` })
    },
  }

  async function toBank() {
    if (!onrampEnabled) return toast(ONRAMP_SOON)
    setOpening(true)
    try {
      const r = await openOnramp('sell', { amount: value })
      if (!r) return // left for the partner's page
      setOpening(false)
      onClose()
      toast({ title: 'Cash-out with LocalRamp', body: 'If you sent your USDC, LocalRamp pays your bank once it arrives. It shows in your history when it’s done.' })
    } catch (err) {
      setOpening(false)
      toast({ tone: 'error', title: 'Couldn’t open the payment page', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    }
  }

  return (
    <Sheet
      title={sentTo ? 'Sent' : 'Withdraw'}
      onClose={onClose}
      footer={
        sentTo ? (
          <Button className="w-full" onClick={onClose}>
            Done
          </Button>
        ) : to === 'bank' ? (
          <Button className="w-full" disabled={!amountOk} busy={opening} onClick={() => void toBank()}>
            {opening ? 'Opening the payment page' : `Cash out ${usd(value, { cents: true })}`}
          </Button>
        ) : undefined
      }
    >
      {sentTo ? (
        <p className="text-[15px] text-slate">
          {usd(value, { cents: true })} USDC went to {shortAddress(sentTo)}. It usually arrives in under a minute.
        </p>
      ) : (
        <div className="space-y-5">
          <Field label="Amount" hint={`Up to ${usd(ledger.available, { cents: true })}. Money in challenges can’t be withdrawn until they settle.`}>
            <div className="relative">
              <span className="absolute top-1/2 left-4 -translate-y-1/2 font-display text-xl font-semibold text-slate">$</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                aria-invalid={!amountOk}
                className={cx(inputBase, 'pl-9 font-display text-2xl font-semibold tabular', !amountOk && amount !== '' && 'ring-miss')}
              />
            </div>
          </Field>
          <fieldset>
            <legend className="text-sm font-semibold">Send to</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  ['bank', 'Bank account', onrampEnabled ? 'Paid in naira through LocalRamp' : 'Coming soon'],
                  ['wallet', 'Another wallet', 'Any Solana address you choose'],
                ] as const
              ).map(([k, t, sub]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={to === k}
                  onClick={() => setTo(k)}
                  className={cx('rounded-xl p-3.5 text-left ring-1 ring-inset', to === k ? 'bg-cobalt-soft ring-2 ring-cobalt' : 'ring-line hover:ring-slate/40')}
                >
                  <span className="block font-semibold">{t}</span>
                  <span className="block text-sm text-slate">{sub}</span>
                </button>
              ))}
            </div>
          </fieldset>
          {to === 'bank' && !onrampEnabled ? (
            <OnrampSoon what="Cashing out to your bank" onUseWallet={() => setTo('wallet')} />
          ) : to === 'bank' ? (
            <p className="rounded-2xl bg-ground p-4 text-[15px] text-slate">
              Next, LocalRamp asks for your bank details and shows the exact rate, its fee and
              what you’ll receive. Nothing leaves your wallet until you confirm there.
            </p>
          ) : (
            <Suspense fallback={<WalletSkeleton />}>
              {embedded ? <EmbeddedSend {...sendProps} /> : <SendPanel {...sendProps} />}
            </Suspense>
          )}
        </div>
      )}
    </Sheet>
  )
}

