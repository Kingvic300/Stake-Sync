import { clusterApiUrl, Connection, PublicKey, type Cluster, type ConnectionConfig, type FetchFn } from '@solana/web3.js'
import { network } from '../lib/network'

export const cluster: Cluster = network.cluster
export const endpoint: string = network.rpc || clusterApiUrl(cluster)

// A keyed RPC (e.g. Helius) may only accept requests from allowed origins: the deployed site, not
// localhost or a preview URL. A refused request is retried on the public endpoint for the cluster.
const publicRpc = clusterApiUrl(cluster)
const rpcFetch: FetchFn = async (input, init) => {
  const res = await fetch(input, init)
  if (endpoint === publicRpc || (res.status !== 401 && res.status !== 403)) return res
  return fetch(publicRpc, init)
}
export const connectionConfig: ConnectionConfig = { commitment: 'confirmed', fetch: rpcFetch }

/** For code outside the wallet provider (signing flows); same RPC and fallback. */
export const newConnection = () => new Connection(endpoint, connectionConfig)

// Circle's official USDC mints
const USDC: Partial<Record<Cluster, string>> = {
  'mainnet-beta': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
}
// VITE_USDC_MINT only overrides the network the single-network env vars point at.
const override = import.meta.env.VITE_SOLANA_CLUSTER === cluster ? import.meta.env.VITE_USDC_MINT : ''
export const usdcMint = new PublicKey(override || USDC[cluster] || USDC.devnet!)

export function shortAddress(a: string) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`
}
