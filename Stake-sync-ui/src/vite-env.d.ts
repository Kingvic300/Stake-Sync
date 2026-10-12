/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_DEVNET_API_URL?: string
  readonly VITE_MAINNET_API_URL?: string
  readonly VITE_DEVNET_RPC?: string
  readonly VITE_MAINNET_RPC?: string
  readonly VITE_ONRAMP_ENABLED?: string
  /** Privy app ID; turns on wallets created for people (embedded wallets) */
  readonly VITE_PRIVY_APP_ID?: string
  readonly VITE_SOLANA_CLUSTER?: string
  readonly VITE_SOLANA_RPC?: string
  /** Jupiter swap API base (SOL to USDC on mainnet); defaults to the free lite API */
  readonly VITE_JUPITER_API?: string
  readonly VITE_USDC_MINT?: string
  readonly VITE_POSE_MODEL_URL?: string
}
