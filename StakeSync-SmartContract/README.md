# Stake-Sync escrow program (Solana)

The on-chain escrow behind Stake-Sync challenges: USDC stakes, sponsor pools, strikes, freezes,
disputes and deterministic settlement. Written in Rust with [Anchor](https://www.anchor-lang.com) 1.2.

Program ID: `ANKCFRDYu45J199F1teNEeCiRUC7xYRArMtiHRYkvAcV`

## Guarantees

These come from the PRD and are enforced by the program, not by convention:

- **No admin custody.** Each challenge's vault is a token account owned by the challenge PDA.
  No instruction lets the admin, verifier or creator withdraw from it. Funds leave only through
  `claim`, `refund_cancelled`, `reclaim_sponsorship` and the treasury share in `finalize`, each
  gated by the challenge rules. (PRD §17, §29)
- **Rules are accepted on-chain and locked.** `join` takes the sha256 of the rules document the
  person accepted and rejects any mismatch. Nothing can change a challenge's rules after creation. (PRD §7)
- **Technical failure is never user failure.** Only a period the verifier records as `Missed` counts
  against someone. An `Excused` (provider down) or frozen period can never become a miss, and
  unrecorded periods don't count either. (PRD §3, §10, §32)
- **Strikes before penalties.** The first `free_strikes` misses cost nothing; later misses add the
  next step of a capped penalty ladder. Missing more than the challenge allows forfeits the stake. (PRD §19)
- **Disputes hold the money.** Any open dispute blocks settlement for the whole challenge until the
  verifier submits the moderator's decision. (PRD §21)
- **Deterministic settlement.** Settlement is a permissionless crank, and all payout math lives in
  `math.rs` as pure functions. The test suite checks that every token deposited is paid out exactly once.
- **Transparent fees, fixed per challenge at creation.** (PRD §33)
  - **Joining:** a fee on top of the stake (2% by default, capped at 5%). It's held in escrow and
    reaches the treasury only at settlement, so a cancelled challenge refunds it in full.
  - **The pot:** of everything forfeited (stakes of people who didn't finish, and penalties), the
    platform keeps 60% (capped at 60%) and finishers split 40% equally. Sponsor prizes go entirely
    to finishers, and a finisher's own stake, minus any penalty, always comes back untouched.

## Accounts

| Account | Seeds | Holds |
| --- | --- | --- |
| `Config` | `["config"]` | admin, verifier key, treasury, USDC mint, fee, pause flag |
| `Challenge` | `["challenge", creator, id_le]` | locked rules, totals, settlement results |
| vault | `["vault", challenge]` | USDC token account owned by the challenge PDA |
| `Participant` | `["participant", challenge, user]` | stake and per-period bitmaps: verified, missed, excused, frozen, disputed |
| `Sponsorship` | `["sponsor", challenge, sponsor]` | each sponsor's contribution |

Periods are days, weeks or checkpoints (`period_secs`), up to 128 per challenge.

## Instructions

| Instruction | Who | What |
| --- | --- | --- |
| `initialize_config` | program upgrade authority | one-time setup with the verifier, treasury and fees (join fee, platform share of forfeits); can't be front-run |
| `update_config` | admin | verifier, treasury, fees (future challenges only), pause, admin handover |
| `create_challenge` | anyone | creates the challenge and its vault with validated rules |
| `sponsor` | anyone | adds USDC to the reward pool until the challenge ends |
| `cancel_challenge` | creator or admin | before start only; unlocks full refunds |
| `join` | participant | deposits the stake plus the joining fee, with the accepted rules hash |
| `use_freeze` | participant | once, future periods only, never over a missed period |
| `open_dispute` | participant | contests a missed period; holds settlement |
| `record_period` | verifier | `Verified`, `Missed` or `Excused` for a period that has ended |
| `resolve_dispute` | verifier | applies the moderator's decision |
| `settle_participant` | anyone | after the end plus the dispute window, with no open disputes |
| `finalize` | anyone | after everyone settles; fixes rewards, pays the treasury share |
| `claim` | finisher | stake minus penalty, plus reward share |
| `refund_cancelled` | participant | full stake and joining fee back from a cancelled challenge |
| `reclaim_sponsorship` | sponsor | if cancelled, or nobody finished |

### Payout rules

- Completed when `missed ≤ period_count − required_periods`.
- Joining costs `stake + stake × join_fee`.
- Finisher receives `stake − penalty + reward_per_finisher`.
- Non-finishers forfeit their stake.
- `platform_share = forfeits × 60%`; `pool = sponsor_pool + (forfeits − platform_share if forfeits_to_finishers)`;
  `reward_per_finisher = pool / finishers`. Joining fees, the platform share and rounding dust go to
  the treasury at finalize.
- If nobody finishes, sponsors reclaim their contributions and forfeits go to the treasury.

## Build and test

Needs Rust and the Solana CLI (Agave 4.x with `cargo build-sbf`). The Anchor CLI is optional.

```bash
./scripts/build.sh   # builds target/deploy/stake_sync.so
./scripts/test.sh    # build, then math unit tests and LiteSVM integration tests
./scripts/idl.sh     # regenerate idl/stake_sync.json for clients
```

The IDL in `idl/stake_sync.json` is what the backend and frontends use to build instructions and decode accounts and events.

`build.sh` calls the platform-tools compiler directly because `cargo build-sbf` can fail to parse
newer `rustup toolchain list` output.

## Deploying

1. Keep `target/deploy/stake_sync-keypair.json` safe and out of git (it's ignored). If you use a new
   keypair, update `declare_id!` in `lib.rs` and `Anchor.toml`.
2. Deploy with `solana program deploy target/deploy/stake_sync.so --program-id target/deploy/stake_sync-keypair.json`.
3. Call `initialize_config` from the upgrade authority with the verifier key, treasury wallet and fee.
4. Use a multisig (e.g. Squads) as the upgrade authority and admin, and keep the verifier key in an HSM or KMS.
5. Get an independent audit before holding significant value on mainnet (PRD §30).

Mainnet USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.
