import { ArrowLeftRight, Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../auth/context'
import { CopyAddress } from '../components/CopyAddress'
import { Button } from '../components/ui'
import { ApiError } from '../lib/api'
import { useLedger } from '../state/ledger-context'
import { useToast } from '../toast/context'
import { shortAddress } from './config'
import { makeMainWallet, unlinkWallet } from './walletApi'

/** Every wallet linked to the account: which one is main, switching it, and removing old ones. */
export function LinkedWallets({ onAdd }: { onAdd: () => void }) {
  const { session, refreshUser } = useAuth()
  const ledger = useLedger()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const wallets = session?.wallets ?? []
  const created = new Set(session?.embeddedWallets ?? [])

  async function act(address: string, what: 'main' | 'remove') {
    setBusy(`${what}:${address}`)
    try {
      if (what === 'main') await makeMainWallet(address)
      else await unlinkWallet(address)
      await refreshUser()
      ledger.refresh()
      toast(what === 'main' ? { title: 'Main wallet changed', body: `${shortAddress(address)} now holds your balance and is used for new stakes.` } : { title: 'Wallet removed', body: `${shortAddress(address)} is no longer linked. The money in it stays yours.` })
    } catch (err) {
      toast({ tone: 'error', title: what === 'main' ? 'Main wallet not changed' : 'Wallet not removed', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Your wallets</h2>
          <p className="mt-1 text-slate">Your main wallet holds your balance and is used for new stakes and payouts. To use a different one, tap Switch wallet, connect it, and confirm it’s yours.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={onAdd}>
          <ArrowLeftRight size={15} /> Switch wallet
        </Button>
      </div>
      {wallets.length === 0 ? (
        <p className="mt-4 rounded-3xl bg-surface p-6 text-center text-slate ring-1 ring-line/70">No wallet linked yet. Connect one to add money and join challenges.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-3xl bg-surface ring-1 ring-line/70">
          {wallets.map((a, i) => (
            <li key={a} className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
              <CopyAddress address={a} className="font-mono text-[15px] text-ink" />
              {i === 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-cobalt-soft px-2.5 py-0.5 text-xs font-semibold text-cobalt-deep">
                  <Star size={12} /> Main
                </span>
              )}
              <span className="text-sm text-slate">{created.has(a) ? 'Created by Stake-Sync' : 'Your own wallet'}</span>
              {ledger.walletBalances[a] != null && <span className="text-sm font-semibold tabular">{ledger.walletBalances[a]!.toFixed(2)} USDC</span>}
              <span className="ml-auto flex gap-2">
                {i !== 0 && (
                  <Button size="sm" variant="secondary" busy={busy === `main:${a}`} onClick={() => void act(a, 'main')}>
                    Make main
                  </Button>
                )}
                {wallets.length > 1 && (
                  <Button size="sm" variant="ghost" busy={busy === `remove:${a}`} onClick={() => void act(a, 'remove')} aria-label={`Remove ${a}`}>
                    <Trash2 size={15} /> Remove
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
