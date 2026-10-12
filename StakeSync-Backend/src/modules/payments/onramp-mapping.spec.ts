import { decideTransition, ledgerDetail, ledgerStatus, mapAmounts, normalizeStatus, normalizeType, notificationFor, parseEvent, showInHistory, usdcUnits, type OnrampView } from './onramp-mapping.js';

// Shaped like the sample payload in Onramper's webhook docs.
const sample = {
  apiKey: 'pk_test_x',
  country: 'ng',
  inAmount: 15000,
  onramp: 'gatefi',
  onrampTransactionId: '8bf94c80-test',
  outAmount: 9.5,
  paymentMethod: 'creditcard',
  partnerContext: 'ss_abc',
  sourceCurrency: 'ngn',
  status: 'completed',
  statusDate: '2026-10-01T10:00:00.000Z',
  targetCurrency: 'usdc_sol',
  transactionId: '01H7D547TESTV2RQJ52ZAB7WF7',
  transactionType: 'buy',
  transactionHash: '',
  walletAddress: 'So1anaWa11et',
  partnerFee: '0.01',
};

const parsed = (over: Record<string, unknown> = {}) => {
  const r = parseEvent({ ...sample, ...over });
  if (!r.ok) throw new Error(r.reason);
  return r.event;
};

const at = (iso: string) => new Date(iso);

describe('Onramper event parsing', () => {
  it('reads the documented fields and keeps raw values', () => {
    const e = parsed();
    expect(e).toMatchObject({ transactionId: sample.transactionId, rawType: 'buy', direction: 'buy', rawStatus: 'completed', state: 'completed', provider: 'gatefi', partnerContext: 'ss_abc' });
    expect(e.transactionHash).toBeNull(); // empty string means "none"
    expect(e.statusDate.toISOString()).toBe(sample.statusDate);
  });

  it('accepts every documented spelling of the transaction type, and nothing else', () => {
    expect(normalizeType('buy')).toBe('buy');
    expect(normalizeType('onramp')).toBe('buy'); // Get Transaction / List Transactions
    expect(normalizeType('sell')).toBe('sell'); // webhook docs, page 1
    expect(normalizeType('offramp')).toBe('sell'); // webhook docs, page 2
    expect(normalizeType('swap')).toBeNull();
    expect(parsed({ transactionType: 'swap' })).toMatchObject({ rawType: 'swap', direction: null });
  });

  it('knows only the documented statuses and preserves the rest', () => {
    for (const s of ['new', 'pending', 'paid', 'completed', 'failed', 'canceled']) expect(normalizeStatus(s)).toBe(s);
    expect(normalizeStatus('test')).toBeNull(); // appears in Onramper's List Transactions example
    expect(normalizeStatus('refunded')).toBeNull(); // not documented, so not invented
    expect(parsed({ status: 'test' })).toMatchObject({ rawStatus: 'test', state: null });
  });

  it('refuses payloads without the fields everything depends on', () => {
    expect(parseEvent(null).ok).toBe(false);
    expect(parseEvent([]).ok).toBe(false);
    expect(parseEvent({ ...sample, transactionId: '../../etc' }).ok).toBe(false);
    expect(parseEvent({ ...sample, statusDate: 'yesterday' }).ok).toBe(false);
    expect(parseEvent({ ...sample, status: undefined }).ok).toBe(false);
  });

  it('turns float amounts into exact USDC units and rejects nonsense', () => {
    expect(usdcUnits(3.83527521)).toBe(3_835_275n);
    expect(usdcUnits(99.99999999999999)).toBe(100_000_000n);
    expect(usdcUnits(1e-7)).toBe(0n);
    expect(parsed({ outAmount: '12.5' }).outAmount).toBe(12.5); // numeric strings are fine
    expect(parsed({ outAmount: -1 }).outAmount).toBeNull();
    expect(parsed({ outAmount: 'NaN' }).outAmount).toBeNull();
    expect(parsed({ outAmount: 1e13 }).outAmount).toBeNull();
  });
});

describe('Onramper amount mapping', () => {
  it('buys: fiat in, USDC out', () => {
    const r = mapAmounts(parsed(), 'buy', 'usdc_sol');
    expect(r).toEqual({ ok: true, amounts: { usdc: 9_500_000n, fiatAmount: '15000.00000000', fiatCurrency: 'NGN' } });
  });

  it('sells: USDC in, fiat out (the opposite fields)', () => {
    const e = parsed({ transactionType: 'offramp', sourceCurrency: 'usdc_sol', inAmount: 20, targetCurrency: 'ngn', outAmount: 30000 });
    expect(mapAmounts(e, 'sell', 'usdc_sol')).toEqual({ ok: true, amounts: { usdc: 20_000_000n, fiatAmount: '30000.00000000', fiatCurrency: 'NGN' } });
  });

  it('parks anything where USDC is not on the side the direction says', () => {
    expect(mapAmounts(parsed({ targetCurrency: 'sol' }), 'buy', 'usdc_sol').ok).toBe(false);
    // A "sell" shaped like a buy is not silently flipped.
    expect(mapAmounts(parsed({ transactionType: 'sell' }), 'sell', 'usdc_sol').ok).toBe(false);
  });
});

describe('Onramper status transitions', () => {
  const t0 = at('2026-10-01T10:00:00Z');
  const t1 = at('2026-10-01T10:01:00Z');
  const t2 = at('2026-10-01T10:02:00Z');
  const cur = (state: Parameters<typeof decideTransition>[1]['state'], d = t1) => ({ state, statusDate: d });

  it('applies the first event and forward progress', () => {
    expect(decideTransition(null, cur('pending'), false).action).toBe('apply');
    expect(decideTransition(cur('new'), cur('pending', t2), false).action).toBe('apply');
    // Progress wins even if the provider's clock dated it earlier (out-of-order delivery).
    expect(decideTransition(cur('pending'), cur('paid', t0), false).action).toBe('apply');
    expect(decideTransition(cur('paid'), cur('completed', t0), false).action).toBe('apply');
  });

  it('ignores repeats and steps backwards', () => {
    expect(decideTransition(cur('pending'), cur('pending'), false).action).toBe('duplicate');
    expect(decideTransition(cur('paid'), cur('pending', t2), false).action).toBe('stale');
    expect(decideTransition(cur('paid'), cur('failed', t0), false).action).toBe('stale'); // failure older than progress
    expect(decideTransition(cur('failed'), cur('pending', t2), false).action).toBe('stale');
  });

  it('refreshes a completed transaction with newer details', () => {
    expect(decideTransition(cur('completed'), cur('completed', t2), false).action).toBe('apply');
    expect(decideTransition(cur('completed'), cur('completed', t0), false).action).toBe('duplicate');
  });

  it('never reverses a completed transaction', () => {
    for (const s of ['failed', 'canceled', 'pending', 'paid', 'new'] as const) {
      expect(decideTransition(cur('completed'), cur(s, t2), true).action).toBe('review');
    }
    // A failure is a conflict even if dated earlier; an earlier step arriving late is just stale.
    expect(decideTransition(cur('completed'), cur('failed', t0), true).action).toBe('review');
    expect(decideTransition(cur('completed'), cur('pending', t0), true).action).toBe('stale');
    expect(decideTransition(cur('completed'), cur('paid'), true).action).toBe('stale');
  });

  it('accepts completed after a failure only with independent evidence', () => {
    expect(decideTransition(cur('failed'), cur('completed', t2), false)).toMatchObject({ action: 'review' });
    expect(decideTransition(cur('failed'), cur('completed', t2), true).action).toBe('apply');
    expect(decideTransition(cur('canceled'), cur('completed', t2), true).action).toBe('apply');
    // Dated before the failure: a late copy of an old event, not a recovery.
    expect(decideTransition(cur('failed'), cur('completed', t0), true).action).toBe('review');
  });

  it('lets a newer failure replace another', () => {
    expect(decideTransition(cur('failed'), cur('canceled', t2), false).action).toBe('apply');
    expect(decideTransition(cur('failed'), cur('canceled', t0), false).action).toBe('stale');
  });
});

describe('Onramper money history and notifications', () => {
  const view = (over: Partial<OnrampView> = {}): OnrampView => ({
    transactionId: 'tx1',
    direction: 'buy',
    state: 'completed',
    progress: 3,
    usdcAmount: 9_500_000n,
    fiatAmount: '15000.00000000',
    fiatCurrency: 'NGN',
    provider: 'gatefi',
    providerTransactionId: 'gf-1',
    statusReason: null,
    ...over,
  });

  it('maps statuses onto the existing ledger statuses', () => {
    expect(ledgerStatus('new')).toBeNull();
    expect(ledgerStatus('pending')).toBe('pending');
    expect(ledgerStatus('paid')).toBe('pending');
    expect(ledgerStatus('completed')).toBe('confirmed');
    expect(ledgerStatus('failed')).toBe('failed');
    expect(ledgerStatus('canceled')).toBe('failed');
  });

  it('hides widgets that were opened and closed, but shows real failures', () => {
    expect(showInHistory({ state: 'new', progress: 0 })).toBe(false);
    expect(showInHistory({ state: 'canceled', progress: 0 })).toBe(false);
    expect(showInHistory({ state: 'canceled', progress: 1 })).toBe(true);
    expect(showInHistory({ state: 'failed', progress: 0 })).toBe(true);
  });

  it('explains failures with a next step and never claims a refund', () => {
    const taken = ledgerDetail(view({ state: 'failed', progress: 2, statusReason: 'Card declined by issuer' }))!;
    expect(taken).toContain('Card declined by issuer');
    expect(taken).toContain('Contact Gatefi with reference gf-1');
    expect(taken.toLowerCase()).not.toContain('refund');
    expect(ledgerDetail(view({ state: 'failed', progress: 1 }))).toBe('Didn’t go through. No USDC was added to your wallet.');
    expect(ledgerDetail(view({ state: 'pending', progress: 1 }))).toBe('Waiting for Gatefi to finish.');
    expect(ledgerDetail(view())).toBeNull();
  });

  it('notifies a completed top-up once per state, by email when allowed', () => {
    const n = notificationFor(view())!;
    expect(n).toMatchObject({ kind: 'reward', title: '$9.50 added to your wallet', dedupeKey: 'onramp:tx1:completed', email: true, href: '/wallet' });
    expect(n.body).toContain('15,000 NGN through Gatefi');
  });

  it('only bothers people about failures when money was taken', () => {
    expect(notificationFor(view({ state: 'pending', progress: 1 }))).toBeNull();
    expect(notificationFor(view({ state: 'failed', progress: 1 }))).toBeNull();
    expect(notificationFor(view({ state: 'canceled', progress: 0 }))).toBeNull();
    const n = notificationFor(view({ state: 'failed', progress: 2 }))!;
    expect(n).toMatchObject({ kind: 'problem', dedupeKey: 'onramp:tx1:failed', email: true });
    expect(n.body.toLowerCase()).not.toContain('refund');
  });
});
