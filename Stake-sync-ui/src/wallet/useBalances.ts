import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { LAMPORTS_PER_SOL, type Connection, type PublicKey } from '@solana/web3.js'
import { useCallback, useEffect, useState } from 'react'
import { usdcMint } from './config'

export interface Balances {
  usdc: number | null
  sol: number | null
  loading: boolean
  error: string | null
  refresh: () => void
}

async function read(connection: Connection, owner: PublicKey) {
  const [lamports, tokens] = await Promise.all([connection.getBalance(owner), connection.getParsedTokenAccountsByOwner(owner, { mint: usdcMint })])
  const usdc = tokens.value.reduce((sum, t) => sum + (t.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0)
  return { usdc, sol: lamports / LAMPORTS_PER_SOL }
}

/** Live USDC and SOL balances for the connected wallet. */
export function useBalances(): Balances {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  // `owner` ties the numbers to a wallet, so switching wallets never shows the previous one's balance.
  const [state, setState] = useState<Omit<Balances, 'refresh'> & { owner: string | null }>({ owner: null, usdc: null, sol: null, loading: false, error: null })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!publicKey) return
    let alive = true
    const owner = publicKey.toBase58()
    read(connection, publicKey)
      .then(({ usdc, sol }) => alive && setState({ owner, usdc, sol, loading: false, error: null }))
      .catch(() => alive && setState({ owner, usdc: null, sol: null, loading: false, error: 'Couldn’t read your balance. Check your connection.' }))
    return () => {
      alive = false
    }
  }, [connection, publicKey, tick])

  const refresh = useCallback(() => setTick((t) => t + 1), [])
  if (!publicKey) return { usdc: null, sol: null, loading: false, error: null, refresh }
  if (state.owner !== publicKey.toBase58()) return { usdc: null, sol: null, loading: true, error: null, refresh }
  return { usdc: state.usdc, sol: state.sol, loading: state.usdc === null && !state.error, error: state.error, refresh }
}
