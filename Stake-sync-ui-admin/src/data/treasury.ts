/** GET /admin/treasury. Money is in USD (USDC). */
export interface Treasury {
  cluster: string
  wallet: { address: string; explorer: string; usdc: number | null } | null
  /** The escrow program's own settings; null until it's deployed and set up. */
  program: { treasury: string; matches: boolean; admin: string; joinPercent: number; platformSharePercent: number; paused: boolean } | null
  fees: { joinPercent: number; platformSharePercent: number }
  totals: { allTime: number; last30: number; joinFees: number; forfeitShare: number; heldInEscrow: number; challenges: number }
  monthly: { month: string; joinFees: number; forfeitShare: number }[]
  recent: { id: string; title: string; settledAt: string | null; total: number; joinFees: number; forfeitShare: number; finishers: number }[]
}
