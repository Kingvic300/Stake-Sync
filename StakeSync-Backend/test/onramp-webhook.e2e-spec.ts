import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { LogsService } from '../src/core/logs/logs.service.js';
import { requestLogger } from '../src/core/logs/request-logger.js';
import { MailService } from '../src/modules/notifications/mail.service.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { OnrampEvent, OnrampTransaction } from '../src/modules/payments/entities/onramp.entities.js';
import { LedgerEntry } from '../src/modules/payments/entities/payment.entities.js';
import { OnrampWebhookService } from '../src/modules/payments/onramp-webhook.service.js';
import { SolanaService } from '../src/modules/payments/solana/solana.service.js';
import { User, Wallet } from '../src/modules/users/entities/user.entities.js';

// Needs a throwaway Postgres: DATABASE_URL=postgresql://... npm run test:e2e
const run = process.env.DATABASE_URL ? describe : describe.skip;

const SECRET = `whsec_e2e_${randomUUID()}`;
const sign = (raw: string, secret = SECRET) => createHmac('sha256', secret).update(raw).digest('hex');

run('Onramper webhooks (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<NestExpressApplication['getHttpServer']>;
  let db: DataSource;
  let service: OnrampWebhookService;
  let mailSpy: ReturnType<typeof vi.spyOn>;
  let creditSpy: ReturnType<typeof vi.spyOn>;
  const stamp = Date.now();
  let token = '';
  let userId = '';
  const wallet = Keypair.generate().publicKey.toBase58();
  const sessions: Record<'buy' | 'sell', string> = { buy: '', sell: '' };
  let t = Date.parse('2026-10-01T10:00:00.000Z');
  const nextDate = () => new Date((t += 60_000)).toISOString();

  const event = (over: Record<string, unknown>) => ({
    apiKey: 'pk_test_e2e',
    country: 'ng',
    inAmount: 15000,
    onramp: 'gatefi',
    onrampTransactionId: `gf-${randomUUID()}`,
    outAmount: 9.5,
    paymentMethod: 'creditcard',
    partnerContext: sessions.buy,
    sourceCurrency: 'ngn',
    status: 'pending',
    statusDate: nextDate(),
    targetCurrency: 'usdc_sol',
    transactionType: 'buy',
    transactionHash: '',
    walletAddress: wallet,
    partnerFee: '0.01',
    // Fields we don't use must not break anything.
    alternateRouteData: { finalCurrency: 'x', finalAmount: 1 },
    isRecurringPayment: false,
    ...over,
  });

  const deliver = (body: object, signature?: string) => {
    const raw = JSON.stringify(body);
    return request(http).post('/api/payments/onramp/webhook').set('Content-Type', 'application/json').set('X-Onramper-Webhook-Signature', signature ?? sign(raw)).send(raw);
  };

  const ledgerFor = (txId: string) => db.getRepository(LedgerEntry).findBy({ externalRef: txId });
  const eventsFor = (txId: string) => db.getRepository(OnrampEvent).find({ where: { transactionId: txId }, order: { createdAt: 'ASC' } });
  const txFor = (txId: string) => db.getRepository(OnrampTransaction).findOneByOrFail({ transactionId: txId });
  const notificationsFor = (txId: string) => db.query(`SELECT kind, title, body, dedupe_key FROM notifications WHERE user_id = $1 AND dedupe_key LIKE $2`, [userId, `onramp:${txId}:%`]);

  beforeAll(async () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    Object.assign(process.env, {
      CHAIN_WORKERS: 'false',
      ONRAMPER_API_KEY: 'pk_test_e2e',
      ONRAMPER_SIGNING_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      ONRAMPER_WEBHOOKS_ENABLED: 'true',
      ONRAMPER_WEBHOOK_SECRET: SECRET,
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // Same body handling as main.ts: raw bytes kept for signature checks, 1 MB JSON limit.
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    app.useBodyParser('json', { limit: '1mb' });
    const logs = app.get(LogsService);
    app.use(requestLogger(logs));
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter(logs));
    await app.init();
    http = app.getHttpServer();
    db = app.get(DataSource);
    service = app.get(OnrampWebhookService);
    mailSpy = vi.spyOn(app.get(MailService), 'send').mockResolvedValue(undefined);
    creditSpy = vi.spyOn(app.get(SolanaService), 'usdcCredit').mockResolvedValue(null);

    const r = await request(http)
      .post('/api/auth/signup')
      .send({ name: 'Onramp Person', email: `onramp${stamp}@example.com`, password: 'correct horse battery', acceptTerms: true })
      .expect(201);
    token = r.body.accessToken;
    userId = r.body.user.id;
    // Verified email (so email notifications can go out) and a wallet, as after onboarding.
    await db.getRepository(User).update({ id: userId }, { emailVerifiedAt: new Date() });
    await db.getRepository(Wallet).save(db.getRepository(Wallet).create({ userId, address: wallet, kind: 'embedded', primary: true, verifiedAt: new Date() }));

    for (const mode of ['buy', 'sell'] as const) {
      const link = await request(http).post('/api/payments/onramp').set('Authorization', `Bearer ${token}`).send({ mode, fiat: 'NGN', amount: 15000 }).expect(200);
      sessions[mode] = new URL(link.body.url).searchParams.get('partnerContext')!;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mailSpy.mockClear();
    creditSpy.mockReset().mockResolvedValue(null);
  });

  it('gives each widget link its own signed, opaque session reference', async () => {
    expect(sessions.buy).toMatch(/^ss_[A-Za-z0-9_-]{24}$/);
    expect(sessions.sell).not.toBe(sessions.buy);
    expect(sessions.buy).not.toContain(userId);
    const rows = await db.query(`SELECT user_id, wallet_address, mode FROM onramp_sessions WHERE partner_context = $1`, [sessions.buy]);
    expect(rows).toEqual([{ user_id: userId, wallet_address: wallet, mode: 'buy' }]);
  });

  it('refuses unsigned, mis-signed and tampered payloads, and stores nothing', async () => {
    const id = randomUUID();
    const body = event({ transactionId: id });
    expect((await deliver(body, 'deadbeef')).status).toBe(401);
    expect((await deliver(body, sign(JSON.stringify(body), 'wrong-secret'))).status).toBe(401);
    const raw = JSON.stringify(body);
    const r = await request(http).post('/api/payments/onramp/webhook').set('Content-Type', 'application/json').set('X-Onramper-Webhook-Signature', sign(raw)).send(raw.replace('15000', '15001'));
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('invalid_signature');
    expect((await request(http).post('/api/payments/onramp/webhook').set('Content-Type', 'application/json').send(raw)).status).toBe(401);
    expect(await eventsFor(id)).toHaveLength(0);
  });

  it('records a completed top-up once, however often it is delivered, and tells the person once', async () => {
    const id = randomUUID();
    expect((await deliver(event({ transactionId: id, status: 'new', outAmount: 0 }))).status).toBe(200);
    expect(await ledgerFor(id)).toHaveLength(0); // an opened widget isn't money history yet
    await deliver(event({ transactionId: id, status: 'pending', outAmount: 9.4 }));
    let [row] = await ledgerFor(id);
    expect(row).toMatchObject({ kind: 'added', status: 'pending', amount: 9_400_000n });

    const done = event({ transactionId: id, status: 'completed' });
    for (let i = 0; i < 3; i++) expect((await deliver(done)).status).toBe(200);

    const rows = await ledgerFor(id);
    expect(rows).toHaveLength(1);
    [row] = rows;
    expect(row).toMatchObject({ userId, kind: 'added', status: 'confirmed', amount: 9_500_000n, fiatCurrency: 'NGN', ref: `onramper:${id}`, signature: null, detail: null });
    expect(Number(row.fiatAmount)).toBe(15000);
    expect(await notificationsFor(id)).toEqual([expect.objectContaining({ kind: 'reward', title: '$9.50 added to your wallet', dedupe_key: `onramp:${id}:completed` })]);
    expect(mailSpy).toHaveBeenCalledTimes(1);
    const events = await eventsFor(id);
    expect(events.map((e) => e.outcome)).toEqual(['applied', 'applied', 'applied']); // the two repeats were never stored
    expect(events.every((e) => !('apiKey' in (e.payload ?? {})))).toBe(true);

    const history = await request(http).get('/api/payments/history').set('Authorization', `Bearer ${token}`).expect(200);
    expect(history.body.find((h: { reference: string }) => h.reference === id)).toMatchObject({
      kind: 'Added money',
      amount: 9.5,
      status: 'confirmed',
      fiatAmount: 15000,
      fiatCurrency: 'NGN',
      detail: null,
      challengeId: null,
    });
    // Existing entries keep their shape, with the new fields empty.
    const tx = await txFor(id);
    expect(tx).toMatchObject({ state: 'completed', notifiedState: 'completed', progress: 3, chainVerified: false, reviewReason: null });
  });

  it('respects the email preference while still notifying in the app', async () => {
    await db.getRepository(User).update({ id: userId }, { notificationPrefs: { email: false, push: true, muted: [] } });
    const id = randomUUID();
    await deliver(event({ transactionId: id, status: 'completed' }));
    expect(await notificationsFor(id)).toHaveLength(1);
    expect(mailSpy).not.toHaveBeenCalled();
    await db.getRepository(User).update({ id: userId }, { notificationPrefs: { email: true, push: true, muted: [] } });
  });

  it('handles out-of-order delivery without going backwards', async () => {
    const id = randomUUID();
    const pending = event({ transactionId: id, status: 'pending' });
    const completed = event({ transactionId: id, status: 'completed' });
    await deliver(completed);
    await deliver(pending); // older, arrives late
    expect((await txFor(id)).state).toBe('completed');
    expect((await ledgerFor(id))[0]).toMatchObject({ status: 'confirmed' });
    expect((await eventsFor(id)).map((e) => e.outcome)).toEqual(['applied', 'stale']);
  });

  it('never reverses a completed top-up, and flags the conflict', async () => {
    const id = randomUUID();
    await deliver(event({ transactionId: id, status: 'completed' }));
    await deliver(event({ transactionId: id, status: 'failed', statusReason: 'late failure' }));
    expect((await ledgerFor(id))[0]).toMatchObject({ status: 'confirmed', detail: null });
    const tx = await txFor(id);
    expect(tx.state).toBe('completed');
    expect(tx.reviewReason).toContain('failed received after completed');
    expect((await eventsFor(id)).map((e) => e.outcome)).toEqual(['applied', 'review']);
  });

  it('accepts completed after failed only once the credit is read on-chain', async () => {
    const id = randomUUID();
    const hash = bs58.encode(randomBytes(64));
    await deliver(event({ transactionId: id, status: 'pending' }));
    await deliver(event({ transactionId: id, status: 'failed' }));
    expect((await ledgerFor(id))[0]).toMatchObject({ status: 'failed' });

    // The provider says completed, but nothing on-chain backs it: held for review.
    await deliver(event({ transactionId: id, status: 'completed', transactionHash: hash }));
    expect(creditSpy).toHaveBeenCalledWith(hash, expect.anything());
    expect((await ledgerFor(id))[0]).toMatchObject({ status: 'failed' });
    expect((await txFor(id)).reviewReason).toContain('not independently confirmed');

    // A later delivery whose credit we can read ourselves is applied, with the on-chain amount.
    creditSpy.mockResolvedValue(9_480_000n);
    await deliver(event({ transactionId: id, status: 'completed', transactionHash: hash }));
    const [row] = await ledgerFor(id);
    expect(row).toMatchObject({ status: 'confirmed', amount: 9_480_000n, signature: hash });
    expect(await txFor(id)).toMatchObject({ state: 'completed', chainVerified: true, reviewReason: null });
  });

  it('shows failed purchases with the reason and what to do, and warns only when money was taken', async () => {
    const declined = randomUUID();
    await deliver(event({ transactionId: declined, status: 'pending' }));
    await deliver(event({ transactionId: declined, status: 'failed', statusReason: 'Card declined' }));
    expect((await ledgerFor(declined))[0]).toMatchObject({ status: 'failed', detail: 'Didn’t go through (Card declined). No USDC was added to your wallet.' });
    expect(await notificationsFor(declined)).toHaveLength(0);

    const taken = randomUUID();
    await deliver(event({ transactionId: taken, status: 'paid', onrampTransactionId: 'gf-ref-9' }));
    await deliver(event({ transactionId: taken, status: 'failed', onrampTransactionId: 'gf-ref-9' }));
    const [row] = await ledgerFor(taken);
    expect(row.detail).toContain('Contact Gatefi with reference gf-ref-9');
    expect(row.detail!.toLowerCase()).not.toContain('refund');
    expect(await notificationsFor(taken)).toEqual([expect.objectContaining({ kind: 'problem' })]);

    const abandoned = randomUUID();
    await deliver(event({ transactionId: abandoned, status: 'new' }));
    await deliver(event({ transactionId: abandoned, status: 'canceled' }));
    expect(await ledgerFor(abandoned)).toHaveLength(0);
  });

  it('parks what it cannot attribute or does not understand, keeping the payload', async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ partnerContext: 'ss_unknown' }, /No session/],
      [{ partnerContext: '' }, /Missing partnerContext/],
      [{ status: 'test' }, /Unknown status "test"/],
      [{ transactionType: 'swap' }, /Unknown transactionType "swap"/],
      [{ walletAddress: Keypair.generate().publicKey.toBase58() }, /Wallet differs/],
      [{ targetCurrency: 'sol' }, /expected usdc_sol/],
      [{ partnerContext: sessions.sell }, /Session was for sell/],
    ];
    for (const [over, note] of cases) {
      const id = randomUUID();
      expect((await deliver(event({ transactionId: id, status: 'completed', ...over }))).status).toBe(200);
      const [e] = await eventsFor(id);
      expect(e).toMatchObject({ outcome: 'parked' });
      expect(e.note).toMatch(note);
      expect(e.payload).toMatchObject({ transactionId: id });
      expect(await ledgerFor(id)).toHaveLength(0);
    }
  });

  it('still records buys from links made before sessions, only into that person’s own wallet', async () => {
    const id = randomUUID();
    await deliver(event({ transactionId: id, status: 'completed', partnerContext: userId }));
    expect((await ledgerFor(id))[0]).toMatchObject({ userId, kind: 'added', status: 'confirmed' });
    const other = randomUUID();
    await deliver(event({ transactionId: other, status: 'completed', partnerContext: userId, walletAddress: Keypair.generate().publicKey.toBase58() }));
    expect((await eventsFor(other))[0]).toMatchObject({ outcome: 'parked' });
  });

  it('keeps cash-outs parked while sell webhooks are off', async () => {
    const id = randomUUID();
    await deliver(
      event({ transactionId: id, transactionType: 'offramp', status: 'completed', partnerContext: sessions.sell, sourceCurrency: 'usdc_sol', inAmount: 20, targetCurrency: 'ngn', outAmount: 30000 }),
    );
    const [e] = await eventsFor(id);
    expect(e).toMatchObject({ outcome: 'parked', note: expect.stringContaining('Sell webhooks are disabled') });
    expect(await ledgerFor(id)).toHaveLength(0);
  });

  describe('once sell webhooks are switched on (after the sell payload is confirmed)', () => {
    const flag = () => service as unknown as { sellEnabled: boolean };
    const sell = (over: Record<string, unknown>) =>
      event({ transactionType: 'offramp', partnerContext: sessions.sell, sourceCurrency: 'usdc_sol', inAmount: 20, targetCurrency: 'ngn', outAmount: 30000, walletAddress: 'ProviderDepositAddr', ...over });
    beforeAll(() => {
      flag().sellEnabled = true;
    });
    afterAll(() => {
      flag().sellEnabled = false;
    });

    it('records a cash-out as money leaving, once', async () => {
      const id = randomUUID();
      await deliver(sell({ transactionId: id, status: 'pending' }));
      await deliver(sell({ transactionId: id, status: 'completed' }));
      await deliver(sell({ transactionId: id, status: 'completed' }));
      const rows = await ledgerFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'cashed_out', status: 'confirmed', amount: -20_000_000n, fiatCurrency: 'NGN' });
      expect(await notificationsFor(id)).toEqual([expect.objectContaining({ title: 'Your cash-out is complete' })]);
    });

    it('folds a cash-out paid with Stake-Sync’s own send into that send, so the money shows once', async () => {
      const id = randomUUID();
      const hash = bs58.encode(randomBytes(64));
      const ledger = db.getRepository(LedgerEntry);
      const sent = await ledger.save(ledger.create({ userId, challengeId: null, kind: 'sent', amount: -20_000_000n, status: 'confirmed', signature: hash, ref: `send:${randomUUID()}` }));
      await deliver(sell({ transactionId: id, status: 'pending' })); // before the hash is known: its own row
      expect(await ledgerFor(id)).toHaveLength(1);
      await deliver(sell({ transactionId: id, status: 'completed', transactionHash: hash }));
      const rows = await ledgerFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: sent.id, kind: 'cashed_out', status: 'confirmed', amount: -20_000_000n, signature: hash, fiatCurrency: 'NGN' });
      expect(await ledger.countBy({ ref: `onramper:${id}` })).toBe(0);
    });
  });

  it('stores events before processing and retries the ones that fail', async () => {
    const id = randomUUID();
    const once = vi.spyOn(service, 'process').mockRejectedValueOnce(new Error('database went away'));
    expect((await deliver(event({ transactionId: id, status: 'completed' }))).status).toBe(200);
    once.mockRestore();
    let [e] = await eventsFor(id);
    expect(e).toMatchObject({ processedAt: null, attempts: 1, lastError: 'database went away' });
    expect(await ledgerFor(id)).toHaveLength(0);

    await db.getRepository(OnrampEvent).update({ id: e.id }, { nextAttemptAt: new Date(Date.now() - 1000) });
    await service.retry();
    [e] = await eventsFor(id);
    expect(e).toMatchObject({ outcome: 'applied' });
    expect((await ledgerFor(id))[0]).toMatchObject({ status: 'confirmed' });
    expect(await notificationsFor(id)).toHaveLength(1);
  });

  it('retries a notification that failed to send, without sending it twice', async () => {
    const id = randomUUID();
    const once = vi.spyOn(app.get(NotificationsService), 'notify').mockRejectedValueOnce(new Error('mail queue down'));
    await deliver(event({ transactionId: id, status: 'completed' }));
    once.mockRestore();
    expect((await txFor(id)).notifiedState).toBeNull();
    expect((await ledgerFor(id))[0]).toMatchObject({ status: 'confirmed' }); // history doesn't wait on notifications

    await service.retry();
    await service.retry();
    expect((await txFor(id)).notifiedState).toBe('completed');
    expect(await notificationsFor(id)).toHaveLength(1);
  });

  it('isn’t throttled by the default per-IP limit (Onramper sends from shared addresses)', async () => {
    const statuses = await Promise.all(Array.from({ length: 130 }, () => deliver({ x: 1 }, 'bad').then((r) => r.status)));
    expect(statuses.filter((s) => s === 429)).toHaveLength(0);
  });
});
