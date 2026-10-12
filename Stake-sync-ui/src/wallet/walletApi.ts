import { api } from '../lib/api'

/** Makes a linked wallet the one stakes and payouts use. */
export const makeMainWallet = (address: string) => api(`/me/wallets/${encodeURIComponent(address)}/primary`, { method: 'POST' })

/** Unlinks a wallet. The API refuses while it still has money in a challenge. */
export const unlinkWallet = (address: string) => api(`/me/wallets/${encodeURIComponent(address)}`, { method: 'DELETE' })
