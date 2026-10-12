import { Transaction, VersionedTransaction, type Connection } from '@solana/web3.js'
import { api, ApiError } from '../lib/api'
import { cluster, newConnection } from './config'

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/** Signs a serialized transaction with the person's wallet and returns the signed bytes. */
export type SignBytes = (transaction: Uint8Array) => Promise<Uint8Array>

type StandardSign = {
  signTransaction: (...inputs: { account: unknown; chain: string; transaction: Uint8Array }[]) => Promise<{ signedTransaction: Uint8Array }[]>
}
type StandardWallet = { name?: string; accounts: { address: string; chains?: readonly string[] }[]; features: Record<string, unknown> }

/**
 * For wallet-adapter wallets (Phantom, Solflare, Backpack, MetaMask). Wallet Standard wallets are
 * told which network the transaction is for; the adapter's own signTransaction doesn't pass it, so
 * wallets like MetaMask would simulate a devnet transaction on mainnet and reject it.
 */
export function adapterSigner(signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>, adapter?: unknown, address?: string): SignBytes {
  const std = (adapter as { wallet?: StandardWallet } | undefined)?.wallet
  const feature = std?.features['solana:signTransaction'] as StandardSign | undefined
  const account = std?.accounts.find((a) => a.address === address)
  if (feature && account) {
    const chain = cluster === 'mainnet-beta' ? 'solana:mainnet' : `solana:${cluster}`
    return async (bytes) => {
      if (account.chains?.length && !account.chains.includes(chain)) {
        const net = chain === 'solana:mainnet' ? 'Solana Mainnet' : `Solana ${cluster[0].toUpperCase()}${cluster.slice(1)}`
        throw new ApiError(`${std?.name ?? 'Your wallet'} isn’t set up for ${net}. Turn on test networks in its settings (in MetaMask: Settings, Advanced, Show test networks), switch to ${net}, then try again.`, 'wallet_network', 0)
      }
      return (await feature.signTransaction({ account, chain, transaction: bytes }))[0].signedTransaction
    }
  }
  // Our API builds legacy transactions; swaps (Jupiter) are versioned.
  return async (bytes) => {
    const tx = VersionedTransaction.deserialize(bytes)
    if (tx.version === 'legacy') return (await signTransaction(Transaction.from(bytes))).serialize()
    return (await signTransaction(tx)).serialize()
  }
}

/**
 * Sends USDC from the person's wallet to another wallet. The API prepares the transaction (the
 * platform pays the network fee), the person's wallet signs it, and the API checks the result
 * on-chain before recording it.
 */
/**
 * Signs a transaction the API prepared (base64, already signed by the platform as fee payer) with
 * the person's wallet and sends it. Returns the signature for the API's confirm step.
 */
export async function signAndSubmit(transaction: string, sign: SignBytes, connection: Connection = newConnection()) {
  const signed = await sign(fromBase64(transaction))
  return connection.sendRawTransaction(signed)
}

export async function sendUsdc(to: string, amount: number, sign: SignBytes, connection: Connection = newConnection()) {
  const r = await api<{ sendId: string; transaction: string; to: string }>('/payments/send', { method: 'POST', body: { to, amount } })
  const signed = await sign(fromBase64(r.transaction))
  const signature = await connection.sendRawTransaction(signed)
  const done = await api<{ status: 'sent' | 'pending' }>('/payments/send/confirm', { method: 'POST', body: { sendId: r.sendId, to: r.to, signature } })
  return { signature, status: done.status }
}
