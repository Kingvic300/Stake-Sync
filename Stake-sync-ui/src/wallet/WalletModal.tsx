import { WalletReadyState, type WalletName } from '@solana/wallet-adapter-base'
import { useWallet } from '@solana/wallet-adapter-react'
import { ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Sheet } from '../components/Sheet'
import { cx } from '../lib/format'
import { gsap, prefersMotion, useGSAP } from '../lib/gsap'
import { useToast } from '../toast/context'
import { useWalletUi } from './context'

const popular = [
  {
    name: 'Phantom',
    install: 'https://phantom.com/download',
    open: (url: string) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(location.origin)}`,
    hue: 285,
  },
  {
    name: 'Solflare',
    install: 'https://solflare.com/download',
    open: (url: string) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(location.origin)}`,
    hue: 45,
  },
  { name: 'Backpack', install: 'https://backpack.app/downloads', open: null, hue: 15 },
]

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

export function WalletModal({ onClose }: { onClose: () => void }) {
  const { wallets, select, connected, connecting, wallet } = useWallet()
  const { error, clearError } = useWalletUi()
  const toast = useToast()
  const [pending, setPending] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)

  const detected = useMemo(
    () =>
      wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable),
    [wallets],
  )
  const missing = popular.filter((p) => !detected.some((w) => w.adapter.name === p.name))

  // Close once the chosen wallet reports connected.
  useEffect(() => {
    if (pending && connected && wallet?.adapter.name === pending) onClose()
  }, [pending, connected, wallet, onClose])

  // Wallet problems (rejected, locked, not installed) show as a toast.
  useEffect(() => {
    if (error) toast({ tone: 'error', title: 'Wallet not connected', body: error, inbox: false })
  }, [error, toast])

  const waiting = pending !== null && !error && (connecting || !connected)

  useGSAP(
    () => {
      if (!prefersMotion()) return
      gsap.from('[data-wallet-row]', { y: 10, autoAlpha: 0, duration: 0.35, stagger: 0.05, ease: 'power2.out', delay: 0.12, clearProps: 'all' })
    },
    { scope: list },
  )

  function choose(name: string) {
    clearError()
    setPending(name)
    select(name as WalletName)
  }

  return (
    <Sheet title="Connect a wallet" onClose={onClose} width={440}>
      <div ref={list}>
        <p className="text-[15px] text-slate">
          Your wallet asks you to approve the connection. Stake-Sync can see your address and balance, never move funds
          without your approval.
        </p>

        {detected.length > 0 && (
          <>
            <h3 className="mt-6 font-sans text-sm font-semibold text-slate">Detected in this browser</h3>
            <ul className="mt-2 space-y-2">
              {detected.map((w) => {
                const busy = waiting && pending === w.adapter.name
                return (
                  <li key={w.adapter.name} data-wallet-row>
                    <button
                      type="button"
                      onClick={() => choose(w.adapter.name)}
                      disabled={waiting}
                      className={cx(
                        'flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left ring-1 ring-inset transition-shadow disabled:cursor-default',
                        busy ? 'is-busy bg-cobalt-soft ring-cobalt' : 'bg-surface ring-line hover:ring-slate/40',
                      )}
                    >
                      <img src={w.adapter.icon} alt="" className="size-9 rounded-xl" />
                      <span className="flex-1 font-semibold">{w.adapter.name}</span>
                      {busy ? (
                        <span className="text-sm font-semibold text-cobalt-deep">Approve in your wallet</span>
                      ) : (
                        <span className="text-sm text-slate">Connect</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {missing.length > 0 && (
          <>
            <h3 className="mt-6 font-sans text-sm font-semibold text-slate">
              {detected.length ? 'Other wallets' : isMobile() ? 'Open Stake-Sync in your wallet app' : 'No wallet found. Install one to continue'}
            </h3>
            <ul className="mt-2 space-y-2">
              {missing.map((p) => {
                const href = isMobile() && p.open ? p.open(location.href) : p.install
                return (
                  <li key={p.name} data-wallet-row>
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 ring-1 ring-inset ring-line transition-shadow hover:ring-slate/40"
                    >
                      <span
                        aria-hidden
                        className="grid size-9 place-items-center rounded-xl font-display text-sm font-bold text-white"
                        style={{ background: `oklch(58% 0.17 ${p.hue})` }}
                      >
                        {p.name[0]}
                      </span>
                      <span className="flex-1 font-semibold">{p.name}</span>
                      <span className="inline-flex items-center gap-1.5 text-sm text-slate">
                        {isMobile() && p.open ? 'Open app' : 'Install'} <ExternalLink size={14} />
                      </span>
                    </a>
                  </li>
                )
              })}
            </ul>
            {!detected.length && !isMobile() && (
              <p className="mt-4 text-sm text-slate">After installing, refresh this page and your wallet will appear above.</p>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}
