import { LAMPORTS_PER_SOL, type PublicKey } from '@solana/web3.js'
import { usdcMint } from './config'

// Jupiter's free swap API (no key). VITE_JUPITER_API switches to another base, e.g. the keyed one.
const BASE = (import.meta.env.VITE_JUPITER_API || 'https://lite-api.jup.ag/swap/v1').replace(/\/$/, '')
const WSOL = 'So11111111111111111111111111111111111111112'

/** SOL kept back for network fees and account deposits, so a swap never empties the wallet. */
export const SOL_RESERVE = 0.01

export interface SwapQuote {
  /** USDC the person gets at the quoted price */
  usdc: number
  /** The least they'll get once slippage is allowed for */
  minUsdc: number
  raw: unknown
}

export async function quoteSolToUsdc(sol: number): Promise<SwapQuote> {
  const lamports = Math.floor(sol * LAMPORTS_PER_SOL)
  const res = await fetch(`${BASE}/quote?inputMint=${WSOL}&outputMint=${usdcMint.toBase58()}&amount=${lamports}&slippageBps=50`)
  if (!res.ok) throw new Error('quote_failed')
  const q = (await res.json()) as { outAmount: string; otherAmountThreshold: string }
  return { usdc: Number(q.outAmount) / 1e6, minUsdc: Number(q.otherAmountThreshold) / 1e6, raw: q }
}

/** The swap as an unsigned transaction (base64) for the person's wallet to sign; they pay its fee in SOL. */
export async function buildSwap(quote: SwapQuote, owner: PublicKey) {
  const res = await fetch(`${BASE}/swap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteResponse: quote.raw, userPublicKey: owner.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 'auto' }),
  })
  if (!res.ok) throw new Error('swap_failed')
  return ((await res.json()) as { swapTransaction: string }).swapTransaction
}
