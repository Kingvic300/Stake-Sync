import { createContext, useContext } from 'react'

export type WalletPath = 'connect' | 'local'

export interface Session {
  name: string
  username?: string
  email: string
  bio?: string
  /** Avatar URL from the API, or a data URL while a new photo uploads */
  avatar?: string
  onboarded: boolean
  walletPath?: WalletPath
  /** Verification accounts linked to this profile, by provider name (e.g. "GitHub") */
  connected?: string[]
  /** Wallets proven to belong to this account, primary first */
  wallets?: string[]
  /** The subset of `wallets` Stake-Sync created for this person (Privy), not connected ones */
  embeddedWallets?: string[]
  emailVerified?: boolean
  /** false: "Keep me logged in" was unticked, so the session ends with the browser tab */
  remember?: boolean
  /** From the API's sign-in */
  accessToken?: string
  refreshToken?: string
}

/** The signed-in person as the API returns them (GET /me). */
export interface ApiUser {
  id: string
  name: string
  handle: string
  email: string | null
  emailVerified: boolean
  avatarUrl: string | null
  bio: string | null
  onboarded: boolean
  fundingPreference: 'wallet' | 'local' | null
  connected: { provider: string; account: string; status: string }[]
  wallets: { address: string; kind: 'external' | 'embedded'; primary: boolean; verified: boolean }[]
}

/** What sign-up, log-in and social sign-in return. */
export interface AuthResult {
  accessToken: string
  refreshToken: string
  user: ApiUser
}

export type ProfileChanges = Partial<Pick<Session, 'name' | 'username' | 'bio' | 'avatar'>>

export interface AuthValue {
  session: Session | null
  /** True when signed in */
  live: boolean
  /** Starts a session from an API sign-in. `blankName` leaves the name for onboarding to ask. */
  applyAuth: (result: AuthResult, opts?: { remember?: boolean; blankName?: boolean }) => void
  /** Re-reads the profile from the API, e.g. after connecting an account. */
  refreshUser: () => Promise<void>
  setProfile: (name: string, username: string) => void
  /** Saves at once, then confirms with the API. Rejects with the API's message if it refuses. */
  updateProfile: (changes: ProfileChanges) => Promise<void>
  completeOnboarding: (walletPath: WalletPath) => void
  signOut: () => void
}

export const AuthContext = createContext<AuthValue | null>(null)

export function useAuth() {
  const v = useContext(AuthContext)
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>')
  return v
}

/** The signed-in person as an avatar or byline expects them. */
export function personOf(session: Session | null) {
  return { name: session?.name || 'You', handle: session?.username ?? '', hue: 230 }
}
