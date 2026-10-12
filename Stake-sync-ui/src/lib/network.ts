import type { Cluster } from '@solana/web3.js'

/**
 * Stake-Sync runs one API per Solana network, because escrows, balances and accounts live on that
 * network. Switching networks points the app at the other API and its RPC, with a separate sign-in.
 *
 * Configure with VITE_DEVNET_API_URL / VITE_MAINNET_API_URL (and VITE_DEVNET_RPC / VITE_MAINNET_RPC).
 * VITE_API_URL + VITE_SOLANA_CLUSTER (+ VITE_SOLANA_RPC) still work for a single network.
 */
export type NetworkId = 'devnet' | 'mainnet'

export interface Network {
  id: NetworkId
  label: string
  cluster: Cluster
  /** Empty when this network isn't available yet */
  api: string
  rpc: string
  /** Test money: shown so nobody mistakes it for real dollars */
  test: boolean
}

const env = import.meta.env
const single: NetworkId = env.VITE_SOLANA_CLUSTER === 'mainnet-beta' ? 'mainnet' : 'devnet'
const trim = (u?: string) => (u ?? '').replace(/\/$/, '')

export const NETWORKS: Record<NetworkId, Network> = {
  devnet: {
    id: 'devnet',
    label: 'Devnet',
    cluster: 'devnet',
    api: trim(env.VITE_DEVNET_API_URL || (single === 'devnet' ? env.VITE_API_URL : '')),
    rpc: env.VITE_DEVNET_RPC || (single === 'devnet' ? env.VITE_SOLANA_RPC : '') || '',
    test: true,
  },
  mainnet: {
    id: 'mainnet',
    label: 'Mainnet',
    cluster: 'mainnet-beta',
    api: trim(env.VITE_MAINNET_API_URL || (single === 'mainnet' ? env.VITE_API_URL : '')),
    rpc: env.VITE_MAINNET_RPC || (single === 'mainnet' ? env.VITE_SOLANA_RPC : '') || '',
    test: false,
  },
}

const KEY = 'stakesync.network'

function stored(): NetworkId | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'devnet' || v === 'mainnet' ? v : null
  } catch {
    return null
  }
}

function pick(): Network {
  const want = stored()
  if (want && NETWORKS[want].api) return NETWORKS[want]
  if (NETWORKS[single].api) return NETWORKS[single]
  return NETWORKS.devnet.api ? NETWORKS.devnet : NETWORKS.mainnet
}

/** The network this page load uses. Changing it reloads the app. */
export const network = pick()

export function switchNetwork(id: NetworkId) {
  if (id === network.id || !NETWORKS[id].api) return
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Storage blocked: the switch can't persist, so there's nothing to reload into.
    return
  }
  window.location.assign('/overview')
}
