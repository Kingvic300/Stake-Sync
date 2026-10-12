import { PrivyProvider, useSubscribeToJwtAuthWithFlag } from '@privy-io/react-auth'
import { useCallback, type ReactNode } from 'react'
import { useAuth } from '../../auth/context'
import { api } from '../../lib/api'

/**
 * Privy, signed in with Stake-Sync's own session (no second login). Privy holds the wallet key in
 * an isolated frame; Stake-Sync never sees it, and the person can export it any time.
 */
export function EmbeddedProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID!}
      config={{
        appearance: { walletChainType: 'solana-only' },
        // Created on request in the add-money flow, never silently.
        embeddedWallets: { ethereum: { createOnLogin: 'off' }, solana: { createOnLogin: 'off' } },
      }}
    >
      <SessionBridge />
      {children}
    </PrivyProvider>
  )
}

/** Hands Privy a short-lived token from our API whenever someone is signed in. */
function SessionBridge() {
  const signedIn = Boolean(useAuth().session?.accessToken)
  const getExternalJwt = useCallback(async () => {
    try {
      return (await api<{ token: string }>('/auth/wallet-token', { method: 'POST' })).token
    } catch {
      return undefined // signed out or offline: Privy treats it as signed out
    }
  }, [])
  useSubscribeToJwtAuthWithFlag({ isAuthenticated: signedIn, isLoading: false, getExternalJwt })
  return null
}
