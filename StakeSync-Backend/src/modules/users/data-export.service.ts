import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppError } from '../../common/errors.js';
import { toUsd } from '../../common/money.js';
import { PROVIDER_LABELS } from '../../common/providers.js';
import { AuditService } from '../../core/audit.service.js';
import { Challenge, Participant } from '../challenges/entities/challenge.entities.js';
import { FeedItem, Message } from '../community/entities/community.entities.js';
import { Dispute } from '../disputes/entities/dispute.entity.js';
import { Organization, OrgMember } from '../organizations/entities/organization.entities.js';
import { LedgerEntry, SponsorContribution } from '../payments/entities/payment.entities.js';
import { Achievement } from '../reputation/entities/reputation.entities.js';
import { ProofSubmission, Verification } from '../verification/entities/verification.entities.js';
import { ConnectedAccount, User, Wallet } from './entities/user.entities.js';

/** One export per person per hour. */
const EXPORT_INTERVAL_SECS = 3600;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * "Download my data" (issue #4): everything Stake-Sync keeps about the person, as JSON.
 *
 * Every field is listed explicitly, so a new column never leaks into exports by accident. Left out
 * on purpose: passwords, tokens, 2FA secrets, sessions, device and IP hashes, risk signals and
 * scores, moderator identities and notes, other people's details, and storage keys. Private files
 * (proof photos, dispute evidence) are linked through the same signed-in endpoints the app uses,
 * never through public storage URLs.
 */
@Injectable()
export class DataExportService {
  private readonly apiUrl: string;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ConnectedAccount) private readonly connections: Repository<ConnectedAccount>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    @InjectRepository(Verification) private readonly verifications: Repository<Verification>,
    @InjectRepository(ProofSubmission) private readonly proofs: Repository<ProofSubmission>,
    @InjectRepository(Dispute) private readonly disputes: Repository<Dispute>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(FeedItem) private readonly feed: Repository<FeedItem>,
    @InjectRepository(LedgerEntry) private readonly ledger: Repository<LedgerEntry>,
    @InjectRepository(SponsorContribution) private readonly sponsorships: Repository<SponsorContribution>,
    @InjectRepository(OrgMember) private readonly members: Repository<OrgMember>,
    @InjectRepository(Organization) private readonly orgs: Repository<Organization>,
    @InjectRepository(Achievement) private readonly achievements: Repository<Achievement>,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.apiUrl = (config.get<string>('apiUrl') ?? '').replace(/\/$/, '');
  }

  /**
   * Builds the export for the signed-in person. The hourly limit is claimed with one conditional
   * UPDATE on the database clock, so it holds across every API instance and concurrent requests;
   * if building fails, the claim is handed back.
   */
  async export(userId: string) {
    const prev = await this.users.findOne({ where: { id: userId }, select: { id: true, dataExportedAt: true } });
    const res = await this.users
      .createQueryBuilder()
      .update()
      // Millisecond precision, so the claim can be matched exactly if it has to be handed back.
      .set({ dataExportedAt: () => "date_trunc('milliseconds', now())" })
      .where(`id = :userId AND (data_exported_at IS NULL OR data_exported_at <= now() - interval '${EXPORT_INTERVAL_SECS} seconds')`, { userId })
      .returning('data_exported_at')
      .execute();
    const row = (res.raw as { data_exported_at: Date }[])[0];
    if (!row) {
      const [{ wait }] = (await this.users.query(`SELECT ceil(extract(epoch FROM data_exported_at + interval '${EXPORT_INTERVAL_SECS} seconds' - now())) AS wait FROM users WHERE id = $1`, [userId])) as {
        wait: string | null;
      }[];
      const retryAfter = Math.max(1, Number(wait ?? 1));
      throw new AppError('export_rate_limited', `You can download your data once an hour. Try again in ${Math.ceil(retryAfter / 60)} minutes.`, HttpStatus.TOO_MANY_REQUESTS, { retryAfter });
    }
    const claimed = new Date(row.data_exported_at);
    try {
      const data = await this.build(userId, claimed);
      const json = JSON.stringify(data, null, 2);
      const counts = Object.fromEntries(Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length]));
      // What was exported and how much, never the data itself.
      await this.audit.log(userId, 'Downloaded their data', `User ${userId}`, 'Self-service data export', { bytes: Buffer.byteLength(json), counts });
      return { json, filename: `stakesync-data-${claimed.toISOString().slice(0, 10)}.json` };
    } catch (e) {
      await this.users.update({ id: userId, dataExportedAt: claimed }, { dataExportedAt: prev?.dataExportedAt ?? null });
      throw e;
    }
  }

  private async build(userId: string, at: Date) {
    const u = await this.users.findOneByOrFail({ id: userId });
    const [connections, wallets, participations, verifications, proofs, disputes, messages, feed, ledger, sponsorships, memberships, achievements] = await Promise.all([
      this.connections.find({ where: { userId }, order: { createdAt: 'ASC' } }),
      this.wallets.find({ where: { userId }, order: { createdAt: 'ASC' } }),
      this.participants.find({ where: { userId }, order: { createdAt: 'ASC' } }),
      this.verifications.find({ where: { userId }, order: { createdAt: 'ASC' } }),
      this.proofs.find({ where: { userId }, order: { createdAt: 'ASC' } }),
      this.disputes.find({ where: { userId }, order: { createdAt: 'ASC' } }),
      this.messages.find({ where: { authorId: userId }, order: { createdAt: 'ASC' } }),
      this.feed.find({ where: { userId }, order: { createdAt: 'ASC' } }),
      this.ledger.find({ where: { userId }, order: { createdAt: 'ASC' } }),
      this.sponsorships.find({ where: { sponsorUserId: userId }, order: { createdAt: 'ASC' } }),
      this.members.find({ where: { userId }, order: { createdAt: 'ASC' } }),
      this.achievements.find({ where: { userId }, order: { earnedAt: 'ASC' } }),
    ]);

    const challengeIds = [
      ...new Set([...participations, ...verifications, ...proofs, ...disputes, ...messages, ...feed, ...sponsorships].map((r) => r.challengeId).concat(ledger.map((l) => l.challengeId).filter((x): x is string => Boolean(x)))),
    ];
    const cs = challengeIds.length ? await this.challenges.findBy({ id: In(challengeIds) }) : [];
    const ch = new Map(cs.map((c) => [c.id, c]));
    // Only what any participant can see about a challenge.
    const ref = (id: string | null) => {
      const c = id ? ch.get(id) : undefined;
      return c ? { id: c.slug, title: c.title } : null;
    };
    const orgList = memberships.length ? await this.orgs.findBy({ id: In(memberships.map((m) => m.orgId)) }) : [];
    const orgById = new Map(orgList.map((o) => [o.id, o]));

    return {
      exportedAt: at.toISOString(),
      format: 'stakesync-data-export/1',
      profile: {
        id: u.id,
        name: u.name,
        handle: u.handle,
        email: u.email,
        emailVerified: Boolean(u.emailVerifiedAt),
        avatarUrl: u.avatarUrl,
        bio: u.bio,
        timezone: u.timezone,
        interests: u.interests,
        fundingPreference: u.fundingPreference,
        commitmentScore: u.score,
        accountStatus: u.status,
        joinedAt: iso(u.createdAt),
        onboardedAt: iso(u.onboardedAt),
        termsAcceptedAt: iso(u.termsAcceptedAt),
        termsVersion: u.termsVersion,
      },
      settings: {
        privacy: { profile: u.privacy.profile, showOnLeaderboards: u.privacy.showOnLeaderboards, showConnectedAccounts: u.privacy.showConnectedAccounts },
        notifications: { email: u.notificationPrefs.email, push: u.notificationPrefs.push, muted: [...(u.notificationPrefs.muted ?? [])] },
      },
      connectedAccounts: connections.map((c) => ({ provider: PROVIDER_LABELS[c.provider], username: c.username, connectedAt: iso(c.createdAt) })),
      wallets: wallets.map((w) => ({ address: w.address, kind: w.kind, primary: w.primary, verified: Boolean(w.verifiedAt), linkedAt: iso(w.createdAt) })),
      challenges: participations.map((p) => {
        const c = ch.get(p.challengeId);
        return {
          challenge: ref(p.challengeId),
          challengeStatus: c?.status ?? null,
          startsAt: iso(c?.startsAt),
          endsAt: iso(c?.endsAt),
          joinedAt: iso(p.acceptedAt),
          status: p.status,
          wallet: p.wallet,
          stakeUsd: toUsd(p.stake),
          joinFeeUsd: toUsd(p.joinFee),
          verifiedDays: p.verifiedCount,
          missedDays: p.missedCount,
          excusedDays: p.excusedCount,
          progress: p.progress,
          rank: p.rank,
          freezeUsed: p.freezeUsed,
          result: p.settled ? (p.completed ? 'completed' : 'not_completed') : 'in_progress',
          penaltyUsd: toUsd(p.penalty),
          rewardUsd: p.settled && p.completed && c?.rewardPerFinisher ? toUsd(c.rewardPerFinisher) : 0,
          claimableUsd: toUsd(p.claimable),
          claimed: p.claimed,
          joinTransaction: p.joinSig,
          claimTransaction: p.claimSig,
        };
      }),
      verifications: verifications.map((v) => ({
        challenge: ref(v.challengeId),
        day: v.period + 1,
        provider: PROVIDER_LABELS[v.provider] ?? v.provider,
        result: v.state,
        detail: v.detail,
        units: v.units,
        decidedAt: iso(v.decidedAt),
        onChainTransaction: v.chainSig,
      })),
      proofs: proofs.map((p) => ({
        id: p.id,
        challenge: ref(p.challengeId),
        day: p.period + 1,
        kind: p.kind,
        note: p.note,
        value: p.value,
        durationSec: p.durationSec,
        takenAt: iso(p.takenAt),
        submittedAt: iso(p.createdAt),
        review: p.status,
        reviewReason: p.reviewReason,
        reviewedAt: iso(p.reviewedAt),
        // Needs your sign-in, like in the app. Not a public link.
        fileUrl: p.fileKey ? `${this.apiUrl}/api/verification/proofs/file/${p.id}` : null,
      })),
      disputes: disputes.map((d) => ({
        id: d.id,
        challenge: ref(d.challengeId),
        day: d.period + 1,
        openedAt: iso(d.createdAt),
        status: d.status,
        reason: d.reason,
        lockedUsd: toUsd(d.lockedAmount),
        evidence: d.evidence.map((e, i) => ({ kind: e.kind, value: e.kind === 'image' ? `${this.apiUrl}/api/disputes/${d.id}/evidence/${i}` : e.value, note: e.note ?? null, at: e.at })),
        timeline: d.timeline.map((t) => ({ at: t.at, text: t.text })),
        decidedAt: iso(d.decidedAt),
        decisionReason: d.decisionReason,
      })),
      messages: messages.map((m) => ({
        id: m.id,
        challenge: ref(m.challengeId),
        sentAt: iso(m.createdAt),
        editedAt: iso(m.editedAt),
        body: m.body,
        replyTo: m.replyToId,
        announcement: m.announcement,
        hidden: Boolean(m.hiddenAt),
      })),
      feedPosts: feed.map((f) => ({ challenge: ref(f.challengeId), kind: f.kind, text: f.text, postedAt: iso(f.createdAt) })),
      moneyHistory: ledger.map((l) => ({
        at: iso(l.createdAt),
        kind: l.kind,
        challenge: ref(l.challengeId),
        amountUsd: toUsd(l.amount),
        status: l.status,
        transaction: l.signature,
      })),
      sponsorships: sponsorships.map((s) => ({ challenge: ref(s.challengeId), amountUsd: toUsd(s.amount), wallet: s.wallet, status: s.status, reclaimed: s.reclaimed, transaction: s.signature, at: iso(s.createdAt) })),
      organizations: memberships
        .filter((m) => orgById.has(m.orgId))
        .map((m) => {
          const o = orgById.get(m.orgId)!;
          return { id: o.slug, name: o.name, role: m.role, joinedAt: iso(m.createdAt) };
        }),
      achievements: achievements.map((a) => ({ challenge: ref(a.challengeId), title: a.title, provider: PROVIDER_LABELS[a.provider] ?? a.provider, detail: a.detail, earnedAt: iso(a.earnedAt) })),
    };
  }
}
