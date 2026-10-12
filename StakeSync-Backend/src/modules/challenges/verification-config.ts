import { PublicKey } from '@solana/web3.js';
import { AppError } from '../../common/errors.js';
import type { VerificationConfig } from './entities/challenge.entities.js';

type Raw = Record<string, unknown>;

const bad = (what: string) => new AppError('invalid_verification', `Check the verification settings: ${what}.`);
const obj = (v: unknown): Raw | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : undefined);
const int = (v: unknown, min: number, max: number, what: string) => {
  if (v === undefined) return undefined;
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw bad(`${what} must be a whole number from ${min} to ${max}`);
  return v as number;
};
const bool = (v: unknown, what: string) => {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw bad(`${what} must be true or false`);
  return v;
};
const oneOf = <T extends string>(v: unknown, options: readonly T[], what: string) => {
  if (v === undefined) return undefined;
  if (!options.includes(v as T)) throw bad(`${what} must be one of ${options.join(', ')}`);
  return v as T;
};
const strip = <T extends Raw>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/**
 * Creators send verification settings as JSON. Only known fields with valid values are kept, so
 * nothing unexpected reaches provider URLs (a repo name goes into GitHub API paths) or the
 * rules document.
 */
export function sanitizeVerificationConfig(input: unknown): VerificationConfig {
  const c = obj(input) ?? {};
  const out: VerificationConfig = {};
  const gh = obj(c.github);
  if (gh) {
    const repo = gh.repo;
    if (repo !== undefined && (typeof repo !== 'string' || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo) || repo.includes('..'))) {
      throw bad('GitHub repository must look like owner/name');
    }
    out.github = strip({
      minChangedLines: int(gh.minChangedLines, 1, 500, 'Minimum changed lines'),
      countPullRequests: bool(gh.countPullRequests, 'Count pull requests'),
      mergedOnly: bool(gh.mergedOnly, 'Merged only'),
      repo: repo as string | undefined,
      minCommits: int(gh.minCommits, 1, 20, 'Commits a day'),
      languages: list(gh.languages, 5, /^[A-Za-z+#.]{1,20}$/, 'Languages', (v) => GITHUB_LANGUAGES[v.toLowerCase()] !== undefined),
      paths: list(gh.paths, 5, /^[A-Za-z0-9_./-]{1,100}$/, 'Paths', (v) => !v.includes('..')),
    });
  }
  const sol = obj(c.solana);
  if (sol) {
    let programId: string | undefined;
    if (sol.programId !== undefined) {
      try {
        if (typeof sol.programId !== 'string') throw new Error('not a string');
        programId = new PublicKey(sol.programId).toBase58();
      } catch {
        throw bad('Program id must be a Solana address');
      }
    }
    // Missing fields fall back to defaults that depend on the challenge mode (see ChallengesService).
    out.solana = strip({
      cluster: oneOf(sol.cluster, ['mainnet-beta', 'devnet'] as const, 'Network'),
      activity: oneOf(sol.activity, ['deploy', 'transaction', 'program'] as const, 'Activity'),
      programId,
    }) as VerificationConfig['solana'];
    if (out.solana?.activity === 'program' && !programId) throw bad('choose the program people must use');
  }
  const lc = obj(c.leetcode);
  if (lc) {
    out.leetcode = strip({
      newOnly: bool(lc.newOnly, 'New problems only') ?? true,
      minDifficulty: oneOf(lc.minDifficulty, ['Easy', 'Medium', 'Hard'] as const, 'Minimum difficulty'),
      minMediumHard: int(lc.minMediumHard, 0, 1000, 'Medium/Hard minimum'),
      assigned: oneOf(lc.assigned, ['daily', 'list'] as const, 'Problems'),
      schedule: lc.schedule === undefined ? undefined : problemSchedule(lc.schedule),
    });
    if (out.leetcode.assigned === 'list' && !out.leetcode.schedule) throw bad('add the problems for each day');
    if (out.leetcode.assigned !== 'list') delete out.leetcode.schedule;
  }
  const cf = obj(c.codeforces);
  if (cf) out.codeforces = strip({ minRating: int(cf.minRating, 0, 4000, 'Minimum rating') });
  const wk = obj(c.wakatime);
  if (wk) out.wakatime = { minMinutes: int(wk.minMinutes, 5, 720, 'Minutes a day') ?? 30 };
  const cam = obj(c.camera);
  if (cam) {
    out.camera = {
      exercise: oneOf(cam.exercise, ['pushups', 'situps', 'squats'] as const, 'Exercise') ?? 'pushups',
      reps: int(cam.reps, 1, 2000, 'Reps') ?? 100,
    };
  }
  const h = obj(c.health);
  if (h) {
    out.health = {
      metric: oneOf(h.metric, ['steps', 'distance'] as const, 'Metric') ?? 'steps',
      threshold: int(h.threshold, 1, 200_000, 'Daily target') ?? 10_000,
    };
  }
  const ph = obj(c.photo);
  if (ph) {
    if (ph.instructions !== undefined && (typeof ph.instructions !== 'string' || ph.instructions.length > 300)) throw bad('Photo instructions must be under 300 characters');
    out.photo = { instructions: (ph.instructions as string | undefined)?.trim() || 'Show today’s progress clearly' };
  }
  if (c.criteria !== undefined) {
    if (!Array.isArray(c.criteria) || c.criteria.length > 10) throw bad('add at most 10 extra rules');
    out.criteria = c.criteria.map((raw, i) => {
      const r = obj(raw) ?? {};
      const text = typeof r.text === 'string' ? r.text.trim() : '';
      if (text.length < 5 || text.length > 200) throw bad(`rule ${i + 1} needs 5 to 200 characters`);
      const check = oneOf(r.check, ['photo', 'self'] as const, `Rule ${i + 1} check`) ?? 'self';
      // A self-reported rule can't be enforced, so it can't decide whether a day counts.
      const required = check === 'photo' && bool(r.required, `Rule ${i + 1} required`) !== false;
      return { id: `r${i + 1}`, text, frequency: oneOf(r.frequency, ['daily', 'weekly', 'total'] as const, `Rule ${i + 1} frequency`) ?? 'daily', check, required };
    });
    if (!out.criteria.length) delete out.criteria;
  }
  return out;
}

/** File extensions per language for the GitHub "only these languages" rule. */
export const GITHUB_LANGUAGES: Record<string, string[]> = {
  rust: ['.rs'],
  typescript: ['.ts', '.tsx'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'],
  go: ['.go'],
  solidity: ['.sol'],
  java: ['.java'],
  kotlin: ['.kt', '.kts'],
  swift: ['.swift'],
  'c++': ['.cpp', '.cc', '.hpp', '.h'],
  c: ['.c', '.h'],
  'c#': ['.cs'],
  ruby: ['.rb'],
  php: ['.php'],
  dart: ['.dart'],
  move: ['.move'],
};

/** Problem slugs per day: up to 5 a day, up to 366 days. */
function problemSchedule(v: unknown) {
  if (!Array.isArray(v) || v.length > 366) throw bad('the problem list can cover at most 366 days');
  return v.map((day, i) => {
    if (!Array.isArray(day) || !day.length || day.length > 5) throw bad(`day ${i + 1} needs 1 to 5 problems`);
    return day.map((s) => {
      if (typeof s !== 'string' || !/^[a-z0-9-]{1,100}$/.test(s)) throw bad(`day ${i + 1} has a problem that isn't a LeetCode problem link`);
      return s;
    });
  });
}

function list(v: unknown, max: number, pattern: RegExp, what: string, ok: (v: string) => boolean) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > max || !v.every((x) => typeof x === 'string' && pattern.test(x.trim()) && ok(x.trim()))) {
    throw bad(`${what}: up to ${max}, from the supported list`);
  }
  const out = [...new Set(v.map((x: string) => x.trim()))];
  return out.length ? out : undefined;
}
