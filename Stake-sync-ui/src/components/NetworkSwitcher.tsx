import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cx } from '../lib/format'
import { network, NETWORKS, switchNetwork, type NetworkId } from '../lib/network'

const ORDER: NetworkId[] = ['devnet', 'mainnet']

/** Which Solana network the app uses. Each network has its own balances, challenges and sign-in. */
export function NetworkSwitcher() {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<NetworkId | null>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const close = () => {
    setOpen(false)
    setConfirm(null)
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Network: ${network.label}. Change network`}
        onClick={() => (open ? close() : setOpen(true))}
        className={cx(
          'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ring-1 transition-shadow',
          network.test ? 'bg-gold-soft text-gold-ink ring-gold/30 hover:ring-gold/60' : 'bg-surface ring-line hover:ring-slate/40',
        )}
      >
        <span className={cx('size-2 rounded-full', network.test ? 'bg-gold' : 'bg-calm')} aria-hidden />
        <span className="hidden sm:inline">{network.label}</span>
        <ChevronDown size={14} aria-hidden />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl bg-surface p-1.5 shadow-(--shadow-sheet) ring-1 ring-line/70">
          {confirm ? (
            <div className="p-3">
              <p className="font-semibold">Switch to {NETWORKS[confirm].label}?</p>
              <p className="mt-1 text-sm text-slate">
                {NETWORKS[confirm].test
                  ? 'Devnet uses free test money. Nothing there is worth real dollars.'
                  : 'Mainnet uses real USDC. Stakes and payouts are real money.'}{' '}
                Each network has its own sign-in, balance and challenges.
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setConfirm(null)} className="flex-1 rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-line hover:bg-ground">
                  Cancel
                </button>
                <button type="button" onClick={() => switchNetwork(confirm)} className="flex-1 rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-white hover:bg-ink/90">
                  Switch
                </button>
              </div>
            </div>
          ) : (
            ORDER.map((id) => {
              const n = NETWORKS[id]
              const current = id === network.id
              const available = Boolean(n.api)
              return (
                <button
                  key={id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  disabled={!available}
                  onClick={() => (current ? close() : setConfirm(id))}
                  className={cx('flex w-full items-start gap-3 rounded-xl p-3 text-left', available ? 'hover:bg-ground' : 'cursor-not-allowed opacity-60')}
                >
                  <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.test ? 'bg-gold' : 'bg-calm')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{n.label}</span>
                    <span className="block text-sm text-slate">{!available ? 'Coming soon' : n.test ? 'Test money, for trying things out' : 'Real USDC'}</span>
                  </span>
                  {current && <Check size={16} className="mt-1 text-cobalt" />}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
