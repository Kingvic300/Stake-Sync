import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { PublicKey } from '@solana/web3.js';
import { DataSource, In, IsNull, LessThan, Like, MoreThan, Not, Repository, type EntityManager } from 'typeorm';
import { sha256Hex } from '../../common/crypto.js';
import { AppError, errMsg } from '../../common/errors.js';
import type { RequestInfo } from '../../core/logs/logs.service.js';
import { LogsService } from '../../core/logs/logs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { Wallet } from '../users/entities/user.entities.js';
import { OnrampEvent, OnrampSession, OnrampTransaction, type OnrampEventOutcome } from './entities/onramp.entities.js';
import { LedgerEntry } from './entities/payment.entities.js';
import {
  decideTransition,
  ledgerDetail,
  ledgerStatus,
  mapAmounts,
  notificationFor,
  parseEvent,
  progressOf,
  showInHistory,
  type OnrampAmounts,
  type OnrampEventData,
} from './onramp-mapping.js';
import { fromLocalRampBuyStatus, fromLocalRampWebhook, verifyLocalRampToken } from './localramp.js';
import { LocalRampService } from './localramp.service.js';
import { OnrampService, verifyWebhookSignature } from './onramp.service.js';
import { SolanaService } from './solana/solana.service.js';

const MAX_ATTEMPTS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const HOUR = 3_600_000;

type Owner = { userId: string; sessionId: string | null; wallet: string };
type Processed = { outcome: OnrampEventOutcome; note?: string; notify?: string };

/**
 * Records Onramper top-ups (and, once confirmed, cash-outs) in money history (issue #1).
 *
 * Every authenticated payload goes into an inbox first, so a crash or a database hiccup never loses
 * one, and we don't depend on Onramper retrying (its retry policy isn't documented). Processing is
 * idempotent: identical deliveries are stored once, status changes only move forward
 * (`decideTransition`), and notifications are deduplicated per transaction and state.
 *
 * The person's wallet balance is never touched: it is always read from the chain. This only explains
 * where money came from or went.
 */
@Injectable()
export class OnrampWebhookService {
  private readonly log = new Logger('Onramper');
  private readonly enabled: boolean;
  private readonly secret?: string;
  private readonly sellEnabled: boolean;
  private readonly reconcileEnabled: boolean;
  private readonly usdcId: string;
  private running = false;

  constructor(
    @InjectRepository(OnrampEvent) private readonly events: Repository<OnrampEvent>,
    @InjectRepository(OnrampTransaction) private readonly transactions: Repository<OnrampTransaction>,
    @InjectRepository(OnrampSession) private readonly sessions: Repository<OnrampSession>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    private readonly db: DataSource,
    private readonly onramp: OnrampService,
    private readonly localramp: LocalRampService,
    private readonly solana: SolanaService,
    private readonly notifications: NotificationsService,
    private readonly logs: LogsService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('onramp.webhooksEnabled') ?? false;
    this.secret = config.get<string>('onramp.webhookSecret')?.trim() || undefined;
    this.sellEnabled = config.get<boolean>('onramp.sellWebhooksEnabled') ?? false;
    this.reconcileEnabled = config.get<boolean>('onramp.reconcileEnabled') ?? false;
    this.usdcId = config.get<string>('onramp.usdcId') ?? 'usdc_sol';
    if (this.enabled && !this.secret) this.log.error('ONRAMPER_WEBHOOKS_ENABLED is on but ONRAMPER_WEBHOOK_SECRET is missing: webhooks will be refused.');
  }

  // ---------- receiving ----------

  /** A webhook from Onramper. Answers 200 once the payload is safely stored, even if processing has to be retried. */
  async receive(rawBody: Buffer | undefined, signature: string | undefined, info: RequestInfo) {
    if (!this.enabled) throw new AppError('onramp_webhooks_disabled', 'Onramper webhooks aren’t enabled.', HttpStatus.SERVICE_UNAVAILABLE);
    if (!this.secret) throw new AppError('onramp_webhooks_unconfigured', 'Onramper webhooks aren’t configured.', HttpStatus.SERVICE_UNAVAILABLE);
    if (!rawBody?.length) throw new AppError('invalid_body', 'Expected a JSON body.');
    if (!verifyWebhookSignature(rawBody, signature, this.secret)) {
      // Never log the header or the body: only that it failed.
      this.logs.security('onramp_bad_signature', 'Onramper webhook signature did not verify', info, { bytes: rawBody.length, header: Boolean(signature) });
      throw new AppError('invalid_signature', 'Signature check failed.', HttpStatus.UNAUTHORIZED);
    }
    const id = await this.store(rawBody, 'webhook');
    if (id) await this.processSafely(id);
    return { received: true };
  }

  /** A webhook from LocalRamp, checked against the token set in its dashboard. */
  async receiveLocalRamp(rawBody: Buffer | undefined, token: string | undefined, info: RequestInfo) {
    const expected = this.localramp.webhookToken;
    if (!expected) throw new AppError('onramp_webhooks_unconfigured', 'LocalRamp webhooks aren’t configured.', HttpStatus.SERVICE_UNAVAILABLE);
    if (!rawBody?.length) throw new AppError('invalid_body', 'Expected a JSON body.');
    if (!verifyLocalRampToken(token, expected)) {
      this.logs.security('localramp_bad_token', 'LocalRamp webhook token did not match', info, { bytes: rawBody.length, header: Boolean(token) });
      throw new AppError('invalid_signature', 'Token check failed.', HttpStatus.UNAUTHORIZED);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new AppError('invalid_body', 'Expected a JSON body.');
    }
    const event = payload && typeof payload === 'object' && !Array.isArray(payload) ? fromLocalRampWebhook(payload as Record<string, unknown>, new Date(), this.localramp.codes) : null;
    // Swaps and sell.initiated don't describe one of our transactions; acknowledge so LocalRamp stops retrying.
    if (!event) return { received: true };
    // Deduplicated on the bytes LocalRamp sent, since our translation stamps the time received.
    const id = await this.store(Buffer.from(JSON.stringify(event)), 'lr_hook', rawBody);
    if (id) await this.processSafely(id);
    return { received: true };
  }

  /**
   * Asks LocalRamp where a top-up is, e.g. when the person closes the pop-up. Only for the person's
   * own session, so nobody can probe others' transactions.
   */
  async checkLocalRamp(userId: string, reference: string) {
    const session = await this.sessions.findOneBy({ partnerContext: reference, userId });
    if (!session) throw new AppError('not_found', 'We couldn’t find that payment.', HttpStatus.NOT_FOUND);
    if (session.mode !== 'buy') return { state: 'unknown' as const };
    const data = await this.localramp.buyStatus(reference);
    const event = fromLocalRampBuyStatus(data, new Date(), this.localramp.codes);
    if (!event) return { state: 'unknown' as const };
    const id = await this.store(Buffer.from(JSON.stringify(event)), 'lr_poll');
    if (id) await this.processSafely(id);
    return { state: String(event.status) };
  }

  /** Inbox insert, idempotent by the payload's hash (or `hashOf`'s). Returns null for a repeat delivery. */
  private async store(raw: Buffer, source: OnrampEvent['source'], hashOf: Buffer = raw) {
    let payload: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(raw.toString('utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch {
      payload = null;
    }
    const e = payload ? parseEvent(payload) : null;
    // The public API key isn't needed later; everything else is kept as received.
    const kept = payload ? { ...payload } : null;
    if (kept) {
      delete kept.apiKey;
      delete kept.ApiKey;
    }
    const res = await this.events
      .createQueryBuilder()
      .insert()
      .values({
        source,
        bodySha256: sha256Hex(hashOf),
        payload: kept as never,
        transactionId: e?.ok ? e.event.transactionId : null,
        status: e?.ok ? e.event.rawStatus : null,
        statusDate: e?.ok ? e.event.statusDate : null,
        ...(payload ? {} : { processedAt: new Date(), outcome: 'invalid' as const, note: 'Body is not a JSON object' }),
      })
      .orIgnore()
      .execute();
    const id = (res.identifiers[0] as { id?: string } | undefined)?.id;
    return payload && id ? id : null;
  }

  // ---------- processing ----------

  /** Process one stored event; on failure, schedule a retry with backoff instead of losing it. */
  async processSafely(id: string) {
    try {
      const r = await this.process(id);
      if (r?.notify) await this.deliver(r.notify);
    } catch (e) {
      const msg = errMsg(e).slice(0, 300);
      await this.events
        .createQueryBuilder()
        .update()
        .set({ attempts: () => 'attempts + 1', lastError: msg, nextAttemptAt: () => "now() + least(power(2, attempts), 60) * interval '1 minute'" })
        .where('id = :id', { id })
        .execute()
        .catch(() => undefined);
      const ev = await this.events.findOneBy({ id }).catch(() => null);
      if (ev && ev.attempts >= MAX_ATTEMPTS) void this.logs.error('Onramper', e, {}, { event: id, attempts: ev.attempts });
      else this.log.warn(`Onramper event ${id} failed, will retry: ${msg}`);
    }
  }

  async process(id: string): Promise<Processed | null> {
    const ev = await this.events.findOneBy({ id });
    if (!ev || ev.processedAt) return null;

    const prepared = await this.prepare(ev);
    if ('outcome' in prepared) return this.finish(id, prepared);
    const { e, owner, amounts, chainCredit } = prepared;

    return this.db.transaction(async (m) => {
      // One worker per event, even with the retry job or another instance running.
      const locked = await m
        .getRepository(OnrampEvent)
        .createQueryBuilder('e')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('e.id = :id AND e.processed_at IS NULL', { id })
        .getOne();
      if (!locked) return null;
      const txs = m.getRepository(OnrampTransaction);
      const current = await txs.createQueryBuilder('t').setLock('pessimistic_write').where('t.transaction_id = :tid', { tid: e.transactionId }).getOne();

      let result: Processed;
      if (current && current.userId && current.userId !== owner.userId) {
        result = { outcome: 'review', note: 'Event names a different person than the stored transaction' };
      } else if (current && current.direction !== e.direction) {
        result = { outcome: 'review', note: `Event says ${e.direction}, stored transaction is ${current.direction}` };
      } else {
        // Our own authenticated status checks count as evidence; pushed messages need the chain.
        const evidence = chainCredit !== null || ev.source === 'poll' || ev.source === 'lr_poll';
        const d = decideTransition(current ? { state: current.state, statusDate: current.statusDate } : null, { state: e.state!, statusDate: e.statusDate }, evidence);
        if (d.action === 'apply') {
          const tx = await this.apply(txs, current, e, owner, amounts, chainCredit);
          tx.ledgerEntryId = await this.project(m, tx);
          await txs.update({ id: tx.id }, { ledgerEntryId: tx.ledgerEntryId });
          result = { outcome: 'applied', notify: tx.transactionId };
        } else {
          result = { outcome: d.action, note: d.reason };
        }
      }
      if (result.outcome === 'review') {
        if (current) await txs.update({ id: current.id }, { reviewReason: result.note?.slice(0, 200) ?? 'Needs review' });
        this.log.warn(`Onramper transaction ${e.transactionId} needs review: ${result.note}`);
      }
      await m.getRepository(OnrampEvent).update({ id }, { processedAt: new Date(), outcome: result.outcome, note: result.note?.slice(0, 300) ?? null, lastError: null });
      return result;
    });
  }

  /** Everything that can be decided before taking locks, including the slow on-chain check. */
  private async prepare(ev: OnrampEvent): Promise<Processed | { e: OnrampEventData; owner: Owner; amounts: OnrampAmounts; chainCredit: bigint | null }> {
    const parsed = parseEvent(ev.payload);
    if (!parsed.ok) return { outcome: 'invalid', note: parsed.reason };
    const e = parsed.event;
    // Unknown values are kept in the stored payload, not guessed at.
    if (!e.direction) return { outcome: 'parked', note: `Unknown transactionType "${e.rawType}"` };
    if (!e.state) return { outcome: 'parked', note: `Unknown status "${e.rawStatus}"` };
    if (e.direction === 'sell' && !this.sellEnabled) return { outcome: 'parked', note: 'Sell webhooks are disabled (ONRAMPER_SELL_WEBHOOKS_ENABLED)' };
    const owner = await this.owner(e);
    if ('park' in owner) return { outcome: 'parked', note: owner.park };
    const mapped = mapAmounts(e, e.direction, this.usdcId);
    if (!mapped.ok) return { outcome: 'parked', note: mapped.reason };

    // Read the credit on-chain ourselves when the provider gives us a hash for a completed buy.
    let chainCredit: bigint | null = null;
    if (e.state === 'completed' && e.direction === 'buy' && e.transactionHash && SOLANA_SIGNATURE.test(e.transactionHash)) {
      // Bounded: this runs inside Onramper's request, and a slow RPC just means "not verified".
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('RPC timed out')), 10_000).unref());
      chainCredit = await Promise.race([this.solana.usdcCredit(e.transactionHash, new PublicKey(owner.wallet)), timeout]).catch((err: unknown) => {
        this.log.warn(`Couldn't read Onramper transaction ${e.transactionId} on-chain: ${errMsg(err)}`);
        return null;
      });
      // One on-chain credit can only ever confirm one purchase.
      if (chainCredit !== null && (await this.transactions.existsBy({ transactionHash: e.transactionHash, chainVerified: true, transactionId: Not(e.transactionId) }))) chainCredit = null;
    }
    return { e, owner, amounts: mapped.amounts, chainCredit };
  }

  /**
   * Who the transaction belongs to. Normally the session our signed link named (the wallet it was
   * made for must match on buys). Links made before sessions existed carried the user id instead;
   * those are accepted only for buys into that person's own linked wallet.
   */
  private async owner(e: OnrampEventData): Promise<Owner | { park: string }> {
    const ctx = e.partnerContext;
    if (ctx?.startsWith('ss_')) {
      const s = await this.sessions.findOneBy({ partnerContext: ctx });
      if (!s) return { park: 'No session for this partnerContext' };
      if (s.mode !== e.direction) return { park: `Session was for ${s.mode}, event is ${e.direction}` };
      if (e.direction === 'buy' && e.walletAddress && e.walletAddress !== s.walletAddress) {
        this.logs.security('onramp_wallet_mismatch', 'Onramper buy delivered to a different wallet than the session', {}, { transactionId: e.transactionId });
        return { park: 'Wallet differs from the one the link was made for' };
      }
      return { userId: s.userId, sessionId: s.id, wallet: s.walletAddress };
    }
    if (ctx && UUID.test(ctx) && e.direction === 'buy' && e.walletAddress) {
      const w = await this.wallets.findOneBy({ userId: ctx, address: e.walletAddress });
      if (w) return { userId: ctx, sessionId: null, wallet: w.address };
    }
    return { park: ctx ? 'No session or linked wallet matches this event' : 'Missing partnerContext' };
  }

  private async apply(
    txs: Repository<OnrampTransaction>,
    current: OnrampTransaction | null,
    e: OnrampEventData,
    owner: Owner,
    amounts: OnrampAmounts,
    chainCredit: bigint | null,
  ) {
    const stateChanged = current?.state !== e.state;
    const verified = e.state === 'completed' && chainCredit !== null;
    const tx = txs.merge(current ?? txs.create({ transactionId: e.transactionId, progress: 0, chainVerified: false, notifiedState: null }), {
      sessionId: owner.sessionId ?? current?.sessionId ?? null,
      userId: owner.userId,
      direction: e.direction!,
      provider: e.provider ?? current?.provider ?? null,
      providerTransactionId: e.providerTransactionId ?? current?.providerTransactionId ?? null,
      providerStatus: e.rawStatus,
      state: e.state!,
      statusDate: e.statusDate,
      progress: Math.max(current?.progress ?? 0, progressOf(e.state!)),
      // Prefer what we read on-chain; otherwise the provider's figure (0 while it's still quoting).
      usdcAmount: verified ? chainCredit : amounts.usdc && amounts.usdc > 0n ? amounts.usdc : (current?.usdcAmount ?? amounts.usdc),
      chainVerified: verified || (current?.chainVerified ?? false),
      fiatAmount: amounts.fiatAmount ?? current?.fiatAmount ?? null,
      fiatCurrency: amounts.fiatCurrency ?? current?.fiatCurrency ?? null,
      walletAddress: e.walletAddress ?? current?.walletAddress ?? null,
      transactionHash: e.transactionHash ?? current?.transactionHash ?? null,
      statusReason: e.statusReason ?? (stateChanged ? null : (current?.statusReason ?? null)),
      reviewReason: null,
    });
    return txs.save(tx);
  }

  /**
   * The money-history row for a transaction: one per transaction, updated in place as it moves on.
   * A cash-out paid from Stake-Sync's own "send" is the same money leaving, so it takes over that
   * row instead of adding a second one.
   */
  private async project(m: EntityManager, tx: OnrampTransaction): Promise<string | null> {
    const ledger = m.getRepository(LedgerEntry);
    if (!tx.userId || (!showInHistory(tx) && !tx.ledgerEntryId)) return tx.ledgerEntryId;
    const units = tx.usdcAmount ?? 0n;
    const fields = {
      kind: tx.direction === 'buy' ? ('added' as const) : ('cashed_out' as const),
      amount: tx.direction === 'buy' ? units : -units,
      status: ledgerStatus(tx.state) ?? 'pending',
      // Only a transaction we confirmed on-chain gets a signature (the apps link it to an explorer).
      signature: tx.chainVerified && tx.transactionHash && tx.transactionHash.length <= 100 ? tx.transactionHash : null,
      fiatAmount: tx.fiatAmount,
      fiatCurrency: tx.fiatCurrency,
      detail: ledgerDetail(tx),
      externalRef: tx.transactionId,
    };

    if (tx.direction === 'sell' && tx.transactionHash) {
      const sent = await ledger.findOneBy({ userId: tx.userId, kind: In(['sent', 'cashed_out']), signature: tx.transactionHash, ref: Like('send:%') });
      if (sent && sent.id !== tx.ledgerEntryId) {
        // Drop the row we made before the send was matched, so the money shows once.
        if (tx.ledgerEntryId) await ledger.delete({ id: tx.ledgerEntryId, ref: `onramper:${tx.transactionId}` });
        tx.ledgerEntryId = sent.id;
      }
    }

    if (tx.ledgerEntryId) {
      const row = await ledger.findOneBy({ id: tx.ledgerEntryId });
      if (row) {
        // A row that came from our own send keeps its on-chain amount and signature.
        const { amount, signature, ...rest } = fields;
        await ledger.update({ id: row.id }, row.ref.startsWith('send:') ? rest : { ...rest, amount, signature });
        return row.id;
      }
    }
    const ref = `onramper:${tx.transactionId}`;
    await ledger
      .createQueryBuilder()
      .insert()
      .values({ userId: tx.userId, challengeId: null, ref, ...fields })
      .orIgnore()
      .execute();
    const row = await ledger.findOneByOrFail({ ref });
    if (row.userId !== tx.userId) throw new Error(`Ledger ref ${ref} belongs to someone else`);
    await ledger.update({ id: row.id }, fields);
    return row.id;
  }

  private async finish(id: string, r: Processed) {
    await this.events.update({ id, processedAt: IsNull() }, { processedAt: new Date(), outcome: r.outcome, note: r.note?.slice(0, 300) ?? null, lastError: null });
    if (r.outcome === 'parked' || r.outcome === 'invalid') this.log.warn(`Onramper event ${id} ${r.outcome}: ${r.note}`);
    return r;
  }

  // ---------- notifications ----------

  /**
   * Tells the person about the transaction's current state, at most once per state (the dedupe key
   * makes a retry harmless). If sending fails, `notified_state` stays behind and the retry job tries again.
   */
  async deliver(transactionId: string) {
    const tx = await this.transactions.findOneBy({ transactionId });
    if (!tx?.userId || tx.notifiedState === tx.state) return;
    try {
      const n = notificationFor(tx);
      if (n) await this.notifications.notify(tx.userId, n);
      await this.transactions.update({ id: tx.id, state: tx.state }, { notifiedState: tx.state });
    } catch (e) {
      this.log.warn(`Notification for Onramper transaction ${transactionId} failed, will retry: ${errMsg(e)}`);
    }
  }

  // ---------- background ----------

  /** Retries events that failed to process and notifications that failed to send. */
  @Cron(CronExpression.EVERY_MINUTE)
  async retry() {
    if (!(this.enabled || this.localramp?.webhookToken) || this.running) return;
    this.running = true;
    try {
      const due = await this.events
        .createQueryBuilder('e')
        .select('e.id')
        .where('e.processed_at IS NULL AND e.attempts < :max AND (e.next_attempt_at IS NULL OR e.next_attempt_at <= now())', { max: MAX_ATTEMPTS })
        .orderBy('e.created_at', 'ASC')
        .limit(50)
        .getMany();
      for (const ev of due) await this.processSafely(ev.id);

      const owed = await this.transactions
        .createQueryBuilder('t')
        .select('t.transactionId')
        .where('t.user_id IS NOT NULL AND t.notified_state IS DISTINCT FROM t.state AND t.updated_at > :since', { since: new Date(Date.now() - 7 * 24 * HOUR) })
        .limit(50)
        .getMany();
      for (const t of owed) await this.deliver(t.transactionId);
    } catch (e) {
      this.log.warn(`Onramper retry run failed: ${errMsg(e)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Asks Onramper about transactions stuck before a final state, in case a webhook never arrived.
   * Off (ONRAMPER_RECONCILE_ENABLED) until the API's authentication and response have been tested.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcile() {
    if (!this.enabled || !this.reconcileEnabled) return;
    const stuck = await this.transactions.find({
      where: { state: In(['new', 'pending', 'paid']), updatedAt: LessThan(new Date(Date.now() - HOUR / 2)), createdAt: MoreThan(new Date(Date.now() - 14 * 24 * HOUR)) },
      order: { updatedAt: 'ASC' },
      take: 20,
    });
    for (const t of stuck) {
      try {
        const data = await this.onramp.fetchTransaction(t.transactionId);
        const id = await this.store(Buffer.from(JSON.stringify(data)), 'poll');
        if (id) await this.processSafely(id);
      } catch (e) {
        this.log.warn(`Reconciling Onramper transaction ${t.transactionId} failed: ${errMsg(e)}`);
      }
    }
  }
}
