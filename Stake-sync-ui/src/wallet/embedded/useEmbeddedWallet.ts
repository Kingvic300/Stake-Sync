import { usePrivy } from '@privy-io/react-auth'
import { useWallets } from '@privy-io/react-auth/solana'
import { useEffect, useRef } from 'react'

type PrivyWallet = ReturnType<typeof useWallets>['wallets'][number]

const isEmbedded = (w: PrivyWallet) => Boolean((w.standardWallet as { isPrivyWallet?: boolean }).isPrivyWallet)

/** The person's Privy-created Solana wallet, once Privy has signed them in. */
export function useEmbeddedWallet() {
  const { ready, authenticated } = usePrivy()
  const { ready: walletsReady, wallets } = useWallets()
  const wallet = wallets.find(isEmbedded) ?? null
  const latest = useRef(wallet)
  useEffect(() => {
    latest.current = wallet
  })

  /** A just-created wallet shows up in Privy's list a moment later; this waits for it (up to 10 s). */
  async function waitFor(address: string) {
    for (let i = 0; i < 40; i++) {
      if (latest.current?.address === address) return latest.current
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error('wallet_not_ready')
  }

  return { ready: ready && (!authenticated || walletsReady), authenticated, wallet, waitFor }
}
