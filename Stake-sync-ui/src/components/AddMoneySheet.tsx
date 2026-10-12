import { useState } from 'react'
import { onrampEnabled } from '../lib/payments'
import { useAuth, type WalletPath } from '../auth/context'
import { cx } from '../lib/format'
import { useLedger } from '../state/ledger-context'
import { AddMoney } from './AddMoney'
import { Sheet } from './Sheet'
import { useToast } from '../toast/context'

/**
 * Add money from anywhere: local currency or a Solana wallet. Opens over the current flow
 * so nobody loses their place, and reports the amount added.
 */
export function AddMoneySheet({ onClose, onAdded, need }: { onClose: () => void; onAdded?: (usdc: number) => void; need?: number }) {
  const ledger = useLedger()
  const toast = useToast()
  const { session } = useAuth()
  const [path, setPath] = useState<WalletPath>(onrampEnabled ? (session?.walletPath ?? 'local') : 'connect')
  return (
    <Sheet title={need ? `Add at least $${need.toFixed(2)}` : 'Add money'} onClose={onClose}>
      <div className={cx('grid grid-cols-2 gap-1 rounded-xl bg-ground p-1')} role="tablist" aria-label="How to add money">
        {(
          [
            ['local', onrampEnabled ? 'Local currency' : 'Local currency (soon)'],
            ['connect', 'Solana wallet'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={path === k}
            onClick={() => setPath(k)}
            className={cx('h-10 rounded-lg text-sm font-semibold transition-colors', path === k ? 'bg-surface shadow-sm' : 'text-slate hover:text-ink')}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="mt-5">
        <AddMoney
          key={path}
          path={path}
          compact
          onDone={(usdc) => {
            if (path === 'local') ledger.add(usdc)
            else ledger.refresh() // USDC sent to the wallet from elsewhere shows up here
            toast(path === 'local' ? { title: 'Money added', body: `${usdc.toFixed(2)} USDC is in your balance.` } : { title: 'Wallet ready', body: `It holds ${usdc.toFixed(2)} USDC.` })
            onAdded?.(usdc)
            onClose()
          }}
        />
      </div>
    </Sheet>
  )
}
