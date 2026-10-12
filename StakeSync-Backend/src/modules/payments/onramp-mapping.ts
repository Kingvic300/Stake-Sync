// Pure rules for Onramper transaction events: parsing, the documented aliases and statuses, which
// side of the trade is USDC, and which status changes may be applied. No I/O, so it's all unit tested.
//
// Sources: https://docs.onramper.com/docs/optional-set-up-webhooks,
// https://docs.onramper.com/docs/optional-webhook-setup and
// https://docs.onramper.com/reference/get_transactions-transactionid. Anything they don't document
// is kept as received and parked, never guessed.

import { toUsd } from '../../common/money.js';
import type { NotifyInput } from '../notifications/notifications.service.js';

export type OnrampDirection = 'buy' | 'sell';
export type OnrampState = 'new' | 'pending' | 'paid' | 'completed' | 'failed' | 'canceled';

/** Every spelling Onramper's docs use for the transaction type. */
const TYPE_ALIASES: Record<string, OnrampDirection> = { buy: 'buy', onramp: 'buy', sell: 'sell', offramp: 'sell' };
const STATES = new Set<OnrampState>(['new', 'pending', 'paid', 'completed', 'failed', 'canceled']);
const TERMINAL = new Set<OnrampState>(['completed', 'failed', 'canceled']);
/** How far a transaction got. Failures don't move it forward. */
const PROGRESS: Record<OnrampState, number> = { new: 0, pending: 1, paid: 2, completed: 3, failed: 0, canceled: 0 };

export const normalizeType = (v: string): OnrampDirection | null => TYPE_ALIASES[v.trim().toLowerCase()] ?? null;
export const normalizeStatus = (v: string): OnrampState | null => {
  const s = v.trim().toLowerCase() as OnrampState;
  return STATES.has(s) ? s : null;
};
export const isTerminal = (s: OnrampState) => TERMINAL.has(s);
export const progressOf = (s: OnrampState) => PROGRESS[s];

export interface OnrampEventData {
  transactionId: string;
  /** As received, so unknown values are preserved. */
  rawType: string;
  rawStatus: string;
  direction: OnrampDirection | null;
  state: OnrampState | null;
  statusDate: Date;
  partnerContext: string | null;
  walletAddress: string | null;
  transactionHash: string | null;
  provider: string | null;
  providerTransactionId: string | null;
  statusReason: string | null;
  inAmount: number | null;
  outAmount: number | null;
  sourceCurrency: string | null;
  targetCurrency: string | null;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** A non-negative amount sent as a JSON number or a numeric string (`partnerFee` arrives as both). */
function amount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n < 1e12 ? n : null;
}

export function parseEvent(payload: unknown): { ok: true; event: OnrampEventData } | { ok: false; reason: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'payload is not an object' };
  const p = payload as Record<string, unknown>;
  const transactionId = typeof p.transactionId === 'string' ? p.transactionId.trim() : '';
  if (!ID.test(transactionId)) return { ok: false, reason: 'missing or malformed transactionId' };
  const rawType = text(p.transactionType, 24);
  const rawStatus = text(p.status, 24);
  if (!rawType || !rawStatus) return { ok: false, reason: 'missing transactionType or status' };
  const statusDate = typeof p.statusDate === 'string' ? new Date(p.statusDate) : null;
  if (!statusDate || Number.isNaN(statusDate.getTime())) return { ok: false, reason: 'missing or malformed statusDate' };
  return {
    ok: true,
    event: {
      transactionId,
      rawType,
      rawStatus,
      direction: normalizeType(rawType),
      state: normalizeStatus(rawStatus),
      statusDate,
      partnerContext: text(p.partnerContext, 64),
      walletAddress: text(p.walletAddress, 64),
      transactionHash: text(p.transactionHash, 128),
      provider: text(p.onramp, 40),
      providerTransactionId: text(p.onrampTransactionId, 120),
      statusReason: text(p.statusReason, 300),
      inAmount: amount(p.inAmount),
      outAmount: amount(p.outAmount),
      sourceCurrency: text(p.sourceCurrency, 20)?.toLowerCase() ?? null,
      targetCurrency: text(p.targetCurrency, 20)?.toLowerCase() ?? null,
    },
  };
}

/** Dollars of USDC (a float from JSON) to base units. Rounds to the 6 decimals USDC has. */
export const usdcUnits = (n: number) => BigInt(Math.round(n * 1_000_000));

/** Fiat ids are short lowercase codes (`ngn`, `usd`); shown upper case. */
const fiatCode = (v: string | null) => (v && /^[a-z]{2,10}$/.test(v) ? v.toUpperCase() : null);

export interface OnrampAmounts {
  usdc: bigint | null;
  fiatAmount: string | null;
  fiatCurrency: string | null;
}

/**
 * Which side of the trade is USDC. The webhook docs define the fields only for buys (fiat in, crypto
 * out); the offramp redirect docs describe sells the other way round (crypto in, fiat out). So the
 * mapping follows the currencies: the USDC side must be the one the direction says it is, or the
 * event is parked instead of guessed.
 */
export function mapAmounts(e: OnrampEventData, direction: OnrampDirection, usdcId: string): { ok: true; amounts: OnrampAmounts } | { ok: false; reason: string } {
  const usdc = usdcId.toLowerCase();
  const [cryptoSide, cryptoAmount, fiatSide, fiatAmount] =
    direction === 'buy' ? [e.targetCurrency, e.outAmount, e.sourceCurrency, e.inAmount] : [e.sourceCurrency, e.inAmount, e.targetCurrency, e.outAmount];
  if (cryptoSide !== usdc) return { ok: false, reason: `expected ${usdc} as the ${direction === 'buy' ? 'target' : 'source'} currency, got ${cryptoSide ?? 'none'}` };
  return {
    ok: true,
    amounts: {
      usdc: cryptoAmount === null ? null : usdcUnits(cryptoAmount),
      fiatAmount: fiatAmount === null ? null : fiatAmount.toFixed(8),
      fiatCurrency: fiatCode(fiatSide),
    },
  };
}

export type TransitionAction = 'apply' | 'duplicate' | 'stale' | 'review';

/**
 * Whether an incoming status may replace the stored one. Webhooks can arrive repeated, late or out
 * of order, so:
 * - a completed transaction is never reversed automatically (anything else after it goes to review);
 * - completed after failed/canceled is applied only with evidence beyond the webhook itself (Onramper's
 *   own example shows that sequence, so it can't simply be refused);
 * - otherwise progress only moves forward, and failures replace progress only when dated later.
 */
export function decideTransition(
  current: { state: OnrampState; statusDate: Date } | null,
  incoming: { state: OnrampState; statusDate: Date },
  hasEvidence: boolean,
): { action: TransitionAction; reason?: string } {
  if (!current) return { action: 'apply' };
  const delta = incoming.statusDate.getTime() - current.statusDate.getTime();
  if (incoming.state === current.state) return delta > 0 ? { action: 'apply' } : { action: 'duplicate' };
  if (current.state === 'completed') {
    // An earlier step arriving late is just out of order; a later failure or step back is a conflict.
    if (!isTerminal(incoming.state) && delta <= 0) return { action: 'stale' };
    return { action: 'review', reason: `${incoming.state} received after completed` };
  }
  if (current.state === 'failed' || current.state === 'canceled') {
    if (incoming.state === 'completed') {
      if (delta <= 0) return { action: 'review', reason: `completed dated before ${current.state}` };
      return hasEvidence ? { action: 'apply' } : { action: 'review', reason: `completed after ${current.state}, not independently confirmed` };
    }
    if (isTerminal(incoming.state)) return delta > 0 ? { action: 'apply' } : { action: 'stale' };
    return { action: 'stale' };
  }
  if (incoming.state === 'completed') return { action: 'apply' };
  if (isTerminal(incoming.state)) return delta >= 0 ? { action: 'apply' } : { action: 'stale' };
  return progressOf(incoming.state) > progressOf(current.state) ? { action: 'apply' } : { action: 'stale' };
}

/** What a transaction looks like to the history and notification rules. */
export interface OnrampView {
  transactionId: string;
  direction: OnrampDirection;
  state: OnrampState;
  progress: number;
  usdcAmount: bigint | null;
  fiatAmount: string | null;
  fiatCurrency: string | null;
  provider: string | null;
  providerTransactionId: string | null;
  statusReason: string | null;
}

/** Money-history status. A transaction that never got past `new` isn't shown. */
export function ledgerStatus(state: OnrampState): 'pending' | 'confirmed' | 'failed' | null {
  if (state === 'new') return null;
  if (state === 'completed') return 'confirmed';
  return state === 'failed' || state === 'canceled' ? 'failed' : 'pending';
}

/** Shown in money history. A widget closed before paying (canceled while still new) isn't. */
export const showInHistory = (t: Pick<OnrampView, 'state' | 'progress'>) => ledgerStatus(t.state) !== null && !(t.state === 'canceled' && t.progress < 1);

const providerName = (p: string | null) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : 'the provider');
const usd = (units: bigint) => `$${toUsd(units).toFixed(2).replace(/\.00$/, '')}`;
const fiat = (t: OnrampView) => (t.fiatAmount && t.fiatCurrency ? `${Number(t.fiatAmount).toLocaleString('en', { maximumFractionDigits: 2 })} ${t.fiatCurrency}` : null);
const reference = (t: OnrampView) => t.providerTransactionId ?? t.transactionId;

/** Plain-language detail for money history: what happened and what to do next. Never claims a refund. */
export function ledgerDetail(t: OnrampView): string | null {
  const who = providerName(t.provider);
  if (t.state === 'completed') return null;
  if (t.state === 'pending' || t.state === 'paid' || t.state === 'new') return `Waiting for ${who} to finish.`;
  const what = t.state === 'canceled' ? 'Canceled' : 'Didn’t go through';
  const reason = t.statusReason ? ` (${t.statusReason})` : '';
  const next =
    t.progress >= 2
      ? ` Your payment was taken but the ${t.direction === 'buy' ? 'purchase' : 'cash-out'} didn’t complete. Contact ${who} with reference ${reference(t)}.`
      : t.direction === 'buy'
        ? ' No USDC was added to your wallet.'
        : '';
  return `${what}${reason}.${next}`.slice(0, 300);
}

/** The notification for a transaction's current state, if it deserves one. Money is always told. */
export function notificationFor(t: OnrampView): NotifyInput | null {
  const key = `onramp:${t.transactionId}:${t.state}`;
  const who = providerName(t.provider);
  const local = fiat(t);
  if (t.state === 'completed') {
    if (t.direction === 'buy') {
      return {
        kind: 'reward',
        title: t.usdcAmount && t.usdcAmount > 0n ? `${usd(t.usdcAmount)} added to your wallet` : 'Money added to your wallet',
        body: `${local ? `${local} through ${who}` : `Your top-up through ${who}`} is in your wallet and ready to use.`,
        href: '/wallet',
        dedupeKey: key,
        email: true,
        emailAction: 'Open wallet',
      };
    }
    return {
      kind: 'reward',
      title: 'Your cash-out is complete',
      body: `${local ? `${local} through ${who}` : `Your cash-out through ${who}`} is on its way to your account.`,
      href: '/wallet',
      dedupeKey: key,
      email: true,
    };
  }
  // Failures are worth a message only when money was taken; an abandoned or declined payment isn't.
  if ((t.state === 'failed' || t.state === 'canceled') && t.progress >= 2) {
    return {
      kind: 'problem',
      title: t.direction === 'buy' ? 'Your top-up didn’t complete' : 'Your cash-out didn’t complete',
      body: `${local ?? 'Your payment'} through ${who} was paid but the ${t.direction === 'buy' ? 'purchase' : 'cash-out'} didn’t complete. Contact ${who} with reference ${reference(t)}.`,
      href: '/wallet',
      dedupeKey: key,
      email: true,
    };
  }
  return null;
}
