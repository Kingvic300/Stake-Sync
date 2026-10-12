import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { PublicKey } from '@solana/web3.js';
import { In, IsNull, MoreThan, Not, Repository } from 'typeorm';
import { AppError } from '../../common/errors.js';
import { Events, type LinkedEvent, type UserEvent, type WalletLinkedEvent } from '../../common/events.js';
import type { VerificationLevel } from '../challenges/entities/challenge.entities.js';
import { Participant } from '../challenges/entities/challenge.entities.js';
import { SolanaService } from '../payments/solana/solana.service.js';
import { ConnectedAccount, User, Wallet } from '../users/entities/user.entities.js';
import { RiskFlag, RiskSignal, type SignalKind } from './entities/risk.entities.js';

const DAY = 86_400_000;
/** Score at which an account is raised to the risk team. */
const FLAG_AT = 60;
const LEVELS: VerificationLevel[] = ['Basic', 'Verified user', 'Enhanced'];

export interface Trust {
  level: VerificationLevel;
  score: number;
  /** What would raise the level, in plain words. */
  next: string[];
}

/**
 * Anti-Sybil and abuse detection (PRD §11, §27). Signals add up to a 0–100 score; high scores open a
 * case for the risk team. Nothing here moves money or penalises anyone automatically: a person
 * restricted by an admin keeps everything they're owed.
 */
@Injectable()
export class RiskService {
  private readonly log = new Logger('Risk');

  constructor(
    @InjectRepository(RiskSignal) private readonly signals: Repository<RiskSignal>,
    @InjectRepository(RiskFlag) private readonly flags: Repository<RiskFlag>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(ConnectedAccount) private readonly connections: Repository<ConnectedAccount>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    private readonly solana: SolanaService,
  ) {}

  async score(userId: string) {
    const rows = await this.signals.find({ where: { userId, createdAt: MoreThan(new Date(Date.now() - 90 * DAY)) } });
    return Math.min(100, rows.reduce((s, r) => s + r.weight, 0));
  }

  /** PRD §11 levels. Higher-value challenges require stronger verification. */
  async trust(userId: string): Promise<Trust> {
    const user = await this.users.findOneByOrFail({ id: userId });
    const [score, linked, wallets] = await Promise.all([
      this.score(userId),
      this.connections.countBy({ userId, status: 'active' }),
      this.wallets.countBy({ userId, verifiedAt: Not(IsNull()) }),
    ]);
    const identities = linked + wallets;
    const ageDays = (Date.now() - user.createdAt.getTime()) / DAY;
    const verifiedEmail = Boolean(user.emailVerifiedAt);
    const restricted = user.status !== 'active';
    const next: string[] = [];

    const verified = verifiedEmail && identities >= 1 && ageDays >= 1 && score < FLAG_AT && !restricted;
    const enhanced = verified && identities >= 2 && ageDays >= 7 && score < 30;

    if (!verifiedEmail) next.push('Confirm your email');
    if (identities < 1) next.push('Connect GitHub, another account or your wallet');
    else if (identities < 2) next.push('Connect a second account or wallet');
    if (ageDays < 7) next.push(ageDays < 1 ? 'Accounts unlock paid challenges after 24 hours' : 'Enhanced challenges need an account at least 7 days old');

    return { level: enhanced ? 'Enhanced' : verified ? 'Verified user' : 'Basic', score, next: enhanced ? [] : next };
  }

  /** Throws a plain explanation if this person can't join a challenge at this level. */
  async assertCanJoin(userId: string, required: VerificationLevel) {
    const user = await this.users.findOneByOrFail({ id: userId });
    if (user.status === 'restricted') {
      throw new AppError('account_restricted', "Your account is under review, so you can't join new challenges right now. Your existing stakes and payouts aren't affected. Email stakesync2@gmail.com if you have questions.", HttpStatus.FORBIDDEN);
    }
    // Account levels (age, linked accounts) are off unless ENFORCE_ACCOUNT_LEVELS=true.
    if (process.env.ENFORCE_ACCOUNT_LEVELS !== 'true') return;
    const t = await this.trust(userId);
    if (LEVELS.indexOf(t.level) < LEVELS.indexOf(required)) {
      throw new AppError('verification_required', `This challenge needs a ${required} account. ${t.next.join('. ')}.`, HttpStatus.FORBIDDEN, { required, current: t.level, next: t.next });
    }
  }

  async addSignal(userId: string, kind: SignalKind, detail: string, weight: number, ref: string, linkedUserId: string | null = null) {
    const inserted = await this.signals
      .createQueryBuilder()
      .insert()
      .values({ userId, kind, detail, weight, ref, linkedUserId })
      .orIgnore()
      .execute();
    if (!inserted.identifiers.length || !inserted.identifiers[0]) return;
    await this.reassess(userId);
  }

  /** Opens or updates the account's risk case when the score crosses the threshold. */
  async reassess(userId: string) {
    const score = await this.score(userId);
    const open = await this.flags.findOne({ where: { userId, status: In(['open', 'watching', 'restricted']) }, order: { createdAt: 'DESC' } });
    if (score < FLAG_AT && !open) return;
    const sigs = await this.signals.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 20 });
    const linked = [...new Set(sigs.map((s) => s.linkedUserId).filter((x): x is string => Boolean(x)))];
    const stakes = await this.participants.find({ where: { userId, status: In(['pending', 'active']) } });
    const value = stakes.reduce((s, p) => s + p.stake, 0n);
    if (open) {
      Object.assign(open, { score, signals: sigs.map((s) => s.detail), linkedUserIds: linked, value });
      await this.flags.save(open);
    } else {
      await this.flags.save(this.flags.create({ userId, score, signals: sigs.map((s) => s.detail), linkedUserIds: linked, value }));
      this.log.log(`Risk case opened for ${userId} (score ${score})`);
    }
  }

  // ---------- detectors ----------

  @OnEvent(Events.UserSignedUp, { async: true, promisify: true })
  async onSignup(e: UserEvent) {
    const user = await this.users.findOneBy({ id: e.userId });
    if (!user) return;
    const since = new Date(Date.now() - DAY);
    if (user.deviceHash) {
      const same = await this.users.find({ where: { deviceHash: user.deviceHash, id: Not(user.id) }, take: 10 });
      for (const other of same) {
        await this.addSignal(user.id, 'shared_device', `Signed up on the same device as @${other.handle}`, 35, `device:${user.id}:${other.id}`, other.id);
        await this.addSignal(other.id, 'shared_device', `Shares a device with new account @${user.handle}`, 20, `device:${other.id}:${user.id}`, user.id);
      }
    }
    if (user.signupIpHash) {
      const recent = await this.users.find({ where: { signupIpHash: user.signupIpHash, id: Not(user.id), createdAt: MoreThan(since) }, take: 10 });
      if (recent.length >= 2) {
        await this.addSignal(user.id, 'burst_signup', `${recent.length + 1} accounts created from one network within 24 hours`, 25, `burst:${user.id}`, recent[0].id);
      } else if (recent.length === 1) {
        await this.addSignal(user.id, 'shared_ip', `Created from the same network as @${recent[0].handle} within 24 hours`, 10, `ip:${user.id}:${recent[0].id}`, recent[0].id);
      }
    }
  }

  @OnEvent(Events.AccountLinked, { async: true, promisify: true })
  async onLinked(e: LinkedEvent) {
    if (e.externalCreatedAt && Date.now() - new Date(e.externalCreatedAt).getTime() < 30 * DAY) {
      const days = Math.max(1, Math.round((Date.now() - new Date(e.externalCreatedAt).getTime()) / DAY));
      await this.addSignal(e.userId, 'new_external_account', `${e.provider} account created ${days} day${days === 1 ? '' : 's'} ago`, 15, `newacct:${e.provider}:${e.externalId}`);
    }
  }

  @OnEvent('risk.linked_account_attempt', { async: true, promisify: true })
  async onLinkAttempt(e: { userId: string; otherUserId: string; provider: string }) {
    await this.addSignal(e.userId, 'linked_account_attempt', `Tried to connect a ${e.provider} account that belongs to another member`, 30, `linkattempt:${e.provider}:${e.userId}:${e.otherUserId}`, e.otherUserId);
  }

  @OnEvent(Events.WalletLinked, { async: true, promisify: true })
  async onWallet(e: WalletLinkedEvent) {
    // Embedded wallets are first funded by on-ramps or our own rent top-ups, which say nothing about
    // who controls them.
    if (e.kind !== 'external') return;
    const funder = await this.firstFunder(e.address).catch(() => null);
    if (!funder || funder === this.solana.platform?.publicKey.toBase58()) return;
    await this.wallets.update({ address: e.address }, { fundedBy: funder });
    const siblings = await this.wallets.find({ where: { fundedBy: funder, address: Not(e.address) }, take: 25 });
    const others = siblings.filter((w) => w.userId !== e.userId);
    // Big clusters are usually exchanges paying out to many customers, not one person.
    if (others.length === 0 || others.length > 20) return;
    const short = `${funder.slice(0, 4)}…${funder.slice(-3)}`;
    for (const w of others) {
      await this.addSignal(e.userId, 'shared_funding', `Funded from the same wallet (${short}) as another member's wallet`, 25, `funding:${e.userId}:${w.userId}`, w.userId);
      await this.addSignal(w.userId, 'shared_funding', `Funded from the same wallet (${short}) as another member's wallet`, 25, `funding:${w.userId}:${e.userId}`, e.userId);
    }
  }

  @OnEvent(Events.ParticipantJoined, { async: true, promisify: true })
  async onJoin(e: { userId: string }) {
    const recent = await this.participants.countBy({ userId: e.userId, createdAt: MoreThan(new Date(Date.now() - 10 * 60_000)) });
    if (recent >= 3) {
      await this.addSignal(e.userId, 'rapid_join_claim', `Joined ${recent} challenges within 10 minutes`, 10, `rapidjoin:${e.userId}:${new Date().toISOString().slice(0, 13)}`);
    }
  }

  /** The address that sent this wallet its first SOL, from its oldest transactions. */
  private async firstFunder(address: string) {
    const conn = this.solana.connection;
    const key = new PublicKey(address);
    let before: string | undefined;
    let oldest: string | undefined;
    for (let page = 0; page < 3; page++) {
      const sigs = await conn.getSignaturesForAddress(key, { before, limit: 1000 });
      if (!sigs.length) break;
      oldest = sigs[sigs.length - 1].signature;
      if (sigs.length < 1000) break;
      before = oldest;
    }
    if (!oldest) return null;
    const tx = await conn.getParsedTransaction(oldest, { maxSupportedTransactionVersion: 0 });
    for (const ix of tx?.transaction.message.instructions ?? []) {
      const p = (ix as { parsed?: { type?: string; info?: { source?: string; destination?: string } } }).parsed;
      if (p?.type === 'transfer' && p.info?.destination === address && p.info.source) return p.info.source;
    }
    return null;
  }
}
