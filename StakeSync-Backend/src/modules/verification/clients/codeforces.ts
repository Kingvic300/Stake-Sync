import { fetchJson, ProviderUnavailable } from '../../../common/http.js';

// Codeforces' official API is free and needs no key for public data. It allows about one call
// every two seconds, so calls are queued.
let chain: Promise<unknown> = Promise.resolve();
const gap = () => new Promise((r) => setTimeout(r, 2100));

function call<T>(method: string, params: Record<string, string>) {
  const run = async () => {
    const url = `https://codeforces.com/api/${method}?${new URLSearchParams(params)}`;
    const res = await fetchJson<{ status: 'OK' | 'FAILED'; result?: T; comment?: string }>(url, { provider: 'codeforces' });
    if (res.status !== 'OK') {
      if (res.comment?.includes('not found')) return null;
      throw new ProviderUnavailable('codeforces', res.comment ?? 'failed');
    }
    return res.result ?? null;
  };
  const next = chain.then(run, run);
  chain = next.then(gap, gap);
  return next as Promise<T | null>;
}

export interface CodeforcesUser {
  handle: string;
  firstName?: string;
  lastName?: string;
  organization?: string;
  registrationTimeSeconds: number;
}

export async function codeforcesUser(handle: string) {
  const r = await call<CodeforcesUser[]>('user.info', { handles: handle });
  return r?.[0] ?? null;
}

export interface CodeforcesSubmission {
  id: number;
  creationTimeSeconds: number;
  verdict?: string;
  problem: { contestId?: number; index: string; name: string; rating?: number };
}

/** Most recent submissions first. */
export async function codeforcesSubmissions(handle: string, count = 200) {
  return (await call<CodeforcesSubmission[]>('user.status', { handle, from: '1', count: String(count) })) ?? [];
}

export const problemKey = (p: CodeforcesSubmission['problem']) => `${p.contestId ?? 'x'}${p.index}`;
