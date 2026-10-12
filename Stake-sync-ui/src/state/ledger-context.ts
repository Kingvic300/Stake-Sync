import { createContext, useContext } from 'react'

/**
 * The person's money as the app shows it, from GET /payments/wallet
 * (their own wallet's USDC plus what's in escrow).
 */
export interface Ledger {
  /** False until the first read lands, so screens show a skeleton instead of a wrong number */
  ready: boolean
  /** The last read failed (API or chain unreachable), so `available` may be out of date */
  failed: boolean
  /** USDC in each linked wallet by address; null when that wallet couldn't be read */
  walletBalances: Record<string, number | null>
  /** Re-reads the balances, e.g. after money arrives or leaves */
  refresh: () => void
  /** USDC in the main wallet: what stakes and transfers can use */
  available: number
  locked: number
  claimable: number
  forfeited: number
  lifetimeRewards: number
  add: (usdc: number) => void
  fund: (usdc: number) => void
}

export const LedgerContext = createContext<Ledger | null>(null)

export function useLedger() {
  const v = useContext(LedgerContext)
  if (!v) throw new Error('useLedger must be used inside <LedgerProvider>')
  return v
}
