import { Injectable } from '@nestjs/common';
import { ProviderUnavailable } from '../../../common/http.js';
import { periodStart } from '../../challenges/schedule.js';
import { leetcodeDifficulty, leetcodeProfile, leetcodeRecentAccepted } from '../clients/leetcode.js';
import { assignedProblems } from '../leetcode-assigned.js';
import { plural, type AdapterContext, type CountResult, type DayResult, type VerificationAdapter } from './adapter.js';

const RANK = { Easy: 0, Medium: 1, Hard: 2 } as const;

/**
 * Accepted submissions. "Previously unsolved" is enforced by counting growth in distinct solved
 * problems from the start snapshot, so re-submitting old problems never counts (PRD §31).
 */
@Injectable()
export class LeetcodeAdapter implements VerificationAdapter {
  readonly key = 'leetcode' as const;

  async baseline(ctx: AdapterContext) {
    const p = await leetcodeProfile(ctx.account!);
    if (!p) throw new ProviderUnavailable('leetcode', 'profile not found');
    return { leetcode: p.solved, takenAt: new Date().toISOString() };
  }

  async day(ctx: AdapterContext): Promise<DayResult> {
    const cfg = ctx.challenge.verificationConfig.leetcode ?? { newOnly: true };
    if (cfg.assigned) {
      const period = Math.round((ctx.from.getTime() - periodStart(ctx.challenge, 0).getTime()) / (ctx.challenge.periodSecs * 1000));
      const slugs = await assignedProblems(ctx.challenge, period);
      if (slugs) return this.assignedDay(ctx, slugs);
    }
    const [recentAll, profile] = await Promise.all([leetcodeRecentAccepted(ctx.account!), cfg.newOnly ? leetcodeProfile(ctx.account!) : null]);
    const seen = new Set((ctx.participant.baseline.leetcodeSeen as string[] | undefined) ?? []);
    let qualifying = recentAll.filter((s) => s.at >= ctx.from && s.at < ctx.to && !seen.has(s.titleSlug));
    if (cfg.minDifficulty) {
      const min = RANK[cfg.minDifficulty];
      const withDiff = await Promise.all(qualifying.map(async (s) => ({ s, d: (await leetcodeDifficulty(s.titleSlug)) as keyof typeof RANK })));
      qualifying = withDiff.filter((x) => RANK[x.d] >= min).map((x) => x.s);
    }
    let solvedNow: number | undefined;
    if (cfg.newOnly && profile) {
      // Only problems never solved before count: the distinct-solved total has to have grown.
      solvedNow = profile.solved.All;
      const last = (ctx.participant.baseline.leetcodeLastAll as number | undefined) ?? (ctx.participant.baseline.leetcode as { All?: number } | undefined)?.All ?? solvedNow;
      if (solvedNow <= last) qualifying = [];
    }
    if (qualifying.length) {
      return {
        outcome: 'verified',
        detail: `${plural(qualifying.length, 'accepted submission')}: ${qualifying.slice(0, 2).map((s) => s.title).join(', ')}`,
        evidence: { submissions: qualifying },
        fingerprints: qualifying.map((s) => `lc:${ctx.account}:${s.id}`),
        units: qualifying.length,
        baselinePatch: { leetcodeSeen: [...seen, ...qualifying.map((s) => s.titleSlug)].slice(-500), ...(solvedNow !== undefined ? { leetcodeLastAll: solvedNow } : {}) },
      };
    }
    return { outcome: 'failed', detail: cfg.newOnly ? 'No new problems solved' : 'No accepted LeetCode submissions', evidence: { recentChecked: recentAll.length } };
  }

  /** The day's set problems: every one needs an accepted submission during that day. */
  private async assignedDay(ctx: AdapterContext, slugs: string[]): Promise<DayResult> {
    const recent = await leetcodeRecentAccepted(ctx.account!);
    const inWindow = recent.filter((s) => s.at >= ctx.from && s.at < ctx.to);
    const solved = slugs.filter((slug) => inWindow.some((s) => s.titleSlug === slug));
    const missing = slugs.filter((slug) => !solved.includes(slug));
    if (!missing.length) {
      const subs = inWindow.filter((s) => slugs.includes(s.titleSlug));
      return {
        outcome: 'verified',
        detail: `Solved ${plural(slugs.length, 'set problem')}: ${subs.slice(0, 3).map((s) => s.title).join(', ')}`,
        evidence: { assigned: slugs, submissions: subs },
        fingerprints: subs.map((s) => `lc:${ctx.account}:${s.id}`),
        units: slugs.length,
      };
    }
    return { outcome: 'failed', detail: `${solved.length} of ${plural(slugs.length, 'set problem')} solved. Still to do: ${missing.join(', ')}`, evidence: { assigned: slugs, solved } };
  }

  async count(ctx: AdapterContext): Promise<CountResult> {
    const cfg = ctx.challenge.verificationConfig.leetcode ?? { newOnly: true };
    const p = await leetcodeProfile(ctx.account!);
    if (!p) throw new ProviderUnavailable('leetcode', 'profile not found');
    const base = (ctx.participant.baseline.leetcode as typeof p.solved | undefined) ?? p.solved;
    const delta = (k: keyof typeof p.solved) => Math.max(0, p.solved[k] - (base[k] ?? 0));
    const mediumHard = delta('Medium') + delta('Hard');
    const total = cfg.minDifficulty === 'Hard' ? delta('Hard') : cfg.minDifficulty === 'Medium' ? mediumHard : delta('All');
    // A floor on Medium/Hard problems (e.g. "50 new problems, 10 Medium or Hard").
    const short = cfg.minMediumHard ? Math.max(0, cfg.minMediumHard - mediumHard) : 0;
    return {
      total: short > 0 ? Math.min(total, (ctx.challenge.targetCount ?? total) - 1) : total,
      detail: `${plural(total, 'new problem')} (${mediumHard} Medium/Hard)${short > 0 ? `; ${short} more Medium/Hard needed` : ''}`,
      evidence: { now: p.solved, baseline: base },
    };
  }
}
