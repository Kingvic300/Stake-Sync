import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { PublicKey } from '@solana/web3.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { AppError, conflict, forbidden, notFound } from '../../common/errors.js';
import { Events, type MoneyEvent } from '../../common/events.js';
import { toUnits, toUsd } from '../../common/money.js';
import { SettingsService } from '../../core/settings.service.js';
import { ChallengesService } from '../challenges/challenges.service.js';
import { Challenge, Participant } from '../challenges/entities/challenge.entities.js';
import { OrgMember } from '../organizations/entities/organization.entities.js';
import { User, Wallet } from '../users/entities/user.entities.js';
import { ChainWorkerService } from './chain-worker.service.js';
import { OnrampSession } from './entities/onramp.entities.js';
import { LocalRampService } from './localramp.service.js';
import { LedgerEntry, SponsorContribution, type LedgerKind } from './entities/payment.entities.js';
import { OnrampService } from './onramp.service.js';
import { chainFailure } from './solana/chain-errors.js';
import { RentService } from './solana/rent.service.js';
import { SolanaService } from './solana/solana.service.js';

const KIND_LABEL: Record<LedgerKind, string> = {
  stake_deposited: 'Stake deposited',
  stake_returned: 'Stake returned',
  reward_claimed: 'Reward claimed',
  refund: 'Stake refunded',
  sponsored: 'Sponsored',
  sponsorship_reclaimed: 'Sponsorship returned',
  penalty: 'Penalty',
  join_fee: 'Joining fee',
  sent: 'Sent to a wallet',
  added: 'Added money',
  cashed_out: 'Cashed out',
};

@Injectable()
export class PaymentsService {
  private readonly appUrl: string;
  private readonly provider: 'localramp' | 'onramper';

  constructor(
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(LedgerEntry) private readonly ledger: Repository<LedgerEntry>,
    @InjectRepository(SponsorContribution) private readonly sponsors: Repository<SponsorContribution>,
    @InjectRepository(OrgMember) private readonly members: Repository<OrgMember>,
    @InjectRepository(OnrampSession) private readonly onrampSessions: Repository<OnrampSession>,
    private readonly solana: SolanaService,
    private readonly rent: RentService,
    private readonly worker: ChainWorkerService,
    private readonly challengesService: ChallengesService,
    private readonly onramp: OnrampService,
    private readonly localramp: LocalRampService,
    private readonly settings: SettingsService,
    private readonly events: EventEmitter2,
    config: ConfigService,
  ) {
    this.appUrl = config.get('appUrl')!;
    this.provider = config.get<'localramp' | 'onramper'>('onrampProvider') ?? 'onramper';
  }

  // ---------- wallet (PRD §16, §18) ----------

  /** Separate buckets, as PRD §18 requires: available, locked stakes, claimable, forfeited. */
  async summary(userId: string) {
    const wallets = await this.wallets.find({ where: { userId }, order: { primary: 'DESC', createdAt: 'ASC' } });
    const balances = await Promise.all(wallets.map(async (w) => ({ w, usdc: await this.solana.usdcBalance(new PublicKey(w.address)).catch(() => null) })));
    const parts = await this.participants.find({ where: { userId, status: Not('pending') }, relations: { challenge: true } });
    const locked = parts.filter((p) => p.status === 'active' && !p.settled).reduce((s, p) => s + p.stake, 0n);
    const claimable = parts.filter((p) => !p.claimed && p.claimable > 0n).reduce((s, p) => s + p.claimable, 0n);
    const forfeited = parts.filter((p) => p.settled).reduce((s, p) => s + (p.completed ? p.penalty : p.stake), 0n);
    const rewards = await this.ledger.createQueryBuilder('l').select('COALESCE(SUM(l.amount), 0)', 'sum').where("l.user_id = :userId AND l.kind = 'reward_claimed'", { userId }).getRawOne<{ sum: string }>();
    const primary = wallets.find((w) => w.primary) ?? wallets[0];
    // Stakes and transfers are paid from the main wallet, so that's what's available. null when
    // the chain couldn't be read, so the app says so instead of showing $0.
    const main = primary ? balances.find((b) => b.w.id === primary.id)!.usdc : 0n;
    return {
      address: primary ? `${primary.address.slice(0, 4)}…${primary.address.slice(-4)}` : null,
      available: main === null ? null : toUsd(main),
      locked: toUsd(locked),
      claimable: toUsd(claimable),
      forfeited: toUsd(forfeited),
      lifetimeRewards: toUsd(BigInt(rewards?.sum ?? '0')),
      wallets: balances.map(({ w, usdc }) => ({ address: w.address, kind: w.kind, primary: w.primary, usdc: usdc === null ? null : toUsd(usdc) })),
      claims: parts
        .filter((p) => !p.claimed && p.claimable > 0n)
        .map((p) => ({
          challengeId: p.challenge!.slug,
          title: p.challenge!.title,
          amount: toUsd(p.claimable),
          kind: p.challenge!.status === 'cancelled' ? 'refund' : 'claim',
        })),
      localCurrency: this.onramp.enabled,
    };
  }

  async history(userId: string, before?: string) {
    const rows = await this.ledger.find({
      where: { userId, ...(before ? { createdAt: LessThan(new Date(before)) } : {}) },
      order: { createdAt: 'DESC' },
      take: 100,
    }).then((list) => list.filter((r) => !(r.status === 'pending' && !r.signature && r.ref?.startsWith('send:')))); // never signed: nothing was sent
    const cs = rows.length ? await this.challenges.findBy({ id: In(rows.map((r) => r.challengeId).filter((x): x is string => Boolean(x))) }) : [];
    return rows.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      kind: KIND_LABEL[r.kind],
      challengeId: cs.find((c) => c.id === r.challengeId)?.slug ?? null,
      challenge: cs.find((c) => c.id === r.challengeId)?.title ?? null,
      amount: toUsd(r.amount),
      signature: r.signature,
      status: r.status,
      // Top-ups and cash-outs in local currency; null for everything else.
      fiatAmount: r.fiatAmount === null ? null : Number(r.fiatAmount),
      fiatCurrency: r.fiatCurrency,
      detail: r.detail,
      reference: r.externalRef,
    }));
  }

  // ---------- claims and refunds ----------

  /** Claim winnings or a refund: returns a transaction for the person's wallet to sign. */
  async claim(userId: string, slug: string) {
    const c = await this.challengesService.bySlug(slug);
    const p = await this.participants.findOneBy({ challengeId: c.id, userId });
    if (!p) throw notFound('participation');
    if (p.claimed) throw conflict('already_claimed', 'You’ve already claimed this.');
    const kind = c.status === 'cancelled' ? 'refund' : 'claim';
    if (kind === 'claim' && (c.status !== 'ended' || !p.completed)) {
      throw new AppError('nothing_to_claim', c.status === 'ended' ? 'There’s nothing to claim from this challenge.' : 'Payouts open once the challenge is settled. We’ll let you know.');
    }
    if (!c.onChain) throw new AppError('nothing_to_claim', 'This challenge had no money involved.');
    const ixs = await this.solana.withdrawIxs(kind, new PublicKey(c.challengePda!), new PublicKey(p.wallet!), this.solana.requirePlatform().publicKey);
    return { status: 'needs_signature' as const, amount: toUsd(p.claimable), ...(await this.solana.buildForWallet(ixs)) };
  }

  async confirmClaim(userId: string, slug: string, signature: string) {
    const c = await this.challengesService.bySlug(slug);
    const p = await this.participants.findOneBy({ challengeId: c.id, userId });
    if (!p) throw notFound('participation');
    try {
      await this.solana.confirmExternal(signature);
    } catch (e) {
      throw chainFailure(e);
    }
    const chain = await this.solana.fetchParticipant(new PublicKey(c.challengePda!), new PublicKey(p.wallet!));
    if (!chain?.claimed) return { status: 'pending' as const };
    await this.worker.recordWithdrawal(c.status === 'cancelled' ? 'refund' : 'claim', c, p, signature);
    return { status: 'claimed' as const, amount: toUsd(p.claimable) };
  }

  // ---------- sponsoring (PRD §8 rewards, §14) ----------

  async sponsor(userId: string, slug: string, amountUsd: number, orgSlug?: string) {
    const c = await this.challengesService.visible(slug, userId);
    if (!c.onChain || !c.challengePda) throw new AppError('not_sponsorable', 'This challenge can’t take sponsorship.');
    if (!['open', 'live'].includes(c.status) || new Date() >= c.endsAt) throw conflict('sponsorship_closed', 'Sponsorship is closed for this challenge.');
    const limits = await this.settings.limits();
    if (amountUsd < 1 || amountUsd > limits.maxSponsorUsd) throw new AppError('invalid_amount', `Sponsor between $1 and $${limits.maxSponsorUsd.toLocaleString('en')}.`);
    let orgId: string | null = null;
    if (orgSlug) {
      const m = await this.members.createQueryBuilder('m').innerJoin('organizations', 'o', 'o.id = m.org_id').where('o.slug = :orgSlug AND m.user_id = :userId', { orgSlug, userId }).getOne();
      if (!m || !['Owner', 'Admin'].includes(m.role)) throw forbidden('Only owners and admins can sponsor for this organization.');
      orgId = m.orgId;
    }
    const amount = toUnits(amountUsd);
    const wallet = await this.wallets.findOne({ where: { userId, verifiedAt: Not(IsNull()) }, order: { primary: 'DESC' } });
    if (!wallet) throw new AppError('no_wallet', 'Set up your wallet first. It takes a few seconds.', HttpStatus.PAYMENT_REQUIRED);
    const owner = new PublicKey(wallet.address);
    const balance = await this.solana.usdcBalance(owner);
    if (balance < amount) throw new AppError('insufficient_balance', `You need $${toUsd(amount - balance).toFixed(2)} more. Add money and try again.`, HttpStatus.PAYMENT_REQUIRED);

    const contribution = await this.sponsors.save(this.sponsors.create({ challengeId: c.id, sponsorUserId: userId, orgId, wallet: wallet.address, amount, status: 'pending' }));
    const ix = await this.solana.sponsorIx(new PublicKey(c.challengePda), owner, amount);
    await this.rent.ensure(wallet); // the first sponsorship creates a small account
    return { status: 'needs_signature' as const, contributionId: contribution.id, ...(await this.solana.buildForWallet([ix])) };
  }

  async confirmSponsor(contributionId: string, signature: string, userId?: string) {
    const s = await this.sponsors.findOneBy({ id: contributionId, ...(userId ? { sponsorUserId: userId } : {}) });
    if (!s) throw notFound('sponsorship');
    if (s.status === 'confirmed') return { status: 'sponsored' as const };
    if (userId) {
      try {
        await this.solana.confirmExternal(signature);
      } catch (e) {
        await this.sponsors.update({ id: s.id }, { status: 'failed' });
        throw chainFailure(e);
      }
    }
    const c = await this.challenges.findOneByOrFail({ id: s.challengeId });
    await this.sponsors.update({ id: s.id }, { status: 'confirmed', signature });
    const chain = await this.solana.fetchChallenge(new PublicKey(c.challengePda!));
    if (chain) await this.challenges.update({ id: c.id }, { sponsorPool: BigInt(chain.sponsorPool.toString()) });
    await this.ledger.createQueryBuilder().insert().values({ userId: s.sponsorUserId, challengeId: c.id, kind: 'sponsored', amount: -s.amount, signature, status: 'confirmed', ref: `sponsor:${signature}` }).orIgnore().execute();
    this.events.emit(Events.Sponsored, { userId: s.sponsorUserId, challengeId: c.id, amount: s.amount, signature } satisfies MoneyEvent);
    return { status: 'sponsored' as const };
  }

  async reclaimSponsorship(userId: string, contributionId: string) {
    const s = await this.sponsors.findOneBy({ id: contributionId, sponsorUserId: userId, status: 'confirmed' });
    if (!s) throw notFound('sponsorship');
    if (s.reclaimed) throw conflict('already_reclaimed', 'You already took this sponsorship back.');
    const c = await this.challenges.findOneByOrFail({ id: s.challengeId });
    if (!(c.status === 'cancelled' || (c.status === 'ended' && c.finisherCount === 0))) {
      throw conflict('cannot_reclaim', 'Sponsorship comes back only if the challenge was cancelled or nobody finished.');
    }
    const ixs = await this.solana.reclaimSponsorshipIxs(new PublicKey(c.challengePda!), new PublicKey(s.wallet), this.solana.requirePlatform().publicKey);
    return { status: 'needs_signature' as const, ...(await this.solana.buildForWallet(ixs)) };
  }

  async confirmReclaim(userId: string, contributionId: string, signature: string) {
    const s = await this.sponsors.findOneBy({ id: contributionId, sponsorUserId: userId });
    if (!s) throw notFound('sponsorship');
    try {
      await this.solana.confirmExternal(signature);
    } catch (e) {
      throw chainFailure(e);
    }
    await this.worker.recordReclaim(await this.challenges.findOneByOrFail({ id: s.challengeId }), s, signature);
    return { status: 'reclaimed' as const };
  }

  async mySponsorships(userId: string) {
    const rows = await this.sponsors.find({ where: { sponsorUserId: userId, status: 'confirmed' }, order: { createdAt: 'DESC' } });
    const cs = rows.length ? await this.challenges.findBy({ id: In(rows.map((r) => r.challengeId)) }) : [];
    return rows.map((r) => {
      const c = cs.find((x) => x.id === r.challengeId)!;
      return {
        id: r.id,
        challengeId: c.slug,
        title: c.title,
        amount: toUsd(r.amount),
        reclaimed: r.reclaimed,
        canReclaim: !r.reclaimed && (c.status === 'cancelled' || (c.status === 'ended' && c.finisherCount === 0)),
      };
    });
  }

  // ---------- local currency in and out (Onramper) ----------

  /**
   * A signed link to buy USDC with local currency (cards, bank transfer, mobile money) straight
   * into the person's own wallet, or to sell it back to their bank. Licensed on-ramps do the
   * conversion and identity checks; Stake-Sync never holds the money.
   */
  // ---------- sending USDC to another wallet ----------

  /**
   * A transfer from the person's own wallet for them to sign. The platform pays the network fee;
   * a new destination account is paid for from the person's wallet (topped up within the rent cap).
   */
  async sendUsdc(userId: string, toAddress: string, amountUsd: number) {
    const user = await this.users.findOneByOrFail({ id: userId });
    if (user.status !== 'active') throw forbidden('Your account is under review, so sending money is paused. Email stakesync2@gmail.com.');
    let to: PublicKey;
    try {
      to = new PublicKey(toAddress);
    } catch {
      throw new AppError('invalid_address', 'That isn’t a Solana wallet address. Check it and try again.');
    }
    if (!PublicKey.isOnCurve(to.toBytes())) throw new AppError('invalid_address', 'That address belongs to a program, not a wallet. Send to a wallet address instead.');
    const wallet = await this.wallets.findOne({ where: { userId, verifiedAt: Not(IsNull()) }, order: { primary: 'DESC' } });
    if (!wallet) throw new AppError('no_wallet', 'Set up your wallet first. It takes a few seconds.', HttpStatus.PAYMENT_REQUIRED);
    const from = new PublicKey(wallet.address);
    if (from.equals(to)) throw new AppError('same_wallet', 'That’s the wallet the money is already in.');
    const amount = toUnits(amountUsd);
    const balance = await this.solana.usdcBalance(from);
    if (balance < amount) throw new AppError('insufficient_balance', `You have $${toUsd(balance).toFixed(2)} available to send.`, HttpStatus.PAYMENT_REQUIRED);

    const id = randomUUID();
    await this.ledger.save(this.ledger.create({ userId, challengeId: null, kind: 'sent', amount: -amount, status: 'pending', ref: `send:${id}`, signature: null }));
    await this.rent.ensure(wallet); // in case the destination needs a USDC account
    return { status: 'needs_signature' as const, sendId: id, ...(await this.solana.buildForWallet(this.solana.usdcTransferIxs(from, to, amount, from))), to: to.toBase58() };
  }

  /** After the wallet sends it: checks the chain really moved the money before recording it. */
  async confirmSend(userId: string, sendId: string, toAddress: string, signature: string) {
    const row = await this.ledger.findOneBy({ userId, ref: `send:${sendId}` });
    if (!row) throw notFound('transfer');
    if (row.status === 'confirmed') return { status: 'sent' as const };
    const wallet = await this.wallets.findOne({ where: { userId, verifiedAt: Not(IsNull()) }, order: { primary: 'DESC' } });
    if (!wallet) throw notFound('wallet');
    try {
      if (!(await this.solana.confirmExternal(signature))) {
        await this.ledger.update({ id: row.id }, { signature }); // shows in history as pending, not lost
        return { status: 'pending' as const };
      }
    } catch (e) {
      await this.ledger.update({ id: row.id }, { status: 'failed', signature });
      throw chainFailure(e);
    }
    const ok = await this.solana.verifyUsdcTransfer(signature, new PublicKey(wallet.address), new PublicKey(toAddress), -row.amount);
    if (!ok) throw new AppError('transfer_mismatch', 'We couldn’t match that transaction to this transfer. If money left your wallet, contact support with the transaction link.');
    await this.ledger.update({ id: row.id }, { status: 'confirmed', signature });
    return { status: 'sent' as const };
  }

  async onrampLink(userId: string, mode: 'buy' | 'sell', fiat?: string, amount?: number) {
    const user = await this.users.findOneByOrFail({ id: userId });
    if (user.status !== 'active') throw forbidden('Your account is under review, so adding money is paused. Email stakesync2@gmail.com.');
    const wallet = await this.wallets.findOne({ where: { userId, verifiedAt: Not(IsNull()) }, order: { primary: 'DESC' } });
    if (!wallet) throw new AppError('no_wallet', 'Set up your wallet first. It takes a few seconds.', HttpStatus.PAYMENT_REQUIRED);
    // A random reference for this link. Onramper sends it back in its webhooks, which is how the
    // transaction finds this person and wallet; it reveals nothing about them on its own.
    const partnerContext = `ss_${randomBytes(18).toString('base64url')}`;
    // LocalRamp opens as a pop-up in the app; Onramper as a signed page we redirect to.
    const result =
      this.provider === 'localramp'
        ? { provider: 'localramp' as const, reference: partnerContext, widget: this.localramp.widget({ mode, reference: partnerContext, wallet: wallet.address, fiat: fiat ?? 'NGN', amount, email: user.email }) }
        : { provider: 'onramper' as const, ...this.onramp.widgetUrl({ mode, wallet: wallet.address, partnerContext, fiat, amount, returnUrl: `${this.appUrl}/wallet?onramp=${mode}` }) };
    await this.onrampSessions.save(
      this.onrampSessions.create({ userId, walletAddress: wallet.address, mode, partnerContext, fiatCurrency: fiat?.toUpperCase() ?? null, requestedAmount: amount?.toFixed(2) ?? null }),
    );
    return result;
  }
}
