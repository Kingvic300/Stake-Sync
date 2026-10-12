import { api, ApiError } from './api'

export type InviteInfo = { kind: 'challenge'; id: string; title: string; code: string } | { kind: 'org'; slug: string; name: string; code: string }

/** Looks up a challenge or organization invite code (GET /invites/:code). Rejects if it doesn't match. */
export function resolveInvite(raw: string) {
  return api<InviteInfo>(`/invites/${encodeURIComponent(raw.trim().toUpperCase())}`)
}

/** Resolves a code to its invite page, or null if it doesn't match anything open. Other failures reject. */
export async function inviteTarget(raw: string) {
  if (!raw.trim()) return null
  try {
    const r = await resolveInvite(raw)
    return r.kind === 'challenge' ? `/i/${r.code}` : `/join/${r.code}`
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}
