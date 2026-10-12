# Solana escrow: backend integration guide

How the Stake-Sync escrow program works and what the NestJS backend has to do to drive it.
The contract source lives in `StakeSync-SmartContract` (Rust, Anchor 1.2.1).

## At a glance

| What | Value |
| --- | --- |
| Program ID | `ANKCFRDYu45J199F1teNEeCiRUC7xYRArMtiHRYkvAcV` |
| IDL | `src/modules/payments/solana/stake-sync.idl.json` (copy of `StakeSync-SmartContract/idl/stake_sync.json`) |
| Constants (seeds, mints, limits, error codes) | `src/modules/payments/solana/stake-sync.constants.ts` |
| Cluster | `mainnet-beta` by default; test everything on `devnet` first |
| USDC mint, mainnet | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| USDC mint, devnet | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (free from faucet.circle.com) |
| Token program | classic SPL Token `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Amounts | `u64` in USDC base units, 6 decimals: 20 USDC = `20_000_000`. Store as `bigint`/`numeric`, never floats |
| Program keypair | `StakeSync-SmartContract/target/deploy/stake_sync-keypair.json` on your machine only. **Back it up.** If it's lost before the first deploy, the program ID changes |

Client packages (Anchor 1.x renamed the TS client from `@coral-xyz/anchor`; the API is the same):

```bash
npm i @anchor-lang/core@1.2.1 @solana/web3.js@^1.99 @solana/spl-token@^0.4
```

`@anchor-lang/core` is built on `@solana/web3.js` v1, so use v1 types (`PublicKey`, `Connection`) alongside it rather than `@solana/kit`.

Env vars (already in `.env.example`, read through `src/config/configuration.ts` as `solana.*`):

| Var | Purpose |
| --- | --- |
| `SOLANA_CLUSTER` | `mainnet-beta` or `devnet` |
| `SOLANA_RPC_URL` / `SOLANA_WS_URL` | Use a paid RPC (Helius, Triton, QuickNode) in production. The public endpoint rate-limits hard |
| `STAKE_SYNC_PROGRAM_ID` | the program ID above |
| `USDC_MINT` | the mint for the cluster |
| `TREASURY_WALLET` | wallet that receives fees; must match `Config.treasury` on-chain |
| `VERIFIER_SECRET_KEY` | verifier key (base58 or JSON bytes). Production should sign through a KMS/HSM |
| `PLATFORM_SECRET_KEY` | creates challenge escrows, pays network fees and rent top-ups for users, cranks settlement. Keep some SOL in it |

---

## 1. How it works

Each challenge gets its own on-chain **vault** (a USDC token account). The vault's owner is the
challenge's PDA, not a person. Only the program can move money out of it, and only through rule-checked
instructions. Nobody holds the vault key: not the admin, not the backend, not the creator.

```
            stake (join)                     claim: stake − penalty + reward
 Participant ─────────────┐             ┌──────────────────────────────▶ Finisher
                          ▼             │
 Sponsor ──────────▶  Challenge vault ──┤  refund_cancelled (cancelled)  ▶ Participant
     sponsor()        (PDA-owned USDC)  │  reclaim_sponsorship           ▶ Sponsor
                                        └─ finalize: fee + undistributed ▶ Treasury
```

The backend has three roles on-chain:

1. **Verifier.** It holds the verifier key and is the only party that can write period results
   (`record_period`) and apply moderator decisions on disputes (`resolve_dispute`).
2. **Crank.** After a challenge ends it calls the permissionless `settle_participant` for each
   participant, then `finalize`.
3. **Indexer.** It mirrors on-chain state into Postgres so the apps can read it quickly.

The backend **cannot** take or redirect anyone's funds, and the admin multisig can't either. That
guarantee is the product, so don't design flows that assume the backend can move escrowed money.

### Signers

| Instruction | Signer | Pays rent | Notes |
| --- | --- | --- | --- |
| `initialize_config` | program upgrade authority | it | once, right after deploy |
| `update_config` | `Config.admin` (multisig) | n/a | pause, rotate verifier/treasury, fee for **future** challenges, admin handover |
| `create_challenge` | creator | creator, about 0.0035 SOL (challenge + vault) | |
| `sponsor` | sponsor | sponsor, about 0.0011 SOL the first time | |
| `cancel_challenge` | creator **or** admin | n/a | only before `start_ts` |
| `join` | participant | participant, about 0.0016 SOL | |
| `use_freeze` | participant | n/a | |
| `open_dispute` | participant | n/a | |
| `record_period` | verifier | n/a | backend |
| `resolve_dispute` | verifier | n/a | backend, after a moderator decides |
| `settle_participant` | anyone | n/a | backend crank |
| `finalize` | anyone | n/a | backend crank |
| `claim` | participant | n/a | user must sign |
| `refund_cancelled` | participant | n/a | user must sign |
| `reclaim_sponsorship` | sponsor | n/a | sponsor must sign |

Rent figures are today's rent-exempt minimums for each account size. Every transaction also costs
5,000 lamports per signature plus any priority fee. **Any signer can be the fee payer**, so the
platform can pay network fees for users by co-signing as `feePayer`. Rent, though, comes from the
account named `payer` in the instruction (see [Decisions for you](#10-decisions-for-you)).

---

## 2. Accounts and PDAs

| Account | Seeds | Contents |
| --- | --- | --- |
| `Config` | `["config"]` | admin, verifier, treasury, usdc_mint, fees (forfeit, join, reward), paused |
| `Challenge` | `["challenge", creator, id as u64 LE]` | locked rules, counters, settlement results |
| vault | `["vault", challenge]` | USDC token account, authority = challenge PDA |
| `Participant` | `["participant", challenge, user]` | stake, five 128-bit period bitmaps, counts, settlement flags |
| `Sponsorship` | `["sponsor", challenge, sponsor]` | amount, reclaimed |

```ts
// src/modules/payments/solana/pda.ts
import { PublicKey } from '@solana/web3.js';
import { SEEDS, STAKE_SYNC_PROGRAM_ID } from './stake-sync.constants.js';

const PROGRAM = new PublicKey(STAKE_SYNC_PROGRAM_ID);
const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM)[0];
const u64le = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};

export const configPda = () => pda(Buffer.from(SEEDS.config));
export const challengePda = (creator: PublicKey, id: bigint) =>
  pda(Buffer.from(SEEDS.challenge), creator.toBuffer(), u64le(id));
export const vaultPda = (challenge: PublicKey) => pda(Buffer.from(SEEDS.vault), challenge.toBuffer());
export const participantPda = (challenge: PublicKey, user: PublicKey) =>
  pda(Buffer.from(SEEDS.participant), challenge.toBuffer(), user.toBuffer());
export const sponsorshipPda = (challenge: PublicKey, sponsor: PublicKey) =>
  pda(Buffer.from(SEEDS.sponsor), challenge.toBuffer(), sponsor.toBuffer());
```

All of these are deterministic, so store them in the DB when a challenge is created. You never need to
look them up on-chain.

### Periods

A challenge runs `period_count` periods (max 128) of `period_secs` each, starting at `start_ts`.

- Period `p` covers `[start_ts + p·period_secs, start_ts + (p+1)·period_secs)`.
- The current period index is `floor((now − start_ts) / period_secs)`.
- `end_ts = start_ts + period_secs · period_count`.
- **Settlement opens at** `settle_after = end_ts + dispute_window_secs`.

Bitmaps (`verified`, `missed`, `excused`, `frozen`, `disputed`) are 16 bytes each: bit `p % 8` of byte
`p / 8`.

```ts
const bit = (map: number[] | Uint8Array, p: number) => (map[p >> 3] & (1 << (p & 7))) !== 0;
```

---

## 3. Lifecycle, step by step

### 3.1 One-time setup (after deploy)

1. Deploy (see [section 9](#9-deploying)).
2. The upgrade authority calls `initialize_config(verifier, treasury, fees)` with the USDC mint
   account. Only the upgrade authority can do this, so nobody can front-run it.
3. Create the treasury's USDC associated token account (ATA). `finalize` pays into it.
4. Hand admin and upgrade authority to a Squads multisig.

### 3.2 Create a challenge

1. The backend stores the **rules document** as immutable bytes (see [section 4](#4-rules-hash)) and
   computes `rules_hash = sha256(bytes)`.
2. Pick `id`: a `u64` unique per creator. Use a DB sequence.
3. Build `ChallengeArgs` from the create form:

| Field | Meaning | Example |
| --- | --- | --- |
| `rules_hash` | `[u8; 32]` sha256 of the rules doc | |
| `stake_min`, `stake_max` | base units; equal = fixed stake; both 0 = no stake | `20_000_000`, `20_000_000` |
| `start_ts` | unix seconds, must be in the future | |
| `period_secs` | 60 to 2,592,000 | `86_400` daily, `604_800` weekly |
| `period_count` | 1 to 128 | `30` |
| `required_periods` | how many must not be missed | `27`, so 3 misses allowed |
| `join_deadline` | after now, before end | usually `start_ts` |
| `dispute_window_secs` | 3,600 to 604,800 | `172_800` (48 h) |
| `free_strikes` | 0 to 10; misses that cost nothing | `1` |
| `penalty_bps` | `[u16; 3]`, each ≤ 5,000; last step repeats | `[500, 1000, 1500]` |
| `freeze_periods` | 0 to 14; length of the one emergency freeze | `2` |
| `max_participants` | 0 = unlimited | `0` |
| `forfeits_to_finishers` | forfeited stakes go to finishers (after fee) instead of the treasury | `true` |

4. Send `create_challenge(id, args)`. This creates the challenge and its vault. The fees are copied
   from Config at this moment and never changes for this challenge.
5. Save `challenge_pda`, `vault_pda` and the signature.

### 3.3 Sponsor (optional)

Anyone can call `sponsor(amount)` until `end_ts`. Repeat calls add to the same `Sponsorship`.

### 3.4 Join

The user accepts the rules in the app, and the app sends
`join(stake, accepted_rules_hash)`. On-chain it checks: not paused, status Open,
`now ≤ join_deadline`, not full, stake in range, and **hash equals the challenge's**. The stake moves
from the user's USDC ATA into the vault. One participant account per wallet per challenge is enforced
by the seeds; joining twice fails at account creation.

### 3.5 During the challenge: the verifier worker

This is the backend's main job. **After each period ends**, record one result for every participant:

| Outcome | When |
| --- | --- |
| `{ verified: {} }` | proof accepted |
| `{ missed: {} }` | no valid proof **and** the provider was working |
| `{ excused: {} }` | the provider or your own pipeline was down, so you can't tell |

Rules the program enforces:

- You can't record before `period_end(p)`. That fails with `PeriodNotOver` (6013).
- `Verified` and `Missed` are final. A second write fails with `AlreadyRecorded` (6014).
- `Excused` can later be upgraded to `Verified` if the data shows up, but it can **never** become
  `Missed`. That fails with `PeriodProtected` (6015).
- Frozen periods can't be marked `Missed` either (6015). Read `participant.frozen` before writing.

> **Important:** only a recorded `Missed` counts against a user. A period with no result counts as
> not missed. If the worker fails to write a miss, that user gets a free pass. Write every miss
> before `settle_after`, and preferably soon after the period ends so the user has time to dispute it.

Idempotency: treat `AlreadyRecorded` as success if the on-chain bit matches what you meant to write.
Keep a `period_results` row per (challenge, user, period) with status `pending → sent → confirmed`.

Batching: each `record_period` is a small instruction, so several fit in one transaction. Measure
against the 1,232-byte transaction limit; expect roughly 6–8 per transaction.

### 3.6 Freezes

`use_freeze(first_period)`: once per participant, covers `freeze_periods` consecutive periods
starting at a period that hasn't started yet, and can't cover an already-missed period. The
participant signs.

### 3.7 Disputes

1. The user contests a missed period. The app sends `open_dispute(period)`, signed by the user.
   Allowed until `settle_after`.
2. **Any open dispute blocks settlement for the whole challenge** (`DisputesOpen`, 6023). Resolve
   disputes quickly; put an SLA in the admin Disputes queue.
3. Evidence (images, notes) stays off-chain in your DB or storage. On-chain only the hold is recorded.
4. A moderator decides in the admin app. The backend then sends `resolve_dispute(period, upheld)` with
   the verifier key. `upheld = true` turns the miss into a verified period; `false` keeps the miss.
   Either way the hold is released.

### 3.8 Cancel (before start only)

`cancel_challenge()` by the creator or admin while `now < start_ts`. After that, each participant
calls `refund_cancelled()` for their full stake, and each sponsor calls `reclaim_sponsorship()`.

### 3.9 Settlement: the crank

A cron job, every few minutes:

```
for each challenge where status = Open and now ≥ settle_after and open_disputes = 0:
    for each participant where settled = false:
        settle_participant()        # batch several per tx
    finalize()                      # once settled_count == participant_count
    notify participants: "Your payout is ready to claim"
```

`settle_participant` computes completion and penalty from the recorded results. `finalize` fixes
`reward_per_finisher` and pays the fee, undistributed forfeits and rounding dust to the treasury ATA.
The treasury token account must be owned by `Config.treasury`.

### 3.10 Claim

`claim()` is signed by the finisher and pays `stake − penalty + reward_per_finisher` into their USDC
ATA. Add `createAssociatedTokenAccountIdempotentInstruction` before it in the same transaction in
case the ATA doesn't exist. Non-finishers have nothing to claim (`NothingToClaim`, 6028).

If **nobody** finished, sponsors can `reclaim_sponsorship()` and forfeits go to the treasury.

---

## 4. Rules hash

What the user agrees to must hash to exactly `challenge.rules_hash`.

- Store the rules document as **immutable bytes**, for example canonical JSON (sorted keys, no
  whitespace) or the rendered Markdown, in a `challenge_rules` row that is never updated.
- Serve those exact bytes to the join screen. The app (or backend) sends `sha256(bytes)` as
  `accepted_rules_hash`.
- Include everything the user is agreeing to: activity, proof method, schedule, stake, strikes,
  penalty ladder, freeze, dispute window, and fee.

```ts
import { createHash } from 'node:crypto';
const rulesHash = (doc: Buffer) => [...createHash('sha256').update(doc).digest()]; // number[32] for Anchor
```

---

## Fees

Fixed per challenge when it's created, enforced by the program, and listed in the rules people accept.

| Fee | Default | Cap | Charged on |
| --- | --- | --- | --- |
| Joining | 2% | 5% | On top of the stake: 20 USDC costs 20.40. Held in escrow; paid to the treasury at finalize; refunded in full if the challenge is cancelled |
| Platform share | 60% | 60% | Forfeited stakes and penalties. Finishers split the other 40% equally |

Sponsor prizes go entirely to finishers, and a finisher's own stake (less penalties) is never charged.
If nobody finishes, forfeits go to the treasury and sponsors take their money back.

## 5. Payout math

The program's math is in `programs/stake_sync/src/math.rs`. Port it to show previews ("you'd get
back X") and to audit settlements. It's pure integer math, so use `bigint`:

```ts
const BPS = 10_000n;

export function penalty(stake: bigint, missed: number, freeStrikes: number, ladder: [number, number, number]) {
  const penalized = Math.max(0, missed - freeStrikes);
  let bps = 0n;
  for (let i = 0; i < penalized; i++) {
    bps += BigInt(ladder[Math.min(i, 2)]);
    if (bps >= BPS) return stake;
  }
  return (stake * bps) / BPS;
}

export const completed = (missed: number, periodCount: number, required: number) =>
  missed <= Math.max(0, periodCount - required);

export const joinFee = (stake: bigint, joinFeeBps: number) => (stake * BigInt(joinFeeBps)) / BPS;

export function distribute(sponsorPool: bigint, forfeited: bigint, finishers: number, feeBps: number, toFinishers: boolean) {
  const fee = (forfeited * BigInt(feeBps)) / BPS; // platform share, 60% by default
  const net = forfeited - fee;
  if (finishers === 0) return { rewardPerFinisher: 0n, treasury: forfeited, sponsorsReclaim: true };
  const pool = sponsorPool + (toFinishers ? net : 0n);
  const reward = pool / BigInt(finishers);
  const dust = pool - reward * BigInt(finishers);
  return { rewardPerFinisher: reward, treasury: fee + (toFinishers ? 0n : net) + dust, sponsorsReclaim: false };
}
```

- Finisher: `missed ≤ period_count − required_periods`. Payout = `stake − penalty + reward_per_finisher`.
- Non-finisher: forfeits the whole stake.
- A finisher's penalty also counts as forfeited, so it feeds the pool.
- The fee applies to forfeits only (max 10%), never to returned stakes or sponsor money.

Example from the test suite (`full_lifecycle`): 10 daily periods, 7 required, 1 free strike, ladder
`[500, 1000, …]`, 5% fee, 900 USDC sponsored, three people stake 20 USDC each.

- Alice misses nothing: finisher, no penalty.
- Bob misses 3 but wins a dispute on one. With 2 misses (1 free, then 5%) he's a finisher with a 1 USDC penalty.
- Carol misses 4 of 10: fails and forfeits 20 USDC.
- Forfeited = 21, fee = 1.05, reward each = (900 + 21 − 1.05) / 2 = 459.975.
- Alice claims 479.975, Bob claims 478.975, the treasury gets 1.05, and the vault ends at exactly 0.

---

## 6. Calling the program from NestJS

```ts
// src/modules/payments/solana/stake-sync.client.ts
import { AnchorProvider, Program, BN, EventParser, BorshCoder } from '@anchor-lang/core';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { TOKEN_PROGRAM_ID, USDC_MINT } from './stake-sync.constants.js';
import { configPda, participantPda, vaultPda } from './pda.js';
import idl from './stake-sync.idl.json' with { type: 'json' }; // needs "resolveJsonModule": true in tsconfig

const TOKEN_PROGRAM = new PublicKey(TOKEN_PROGRAM_ID);
const usdcMint = new PublicKey(USDC_MINT['mainnet-beta']); // or from config

// Minimal wallet. In production replace sign* with a KMS/HSM signer for the verifier.
function walletFor(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => {
      if (tx instanceof VersionedTransaction) tx.sign([kp]);
      else tx.partialSign(kp);
      return tx;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => {
      for (const tx of txs) {
        if (tx instanceof VersionedTransaction) tx.sign([kp]);
        else tx.partialSign(kp);
      }
      return txs;
    },
  };
}

const connection = new Connection(process.env.SOLANA_RPC_URL!, { commitment: 'confirmed', wsEndpoint: process.env.SOLANA_WS_URL });
const verifier = Keypair.fromSecretKey(/* load from KMS or VERIFIER_SECRET_KEY */ new Uint8Array());
const provider = new AnchorProvider(connection, walletFor(verifier), { commitment: 'confirmed' });
export const program = new Program(idl as any, provider); // generate types with anchor's TS type output if you want full typing
```

The provider's wallet signs `.rpc()` calls. Use one `Program` per signer: one with the verifier wallet
for results and disputes, and one with the crank wallet for settlement. Then the verifier key never
pays for routine transactions, and a leaked crank key can't record results.

Anchor exposes instructions and account fields in camelCase (`record_period` becomes `recordPeriod`,
`user_token` becomes `userToken`). `accountsPartial` lets you pass every account explicitly, which is
the clearest option for a backend.

**Record a result (verifier):**

```ts
await program.methods
  .recordPeriod(period, { missed: {} })
  .accountsPartial({ verifier: verifier.publicKey, config: configPda(), challenge, participant })
  .rpc();
```

**Resolve a dispute (verifier):**

```ts
await program.methods.resolveDispute(period, upheld).accountsPartial({ verifier: verifier.publicKey, config: configPda(), challenge, participant }).rpc();
```

**Settlement crank (several per transaction):**

```ts
const ixs = await Promise.all(
  unsettled.map((participant) =>
    program.methods.settleParticipant().accountsPartial({ cranker: crank.publicKey, challenge, participant }).instruction(),
  ),
);
// send in chunks; then:
await program.methods
  .finalize()
  .accountsPartial({
    cranker: crank.publicKey,
    config: configPda(),
    challenge,
    mint: usdcMint,
    vault: vaultPda(challenge),
    treasuryToken: getAssociatedTokenAddressSync(usdcMint, treasury),
    tokenProgram: TOKEN_PROGRAM,
  })
  .rpc();
```

**Build a user-signed transaction (join) for the frontend:**

```ts
const ix = await program.methods
  .join(new BN(stake.toString()), rulesHash)
  .accountsPartial({
    user,
    config: configPda(),
    challenge,
    participant: participantPda(challenge, user),
    mint: usdcMint,
    userToken: getAssociatedTokenAddressSync(usdcMint, user),
    vault: vaultPda(challenge),
    tokenProgram: TOKEN_PROGRAM,
    systemProgram: SystemProgram.programId,
  })
  .instruction();
// Put ix in a Transaction, set feePayer (user, or the platform if you co-sign), set recentBlockhash,
// serialize with requireAllSignatures:false and return base64 to the app. The wallet signs and sends it.
```

The frontend can also build these itself from the same IDL. Either way, the backend should
**confirm** the result from chain data (section 7) rather than trusting the app's word.

**Read accounts:**

```ts
const c = await program.account.challenge.fetch(challenge);
const p = await program.account.participant.fetch(participant);
const all = await program.account.participant.all([{ memcmp: { offset: 8, bytes: challenge.toBase58() } }]); // all participants of a challenge
```

(`Participant.challenge` is the first field, so it sits right after the 8-byte discriminator.)

---

## 7. Indexing events

The program emits 10 events: `ChallengeCreated`, `Sponsored`, `Joined`, `PeriodRecorded`,
`FreezeUsed`, `DisputeOpened`, `DisputeResolved`, `ParticipantSettled`, `ChallengeFinalized` and
`Claimed`. They're written to transaction logs.

```ts
const parser = new EventParser(program.programId, new BorshCoder(program.idl));

connection.onLogs(program.programId, ({ signature, logs, err }) => {
  if (err) return;
  for (const ev of parser.parseLogs(logs)) {
    // ev.name, ev.data → upsert keyed by (signature, index); idempotent
  }
}, 'confirmed');
```

- WebSocket subscriptions drop. Also run a **backfill** with `getSignaturesForAddress(programId, { until: lastSeenSig })`
  and `getTransaction` on startup and every few minutes.
- Use `confirmed` for UI updates and `finalized` before treating money movements as final in your
  ledger (notifications such as "Money claimed").
- **Accounts are the source of truth.** Events are history. A reconcile job should periodically fetch
  `Challenge` and `Participant` accounts and fix any drift.
- Feed each event into the notifications module, for example `Joined` becomes "You're in",
  `PeriodRecorded/missed` becomes "Day 4 marked missed. Dispute?", `ChallengeFinalized` becomes "Payout ready".

---

## 8. Mapping to Postgres

Suggested columns. Adjust them to your entities.

| Table | On-chain fields to add |
| --- | --- |
| `challenges` | `onchain_creator` (base58), `onchain_id` (bigint), `challenge_pda`, `vault_pda`, `rules_hash` (bytea), `fee_bps`, `chain_status` (`open/settled/cancelled`), `settle_after` (timestamptz), `create_sig` |
| `challenge_rules` | `challenge_id`, `doc` (bytea, immutable), `sha256` |
| `participants` | `wallet`, `participant_pda`, `stake_units` (numeric(20,0)), `join_sig`, `settled`, `completed`, `penalty_units`, `claimed`, `claim_sig` |
| `period_results` | `challenge_id`, `user_id`, `period` (int), `outcome`, `status` (`pending/sent/confirmed/failed`), `sig`, `recorded_at`. Unique (challenge, user, period) |
| `disputes` | `challenge_id`, `user_id`, `period`, evidence refs, `open_sig`, `decision`, `resolve_sig` |
| `sponsorships` | `challenge_id`, `sponsor_wallet`, `amount_units`, `reclaimed` |
| `chain_events` | `signature`, `idx`, `slot`, `name`, `data` (jsonb). Unique (signature, idx) |

---

## 9. Deploying

Do it all on **devnet first** (`solana config set --url devnet`, devnet USDC mint, `SOLANA_CLUSTER=devnet`).

```bash
cd StakeSync-SmartContract
./scripts/test.sh                       # must pass
./scripts/build.sh                      # target/deploy/stake_sync.so (~478 KB)
solana program deploy target/deploy/stake_sync.so \
  --program-id target/deploy/stake_sync-keypair.json
```

- The deployer wallet becomes the upgrade authority. Program storage costs about **2.43 SOL** in rent,
  and the deploy buffer needs the same again temporarily (refunded). Have about 5 SOL.
- Then run `initialize_config` from that wallet, using a one-off script with the provider wallet set to
  the upgrade authority:

```ts
await program.methods
  // Platform keeps 60% of forfeits (finishers split 40%); 2% joining fee on top of each stake
  .initializeConfig(verifierPubkey, treasuryPubkey, { forfeitBps: 6000, joinBps: 200 })
  .accountsPartial({
    admin: upgradeAuthority.publicKey,
    config: configPda(),
    usdcMint,
    program: program.programId,
    programData: PublicKey.findProgramAddressSync([program.programId.toBuffer()], new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0],
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

- Create the treasury's USDC ATA.
- Fund the verifier and crank keys with a little SOL (about 0.1 SOL covers thousands of transactions).
- Move control to a multisig:
  `solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <SQUADS_VAULT> --skip-new-upgrade-authority-signer-check`,
  then `update_config({ admin: SQUADS_VAULT })`.
- After any contract change: rebuild, run `./scripts/idl.sh`, and copy the new `idl/stake_sync.json`
  over `src/modules/payments/solana/stake-sync.idl.json`.
- **Get an independent audit before mainnet holds real value** (PRD §30).

### Admin app → on-chain

| Admin action | Instruction | Signer |
| --- | --- | --- |
| Pause new challenges/joins | `update_config({ paused: true })` | multisig |
| Rotate verifier key | `update_config({ verifier })` | multisig |
| Change fee | `update_config({ feeBps })`, future challenges only | multisig |
| Cancel a challenge before start | `cancel_challenge()` | multisig (admin) |
| Decide a dispute | `resolve_dispute(period, upheld)` | backend verifier, after the four-eyes approval in the admin app |
| Escrow page | read-only account fetches | n/a |

`update_config` takes every field as optional: pass `null` for fields you're not changing.
Pausing doesn't stop running challenges, claims or refunds.

---

## 10. What the backend already does

The code in `src/modules/payments` implements all of the above. These are the choices it makes:

1. **The platform key creates every escrow** (`ChainWorkerService.createPending`). People don't
   need SOL to create a challenge. The person or organization that set it up is the creator in our
   database; they cancel through the API and the platform key signs. Challenge ids are unique u64s
   stored as `challenges.chain_id`.
2. **Everyone signs with their own wallet; Stake-Sync never holds money or keys.** People who
   don't use crypto get an **embedded wallet** when they sign in (from a provider such as Privy,
   Dynamic or Web3Auth, set up in the frontend). They link it like any wallet, by signing a message
   (`POST /auth/wallet/link` with `kind: "embedded"`). Every money action returns a transaction
   with the platform as fee payer (`buildForWallet`). The app has the wallet sign it, then calls the
   matching `/confirm` endpoint, and the indexer confirms it as well.
3. **Rent top-ups.** Joining or sponsoring creates a small account whose rent the wallet pays.
   Wallets with no SOL get about 0.003 SOL from the platform first (`RentService`), at most
   `RENT_DRIPS_PER_DAY` times a day per wallet.
4. **Local currency** goes through Onramper (`POST /payments/onramp`). It returns a signed,
   single-use widget link where licensed on-ramps take cards, bank transfers or mobile money and
   send USDC straight to the person's wallet. `mode: "sell"` cashes out to their bank the same way.
   Onramper's webhooks record completed top-ups in money history; see [onramper.md](onramper.md).
   Claims are one signature, and people are notified when money is ready.
5. **Account rent is never returned**, because accounts aren't closed after claiming. That can be added in
   a later program version.

## 11. Verification methods → outcomes

How each proof method feeds `record_period`. The verification module's adapters
(`src/modules/verification/adapters/`) should each return `verified | missed | unavailable`, and
`unavailable` maps to `excused`.

| Method | Works on | How | Outage handling |
| --- | --- | --- | --- |
| Photo proof | web + mobile | upload → automated check (EXIF time, dedupe hash, optional AI review) → human review queue for doubtful ones | review backlog past period end: hold, don't write `missed` until reviewed |
| Camera reps (push-ups, sit-ups) | web + mobile | MediaPipe pose runs on the device and counts reps; upload the count plus a compact keypoint trace and a few frames | client counts can be faked: re-score traces server-side and spot-check samples |
| Steps / distance | **native app only** | Apple HealthKit (iOS) or Health Connect (Android) is read on-device by a native app (React Native/Expo) and uploaded. There's no server-side Apple Health API, and the Google Fit REST APIs are deprecated | phone hasn't synced: send a reminder; still nothing at period end with a recent sync → `missed`; no sync for days → `excused` + support |
| GPS walk/run | web (foreground only) or native | browser geolocation stops when the tab is backgrounded; use the native app for real tracking | GPS denied or lost → `excused` only if it's the provider's fault, not the user's |
| Third-party apps (Strava, GitHub, etc.) | backend | OAuth + API polling or webhooks | API down or rate-limited → `excused`, retry, upgrade to `verified` when data arrives |

Rule of thumb: **only write `missed` when you're sure the user didn't do it.** When the fault is
yours or the provider's, write `excused`.

## 12. Errors

Codes are in `STAKE_SYNC_ERRORS`. Anchor surfaces them as `err.error.errorCode.number` (or parse
`custom program error: 0x1770`–`0x1792` from simulation logs). Never show raw errors to users. Map them:

| Code | Name | Tell the user |
| --- | --- | --- |
| 6000 | Paused | "New challenges are paused for maintenance. Try again later." |
| 6007 | JoinClosed | "Joining has closed for this challenge." |
| 6008 | ChallengeFull | "This challenge is full." |
| 6009 | StakeOutOfRange | "Choose a stake between X and Y." |
| 6010 | RulesMismatch | "The rules changed. Review them again to join." (shouldn't happen; log it) |
| 6017 | FreezeInvalid | "Freezes have to start on a future day." |
| 6019 | DisputeWindowClosed | "The window to dispute this has closed." |
| 6027 | AlreadyClaimed | "You've already claimed this payout." |
| others | | "Something went wrong on our side. Your money is safe in escrow." Log it and alert |

Insufficient USDC or SOL comes from the token or system program, not these codes. Check balances
before building the transaction and send the user to Add money.
