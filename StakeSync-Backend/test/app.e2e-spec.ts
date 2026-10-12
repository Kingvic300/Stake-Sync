import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import helmet from 'helmet';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { totpCode } from '../src/common/crypto.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { LogsService } from '../src/core/logs/logs.service.js';
import { requestLogger } from '../src/core/logs/request-logger.js';

// Needs a throwaway Postgres: DATABASE_URL=postgresql://... npm run test:e2e
// Example: docker run -d -p 5544:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=stakesync postgres:16
const run = process.env.DATABASE_URL ? describe : describe.skip;

run('API (e2e)', () => {
  let app: INestApplication<App>;
  let http: ReturnType<INestApplication<App>['getHttpServer']>;
  let logs: LogsService;
  const stamp = Date.now();
  const email = `e2e${stamp}@example.com`;
  const password = 'correct horse battery';
  let token = '';

  beforeAll(async () => {
    Object.assign(process.env, { CHAIN_WORKERS: 'false', ADMIN_REQUIRE_2FA: 'true', MAX_LOGIN_ATTEMPTS: '3' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    logs = app.get(LogsService);
    app.use(helmet());
    app.use(requestLogger(logs));
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter(logs));
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports health with security headers and a request id', async () => {
    const r = await request(http).get('/api/health').expect(200);
    expect(r.body.db).toBe(true);
    expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('refuses common passwords', async () => {
    const r = await request(http).post('/api/auth/signup').send({ name: 'Weak', email: `weak${stamp}@example.com`, password: 'password123', acceptTerms: true }).expect(400);
    expect(r.body.code).toBe('weak_password');
  });

  it('needs the terms accepted to create an account', async () => {
    const r = await request(http).post('/api/auth/signup').send({ name: 'No Terms', email: `noterms${stamp}@example.com`, password, acceptTerms: false }).expect(400);
    expect(r.body.code).toBe('terms_required');
  });

  it('signs up and reads the profile', async () => {
    const r = await request(http).post('/api/auth/signup').send({ name: 'E2E Person', email, password, acceptTerms: true }).expect(201);
    expect(r.body.user.termsAccepted).toBe(true);
    token = r.body.accessToken;
    const me = await request(http).get('/api/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body.verificationLevel).toBe('Basic');
  });

  it('never shows raw errors', async () => {
    const bad = await request(http).post('/api/challenges').set('Authorization', `Bearer ${token}`).send({ title: 'x' }).expect(400);
    expect(bad.body.code).toBe('invalid_input');
    expect(JSON.stringify(bad.body)).not.toMatch(/\.(ts|js):\d+|stack/);
    const junk = await request(http).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":').expect(400);
    expect(junk.body.code).toBe('invalid_json');
  });

  it('rejects forged and tampered tokens', async () => {
    const [h, p] = token.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: '00000000-0000-0000-0000-000000000000', sid: 'x', adm: 'Super admin' })).toString('base64url')}.sig`;
    await request(http).get('/api/me').set('Authorization', `Bearer ${forged}`).expect(401);
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`;
    await request(http).get('/api/me').set('Authorization', `Bearer ${none}`).expect(401);
  });

  it('ends a session immediately when signing out everywhere', async () => {
    const login = await request(http).post('/api/auth/login').send({ email, password }).expect(200);
    await request(http).post('/api/auth/logout-all').set('Authorization', `Bearer ${login.body.accessToken}`).expect(204);
    await new Promise((r) => setTimeout(r, 16_000)); // the guard caches session state for 15 seconds
    await request(http).get('/api/me').set('Authorization', `Bearer ${login.body.accessToken}`).expect(401);
    token = (await request(http).post('/api/auth/login').send({ email, password }).expect(200)).body.accessToken;
  }, 30_000);

  it('locks an account after repeated wrong passwords', async () => {
    const victim = `lock${stamp}@example.com`;
    await request(http).post('/api/auth/signup').send({ name: 'Lock Me', email: victim, password, acceptTerms: true }).expect(201);
    for (let i = 0; i < 3; i++) await request(http).post('/api/auth/login').send({ email: victim, password: 'wrong password!' }).expect(401);
    const locked = await request(http).post('/api/auth/login').send({ email: victim, password }).expect(429);
    expect(locked.body.code).toBe('account_locked');
  });

  it('needs the host to agree to the rules and terms when creating a challenge', async () => {
    const body = {
      host: 'me', title: 'Agreement Check', description: 'A challenge used to check the rules checkbox is required.', category: 'Productivity', privacy: 'public',
      providers: ['photo'], mode: 'days', duration: 7, required: 5, start: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
      stakeMode: 'none', preset: 'gentle',
    };
    const r = await request(http).post('/api/challenges').set('Authorization', `Bearer ${token}`).send({ ...body, agreeToRules: false }).expect(400);
    expect(r.body.code).toBe('rules_not_accepted');
    // Ticked: the request gets past the agreement (it then needs a confirmed email).
    const ok = await request(http).post('/api/challenges').set('Authorization', `Bearer ${token}`).send({ ...body, agreeToRules: true }).expect(403);
    expect(ok.body.code).toBe('email_unverified');
  });

  it('keeps admin endpoints away from member tokens', () => request(http).get('/api/admin/overview').set('Authorization', `Bearer ${token}`).expect(403));

  it('requires two-step verification for admins, then shows the server and error logs', async () => {
    await app.get(DataSource).query(`UPDATE users SET admin_role = 'Super admin' WHERE email = $1`, [email]);
    const login = await request(http).post('/api/auth/admin/login').send({ email, password }).expect(200);
    expect(login.body.twoFactorRequired).toBe(true);
    const blocked = await request(http).get('/api/admin/logs').set('Authorization', `Bearer ${login.body.accessToken}`).expect(403);
    expect(blocked.body.code).toBe('two_factor_setup_required');

    const setup = await request(http).post('/api/auth/admin/2fa/setup').set('Authorization', `Bearer ${login.body.accessToken}`).expect(200);
    const enabled = await request(http).post('/api/auth/admin/2fa/enable').set('Authorization', `Bearer ${login.body.accessToken}`).send({ code: totpCode(setup.body.secret) }).expect(200);
    const admin = enabled.body.accessToken;
    // The same code can't be used twice.
    await request(http).post('/api/auth/admin/login').send({ email, password, code: totpCode(setup.body.secret) }).expect(401);

    await logs.flush();
    const list = await request(http).get('/api/admin/logs?kind=security').set('Authorization', `Bearer ${admin}`).expect(200);
    const events = list.body.items.map((i: { context: string }) => i.context);
    expect(events).toEqual(expect.arrayContaining(['login_failed', 'account_locked', 'login_locked']));
    expect(JSON.stringify(list.body)).not.toContain(password);

    const reqs = await request(http).get('/api/admin/logs?kind=request&status=4xx').set('Authorization', `Bearer ${admin}`).expect(200);
    expect(reqs.body.items.length).toBeGreaterThan(0);
    const stats = await request(http).get('/api/admin/logs/stats').set('Authorization', `Bearer ${admin}`).expect(200);
    expect(stats.body.requests).toBeGreaterThan(0);
    // The same error with different ids is one group; resolving and reopening work.
    await logs.error('Test', new Error('Payout failed for order 1234'), { path: '/api/x', method: 'GET' });
    await logs.error('Test', new Error('Payout failed for order 9876'), { path: '/api/x', method: 'GET' });
    await logs.flush();
    const groups = await request(http).get('/api/admin/errors?q=Payout').set('Authorization', `Bearer ${admin}`).expect(200);
    expect(groups.body).toHaveLength(1);
    expect(groups.body[0].count).toBe(2);
    const detail = await request(http).get(`/api/admin/errors/${groups.body[0].id}`).set('Authorization', `Bearer ${admin}`).expect(200);
    expect(detail.body.occurrences).toHaveLength(2);
    expect(detail.body.stack).toContain('Error: Payout failed');
    await request(http).post(`/api/admin/errors/${groups.body[0].id}/resolve`).set('Authorization', `Bearer ${admin}`).send({ reason: 'Fixed retry logic' }).expect(204);
    await logs.error('Test', new Error('Payout failed for order 5555'), { path: '/api/x', method: 'GET' });
    const again = await request(http).get('/api/admin/errors?q=Payout').set('Authorization', `Bearer ${admin}`).expect(200);
    expect(again.body[0].status).toBe('open'); // it came back, so it reopens
  });
});
