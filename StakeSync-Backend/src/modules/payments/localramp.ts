// LocalRamp (https://docs.localramp.co): naira and other African currencies in and out of USDC.
// Its webhook and status payloads are translated into the shape the Onramper pipeline already
// understands (onramp-mapping.ts), so both providers share one set of rules: forward-only status,
// on-chain confirmation of top-ups, one history row per transaction, deduplicated notifications.

import { timingSafeEqual } from 'node:crypto';

/** LocalRamp sends the token set in its dashboard in `localramp-webhook-token`. Compared in constant time. */
export function verifyLocalRampToken(header: string | undefined, token: string) {
  const a = Buffer.from(header?.trim() ?? '');
  const b = Buffer.from(token);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

const COUNTRY: Record<string, string> = { NGN: 'NG', GHS: 'GH', KES: 'KE', ZMW: 'ZM', RWF: 'RW', UGX: 'UG', XOF: 'CI', XAF: 'CM' };
export const countryFor = (fiat: string) => COUNTRY[fiat.toUpperCase()] ?? 'NG';

export interface LocalRampCodes {
  /** Onramper's USDC id, which the shared pipeline compares currencies against. */
  usdcId: string;
  buyCurrency: string;
  sellCurrency: string;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

/** LocalRamp's coin code to the pipeline's USDC id when it's ours; anything else is kept (and gets parked). */
function crypto(code: string | null, ours: string, codes: LocalRampCodes) {
  if (!code) return codes.usdcId;
  return code.toUpperCase() === ours.toUpperCase() ? codes.usdcId : code.toLowerCase();
}

/**
 * A LocalRamp webhook as an Onramper-shaped event. `null` for events that don't describe one of our
 * transactions (swaps, and sell.initiated, which only carries LocalRamp's own reference).
 * LocalRamp payloads carry no timestamp, so the time we received it stands in for the status date.
 */
export function fromLocalRampWebhook(p: Record<string, unknown>, receivedAt: Date, codes: LocalRampCodes): Record<string, unknown> | null {
  const type = str(p.event_type);
  const base = { onramp: 'localramp', statusDate: receivedAt.toISOString(), original: p };
  switch (type) {
    case 'buy.fiat_received': {
      const ref = str(p.reference);
      return !ref ? null : {
        ...base,
        transactionId: ref,
        partnerContext: ref,
        transactionType: 'buy',
        status: 'paid',
        inAmount: str(p.sent_amount),
        sourceCurrency: str(p.sender_currency)?.toLowerCase() ?? null,
        targetCurrency: codes.usdcId,
      };
    }
    case 'buy.crypto_sent': {
      const ref = str(p.reference);
      return !ref ? null : {
        ...base,
        transactionId: ref,
        partnerContext: ref,
        transactionType: 'buy',
        status: 'completed',
        outAmount: str(p.received_amount),
        targetCurrency: crypto(str(p.receiver_currency), codes.buyCurrency, codes),
        transactionHash: str(p.txid),
      };
    }
    case 'sell.completed':
    case 'sell.failed': {
      const ref = str(p.tx_ext_reference);
      return !ref ? null : {
        ...base,
        transactionId: ref,
        partnerContext: ref,
        onrampTransactionId: str(p.reference),
        transactionType: 'sell',
        status: type === 'sell.completed' ? 'completed' : 'failed',
        outAmount: str(p.to_amount),
        sourceCurrency: crypto(str(p.from_currency), codes.sellCurrency, codes),
        targetCurrency: str(p.to_currency)?.toLowerCase() ?? null,
      };
    }
    default:
      return null;
  }
}

/** LocalRamp buy states to the pipeline's: awaiting_payment = new, pending = paid (being processed), completed. */
const BUY_STATE: Record<string, string> = { awaiting_payment: 'new', pending: 'paid', completed: 'completed' };

/** The buy status endpoint's `data` as an Onramper-shaped event, or null if the state is unknown. */
export function fromLocalRampBuyStatus(d: Record<string, unknown>, checkedAt: Date, codes: LocalRampCodes): Record<string, unknown> | null {
  const ref = str(d.reference);
  const state = BUY_STATE[str(d.state) ?? ''];
  if (!ref || !state) return null;
  return {
    onramp: 'localramp',
    original: d,
    transactionId: ref,
    partnerContext: ref,
    transactionType: 'buy',
    status: state,
    statusDate: checkedAt.toISOString(),
    inAmount: str(d.sent_amount),
    outAmount: str(d.received_amount),
    sourceCurrency: str(d.sender_currency)?.toLowerCase() ?? null,
    targetCurrency: crypto(str(d.receiver_currency), codes.buyCurrency, codes),
    walletAddress: str(d.destination_address),
    transactionHash: str(d.txid),
  };
}
