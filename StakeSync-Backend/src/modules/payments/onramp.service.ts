import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, createPrivateKey, randomUUID, sign, timingSafeEqual, type KeyObject } from 'node:crypto';
import { AppError } from '../../common/errors.js';

const EMPTY_BODY_SHA256 = createHash('sha256').update('').digest('hex');

/**
 * Onramper signs each webhook payload with the secret it issues at registration: an HMAC-SHA256 hex
 * digest in X-Onramper-Webhook-Signature (https://docs.onramper.com/docs/optional-set-up-webhooks).
 * Checked against the exact bytes received, in constant time.
 */
export function verifyWebhookSignature(rawBody: Buffer, header: string | undefined, secret: string) {
  const given = header?.trim().toLowerCase() ?? '';
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(given, 'hex'));
}

/**
 * Local currency in and out through Onramper. It routes each purchase to licensed on-ramps
 * (cards, bank transfer, mobile money) and USDC lands straight in the person's own wallet, so
 * Stake-Sync never holds money. Selling works the same way in reverse, paying out to their bank.
 *
 * Widget URLs carry the wallet address, so they're signed server-side with Onramper's V2 scheme
 * (Ed25519): https://docs.onramper.com/docs/widget-sign-a-url-v2
 */
@Injectable()
export class OnrampService {
  private readonly apiKey?: string;
  private readonly key?: KeyObject;
  private readonly baseUrl: string;
  private readonly usdcId: string;
  private readonly defaultFiat: string;
  private readonly apiUrl: string;
  private readonly webhookSecret?: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get('onramp.apiKey');
    const pem = config.get<string>('onramp.signingKey');
    this.key = pem ? createPrivateKey(pem.replace(/\\n/g, '\n')) : undefined;
    this.baseUrl = config.get('onramp.baseUrl') ?? 'https://buy.onramper.com';
    this.usdcId = config.get('onramp.usdcId') ?? 'usdc_sol';
    this.defaultFiat = config.get('onramp.defaultFiat') ?? 'NGN';
    this.apiUrl = config.get('onramp.apiUrl') ?? 'https://api.onramper.com';
    this.webhookSecret = config.get('onramp.webhookSecret');
  }

  get enabled() {
    return Boolean(this.apiKey && this.key);
  }

  /**
   * A single-use, signed widget link (valid 15 minutes) for buying or selling USDC. `partnerContext`
   * is signed with the rest, so the session it names can't be swapped, and Onramper echoes it back.
   */
  widgetUrl(input: { mode: 'buy' | 'sell'; wallet: string; partnerContext: string; fiat?: string; amount?: number; returnUrl: string }) {
    if (!this.enabled) {
      throw new AppError('onramp_unavailable', 'Paying in local currency isn’t available yet. You can top up from a Solana wallet instead.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    const fields: Record<string, string> = {
      apiKey: this.apiKey!,
      mode: input.mode,
      defaultCrypto: this.usdcId,
      onlyCryptos: this.usdcId,
      defaultFiat: (input.fiat ?? this.defaultFiat).toUpperCase(),
      wallets: `${this.usdcId}:${input.wallet}`,
      partnerContext: input.partnerContext,
      successRedirectUrl: input.returnUrl,
      ...(input.amount ? { defaultAmount: String(input.amount) } : {}),
    };
    return { url: this.sign(fields), expiresInMinutes: 15 };
  }

  /**
   * One transaction from Onramper's API (https://docs.onramper.com/reference/get_transactions-transactionid),
   * authenticated with the API key and the webhook secret. Only used by reconciliation, which is off
   * until this response has been checked against real transactions.
   */
  async fetchTransaction(transactionId: string): Promise<unknown> {
    if (!this.apiKey || !this.webhookSecret) throw new Error('Onramper API key or webhook secret missing');
    const res = await fetch(`${this.apiUrl}/transactions/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: this.apiKey, 'x-onramper-secret': this.webhookSecret, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Onramper API answered ${res.status}`);
    return res.json();
  }

  /** Onramper V2: Ed25519 over an 8-line canonical string of the signed fields. */
  private sign(fields: Record<string, string>) {
    const timestamp = new Date().toISOString();
    const nonce = randomUUID();
    const expiry = new Date(Date.now() + 15 * 60_000).toISOString();
    const keys = Object.keys(fields).sort();
    const canonicalQuery = new URLSearchParams(keys.map((k) => [k, fields[k]])).toString();
    const canonical = ['ONRAMPER-SIG-V2', timestamp, nonce, 'GET', '/', canonicalQuery, '', EMPTY_BODY_SHA256].join('\n');
    const signature = sign(null, Buffer.from(canonical, 'utf8'), this.key!).toString('base64');
    const url = new URL(this.baseUrl);
    for (const k of keys) url.searchParams.set(k, fields[k]);
    url.searchParams.set('sigV2', `v2:${signature}`);
    url.searchParams.set('sigV2Timestamp', timestamp);
    url.searchParams.set('sigV2Nonce', nonce);
    url.searchParams.set('sigV2Expiry', expiry);
    url.searchParams.set('sigV2Fields', keys.join(','));
    return url.toString();
  }
}
