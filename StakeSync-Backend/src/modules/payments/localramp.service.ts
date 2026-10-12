import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors.js';
import { countryFor, type LocalRampCodes } from './localramp.js';

/** Settings for LocalRamp's pop-up, and its transaction status API. */
@Injectable()
export class LocalRampService {
  private readonly publicKey?: string;
  private readonly secretKey?: string;
  private readonly apiUrl: string;
  readonly webhookToken?: string;
  readonly codes: LocalRampCodes;
  private readonly sellChain: string;

  constructor(config: ConfigService) {
    this.publicKey = config.get<string>('localramp.publicKey')?.trim() || undefined;
    this.secretKey = config.get<string>('localramp.secretKey')?.trim() || undefined;
    this.webhookToken = config.get<string>('localramp.webhookToken')?.trim() || undefined;
    this.apiUrl = (config.get<string>('localramp.apiUrl') ?? 'https://api.localramp.co').replace(/\/$/, '');
    this.codes = {
      usdcId: config.get<string>('onramp.usdcId') ?? 'usdc_sol',
      buyCurrency: config.get<string>('localramp.buyCurrency') ?? 'USDC_SOL',
      sellCurrency: config.get<string>('localramp.sellCurrency') ?? 'USDC',
    };
    this.sellChain = config.get<string>('localramp.sellChain') ?? 'SOL';
  }

  get enabled() {
    return Boolean(this.publicKey);
  }

  /**
   * What the member app passes to LocalRamp's pop-up (window.LocalRampBuy / LocalRampSell). Only the
   * public key leaves the server; `reference` is our random session reference, echoed in webhooks.
   */
  widget(input: { mode: 'buy' | 'sell'; reference: string; wallet: string; fiat: string; amount?: number; email?: string | null }) {
    if (!this.publicKey) throw new AppError('onramp_unavailable', 'Paying in local currency isn’t available yet. You can top up from a Solana wallet instead.', HttpStatus.SERVICE_UNAVAILABLE);
    const fiat = input.fiat.toUpperCase();
    const amount = input.amount ? input.amount.toFixed(2) : undefined;
    const common = { public_key: this.publicKey, reference: input.reference, country_code: countryFor(fiat), ...(input.email ? { email: input.email } : {}) };
    return input.mode === 'buy'
      ? {
          script: 'https://cdn.localramp.co/onramp-inline.js',
          global: 'LocalRampBuy' as const,
          options: { ...common, sender_currency: fiat, ...(amount ? { sender_amount: amount } : {}), receiver_currency: this.codes.buyCurrency, destination_address: input.wallet },
        }
      : {
          script: 'https://cdn.localramp.co/onramp-inline.js',
          global: 'LocalRampSell' as const,
          options: { ...common, from_currency: this.codes.sellCurrency, crypto_chain: this.sellChain, to_currency: fiat, ...(amount ? { from_amount: amount } : {}) },
        };
  }

  /** GET /v1/transaction/buy/status/:reference with the secret key. */
  async buyStatus(reference: string): Promise<Record<string, unknown>> {
    if (!this.secretKey) throw new Error('LOCALRAMP_SECRET_KEY missing');
    const res = await fetch(`${this.apiUrl}/v1/transaction/buy/status/${encodeURIComponent(reference)}`, {
      headers: { 'x-auth-token': this.secretKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`LocalRamp answered ${res.status}`);
    const body = (await res.json()) as { data?: Record<string, unknown> };
    if (!body.data) throw new Error('LocalRamp status response had no data');
    return body.data;
  }
}
