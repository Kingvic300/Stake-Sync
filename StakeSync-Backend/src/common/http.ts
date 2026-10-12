/**
 * Outbound HTTP for provider integrations. Failures are classified so the verification engine can
 * tell "the provider is down" (never the user's fault) from "the provider answered".
 */
export class ProviderUnavailable extends Error {
  constructor(
    public readonly provider: string,
    reason: string,
  ) {
    super(`${provider} unavailable: ${reason}`);
  }
}

/** The provider answered but rejected our credentials: the user must reconnect. */
export class ProviderAuthError extends Error {
  constructor(public readonly provider: string) {
    super(`${provider} rejected the stored credentials`);
  }
}

export interface FetchOpts extends RequestInit {
  timeoutMs?: number;
  provider?: string;
}

export async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const provider = opts.provider ?? new URL(url).host;
  let res: Response;
  try {
    res = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000) });
  } catch (e) {
    throw new ProviderUnavailable(provider, e instanceof Error ? e.message : 'network error');
  }
  if (res.status === 401 || res.status === 403) {
    // GitHub uses 403 for rate limits too.
    if (res.headers.get('x-ratelimit-remaining') === '0') throw new ProviderUnavailable(provider, 'rate limited');
    throw new ProviderAuthError(provider);
  }
  if (res.status === 429 || res.status >= 500) throw new ProviderUnavailable(provider, `HTTP ${res.status}`);
  if (!res.ok) throw new Error(`${provider} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}
