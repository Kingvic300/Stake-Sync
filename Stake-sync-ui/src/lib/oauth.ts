import { api } from './api'

export type OAuthProvider = 'google' | 'github' | 'wakatime'

/**
 * Sends the browser to the provider's consent page. It comes back to /auth/callback/:provider,
 * which finishes the sign-in (mode "login") or links the account (mode "connect").
 */
export async function startOAuth(provider: OAuthProvider, mode: 'login' | 'connect', opts: { acceptTerms?: boolean; redirect?: string } = {}) {
  const q = new URLSearchParams({ mode })
  if (opts.redirect) q.set('redirect', opts.redirect)
  if (opts.acceptTerms) q.set('acceptTerms', 'true')
  // Signing in starts signed out; connecting needs the person's token.
  const { url } = await api<{ url: string }>(`/auth/oauth/${provider}/start?${q}`, mode === 'login' ? { token: '' } : {})
  window.location.assign(url)
}
