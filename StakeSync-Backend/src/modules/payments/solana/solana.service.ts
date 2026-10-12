import { AnchorProvider, BN, Program, Wallet, type AccountClient, type Idl } from '@anchor-lang/core';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { readFileSync } from 'node:fs';
import { unavailable } from '../../../common/errors.js';
import { Pdas } from './pda.js';
import { STAKE_SYNC_ERRORS, TOKEN_PROGRAM_ID, USDC_DECIMALS } from './stake-sync.constants.js';

const idl = JSON.parse(readFileSync(new URL('./stake-sync.idl.json', import.meta.url), 'utf8')) as Idl;

export type Outcome = 'verified' | 'missed' | 'excused';

export interface ChallengeArgs {
  rulesHash: Buffer;
  stakeMin: bigint;
  stakeMax: bigint;
  startTs: number;
  periodSecs: number;
  periodCount: number;
  requiredPeriods: number;
  joinDeadline: number;
  disputeWindowSecs: number;
  freeStrikes: number;
  penaltyBps: [number, number, number];
  freezePeriods: number;
  maxParticipants: number;
  forfeitsToFinishers: boolean;
}

/** Decoded on-chain accounts, in the program's own field names. */
export interface ChainChallenge {
  status: { open?: object; settled?: object; cancelled?: object };
  participantCount: number;
  totalStaked: BN;
  sponsorPool: BN;
  openDisputes: number;
  settledCount: number;
  finisherCount: number;
  forfeitedTotal: BN;
  rewardPerFinisher: BN;
  treasuryAmount: BN;
  feeBps: number;
  joinFeeBps: number;
  joinFees: BN;
}

export interface ChainConfig {
  admin: PublicKey;
  verifier: PublicKey;
  treasury: PublicKey;
  usdcMint: PublicKey;
  feeBps: number;
  joinFeeBps: number;
  paused: boolean;
}

export interface ChainParticipant {
  user: PublicKey;
  stake: BN;
  joinFee: BN;
  verified: number[];
  missed: number[];
  excused: number[];
  frozen: number[];
  disputed: number[];
  verifiedCount: number;
  missedCount: number;
  openDisputes: number;
  freezeUsed: boolean;
  settled: boolean;
  completed: boolean;
  penalty: BN;
  claimed: boolean;
}

export const bitSet = (map: number[], i: number) => (map[i >> 3] & (1 << (i & 7))) !== 0;

function parseSecret(raw?: string) {
  if (!raw) return undefined;
  const bytes = raw.trim().startsWith('[') ? Uint8Array.from(JSON.parse(raw) as number[]) : bs58.decode(raw.trim());
  return Keypair.fromSecretKey(bytes);
}

/**
 * Everything that talks to the Stake-Sync program. Builds instructions from the IDL, signs with the
 * platform/verifier keys, and returns unsigned transactions for people's own wallets to sign.
 */
@Injectable()
export class SolanaService {
  private readonly log = new Logger('Solana');
  readonly connection: Connection;
  readonly devnet: Connection;
  readonly program: Program;
  readonly pdas: Pdas;
  readonly usdcMint: PublicKey;
  readonly tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);
  readonly treasury?: PublicKey;
  readonly verifier?: Keypair;
  readonly platform?: Keypair;
  readonly cluster: string;

  constructor(config: ConfigService) {
    this.cluster = config.get('solana.cluster') ?? 'mainnet-beta';
    this.connection = new Connection(config.get('solana.rpcUrl')!, { commitment: 'confirmed', wsEndpoint: config.get('solana.wsUrl') });
    this.devnet = new Connection(config.get('solana.devnetRpcUrl')!, 'confirmed');
    const programId = new PublicKey(config.get<string>('solana.programId')!);
    this.program = new Program({ ...idl, address: programId.toBase58() }, new AnchorProvider(this.connection, new Wallet(Keypair.generate()), {}));
    this.pdas = new Pdas(programId);
    this.usdcMint = new PublicKey(config.get<string>('solana.usdcMint')!);
    const treasury = config.get<string>('solana.treasury');
    this.treasury = treasury ? new PublicKey(treasury) : undefined;
    this.verifier = parseSecret(config.get('solana.verifierKey'));
    this.platform = parseSecret(config.get('solana.platformKey'));
    if (!this.platform) this.log.warn('PLATFORM_SECRET_KEY missing: on-chain challenge creation and fee sponsoring are disabled.');
    if (!this.verifier) this.log.warn('VERIFIER_SECRET_KEY missing: results cannot be recorded on-chain.');
  }

  /** Typed loosely: the IDL is loaded at runtime. */
  get accounts() {
    return this.program.account as unknown as Record<'challenge' | 'participant' | 'sponsorship' | 'config', AccountClient>;
  }

  get ready() {
    return Boolean(this.platform);
  }

  requirePlatform() {
    if (!this.platform) throw unavailable('Payments are being set up. Please try again later.');
    return this.platform;
  }

  ata(owner: PublicKey) {
    return getAssociatedTokenAddressSync(this.usdcMint, owner, true, this.tokenProgram);
  }

  // ---------- instruction builders ----------

  createChallengeIx(id: bigint, a: ChallengeArgs) {
    const creator = this.requirePlatform().publicKey;
    const challenge = this.pdas.challenge(creator, id);
    return this.program.methods
      .createChallenge(new BN(id.toString()), {
        rulesHash: [...a.rulesHash],
        stakeMin: new BN(a.stakeMin.toString()),
        stakeMax: new BN(a.stakeMax.toString()),
        startTs: new BN(a.startTs),
        periodSecs: a.periodSecs,
        periodCount: a.periodCount,
        requiredPeriods: a.requiredPeriods,
        joinDeadline: new BN(a.joinDeadline),
        disputeWindowSecs: a.disputeWindowSecs,
        freeStrikes: a.freeStrikes,
        penaltyBps: a.penaltyBps,
        freezePeriods: a.freezePeriods,
        maxParticipants: a.maxParticipants,
        forfeitsToFinishers: a.forfeitsToFinishers,
      })
      .accountsPartial({
        creator,
        config: this.pdas.config(),
        mint: this.usdcMint,
        challenge,
        vault: this.pdas.vault(challenge),
        tokenProgram: this.tokenProgram,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  joinIx(challenge: PublicKey, user: PublicKey, stake: bigint, rulesHash: Buffer) {
    return this.program.methods
      .join(new BN(stake.toString()), [...rulesHash])
      .accountsPartial({
        user,
        config: this.pdas.config(),
        challenge,
        participant: this.pdas.participant(challenge, user),
        mint: this.usdcMint,
        userToken: this.ata(user),
        vault: this.pdas.vault(challenge),
        tokenProgram: this.tokenProgram,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  sponsorIx(challenge: PublicKey, sponsor: PublicKey, amount: bigint) {
    return this.program.methods
      .sponsor(new BN(amount.toString()))
      .accountsPartial({
        sponsor,
        challenge,
        sponsorship: this.pdas.sponsorship(challenge, sponsor),
        mint: this.usdcMint,
        sponsorToken: this.ata(sponsor),
        vault: this.pdas.vault(challenge),
        tokenProgram: this.tokenProgram,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  cancelIx(challenge: PublicKey) {
    return this.program.methods
      .cancelChallenge()
      .accountsPartial({ authority: this.requirePlatform().publicKey, config: this.pdas.config(), challenge })
      .instruction();
  }

  useFreezeIx(challenge: PublicKey, user: PublicKey, firstPeriod: number) {
    return this.program.methods
      .useFreeze(firstPeriod)
      .accountsPartial({ user, challenge, participant: this.pdas.participant(challenge, user) })
      .instruction();
  }

  openDisputeIx(challenge: PublicKey, user: PublicKey, period: number) {
    return this.program.methods
      .openDispute(period)
      .accountsPartial({ user, challenge, participant: this.pdas.participant(challenge, user) })
      .instruction();
  }

  recordPeriodIx(challenge: PublicKey, user: PublicKey, period: number, outcome: Outcome) {
    return this.program.methods
      .recordPeriod(period, { [outcome]: {} })
      .accountsPartial({
        verifier: this.verifier!.publicKey,
        config: this.pdas.config(),
        challenge,
        participant: this.pdas.participant(challenge, user),
      })
      .instruction();
  }

  resolveDisputeIx(challenge: PublicKey, user: PublicKey, period: number, upheld: boolean) {
    return this.program.methods
      .resolveDispute(period, upheld)
      .accountsPartial({
        verifier: this.verifier!.publicKey,
        config: this.pdas.config(),
        challenge,
        participant: this.pdas.participant(challenge, user),
      })
      .instruction();
  }

  settleParticipantIx(challenge: PublicKey, user: PublicKey) {
    return this.program.methods
      .settleParticipant()
      .accountsPartial({ cranker: this.requirePlatform().publicKey, challenge, participant: this.pdas.participant(challenge, user) })
      .instruction();
  }

  async finalizeIxs(challenge: PublicKey) {
    if (!this.treasury) throw unavailable();
    const treasuryToken = this.ata(this.treasury);
    const payer = this.requirePlatform().publicKey;
    return [
      createAssociatedTokenAccountIdempotentInstruction(payer, treasuryToken, this.treasury, this.usdcMint, this.tokenProgram),
      await this.program.methods
        .finalize()
        .accountsPartial({
          cranker: payer,
          config: this.pdas.config(),
          challenge,
          mint: this.usdcMint,
          vault: this.pdas.vault(challenge),
          treasuryToken,
          tokenProgram: this.tokenProgram,
        })
        .instruction(),
    ];
  }

  /** claim | refund_cancelled, preceded by creating the person's USDC account if needed. */
  async withdrawIxs(kind: 'claim' | 'refund', challenge: PublicKey, user: PublicKey, feePayer: PublicKey) {
    const userToken = this.ata(user);
    const builder = kind === 'claim' ? this.program.methods.claim() : this.program.methods.refundCancelled();
    return [
      createAssociatedTokenAccountIdempotentInstruction(feePayer, userToken, user, this.usdcMint, this.tokenProgram),
      await builder
        .accountsPartial({
          user,
          challenge,
          participant: this.pdas.participant(challenge, user),
          mint: this.usdcMint,
          vault: this.pdas.vault(challenge),
          userToken,
          tokenProgram: this.tokenProgram,
        })
        .instruction(),
    ];
  }

  async reclaimSponsorshipIxs(challenge: PublicKey, sponsor: PublicKey, feePayer: PublicKey) {
    const sponsorToken = this.ata(sponsor);
    return [
      createAssociatedTokenAccountIdempotentInstruction(feePayer, sponsorToken, sponsor, this.usdcMint, this.tokenProgram),
      await this.program.methods
        .reclaimSponsorship()
        .accountsPartial({
          sponsor,
          challenge,
          sponsorship: this.pdas.sponsorship(challenge, sponsor),
          mint: this.usdcMint,
          vault: this.pdas.vault(challenge),
          sponsorToken,
          tokenProgram: this.tokenProgram,
        })
        .instruction(),
    ];
  }

  usdcTransferIxs(from: PublicKey, to: PublicKey, amount: bigint, feePayer: PublicKey) {
    const toAta = this.ata(to);
    return [
      createAssociatedTokenAccountIdempotentInstruction(feePayer, toAta, to, this.usdcMint, this.tokenProgram),
      createTransferCheckedInstruction(this.ata(from), this.usdcMint, toAta, from, amount, USDC_DECIMALS, [], this.tokenProgram),
    ];
  }

  // ---------- transactions ----------

  private withPriority(ixs: TransactionInstruction[]) {
    return [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }), ...ixs];
  }

  /**
   * A transaction for someone's own wallet to sign. The platform pays the network fee and signs
   * first; the wallet adds its signature and sends it.
   */
  async buildForWallet(ixs: TransactionInstruction[]) {
    const platform = this.requirePlatform();
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: platform.publicKey, blockhash, lastValidBlockHeight }).add(...this.withPriority(ixs));
    tx.partialSign(platform);
    return {
      transaction: tx.serialize({ requireAllSignatures: false }).toString('base64'),
      lastValidBlockHeight,
    };
  }

  /** Signs with our own keys and sends. The platform key pays fees. */
  async send(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const platform = this.requirePlatform();
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: platform.publicKey, blockhash, lastValidBlockHeight }).add(...this.withPriority(ixs));
    const unique = [platform, ...signers.filter((s) => !s.publicKey.equals(platform.publicKey))];
    tx.sign(...unique);
    const sig = await this.connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    const res = await this.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    if (res.value.err) throw new ChainError(sig, res.value.err);
    return sig;
  }

  /** Waits for a signature someone's wallet submitted, and checks it succeeded. */
  async confirmExternal(signature: string) {
    for (let i = 0; i < 30; i++) {
      const { value } = await this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const s = value[0];
      if (s?.err) throw new ChainError(signature, s.err);
      if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  // ---------- reads ----------

  /** True if `signature` moved at least `amount` USDC from `from`'s account to `to`'s, per the chain. */
  async verifyUsdcTransfer(signature: string, from: PublicKey, to: PublicKey, amount: bigint) {
    const tx = await this.connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx?.meta || tx.meta.err) return false;
    const mint = this.usdcMint.toBase58();
    const change = (owner: PublicKey) => {
      const pick = (list: typeof tx.meta.preTokenBalances) => BigInt(list?.find((b) => b.mint === mint && b.owner === owner.toBase58())?.uiTokenAmount.amount ?? '0');
      return pick(tx.meta!.postTokenBalances) - pick(tx.meta!.preTokenBalances);
    };
    return change(from) <= -amount && change(to) >= amount;
  }

  /**
   * USDC a finalized transaction credited to `owner` (net, across their USDC accounts), or null if it
   * didn't. Used to confirm a provider's top-up ourselves instead of taking the webhook's word for it.
   */
  async usdcCredit(signature: string, owner: PublicKey) {
    const tx = await this.connection.getParsedTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!tx?.meta || tx.meta.err) return null;
    const mint = this.usdcMint.toBase58();
    const who = owner.toBase58();
    const total = (list: typeof tx.meta.preTokenBalances) =>
      (list ?? []).filter((b) => b.mint === mint && b.owner === who).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    const credit = total(tx.meta.postTokenBalances) - total(tx.meta.preTokenBalances);
    return credit > 0n ? credit : null;
  }

  async fetchChallenge(pda: PublicKey) {
    return (await this.accounts.challenge.fetchNullable(pda)) as ChainChallenge | null;
  }

  /** The program's settings: who may change them, the verifier, the treasury, fees, paused. */
  async fetchConfig() {
    return (await this.accounts.config.fetchNullable(this.pdas.config())) as ChainConfig | null;
  }

  async fetchParticipant(challenge: PublicKey, user: PublicKey) {
    return (await this.accounts.participant.fetchNullable(this.pdas.participant(challenge, user))) as ChainParticipant | null;
  }

  async usdcBalance(owner: PublicKey) {
    // Read through the RPC's parsed balance rather than decoding account bytes locally
    // (spl-token's decoder depends on bigint-buffer, which has an unpatched advisory).
    const balance = await this.tokenAccountBalance(this.ata(owner));
    return balance ?? 0n;
  }

  /** Balance of a token account itself (e.g. a challenge vault). */
  async tokenAccountBalance(address: PublicKey) {
    try {
      const b = await this.connection.getTokenAccountBalance(address, 'confirmed');
      return BigInt(b.value.amount);
    } catch {
      return null;
    }
  }

  solBalance(owner: PublicKey) {
    return this.connection.getBalance(owner, 'confirmed');
  }

  async dripSol(to: PublicKey, lamports: number) {
    const platform = this.requirePlatform();
    return this.send([SystemProgram.transfer({ fromPubkey: platform.publicKey, toPubkey: to, lamports })]);
  }
}

/** A transaction that landed but failed. `code` is the program error code when there is one. */
export class ChainError extends Error {
  readonly code?: number;
  readonly name_?: string;

  constructor(
    readonly signature: string,
    readonly raw: unknown,
  ) {
    const custom = (raw as { InstructionError?: [number, { Custom?: number }] })?.InstructionError?.[1]?.Custom;
    super(`Transaction ${signature} failed: ${custom !== undefined ? (STAKE_SYNC_ERRORS[custom as keyof typeof STAKE_SYNC_ERRORS] ?? custom) : JSON.stringify(raw)}`);
    this.code = custom;
    this.name_ = custom !== undefined ? STAKE_SYNC_ERRORS[custom as keyof typeof STAKE_SYNC_ERRORS] : undefined;
  }
}

/** Anchor/web3 errors thrown before landing (simulation) also carry the program code. */
export function programErrorCode(e: unknown): number | undefined {
  if (e instanceof ChainError) return e.code;
  const anyE = e as { error?: { errorCode?: { number?: number } }; logs?: string[]; message?: string };
  if (anyE?.error?.errorCode?.number) return anyE.error.errorCode.number;
  const m = /custom program error: 0x([0-9a-f]+)/i.exec(anyE?.message ?? (anyE?.logs ?? []).join('\n'));
  return m ? parseInt(m[1], 16) : undefined;
}
