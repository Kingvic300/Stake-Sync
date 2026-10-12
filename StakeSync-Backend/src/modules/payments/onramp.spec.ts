import { createHash, createHmac, generateKeyPairSync, verify } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { OnrampService, verifyWebhookSignature } from './onramp.service.js';

describe('Onramper V2 signed widget links', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const config = {
    get: (k: string) =>
      ({
        'onramp.apiKey': 'pk_test_123',
        'onramp.signingKey': privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        'onramp.baseUrl': 'https://buy.onramper.dev',
        'onramp.usdcId': 'usdc_sol',
        'onramp.defaultFiat': 'NGN',
      })[k],
  } as unknown as ConfigService;
  const onramp = new OnrampService(config);

  it('sends USDC on Solana to the person’s own wallet and signs every core field', () => {
    const { url } = onramp.widgetUrl({ mode: 'buy', wallet: 'So1anaWa11et', partnerContext: 'ss_test', amount: 15000, returnUrl: 'https://app/wallet' });
    const u = new URL(url);
    expect(u.searchParams.get('wallets')).toBe('usdc_sol:So1anaWa11et');
    expect(u.searchParams.get('defaultFiat')).toBe('NGN');
    const fields = u.searchParams.get('sigV2Fields')!.split(',');
    expect(fields).toEqual([...fields].sort());
    expect(fields).toContain('apiKey');
    expect(fields).toContain('wallets');

    // Rebuild the canonical string the way Onramper does and check the signature.
    const query = new URLSearchParams(fields.map((k) => [k, u.searchParams.get(k)!])).toString();
    const canonical = ['ONRAMPER-SIG-V2', u.searchParams.get('sigV2Timestamp'), u.searchParams.get('sigV2Nonce'), 'GET', '/', query, '', createHash('sha256').update('').digest('hex')].join('\n');
    const sig = Buffer.from(u.searchParams.get('sigV2')!.replace(/^v2:/, ''), 'base64');
    expect(verify(null, Buffer.from(canonical), publicKey, sig)).toBe(true);
  });

  it('signs the session reference so it can’t be swapped', () => {
    const u = new URL(onramp.widgetUrl({ mode: 'buy', wallet: 'W', partnerContext: 'ss_session', returnUrl: 'https://x' }).url);
    expect(u.searchParams.get('partnerContext')).toBe('ss_session');
    expect(u.searchParams.get('sigV2Fields')!.split(',')).toContain('partnerContext');
  });

  it('makes a new nonce every time (links are single-use)', () => {
    const a = new URL(onramp.widgetUrl({ mode: 'sell', wallet: 'W', partnerContext: 'ss_x', returnUrl: 'https://x' }).url);
    const b = new URL(onramp.widgetUrl({ mode: 'sell', wallet: 'W', partnerContext: 'ss_x', returnUrl: 'https://x' }).url);
    expect(a.searchParams.get('sigV2Nonce')).not.toBe(b.searchParams.get('sigV2Nonce'));
  });
});

describe('Onramper webhook signatures', () => {
  const secret = 'whsec_test_0123456789';
  const body = Buffer.from('{"transactionId":"01H7","status":"completed"}');
  const sig = (b: Buffer, s = secret) => createHmac('sha256', s).update(b).digest('hex');

  it('accepts the HMAC-SHA256 hex digest of the exact bytes received', () => {
    expect(verifyWebhookSignature(body, sig(body), secret)).toBe(true);
    expect(verifyWebhookSignature(body, sig(body).toUpperCase(), secret)).toBe(true);
  });

  it('rejects any change to the body, a different secret, or a malformed header', () => {
    const tampered = Buffer.from(body);
    tampered[tampered.length - 2] ^= 1;
    expect(verifyWebhookSignature(tampered, sig(body), secret)).toBe(false);
    // Re-serialised JSON is not the bytes that were signed.
    expect(verifyWebhookSignature(Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 1)), sig(body), secret)).toBe(false);
    expect(verifyWebhookSignature(body, sig(body, 'other-secret'), secret)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
    expect(verifyWebhookSignature(body, '', secret)).toBe(false);
    expect(verifyWebhookSignature(body, sig(body).slice(0, 63), secret)).toBe(false);
    expect(verifyWebhookSignature(body, `sha256=${sig(body)}`, secret)).toBe(false);
    expect(verifyWebhookSignature(body, 'z'.repeat(64), secret)).toBe(false);
  });
});
