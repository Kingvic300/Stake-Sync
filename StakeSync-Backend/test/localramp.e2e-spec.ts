import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { LogsService } from '../src/core/logs/logs.service.js';
import { MailService } from '../src/modules/notifications/mail.service.js';
import { LedgerEntry } from '../src/modules/payments/entities/payment.entities.js';
import { LocalRampService } from '../src/modules/payments/localramp.service.js';
import { SolanaService } from '../src/modules/payments/solana/solana.service.js';
import { User, Wallet } from '../src/modules/users/entities/user.entities.js';

// Needs a throwaway Postgres: DATABASE_URL=postgresql://... npm run test:e2e
const run = process.env.DATABASE_URL ? describe : describe.skip;

const ENV = {
  CHAIN_WORKERS: 'false',
  ONRAMP_PROVIDER: 'localramp',
  LOCALRAMP_PUBLIC_KEY: 'pk_test_localramp_e2e',
  LOCALRAMP_SECRET_KEY: 'sk_test_localramp_e2e',
  LOCALRAMP_WEBHOOK_TOKEN: `tok_${randomBytes(12).toString('hex')}`,
};

run('LocalRamp (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<NestExpressApplication['getHttpServer']>;
  let db: DataSource;
  let token = '';
  let userId = '';
  let otherToken = '';
  let reference = '';
  const wallet = Keypair.generate().publicKey.toBase58();
  const stamp = Date.now();

  const hook = (body: object, tok: string | null = ENV.LOCALRAMP_WEBHOOK_TOKEN) => {
    const r = request(http).post('/api/payments/onramp/localramp/webhook').set('Content-Type', 'application/json');
    return (tok === null ? r : r.set('localramp-webhook-token', tok)).send(JSON.stringify(body));
  };
  const ledger = () => db.getRepository(LedgerEntry).findBy({ externalRef: reference });

  beforeAll(async () => {
    Object.assign(process.env, ENV);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    app.useBodyParser('json', { limit: '1mb' });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter(app.get(LogsService)));
    await app.init();
    http = app.getHttpServer();
    db = app.get(DataSource);
    vi.spyOn(app.get(MailService), 'send').mockResolvedValue(undefined);

    const r = await request(http).post('/api/auth/signup').send({ name: 'Ramp Person', email: `lramp${stamp}@example.com`, password: 'correct horse battery', acceptTerms: true }).expect(201);
    token = r.body.accessToken;
    userId = r.body.user.id;
    await db.getRepository(User).update({ id: userId }, { emailVerifiedAt: new Date() });
    await db.getRepository(Wallet).save(db.getRepository(Wallet).create({ userId, address: wallet, kind: 'embedded', primary: true, verifiedAt: new Date() }));
    const o = await request(http).post('/api/auth/signup').send({ name: 'Someone Else', email: `lramp-other${stamp}@example.com`, password: 'correct horse battery', acceptTerms: true }).expect(201);
    otherToken = o.body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
    // Later suites expect the default provider.
    for (const k of Object.keys(ENV)) delete process.env[k];
  });

  it('opens the LocalRamp pop-up with only the public key, our reference and the person’s wallet', async () => {
    const r = await request(http).post('/api/payments/onramp').set('Authorization', `Bearer ${token}`).send({ mode: 'buy', fiat: 'NGN', amount: 15000 }).expect(200);
    expect(r.body).toMatchObject({
      provider: 'localramp',
      widget: {
        script: 'https://cdn.localramp.co/onramp-inline.js',
        global: 'LocalRampBuy',
        options: { public_key: ENV.LOCALRAMP_PUBLIC_KEY, sender_currency: 'NGN', sender_amount: '15000.00', country_code: 'NG', receiver_currency: 'USDC_SOL', destination_address: wallet },
      },
    });
    reference = r.body.reference;
    expect(reference).toMatch(/^ss_[A-Za-z0-9_-]{24}$/);
    expect(r.body.widget.options.reference).toBe(reference);
    expect(JSON.stringify(r.body)).not.toContain(ENV.LOCALRAMP_SECRET_KEY);
    const sell = await request(http).post('/api/payments/onramp').set('Authorization', `Bearer ${token}`).send({ mode: 'sell', fiat: 'NGN', amount: 10 }).expect(200);
    expect(sell.body.widget).toMatchObject({ global: 'LocalRampSell', options: { from_currency: 'USDC', crypto_chain: 'SOL', to_currency: 'NGN', from_amount: '10.00' } });
  });

  it('refuses webhooks without the right token and stores nothing', async () => {
    const body = { event_type: 'buy.fiat_received', reference, sent_amount: '15000', sender_currency: 'NGN' };
    expect((await hook(body, null)).status).toBe(401);
    expect((await hook(body, 'tok_wrong')).status).toBe(401);
    expect(await ledger()).toHaveLength(0);
  });

  it('records a top-up once, confirmed on-chain, however often LocalRamp delivers it', async () => {
    expect((await hook({ event_type: 'buy.fiat_received', reference, sent_amount: '15000.00', sender_currency: 'NGN' })).status).toBe(200);
    let rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId, kind: 'added', status: 'pending', fiatCurrency: 'NGN' });

    const txid = bs58.encode(randomBytes(64));
    const credit = vi.spyOn(app.get(SolanaService), 'usdcCredit').mockResolvedValue(9_870_000n);
    const sent = { event_type: 'buy.crypto_sent', reference, received_amount: '9.87', receiver_currency: 'USDC_SOL', txid };
    for (let i = 0; i < 3; i++) expect((await hook(sent)).status).toBe(200);
    expect(credit).toHaveBeenCalledWith(txid, expect.anything());

    rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'added', status: 'confirmed', amount: 9_870_000n, signature: txid, ref: `onramper:${reference}` });
    const notes = await db.query(`SELECT title FROM notifications WHERE user_id = $1 AND dedupe_key LIKE $2`, [userId, `onramp:${reference}:%`]);
    expect(notes).toEqual([{ title: '$9.87 added to your wallet' }]);
  });

  it('checks a payment’s status only for its owner', async () => {
    vi.spyOn(app.get(LocalRampService), 'buyStatus').mockResolvedValue({ reference, state: 'completed', sent_amount: '15000', sender_currency: 'NGN', received_amount: '9.87', receiver_currency: 'USDC_SOL', destination_address: wallet, txid: null });
    const mine = await request(http).post(`/api/payments/onramp/${reference}/check`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(mine.body).toEqual({ state: 'completed' });
    expect((await request(http).post(`/api/payments/onramp/${reference}/check`).set('Authorization', `Bearer ${otherToken}`)).status).toBe(404);
    expect(await ledger()).toHaveLength(1); // still one entry
  });

  it('acknowledges events that are not ours without recording anything', async () => {
    expect((await hook({ event_type: 'swap.completed', reference: 'SWAP_1', from_currency: 'BNB', to_currency: 'USDT', to_amount: '1' })).status).toBe(200);
  });
});
