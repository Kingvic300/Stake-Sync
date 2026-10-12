import { Injectable } from '@nestjs/common';
import { GITHUB_LANGUAGES } from '../../challenges/verification-config.js';
import { pullRequests, qualifyingCommits } from '../clients/github.js';
import { plural, type AdapterContext, type CountResult, type DayResult, type VerificationAdapter } from './adapter.js';

/** Commits with real changes and pull requests (PRD §9). Formatting-only and empty commits don't count. */
@Injectable()
export class GithubAdapter implements VerificationAdapter {
  readonly key = 'github' as const;

  async day(ctx: AdapterContext): Promise<DayResult> {
    const cfg = ctx.challenge.verificationConfig.github ?? {};
    const need = cfg.minCommits ?? 1;
    const extensions = (cfg.languages ?? []).flatMap((l) => GITHUB_LANGUAGES[l.toLowerCase()] ?? []);
    const commits = await qualifyingCommits(ctx.token!, ctx.account!, ctx.from, ctx.to, cfg.minChangedLines ?? 5, cfg.repo, { extensions, paths: cfg.paths, enough: need });
    const scope = [cfg.languages?.length ? `in ${cfg.languages.join(' or ')}` : '', cfg.paths?.length ? `under ${cfg.paths.join(', ')}` : ''].filter(Boolean).join(' ');
    if (commits.length >= need) {
      const repos = [...new Set(commits.map((c) => c.repo))];
      return {
        outcome: 'verified',
        detail: `${plural(commits.length, 'commit')} to ${repos.slice(0, 2).join(', ')}${repos.length > 2 ? ` and ${repos.length - 2} more` : ''}`,
        evidence: { commits: commits.map((c) => ({ sha: c.sha, repo: c.repo, message: c.message, at: c.at, changed: c.changed })) },
        fingerprints: commits.map((c) => `gh:${c.sha}`),
        units: commits.length,
      };
    }
    // Pull requests can stand in for a single commit, not for a multi-commit or language/path rule.
    if (cfg.countPullRequests !== false && need === 1 && !extensions.length && !cfg.paths?.length) {
      const prs = await pullRequests(ctx.token!, ctx.account!, ctx.from, ctx.to, Boolean(cfg.mergedOnly), cfg.repo);
      if (prs.length) {
        return {
          outcome: 'verified',
          detail: `${plural(prs.length, 'pull request')} in ${prs[0].repo}`,
          evidence: { pullRequests: prs },
          fingerprints: prs.map((p) => `ghpr:${p.url}`),
          units: prs.length,
        };
      }
    }
    return {
      outcome: 'failed',
      detail: `${commits.length} of ${plural(need, 'qualifying commit')}${scope ? ` ${scope}` : ''} (each needs ${cfg.minChangedLines ?? 5}+ changed lines)`,
      evidence: { checkedFrom: ctx.from, checkedTo: ctx.to, found: commits.length },
    };
  }

  async count(ctx: AdapterContext): Promise<CountResult> {
    const cfg = ctx.challenge.verificationConfig.github ?? {};
    const prs = await pullRequests(ctx.token!, ctx.account!, ctx.from, ctx.to, cfg.mergedOnly !== false, cfg.repo);
    return {
      total: prs.length,
      detail: `${plural(prs.length, cfg.mergedOnly !== false ? 'merged pull request' : 'pull request')}`,
      evidence: { pullRequests: prs.slice(0, 50) },
      fingerprints: prs.map((p) => `ghpr:${p.url}`),
    };
  }
}
