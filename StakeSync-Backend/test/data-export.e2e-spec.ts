import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { LogsService } from '../src/core/logs/logs.service.js';
import { Challenge, Participant } from '../src/modules/challenges/entities/challenge.entities.js';
import { FeedItem, Message } from '../src/modules/community/entities/community.entities.js';
import { Dispute } from '../src/modules/disputes/entities/dispute.entity.js';
import { Organization, OrgMember } from '../src/modules/organizations/entities/organization.entities.js';
import { LedgerEntry, SponsorContribution } from '../src/modules/payments/entities/payment.entities.js';
import { Achievement } from '../src/modules/reputation/entities/reputation.entities.js';
import { RiskSignal } from '../src/modules/risk/entities/risk.entities.js';
import { ConnectedAccount, User, Wallet } from '../src/modules/users/entities/user.entities.js';
import { DataExportService } from '../src/modules/users/data-export.service.js';
import { ProofSubmission, Verification } from '../src/modules/verification/entities/verification.entities.js';

// Needs a throwaway Postgres: DATABASE_URL=postgresql://... npm run test:e2e
const run = process.env.DATABASE_URL ? describe : describe.skip;

/** Values planted in fields that must never reach an export. */
const SECRETS = {
  totp: 'TOTP-SECRET-MARKER',
  ipHash: 'IPHASH-MARKER',
  deviceHash: 'DEVICEHASH-MARKER',
  statusReason: 'ADMIN-NOTE-MARKER',
  accessToken: 'gho_ACCESS-TOKEN-MARKER',
  refreshToken: 'REFRESH-TOKEN-MARKER',
  externalId: 'EXTERNAL-ID-MARKER',
  fundedBy: 'FUNDER-WALLET-MARKER',
  risk: 'RISK-SIGNAL-MARKER',
  phash: 'PHASHMARKER',
  flag: 'PROOF-FLAG-MARKER',
  fileKey: 'proofs/2026-10-11/STORAGE-KEY-MARKER.jpg',
  evidenceKey: 'evidence/2026-10-11/EVIDENCE-KEY-MARKER.jpg',
  hiddenReason: 'MOD-HIDDEN-REASON-MARKER',
  ledgerRef: 'LEDGER-REF-MARKER',
};

run('Download my data (e2e)', () => {
  const apps: INestApplication<App>[] = [];
  let http: App;
  let http2: App;
  let db: DataSource;
  const stamp = Date.now();
  const password = 'correct horse battery';
  const a = { email: `export-a${stamp}@example.com`, token: '', id: '' };
  const b = { email: `export-b${stamp}@example.com`, token: '', id: '' };
  let challengeSlug = '';

  const start = async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<INestApplication<App>>();
    const logs = app.get(LogsService);
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter(logs));
    await app.init();
    apps.push(app);
    return app;
  };
  const exportAs = (token: string, server = http) => request(server).get('/api/me/export').set('Authorization', `Bearer ${token}`);
  const resetLimit = (id: string) => db.getRepository(User).update({ id }, { dataExportedAt: null });

  beforeAll(async () => {
    Object.assign(process.env, { CHAIN_WORKERS: 'false', API_URL: 'https://api.example.test' });
    // Two instances sharing one database, like two servers behind a load balancer.
    const first = await start();
    const second = await start();
    http = first.getHttpServer();
    http2 = second.getHttpServer();
    db = first.get(DataSource);

    for (const [who, name] of [
      [a, 'Export Person'],
      [b, 'Other Person'],
    ] as const) {
      const r = await request(http).post('/api/auth/signup').send({ name, email: who.email, password, acceptTerms: true }).expect(201);
      who.token = r.body.accessToken;
      who.id = r.body.user.id;
    }
    const users = db.getRepository(User);
    await users.update({ id: a.id }, { emailVerifiedAt: new Date(), totpSecret: SECRETS.totp, signupIpHash: SECRETS.ipHash, deviceHash: SECRETS.deviceHash, statusReason: SECRETS.statusReason, bio: 'Building every day' });

    const created = await request(http)
      .post('/api/challenges')
      .set('Authorization', `Bearer ${a.token}`)
      .send({
        host: 'me',
        title: 'Export Check',
        description: 'A challenge used to check what a data export contains.',
        category: 'Productivity',
        privacy: 'public',
        providers: ['photo'],
        mode: 'days',
        duration: 7,
        required: 5,
        start: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
        stakeMode: 'none',
        preset: 'gentle',
        agreeToRules: true,
      });
    expect(created.status).toBe(201);
    const c = await db.getRepository(Challenge).findOneByOrFail({ creatorId: a.id });
    challengeSlug = c.slug;
    await db.getRepository(Challenge).update({ id: c.id }, { rewardPerFinisher: 2_500_000n });

    const save = <T extends object>(entity: new () => T, row: Partial<T>) => db.getRepository(entity).save(db.getRepository(entity).create(row as T));
    await save(ConnectedAccount, { userId: a.id, provider: 'github', externalId: SECRETS.externalId, username: 'export-person', accessToken: SECRETS.accessToken, refreshToken: SECRETS.refreshToken });
    await save(Wallet, { userId: a.id, address: `ExportWa11et${stamp}`.slice(0, 44), kind: 'embedded', primary: true, verifiedAt: new Date(), fundedBy: SECRETS.fundedBy });
    await save(RiskSignal, { userId: a.id, kind: 'shared_device', detail: SECRETS.risk, weight: 40, ref: `export-risk:${a.id}` });
    const pa = await save(Participant, {
      challengeId: c.id,
      userId: a.id,
      status: 'completed',
      acceptedRulesHash: c.rulesHash,
      acceptedAt: new Date(),
      settled: true,
      completed: true,
      penalty: 500_000n,
      stake: 10_000_000n,
      claimable: 12_000_000n,
    });
    const pb = await save(Participant, { challengeId: c.id, userId: b.id, status: 'active', acceptedRulesHash: c.rulesHash, acceptedAt: new Date() });
    const va = await save(Verification, { participantId: pa.id, challengeId: c.id, userId: a.id, period: 0, provider: 'photo', state: 'verified', detail: 'Photo approved', units: 1, decidedAt: new Date() });
    await save(Verification, { participantId: pb.id, challengeId: c.id, userId: b.id, period: 0, provider: 'photo', state: 'failed', detail: 'OTHER-USER-VERIFICATION' });
    const proof = await save(ProofSubmission, { userId: a.id, participantId: pa.id, challengeId: c.id, period: 0, kind: 'photo', fileKey: SECRETS.fileKey, note: 'Morning run', phash: SECRETS.phash, flags: [SECRETS.flag], status: 'approved' });
    const dispute = await save(Dispute, {
      participantId: pa.id,
      challengeId: c.id,
      userId: a.id,
      verificationId: va.id,
      period: 1,
      provider: 'photo',
      reason: 'My photo was rejected wrongly',
      evidence: [
        { kind: 'image', value: SECRETS.evidenceKey, at: new Date().toISOString() },
        { kind: 'link', value: 'https://example.com/proof', at: new Date().toISOString() },
      ],
      timeline: [{ at: new Date().toISOString(), source: 'user', text: 'Dispute opened' }],
      dueAt: new Date(Date.now() + 86_400_000),
      lockedAmount: 0n,
      assigneeId: b.id,
    });
    await save(Message, { challengeId: c.id, authorId: a.id, body: 'Day one done!', mentions: [b.id], hiddenAt: new Date(), hiddenReason: SECRETS.hiddenReason });
    await save(Message, { challengeId: c.id, authorId: b.id, body: 'OTHER-USER-MESSAGE' });
    await save(FeedItem, { challengeId: c.id, userId: a.id, kind: 'share', text: 'Shared my streak' });
    await save(FeedItem, { challengeId: c.id, userId: b.id, kind: 'share', text: 'OTHER-USER-FEED' });
    await save(LedgerEntry, { userId: a.id, challengeId: c.id, kind: 'stake_deposited', amount: -10_000_000n, status: 'confirmed', signature: 'sig-export-1', ref: SECRETS.ledgerRef });
    await save(SponsorContribution, { challengeId: c.id, sponsorUserId: a.id, wallet: `ExportWa11et${stamp}`.slice(0, 44), amount: 5_000_000n, status: 'confirmed' });
    const org = await save(Organization, { slug: `export-org-${stamp}`, name: 'Export Org', kind: 'Community', about: '', inviteCode: `EXP${stamp}`.slice(0, 12), createdById: a.id });
    await save(OrgMember, { orgId: org.id, userId: a.id, role: 'Admin' });
    await save(OrgMember, { orgId: org.id, userId: b.id, role: 'Member' });
    await save(Achievement, { userId: a.id, challengeId: c.id, title: 'Export Check — Completed', provider: 'photo', detail: '7/7 days', earnedAt: new Date() });
    Object.assign(a, { proofId: proof.id, disputeId: dispute.id });
  });

  afterAll(async () => {
    for (const app of apps) await app.close();
  });

  beforeEach(async () => {
    await resetLimit(a.id);
    await resetLimit(b.id);
  });

  it('needs a valid sign-in', async () => {
    await request(http).get('/api/me/export').expect(401);
    await request(http).get('/api/me/export').set('Authorization', 'Bearer not.a.token').expect(401);
  });

  it('downloads a JSON file with every category of the person’s data', async () => {
    const r = await exportAs(a.token).expect(200);
    expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="stakesync-data-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(r.headers['cache-control']).toBe('no-store');
    const d = r.body;
    expect(d.format).toBe('stakesync-data-export/1');
    expect(Object.keys(d)).toEqual(
      expect.arrayContaining(['profile', 'settings', 'connectedAccounts', 'wallets', 'challenges', 'verifications', 'proofs', 'disputes', 'messages', 'feedPosts', 'moneyHistory', 'sponsorships', 'organizations', 'achievements']),
    );
    expect(d.profile).toMatchObject({ id: a.id, email: a.email, name: 'Export Person', bio: 'Building every day', emailVerified: true });
    expect(d.settings).toEqual({ privacy: { profile: 'public', showOnLeaderboards: true, showConnectedAccounts: true }, notifications: { email: true, push: true, muted: [] } });
    expect(d.connectedAccounts).toEqual([{ provider: 'GitHub', username: 'export-person', connectedAt: expect.any(String) }]);
    expect(d.wallets).toEqual([expect.objectContaining({ kind: 'embedded', primary: true, verified: true })]);
    expect(d.challenges).toEqual([
      expect.objectContaining({ challenge: { id: challengeSlug, title: 'Export Check' }, status: 'completed', result: 'completed', stakeUsd: 10, penaltyUsd: 0.5, rewardUsd: 2.5, claimableUsd: 12 }),
    ]);
    expect(d.verifications).toEqual([expect.objectContaining({ day: 1, result: 'verified', detail: 'Photo approved' })]);
    expect(d.proofs).toEqual([expect.objectContaining({ kind: 'photo', note: 'Morning run', review: 'approved', fileUrl: `https://api.example.test/api/verification/proofs/file/${(a as { proofId?: string }).proofId}` })]);
    const disputeId = (a as { disputeId?: string }).disputeId;
    expect(d.disputes[0].evidence).toEqual([
      expect.objectContaining({ kind: 'image', value: `https://api.example.test/api/disputes/${disputeId}/evidence/0` }),
      expect.objectContaining({ kind: 'link', value: 'https://example.com/proof' }),
    ]);
    expect(d.messages).toEqual([expect.objectContaining({ body: 'Day one done!', hidden: true })]);
    expect(d.feedPosts).toEqual([expect.objectContaining({ text: 'Shared my streak' })]);
    expect(d.moneyHistory).toEqual([expect.objectContaining({ kind: 'stake_deposited', amountUsd: -10, status: 'confirmed', transaction: 'sig-export-1' })]);
    expect(d.sponsorships).toEqual([expect.objectContaining({ amountUsd: 5, status: 'confirmed' })]);
    expect(d.organizations).toEqual([expect.objectContaining({ name: 'Export Org', role: 'Admin' })]);
    expect(d.achievements).toEqual([expect.objectContaining({ title: 'Export Check — Completed' })]);
  });

  it('never includes credentials, internal signals, storage keys or other people’s data', async () => {
    const r = await exportAs(a.token).expect(200);
    const text = JSON.stringify(r.body);
    for (const marker of Object.values(SECRETS)) expect(text).not.toContain(marker);
    const hash = (await db.getRepository(User).findOne({ where: { id: a.id }, select: { id: true, passwordHash: true } }))!.passwordHash!;
    expect(text).not.toContain(hash);
    expect(text).not.toMatch(/passwordHash|totpSecret|accessToken|refreshToken|signupIpHash|deviceHash|fundedBy|riskScore|fileKey|assigneeId|decidedById|hiddenReason/);
    for (const other of ['OTHER-USER-MESSAGE', 'OTHER-USER-FEED', 'OTHER-USER-VERIFICATION', b.email, b.id, 'Other Person']) expect(text).not.toContain(other);
  });

  it('always exports the signed-in person, whatever the request asks for', async () => {
    const r = await exportAs(a.token).query({ userId: b.id, id: b.id }).expect(200);
    expect(r.body.profile.id).toBe(a.id);
    const other = await exportAs(b.token).expect(200);
    expect(other.body.profile.id).toBe(b.id);
    expect(JSON.stringify(other.body)).not.toContain(a.email);
  });

  it('handles someone with nothing recorded yet', async () => {
    const r = await exportAs(b.token).expect(200);
    expect(r.body.connectedAccounts).toEqual([]);
    expect(r.body.wallets).toEqual([]);
    expect(r.body.disputes).toEqual([]);
    expect(r.body.moneyHistory).toEqual([]);
  });

  it('allows one export an hour per person, across instances and concurrent requests', async () => {
    await exportAs(a.token).expect(200);
    const again = await exportAs(a.token).expect(429);
    expect(again.body.code).toBe('export_rate_limited');
    expect(Number(again.headers['retry-after'])).toBeGreaterThan(3500);
    // A second server shares the limit.
    await exportAs(a.token, http2).expect(429);
    // Another person is unaffected.
    await exportAs(b.token, http2).expect(200);

    await resetLimit(a.id);
    const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => exportAs(a.token, i % 2 ? http2 : http).then((x) => x.status)));
    expect(burst.filter((s) => s === 200)).toHaveLength(1);
    expect(burst.filter((s) => s === 429)).toHaveLength(5);
  });

  it('gives the hour back if building the export fails', async () => {
    const svc = apps[0].get(DataExportService) as unknown as { build: () => Promise<unknown> };
    const spy = vi.spyOn(svc, 'build').mockRejectedValueOnce(new Error('database went away'));
    await exportAs(a.token).expect(500);
    spy.mockRestore();
    await exportAs(a.token).expect(200);
  });

  it('records the export in the audit log without the exported data', async () => {
    await db.query(`DELETE FROM audit_entries WHERE actor_id = $1`, [a.id]);
    await exportAs(a.token).expect(200);
    const rows: { action: string; target: string; meta: Record<string, unknown> }[] = await db.query(`SELECT action, target, meta FROM audit_entries WHERE actor_id = $1`, [a.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'Downloaded their data', target: `User ${a.id}` });
    expect(rows[0].meta).toMatchObject({ bytes: expect.any(Number), counts: expect.objectContaining({ messages: 1, moneyHistory: 1 }) });
    const meta = JSON.stringify(rows[0].meta);
    for (const personal of [a.email, 'Day one done!', 'Morning run', 'export-person', 'Building every day']) expect(meta).not.toContain(personal);
  });
});
