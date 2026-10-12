import { toUsd } from '../../common/money.js';
import { PROVIDER_LABELS } from '../../common/providers.js';
import { joinFee, penalty } from '../../common/settlement-math.js';
import type { User } from '../users/entities/user.entities.js';
import type { Organization } from '../organizations/entities/organization.entities.js';
import type { Verification } from '../verification/entities/verification.entities.js';
import type { Challenge, Participant, ProviderKey, VerificationConfig } from './entities/challenge.entities.js';
import { distributionText, disputeText, feesText } from './rules.js';
import { currentPeriod, localDate, periodEnd } from './schedule.js';

type Person = Pick<User, 'name' | 'handle' | 'hue' | 'avatarUrl'>;

export const person = (u: Person) => ({ name: u.name, handle: u.handle, hue: u.hue, avatarUrl: u.avatarUrl });

/** Wording per provider, matching the create flow. */
export function requirementText(provider: ProviderKey, cfg: VerificationConfig, mode: 'days' | 'count', required: number, duration: number, target: number) {
  const ex = cfg.camera?.exercise ?? 'pushups';
  const exName = { pushups: 'push-ups', situps: 'sit-ups', squats: 'squats' }[ex];
  const t: Record<ProviderKey, { days: string; count: string }> = {
    github: { days: 'Qualifying commits or pull requests', count: cfg.github?.mergedOnly === false ? 'pull requests' : 'merged pull requests' },
    solana: { days: 'On-chain activity from your linked wallet', count: 'program deployments' },
    leetcode: { days: 'A new accepted LeetCode submission', count: 'new LeetCode problems solved' },
    codeforces: { days: 'An accepted Codeforces solution', count: 'new Codeforces problems solved' },
    wakatime: { days: `${cfg.wakatime?.minMinutes ?? 30} minutes of tracked coding`, count: 'hours of tracked coding' },
    camera: { days: `${cfg.camera?.reps ?? 100} camera-counted ${exName}`, count: `camera-counted ${exName}` },
    health: {
      days: cfg.health?.metric === 'distance' ? `${(cfg.health.threshold / 1000).toFixed(1)} km walked or run` : `${(cfg.health?.threshold ?? 10_000).toLocaleString('en')} steps`,
      count: cfg.health?.metric === 'steps' ? 'steps' : 'kilometres walked or run',
    },
    photo: { days: 'An approved photo of your progress', count: 'approved progress photos' },
  };
  return mode === 'days' ? `${t[provider].days} on at least ${required} of ${duration} days` : `${target} ${t[provider].count} in ${duration} days`;
}

export function defaultUnit(provider: ProviderKey, cfg: VerificationConfig) {
  const map: Record<ProviderKey, string> = {
    github: 'pull requests',
    solana: 'deployments',
    leetcode: 'problems',
    codeforces: 'problems',
    wakatime: 'hours',
    camera: { pushups: 'push-ups', situps: 'sit-ups', squats: 'squats' }[cfg.camera?.exercise ?? 'pushups'],
    health: cfg.health?.metric === 'steps' ? 'steps' : 'km',
    photo: 'photos',
  };
  return map[provider];
}

/** Public status the apps understand. */
export function publicStatus(c: Challenge) {
  if (c.status === 'pending_chain') return 'open';
  if (c.status === 'cancelled') return 'ended';
  return c.status as 'open' | 'live' | 'settling' | 'ended';
}

/** Everything PRD §7 says a challenge must show. */
export function challengeView(c: Challenge, creator: Person, org: Organization | null, opts: { showInvite?: boolean } = {}) {
  const ladderPct = c.penaltiesBps.map((b) => b / 100);
  return {
    id: c.slug,
    title: c.title,
    summary: c.summary,
    description: c.description,
    category: c.category,
    providers: c.providers.map((p) => PROVIDER_LABELS[p]),
    creator: person(creator),
    org: org ? { name: org.name, slug: org.slug } : undefined,
    bannerUrl: c.bannerUrl,
    participants: c.participantCount,
    limit: c.participantLimit ?? undefined,
    stake: toUsd(c.stakeMin),
    stakeMode: c.stakeMode,
    stakeRange: c.stakeMode === 'range' ? [toUsd(c.stakeMin), toUsd(c.stakeMax)] : undefined,
    sponsorPool: toUsd(c.sponsorPool),
    sponsorPledged: toUsd(c.sponsorPledge),
    durationDays: c.durationDays,
    mode: c.mode,
    requirement: c.requirement,
    requiredDays: c.mode === 'days' ? c.requiredPeriods : undefined,
    targetCount: c.targetCount ?? undefined,
    countUnit: c.countUnit ?? undefined,
    freeStrikes: c.freeStrikes,
    penalties: ladderPct.filter((p) => p > 0),
    penaltyStructure: c.penaltyPreset,
    forfeitsToFinishers: c.forfeitsToFinishers,
    startsAt: localDate(c.startsAt, c.timezone),
    joinBy: localDate(new Date(c.joinBy.getTime() - 1), c.timezone),
    startsAtIso: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    timezone: c.timezone,
    difficulty: c.difficulty,
    privacy: c.privacy,
    verificationLevel: c.verificationLevel,
    distribution: distributionText(c),
    disputeRules: disputeText(c),
    eligibility: `${process.env.ENFORCE_ACCOUNT_LEVELS === 'true' ? `${c.verificationLevel} account` : 'Anyone with a Stake-Sync account'}${c.privacy === 'org' && org ? `, member of ${org.name}` : ''}${c.privacy === 'private' ? ', invite only' : ''}`,
    freeze: { allowed: c.freezePeriods > 0, days: c.freezePeriods },
    fees: { joinPercent: c.joinFeeBps / 100, platformSharePercent: c.feeBps / 100, summary: feesText(c) },
    /** What joining costs at the minimum stake, fee included. */
    joinCost: toUsd(c.stakeMin + joinFee(c.stakeMin, c.joinFeeBps)),
    status: publicStatus(c),
    cancelled: c.status === 'cancelled',
    settingUp: c.status === 'pending_chain',
    paused: Boolean(c.moderationHold),
    /** Everything that's checked, for the rules matrix people see before joining */
    verification: c.verificationConfig,
    exercise: c.verificationConfig.camera?.exercise,
    metric: c.verificationConfig.health?.metric,
    escrow: c.onChain ? { address: c.vaultPda, challengeAccount: c.challengePda } : null,
    rulesHash: c.rulesHash,
    inviteCode: opts.showInvite ? c.inviteCode : undefined,
  };
}

const UI_STATE: Record<string, string> = {
  verified: 'verified',
  failed: 'failed',
  pending: 'pending',
  unavailable: 'unavailable',
  disputed: 'disputed',
  excused: 'unavailable',
};

/** A person's progress in one challenge (the app's Participation shape). */
export function participationView(c: Challenge, p: Participant, verifications: Verification[], now = new Date()) {
  const byPeriod = new Map(verifications.map((v) => [v.period, v]));
  const cur = currentPeriod(c, now);
  const frozen = (i: number) => p.freezeFrom !== null && i >= p.freezeFrom && i < p.freezeFrom + c.freezePeriods;
  const ended = now >= c.endsAt;
  const days = Array.from({ length: c.periodCount }, (_, i) => {
    const v = byPeriod.get(i);
    if (v && v.state !== 'pending') {
      return { day: i + 1, state: UI_STATE[v.state], note: v.state === 'excused' ? `${v.detail || 'The provider was down'}. This day can't count against you.` : v.detail || undefined };
    }
    if (frozen(i)) return { day: i + 1, state: 'frozen', note: 'Emergency freeze' };
    if (!ended && (cur === null || i > cur)) return { day: i + 1, state: 'upcoming' };
    return { day: i + 1, state: 'pending', note: v?.detail || undefined };
  });
  const ladder = c.penaltiesBps.map((b) => b / 100);
  const currentPenalty = penalty(p.stake, p.missedCount, c.freeStrikes, ladder);
  return {
    challengeId: c.slug,
    status: p.status,
    today: cur === null ? (now < c.startsAt ? 0 : c.periodCount) : cur + 1,
    days: c.mode === 'days' ? days : days.slice(0, cur === null ? c.periodCount : cur + 1),
    count: c.mode === 'count' ? p.progress : undefined,
    target: c.mode === 'count' ? c.targetCount : undefined,
    completedDays: p.verifiedCount,
    missedDays: p.missedCount,
    strikesUsed: Math.min(p.missedCount, c.freeStrikes),
    strikesLeft: Math.max(0, c.freeStrikes - p.missedCount),
    missesAllowed: Math.max(0, c.periodCount - c.requiredPeriods),
    stake: toUsd(p.stake),
    stakeRemaining: toUsd(p.stake - currentPenalty),
    penaltySoFar: toUsd(currentPenalty),
    position: p.rank,
    freezeUsed: p.freezeUsed,
    freezeFrom: p.freezeFrom !== null ? p.freezeFrom + 1 : null,
    nextDeadline: cur !== null ? periodEnd(c, cur).toISOString() : null,
    completed: p.completed,
    claimable: toUsd(p.claimable),
    claimed: p.claimed,
    history: verifications
      .filter((v) => v.state !== 'pending')
      .sort((a, b) => (b.decidedAt ?? b.updatedAt).getTime() - (a.decidedAt ?? a.updatedAt).getTime())
      .slice(0, 40)
      .map((v) => ({
        id: v.id,
        at: (v.decidedAt ?? v.updatedAt).toISOString(),
        day: v.period + 1,
        state: UI_STATE[v.state],
        provider: PROVIDER_LABELS[v.provider],
        detail: v.detail,
      })),
  };
}
