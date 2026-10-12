import { fromLocalRampBuyStatus, fromLocalRampWebhook, verifyLocalRampToken } from './localramp.js';
import { mapAmounts, parseEvent } from './onramp-mapping.js';

const codes = { usdcId: 'usdc_sol', buyCurrency: 'USDC_SOL', sellCurrency: 'USDC' };
const at = new Date('2026-10-11T12:00:00Z');
const ok = (e: Record<string, unknown> | null) => {
  const p = parseEvent(e);
  if (!p.ok) throw new Error(p.reason);
  return p.event;
};

describe('LocalRamp', () => {
  it('checks the webhook token in constant time and refuses blanks', () => {
    expect(verifyLocalRampToken('tok_123', 'tok_123')).toBe(true);
    expect(verifyLocalRampToken(' tok_123 ', 'tok_123')).toBe(true);
    expect(verifyLocalRampToken('tok_124', 'tok_123')).toBe(false);
    expect(verifyLocalRampToken(undefined, 'tok_123')).toBe(false);
    expect(verifyLocalRampToken('', '')).toBe(false);
  });

  it('turns "fiat received" into a paid buy with the naira amount', () => {
    const e = ok(fromLocalRampWebhook({ event_type: 'buy.fiat_received', reference: 'ss_abc', sent_amount: '15500.00', sender_currency: 'NGN' }, at, codes));
    expect(e).toMatchObject({ transactionId: 'ss_abc', partnerContext: 'ss_abc', direction: 'buy', state: 'paid', inAmount: 15500, sourceCurrency: 'ngn' });
    const m = mapAmounts(e, 'buy', 'usdc_sol');
    expect(m).toMatchObject({ ok: true, amounts: { fiatCurrency: 'NGN', usdc: null } });
  });

  it('turns "crypto sent" into a completed buy with the USDC amount and transaction', () => {
    const e = ok(fromLocalRampWebhook({ event_type: 'buy.crypto_sent', reference: 'ss_abc', received_amount: '9.87', receiver_currency: 'USDC_SOL', txid: '5xYz' }, at, codes));
    expect(e).toMatchObject({ state: 'completed', outAmount: 9.87, transactionHash: '5xYz' });
    expect(mapAmounts(e, 'buy', 'usdc_sol')).toMatchObject({ ok: true, amounts: { usdc: 9_870_000n } });
  });

  it('parks a buy that delivered a different coin instead of guessing', () => {
    const e = ok(fromLocalRampWebhook({ event_type: 'buy.crypto_sent', reference: 'ss_abc', received_amount: '10', receiver_currency: 'USDT_TRX', txid: 't' }, at, codes));
    expect(mapAmounts(e, 'buy', 'usdc_sol').ok).toBe(false);
  });

  it('maps sell results by our reference, keeping LocalRamp’s for support', () => {
    const e = ok(fromLocalRampWebhook({ event_type: 'sell.completed', tx_ext_reference: 'ss_sell', reference: 'SELL_x', from_currency: 'USDC', to_currency: 'NGN', to_amount: '15000' }, at, codes));
    expect(e).toMatchObject({ transactionId: 'ss_sell', direction: 'sell', state: 'completed', providerTransactionId: 'SELL_x', outAmount: 15000 });
    expect(ok(fromLocalRampWebhook({ event_type: 'sell.failed', tx_ext_reference: 'ss_sell', reference: 'SELL_x', from_currency: 'USDC', to_currency: 'NGN', to_amount: '1' }, at, codes)).state).toBe('failed');
  });

  it('ignores events that are not one of our transactions', () => {
    expect(fromLocalRampWebhook({ event_type: 'swap.completed', reference: 'SWAP_1' }, at, codes)).toBeNull();
    expect(fromLocalRampWebhook({ event_type: 'sell.initiated', reference: 'SELL_1' }, at, codes)).toBeNull();
    expect(fromLocalRampWebhook({ event_type: 'buy.crypto_sent' }, at, codes)).toBeNull();
  });

  it('maps the status endpoint’s states', () => {
    const base = { reference: 'ss_abc', sent_amount: '15400', sender_currency: 'NGN', received_amount: '9.8', receiver_currency: 'USDC_SOL', destination_address: 'Wallet111', txid: null };
    expect(ok(fromLocalRampBuyStatus({ ...base, state: 'awaiting_payment' }, at, codes)).state).toBe('new');
    expect(ok(fromLocalRampBuyStatus({ ...base, state: 'pending' }, at, codes)).state).toBe('paid');
    expect(ok(fromLocalRampBuyStatus({ ...base, state: 'completed', txid: 'sig' }, at, codes))).toMatchObject({ state: 'completed', walletAddress: 'Wallet111', transactionHash: 'sig' });
    expect(fromLocalRampBuyStatus({ ...base, state: 'mystery' }, at, codes)).toBeNull();
  });
});
