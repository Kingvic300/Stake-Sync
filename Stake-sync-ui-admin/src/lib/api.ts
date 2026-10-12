// Talks to the Stake-Sync API when VITE_API_URL is set.

const BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '')
export const apiEnabled = Boolean(BASE)

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

export interface Tokens {
  accessToken?: string
  refreshToken?: string
}

interface SessionBinding {
  get: () => Tokens | null
  update: (t: Required<Tokens>) => void
  expire: () => void
}

let binding: SessionBinding | null = null

/** The auth provider hands over its session so requests can sign and refresh themselves. */
export function bindSession(b: SessionBinding) {
  binding = b
}

let refreshing: Promise<boolean> | null = null

async function refresh() {
  const rt = binding?.get()?.refreshToken
  if (!rt) return false
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) })
    .then(async (r) => {
      if (!r.ok) return false
      const j = (await r.json()) as { accessToken: string; refreshToken: string }
      binding?.update({ accessToken: j.accessToken, refreshToken: j.refreshToken })
      return true
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

/**
 * JSON request with the admin's token. Refreshes once on an expired token, and turns every failure
 * into a plain sentence the page can show (never a raw status or stack).
 */
export async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string; signal?: AbortSignal; retried?: boolean } = {}): Promise<T> {
  if (!BASE) throw new ApiError('The admin API isn’t configured.', 'not_configured', 0)
  // An explicit token (even '') means this call manages its own auth, e.g. during sign-in.
  const explicit = opts.token !== undefined
  const token = explicit ? opts.token : binding?.get()?.accessToken
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError('We can’t reach the server. Check your connection and try again.', 'network', 0)
  }
  if (res.status === 401 && !explicit && !opts.retried && (await refresh())) return api<T>(path, { ...opts, retried: true })
  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => null)) as ({ code?: string; message?: string } & T) | null
  if (!res.ok) {
    if (res.status === 401 && !explicit) binding?.expire()
    throw new ApiError(data?.message ?? 'Something went wrong. Please try again.', data?.code ?? 'error', res.status)
  }
  return data as T
}

export async function apiBlob(path: string, opts: { signal?: AbortSignal; retried?: boolean } = {}): Promise<Blob> {
  if (!BASE) throw new ApiError('The admin API isn’t configured.', 'not_configured', 0)
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: binding?.get()?.accessToken ? { Authorization: `Bearer ${binding.get()!.accessToken}` } : {},
      signal: opts.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError('We can’t reach the server. Check your connection and try again.', 'network', 0)
  }
  if (res.status === 401 && !opts.retried && (await refresh())) return apiBlob(path, { ...opts, retried: true })
  if (!res.ok) {
    if (res.status === 401) binding?.expire()
    const data = (await res.json().catch(() => null)) as { message?: string; code?: string } | null
    throw new ApiError(data?.message ?? 'Something went wrong. Please try again.', data?.code ?? 'error', res.status)
  }
  return res.blob()
}
