import { Injectable } from '@nestjs/common';
import { codeforcesSubmissions, problemKey } from '../clients/codeforces.js';
import { plural, type AdapterContext, type CountResult, type DayResult, type VerificationAdapter } from './adapter.js';

/** Accepted Codeforces solutions; only problems not solved before the challenge count. */
@Injectable()
export class CodeforcesAdapter implements VerificationAdapter {
  readonly key = 'codeforces' as const;

  async baseline(ctx: AdapterContext) {
    const subs = await codeforcesSubmissions(ctx.account!, 1000);
    const solved = [...new Set(subs.filter((s) => s.verdict === 'OK').map((s) => problemKey(s.problem)))];
    return { codeforcesSolved: solved };
  }

  private async newSolves(ctx: AdapterContext) {
    const minRating = ctx.challenge.verificationConfig.codeforces?.minRating ?? 0;
    const before = new Set((ctx.participant.baseline.codeforcesSolved as string[] | undefined) ?? []);
    const subs = await codeforcesSubmissions(ctx.account!, 300);
    const firstSolve = new Map<string, (typeof subs)[number]>();
    for (const s of [...subs].reverse()) {
      if (s.verdict !== 'OK') continue;
      const k = problemKey(s.problem);
      if (!before.has(k) && !firstSolve.has(k) && (s.problem.rating ?? 0) >= minRating) firstSolve.set(k, s);
    }
    return [...firstSolve.values()].filter((s) => {
      const at = s.creationTimeSeconds * 1000;
      return at >= ctx.from.getTime() && at < ctx.to.getTime();
    });
  }

  async day(ctx: AdapterContext): Promise<DayResult> {
    const solved = await this.newSolves(ctx);
    if (solved.length) {
      return {
        outcome: 'verified',
        detail: `${plural(solved.length, 'new problem')} solved: ${solved.slice(0, 2).map((s) => s.problem.name).join(', ')}`,
        evidence: { submissions: solved.map((s) => ({ id: s.id, problem: s.problem })) },
        fingerprints: solved.map((s) => `cf:${s.id}`),
        units: solved.length,
      };
    }
    return { outcome: 'failed', detail: 'No new accepted Codeforces solutions' };
  }

  async count(ctx: AdapterContext): Promise<CountResult> {
    const solved = await this.newSolves(ctx);
    return { total: solved.length, detail: plural(solved.length, 'new problem') + ' solved', evidence: { problems: solved.map((s) => s.problem) } };
  }
}
