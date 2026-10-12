import { sha256Hex } from '../../common/crypto.js';
import { toUsd } from '../../common/money.js';
import { PROVIDER_LABELS } from '../../common/providers.js';
import type { Challenge } from './entities/challenge.entities.js';

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

const pct = (bps: number) => `${bps / 100}%`;

export function distributionText(c: Pick<Challenge, 'forfeitsToFinishers' | 'feeBps' | 'stakeMode'>) {
  if (c.stakeMode === 'none') return 'Sponsor rewards split equally between everyone who completes';
  return c.forfeitsToFinishers
    ? `Sponsor rewards go entirely to finishers. Of the stakes and penalties people forfeit, Stake-Sync keeps ${pct(c.feeBps)} and everyone who completes splits the other ${pct(10_000 - c.feeBps)} equally`
    : 'Sponsor rewards split equally between everyone who completes. Forfeited stakes go to the Stake-Sync treasury';
}

/** Every fee, in one sentence, for the rules people accept. */
export function feesText(c: Pick<Challenge, 'feeBps' | 'joinFeeBps' | 'stakeMode'>) {
  if (c.stakeMode === 'none') return 'No Stake-Sync fees.';
  const parts = [
    c.joinFeeBps ? `${pct(c.joinFeeBps)} joining fee on top of your stake (refunded if the challenge is cancelled)` : null,
    c.feeBps ? `Stake-Sync keeps ${pct(c.feeBps)} of forfeited stakes and penalties` : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join('. ')}. Your own stake back and sponsor prizes are never charged.` : 'No Stake-Sync fees.';
}

export function disputeText(c: Pick<Challenge, 'disputeWindowSecs'>) {
  const hours = Math.round(c.disputeWindowSecs / 3600);
  return `Any missed day can be disputed until ${hours} hours after the challenge ends. Money affected by a dispute stays locked until a moderator decides. A day can't be marked missed when the verification provider was down.`;
}

/**
 * The rules document people accept before staking (PRD §7). Canonical JSON: the same challenge
 * always produces the same bytes, so the sha256 matches the hash locked into the escrow program.
 * Title, description and everything financial are included; banner and summary are not.
 */
export function rulesDocument(c: Challenge, creatorName: string, orgName: string | null) {
  const doc = {
    version: 1,
    challenge: c.slug,
    title: c.title,
    description: c.description,
    creator: creatorName,
    organization: orgName,
    category: c.category,
    privacy: c.privacy,
    participantLimit: c.participantLimit,
    requirement: c.requirement,
    verification: { providers: c.providers.map((p) => PROVIDER_LABELS[p]), settings: c.verificationConfig },
    schedule: {
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
      joinBy: c.joinBy.toISOString(),
      timezone: c.timezone,
      periodSeconds: c.periodSecs,
      periods: c.periodCount,
      mode: c.mode,
      requiredPeriods: c.requiredPeriods,
      targetCount: c.targetCount,
      countUnit: c.countUnit,
    },
    stake: { mode: c.stakeMode, minUsdc: toUsd(c.stakeMin), maxUsdc: toUsd(c.stakeMax) },
    strikes: {
      structure: c.penaltyPreset,
      free: c.freeStrikes,
      penaltyStepsPercent: c.penaltiesBps.map((b) => b / 100),
      ...(c.stakeMode === 'none' && c.mode === 'days' ? { afterLastStrike: 'The next miss after your free strikes takes you out of the challenge.' } : {}),
    },
    freeze: { allowed: c.freezePeriods > 0, periods: c.freezePeriods },
    rewards: { sponsorPledgeUsdc: toUsd(c.sponsorPledge), distribution: distributionText(c), forfeitsToFinishers: c.forfeitsToFinishers },
    fees: { joinPercent: c.joinFeeBps / 100, platformSharePercent: c.feeBps / 100, summary: feesText(c) },
    disputes: { windowSeconds: c.disputeWindowSecs, rule: disputeText(c) },
    eligibility: { verificationLevel: c.verificationLevel },
    protections: [
      'A period can only count against you if the verifier records it as missed.',
      'If a verification provider is down, that period is protected and can never become a miss.',
      'Stake-Sync cannot withdraw escrowed funds. Payouts follow these rules only.',
    ],
  };
  const text = canonical(doc);
  return { doc: text, hash: sha256Hex(text) };
}
