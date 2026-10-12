import { fetchJson, ProviderUnavailable } from '../../../common/http.js';

// LeetCode has no official API. Its public GraphQL endpoint is free and needs no key, but it is
// unofficial: if it changes or blocks us, checks become "unavailable" (never a miss) and an admin
// can declare an outage.
const URL_ = 'https://leetcode.com/graphql';

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetchJson<{ data?: T; errors?: { message: string }[] }>(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://leetcode.com', 'User-Agent': 'Mozilla/5.0 (compatible; Stake-Sync)' },
    body: JSON.stringify({ query, variables }),
    provider: 'leetcode',
  });
  if (!res.data) throw new ProviderUnavailable('leetcode', res.errors?.[0]?.message ?? 'empty response');
  return res.data;
}

export interface LeetCodeProfile {
  username: string;
  aboutMe: string;
  solved: { All: number; Easy: number; Medium: number; Hard: number };
}

export async function leetcodeProfile(username: string): Promise<LeetCodeProfile | null> {
  const d = await gql<{
    matchedUser: null | { username: string; profile: { aboutMe: string | null; realName: string | null }; submitStatsGlobal: { acSubmissionNum: { difficulty: string; count: number }[] } };
  }>(
    `query($u:String!){ matchedUser(username:$u){ username profile{ aboutMe realName } submitStatsGlobal{ acSubmissionNum{ difficulty count } } } }`,
    { u: username },
  );
  if (!d.matchedUser) return null;
  const counts = Object.fromEntries(d.matchedUser.submitStatsGlobal.acSubmissionNum.map((x) => [x.difficulty, x.count]));
  return {
    username: d.matchedUser.username,
    // The profile's "ReadMe" (formerly Summary / About me), plus the display name as a fallback.
    aboutMe: `${d.matchedUser.profile.aboutMe ?? ''}\n${d.matchedUser.profile.realName ?? ''}`,
    solved: { All: counts.All ?? 0, Easy: counts.Easy ?? 0, Medium: counts.Medium ?? 0, Hard: counts.Hard ?? 0 },
  };
}

export interface AcceptedSubmission {
  id: string;
  title: string;
  titleSlug: string;
  at: Date;
}

/** The most recent accepted submissions (LeetCode returns at most 20). */
export async function leetcodeRecentAccepted(username: string): Promise<AcceptedSubmission[]> {
  const d = await gql<{ recentAcSubmissionList: { id: string; title: string; titleSlug: string; timestamp: string }[] | null }>(
    `query($u:String!,$n:Int!){ recentAcSubmissionList(username:$u, limit:$n){ id title titleSlug timestamp } }`,
    { u: username, n: 20 },
  );
  return (d.recentAcSubmissionList ?? []).map((s) => ({ id: s.id, title: s.title, titleSlug: s.titleSlug, at: new Date(Number(s.timestamp) * 1000) }));
}

const difficultyCache = new Map<string, string>();

export async function leetcodeDifficulty(slug: string) {
  const hit = difficultyCache.get(slug);
  if (hit) return hit;
  const d = await gql<{ question: { difficulty: string } | null }>(`query($s:String!){ question(titleSlug:$s){ difficulty } }`, { s: slug });
  const diff = d.question?.difficulty ?? 'Easy';
  difficultyCache.set(slug, diff);
  return diff;
}

export interface LeetCodeQuestion {
  slug: string;
  title: string;
  difficulty: string;
  url: string;
}

const questionCache = new Map<string, LeetCodeQuestion>();

/** Title and difficulty of a problem, for reminders and the challenge page. */
export async function leetcodeQuestion(slug: string): Promise<LeetCodeQuestion> {
  const hit = questionCache.get(slug);
  if (hit) return hit;
  const d = await gql<{ question: { title: string; difficulty: string } | null }>(`query($s:String!){ question(titleSlug:$s){ title difficulty } }`, { s: slug });
  const q = { slug, title: d.question?.title ?? slug, difficulty: d.question?.difficulty ?? 'Unknown', url: `https://leetcode.com/problems/${slug}/` };
  if (d.question) questionCache.set(slug, q);
  return q;
}

const dailyCache = new Map<string, string>();

/** LeetCode's official daily question for a UTC date (YYYY-MM-DD), as a problem slug. */
export async function leetcodeDailySlug(date: string): Promise<string | null> {
  const hit = dailyCache.get(date);
  if (hit) return hit;
  const [year, month] = date.split('-').map(Number);
  const d = await gql<{ dailyCodingChallengeV2: { challenges: { date: string; question: { titleSlug: string } }[] } | null }>(
    `query($y:Int!,$m:Int!){ dailyCodingChallengeV2(year:$y, month:$m){ challenges{ date question{ titleSlug } } } }`,
    { y: year, m: month },
  );
  for (const c of d.dailyCodingChallengeV2?.challenges ?? []) dailyCache.set(c.date, c.question.titleSlug);
  if (!dailyCache.has(date)) {
    // The current month's list can lag a day; today's question has its own query.
    const t = await gql<{ activeDailyCodingChallengeQuestion: { date: string; question: { titleSlug: string } } | null }>(
      `query{ activeDailyCodingChallengeQuestion{ date question{ titleSlug } } }`,
      {},
    );
    const a = t.activeDailyCodingChallengeQuestion;
    if (a) dailyCache.set(a.date, a.question.titleSlug);
  }
  return dailyCache.get(date) ?? null;
}
