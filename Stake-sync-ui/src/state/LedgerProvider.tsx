import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/context'
import { api } from '../lib/api'
import { LedgerContext } from './ledger-context'

const round = (n: number) => Math.round(n * 100) / 100

interface WalletSummary {
  /** null when the API couldn't read the main wallet from the chain */
  available: number | null
  locked: number
  claimable: number
  forfeited: number
  lifetimeRewards: number
  wallets: { address: string; usdc: number | null }[]
}

export function LedgerProvider({ children }: { children: ReactNode }) {
  const { live } = useAuth()
  const [s, set] = useState({ available: 0, locked: 0, claimable: 0, forfeited: 0, lifetimeRewards: 0 })
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [walletBalances, setWalletBalances] = useState<Record<string, number | null>>({})
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  // Balances from the API once signed in.
  useEffect(() => {
    if (!live) return
    let alive = true
    api<WalletSummary>('/payments/wallet')
      .then((w) => {
        if (!alive) return
        set((v) => ({ available: w.available ?? v.available, locked: w.locked, claimable: w.claimable, forfeited: w.forfeited, lifetimeRewards: w.lifetimeRewards }))
        setWalletBalances(Object.fromEntries(w.wallets.map((x) => [x.address, x.usdc])))
        setFailed(w.available === null)
        setLoaded(true)
      })
      .catch(() => {
        // Keep the last numbers; the wallet screen offers a retry.
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [live, tick])

  const value = useMemo(
    () => ({
      ...s,
      ready: loaded,
      failed,
      walletBalances,
      refresh,
      add: (usdc: number) => set((v) => ({ ...v, available: round(v.available + usdc) })),
      fund: (usdc: number) => set((v) => ({ ...v, available: round(v.available - usdc) })),
    }),
    [s, loaded, failed, walletBalances, refresh],
  )

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>
}
