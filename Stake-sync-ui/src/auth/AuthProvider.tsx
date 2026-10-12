import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, apiEnabled, bindSession } from '../lib/api'
import { network } from '../lib/network'
import { reportError } from '../lib/report'
import { AuthContext, type ApiUser, type AuthResult, type ProfileChanges, type Session, type WalletPath } from './context'

// The session holds the API tokens plus a copy of the profile so screens render at once.
// One session per network: each network has its own API and accounts.
const KEY = `stakesync.session.${network.id}`
const LEGACY = 'stakesync.session'

function load(): Session | null {
  try {
    // Sessions saved before networks existed belong to the devnet API.
    const legacy = network.id === 'devnet' ? (localStorage.getItem(LEGACY) ?? sessionStorage.getItem(LEGACY)) : null
    const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY) ?? legacy
    const s = raw ? (JSON.parse(raw) as Session) : null
    // Sessions without tokens are from the old offline demo; they can't call the API.
    return s?.accessToken ? s : null
  } catch {
    return null
  }
}

function save(s: Session | null) {
  try {
    localStorage.removeItem(KEY)
    sessionStorage.removeItem(KEY)
    localStorage.removeItem(LEGACY)
    sessionStorage.removeItem(LEGACY)
    // "Keep me logged in" unticked: forget the session when the tab closes.
    if (s) (s.remember === false ? sessionStorage : localStorage).setItem(KEY, JSON.stringify(s))
  } catch {
    // storage blocked: session lasts for this tab only
  }
}

/** The profile fields of a session, from what the API says about this person. */
function fromUser(u: ApiUser, base: Partial<Session> = {}): Session {
  return {
    ...base,
    // A new email account picks its display name during onboarding.
    name: !u.onboarded && base.name === '' ? '' : u.name,
    username: u.handle,
    email: u.email ?? '',
    emailVerified: u.emailVerified,
    bio: u.bio ?? undefined,
    avatar: u.avatarUrl ?? undefined,
    onboarded: u.onboarded,
    walletPath: u.fundingPreference === 'wallet' ? 'connect' : u.fundingPreference === 'local' ? 'local' : base.walletPath,
    connected: u.connected.filter((c) => c.status !== 'revoked').map((c) => c.provider),
    wallets: u.wallets.filter((w) => w.verified).map((w) => w.address),
    embeddedWallets: u.wallets.filter((w) => w.verified && w.kind === 'embedded').map((w) => w.address),
  }
}

async function dataUrlFile(url: string) {
  const blob = await (await fetch(url)).blob()
  return new File([blob], 'avatar.jpg', { type: blob.type || 'image/jpeg' })
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(load)

  const update = useCallback((s: Session | null) => {
    save(s)
    setSession(s)
  }, [])

  // API requests read the latest tokens from storage and refresh them in place. Bound during the
  // first render, before any child's effects run, so their first requests already carry the token.
  const updateRef = useRef(update)
  useEffect(() => {
    updateRef.current = update
  }, [update])
  useState(() =>
    bindSession({
      get: load,
      update: (tokens) => {
        const s = load()
        if (s) updateRef.current({ ...s, ...tokens })
      },
      expire: () => updateRef.current(null),
    }),
  )

  /** Merges the API's view of the profile into whatever session is current now. */
  const sync = useCallback(
    (u: ApiUser) => {
      const s = load()
      if (s?.accessToken) update(fromUser(u, s))
    },
    [update],
  )

  const refreshUser = useCallback(async () => {
    if (!apiEnabled || !load()?.accessToken) return
    sync(await api<ApiUser>('/me'))
  }, [sync])

  // Pick up changes made on another device since this session was saved.
  useEffect(() => {
    if (!apiEnabled || !load()?.accessToken) return
    api<ApiUser>('/me')
      .then(sync)
      .catch(() => {
        // Offline or signed out elsewhere: the saved copy stays until the next request decides.
      })
  }, [sync])

  const value = useMemo(() => {
    const live = apiEnabled && Boolean(session?.accessToken)

    async function updateProfile(changes: ProfileChanges) {
      if (!session) return
      const before = session
      update({ ...session, ...changes })
      if (!live) return
      try {
        const body: Record<string, string> = {}
        if (changes.name !== undefined && changes.name !== before.name) body.name = changes.name
        if (changes.username !== undefined && changes.username !== before.username) body.handle = changes.username
        if (changes.bio !== undefined && changes.bio !== (before.bio ?? '')) body.bio = changes.bio
        if (Object.keys(body).length) sync(await api<ApiUser>('/me', { method: 'PATCH', body }))
        if (changes.avatar?.startsWith('data:')) {
          const form = new FormData()
          form.append('file', await dataUrlFile(changes.avatar))
          sync(await api<ApiUser>('/me/avatar', { method: 'POST', body: form }))
        }
        // Removed in the editor: delete it on the server too.
        if ('avatar' in changes && !changes.avatar && before.avatar) sync(await api<ApiUser>('/me/avatar', { method: 'DELETE' }))
      } catch (e) {
        // Put back what the server has, and let the screen say why.
        const s = load()
        if (s) update({ ...s, name: before.name, username: before.username, bio: before.bio, avatar: before.avatar })
        throw e
      }
    }

    return {
      session,
      live,
      applyAuth: (r: AuthResult, opts: { remember?: boolean; blankName?: boolean } = {}) =>
        update({
          ...fromUser(r.user, { name: opts.blankName ? '' : undefined }),
          remember: opts.remember,
          accessToken: r.accessToken,
          refreshToken: r.refreshToken,
        }),
      refreshUser,
      setProfile: (name: string, username: string) => session && update({ ...session, name, username }),
      updateProfile,
      completeOnboarding: (walletPath: WalletPath) => {
        if (!session) return
        update({ ...session, onboarded: true, walletPath })
        // If this doesn't land, the next sign-in simply offers onboarding again.
        api<ApiUser>('/me', { method: 'PATCH', body: { onboarded: true, fundingPreference: walletPath === 'connect' ? 'wallet' : 'local' } })
          .then(sync)
          .catch((e) => reportError(e, { where: 'complete onboarding' }))
      },
      signOut: () => {
        // End the session on the server too, so a copied token stops working. Signing out never waits on it.
        api('/auth/logout', { method: 'POST' }).catch(() => {})
        update(null)
      },
    }
  }, [session, update, sync, refreshUser])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
