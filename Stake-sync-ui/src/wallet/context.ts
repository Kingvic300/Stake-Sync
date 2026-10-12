import { createContext, useContext } from 'react'

export interface WalletUi {
  openModal: () => void
  closeModal: () => void
  error: string | null
  clearError: () => void
}

export const WalletUiContext = createContext<WalletUi | null>(null)

export function useWalletUi() {
  const v = useContext(WalletUiContext)
  if (!v) throw new Error('useWalletUi must be used inside <SolanaProvider>')
  return v
}
