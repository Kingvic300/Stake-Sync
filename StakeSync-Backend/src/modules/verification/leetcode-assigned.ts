import type { Challenge } from '../challenges/entities/challenge.entities.js';
import { periodStart } from '../challenges/schedule.js';
import { leetcodeDailySlug } from './clients/leetcode.js';

/**
 * The problems everyone must solve on a given day, or null when any new problem counts.
 * "daily" follows LeetCode's own daily question (the UTC date at the middle of the day);
 * "list" is the creator's schedule, one or more problems per day.
 */
export async function assignedProblems(c: Pick<Challenge, 'verificationConfig' | 'startsAt' | 'periodSecs' | 'periodCount' | 'disputeWindowSecs'>, period: number): Promise<string[] | null> {
  const lc = c.verificationConfig.leetcode;
  if (!lc?.assigned) return null;
  if (lc.assigned === 'list') return lc.schedule?.[period]?.length ? lc.schedule[period] : null;
  const mid = new Date(periodStart(c, period).getTime() + (c.periodSecs * 1000) / 2);
  const slug = await leetcodeDailySlug(mid.toISOString().slice(0, 10));
  return slug ? [slug] : null;
}
