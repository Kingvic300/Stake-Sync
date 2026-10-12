import { fetchJson } from '../../../common/http.js';

// GitHub's API is free: 5,000 requests an hour per connected user token.
const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Stake-Sync',
  'X-GitHub-Api-Version': '2022-11-28',
});

export interface QualifyingCommit {
  sha: string;
  repo: string;
  message: string;
  at: Date;
  changed: number;
}

export interface QualifyingPr {
  url: string;
  repo: string;
  title: string;
  at: Date;
  merged: boolean;
}

/** Repositories the person contributed commits to in (roughly) this window. */
async function activeRepos(token: string, login: string, from: Date, to: Date) {
  const query = `query($login:String!,$from:DateTime!,$to:DateTime!){
    user(login:$login){ contributionsCollection(from:$from,to:$to){
      commitContributionsByRepository(maxRepositories:25){ repository{ nameWithOwner } contributions(first:1){ totalCount } }
    } } }`;
  // Contribution days follow the person's GitHub timezone, so widen by a day each side, then
  // filter commits by exact timestamps below.
  const res = await fetchJson<{ data?: { user: { contributionsCollection: { commitContributionsByRepository: { repository: { nameWithOwner: string } }[] } } | null } }>(
    'https://api.github.com/graphql',
    {
      method: 'POST',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { login, from: new Date(from.getTime() - 86_400_000).toISOString(), to: new Date(to.getTime() + 86_400_000).toISOString() } }),
      provider: 'github',
    },
  );
  return res.data?.user?.contributionsCollection.commitContributionsByRepository.map((r) => r.repository.nameWithOwner) ?? [];
}

/**
 * Commits authored in [from, to) that change at least `minChanged` lines, excluding merges.
 * Empty and formatting-only commit spam doesn't count (PRD §31).
 */
export interface CommitFilter {
  /** File extensions that count, e.g. [".rs"]; empty = all */
  extensions?: string[];
  /** Path prefixes that count, e.g. ["src/"]; empty = all */
  paths?: string[];
  /** Stop once this many qualifying commits are found */
  enough?: number;
}

/** Whether a changed file counts under the challenge's language and path rules. */
export function fileCounts(name: string, f: CommitFilter) {
  const ext = !f.extensions?.length || f.extensions.some((e) => name.toLowerCase().endsWith(e));
  const path = !f.paths?.length || f.paths.some((p) => (p.endsWith('/') ? name.startsWith(p) : name === p || name.startsWith(`${p}/`)));
  return ext && path;
}

export async function qualifyingCommits(token: string, login: string, from: Date, to: Date, minChanged: number, onlyRepo?: string, filter: CommitFilter = {}): Promise<QualifyingCommit[]> {
  const repos = onlyRepo ? [onlyRepo] : await activeRepos(token, login, from, to);
  const out: QualifyingCommit[] = [];
  for (const repo of repos.slice(0, 15)) {
    const list = await fetchJson<{ sha: string; commit: { message: string; author: { date: string } }; parents: unknown[] }[]>(
      `https://api.github.com/repos/${repo}/commits?${new URLSearchParams({ author: login, since: from.toISOString(), until: to.toISOString(), per_page: '20' })}`,
      { headers: headers(token), provider: 'github' },
    ).catch((e: unknown) => {
      // A repo that was deleted or made private since doesn't fail the whole check.
      if (e instanceof Error && /HTTP (404|409)/.test(e.message)) return [];
      throw e;
    });
    for (const c of list.filter((c) => c.parents.length <= 1).slice(0, 8)) {
      const detail = await fetchJson<{ stats?: { additions: number; deletions: number }; files?: { changes: number; filename: string }[] }>(
        `https://api.github.com/repos/${repo}/commits/${c.sha}`,
        { headers: headers(token), provider: 'github' },
      );
      // Lockfiles and generated files don't count toward "meaningful" changes.
      const changed = (detail.files ?? [])
        .filter((f) => !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|.*\.min\.(js|css))$/.test(f.filename) && fileCounts(f.filename, filter))
        .reduce((s, f) => s + f.changes, 0);
      if (changed >= minChanged) {
        out.push({ sha: c.sha, repo, message: c.commit.message.split('\n')[0].slice(0, 120), at: new Date(c.commit.author.date), changed });
      }
    }
    if (out.length >= Math.max(5, filter.enough ?? 0)) break; // enough evidence for one period
  }
  return out;
}

export async function pullRequests(token: string, login: string, from: Date, to: Date, mergedOnly: boolean, onlyRepo?: string): Promise<QualifyingPr[]> {
  const range = `${from.toISOString().slice(0, 19)}Z..${to.toISOString().slice(0, 19)}Z`;
  const q = [`author:${login}`, 'type:pr', mergedOnly ? `merged:${range}` : `created:${range}`, onlyRepo ? `repo:${onlyRepo}` : ''].filter(Boolean).join(' ');
  const res = await fetchJson<{ items: { html_url: string; title: string; created_at: string; repository_url: string; pull_request?: { merged_at: string | null } }[] }>(
    `https://api.github.com/search/issues?${new URLSearchParams({ q, per_page: '30' })}`,
    { headers: headers(token), provider: 'github' },
  );
  return res.items.map((i) => ({
    url: i.html_url,
    repo: i.repository_url.split('/repos/')[1],
    title: i.title.slice(0, 120),
    at: new Date(i.pull_request?.merged_at ?? i.created_at),
    merged: Boolean(i.pull_request?.merged_at),
  }));
}
