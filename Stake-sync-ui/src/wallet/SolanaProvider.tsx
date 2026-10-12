import type { WalletError } from '@solana/wallet-adapter-base'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { connectionConfig, endpoint } from './config'
import { WalletUiContext } from './context'
import { WalletModal } from './WalletModal'

function describe(e: WalletError) {
  if (e.name === 'WalletConnectionError' || /reject/i.test(e.message)) return 'The connection request was declined in your wallet.'
  if (e.name === 'WalletNotReadyError') return 'That wallet isn’t installed in this browser.'
  if (e.name === 'WalletWindowClosedError') return 'The wallet window was closed before connecting.'
  return e.message || 'The wallet couldn’t connect. Try again.'
}

/**
 * Wallet Standard wallets (Phantom, Solflare, Backpack and others) register themselves,
 * so no adapters are listed here. Mobile Wallet Adapter is added automatically on Android.
 */
export function SolanaProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onError = useCallback((e: WalletError) => setError(describe(e)), [])
  const ui = useMemo(
    () => ({
      openModal: () => {
        setError(null)
        setOpen(true)
      },
      closeModal: () => setOpen(false),
      error,
      clearError: () => setError(null),
    }),
    [error],
  )

  return (
    <ConnectionProvider endpoint={endpoint} config={connectionConfig}>
      <WalletProvider wallets={[]} autoConnect onError={onError}>
        <WalletUiContext.Provider value={ui}>
          {children}
          {open && <WalletModal onClose={() => setOpen(false)} />}
        </WalletUiContext.Provider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
