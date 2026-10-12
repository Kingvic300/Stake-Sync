//! End-to-end tests against the compiled program (target/deploy/stake_sync.so) in LiteSVM.
//! Build first: ./scripts/build.sh

use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use litesvm_token::{spl_token, CreateAssociatedTokenAccount, CreateMint, MintTo};
use solana_address::Address;
use solana_clock::Clock;
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;
use stake_sync::errors::StakeSyncError as E;
use stake_sync::instructions::Fees;
use stake_sync::state::{ChallengeArgs, Outcome};

/// Asserts a transaction failed with this program's specific error, not some unrelated failure.
#[track_caller]
fn fails_with(r: Result<(), String>, e: E) {
    let want = format!("Custom({})", anchor_lang::error::ERROR_CODE_OFFSET + e as u32);
    let got = r.expect_err("expected the transaction to fail");
    assert!(got.contains(&want), "expected {want} ({e:?}), got {got}");
}

const USDC: u64 = 1_000_000; // 6 decimals
const DAY: u32 = 86_400;
const START: i64 = 1_800_000_000;
const RULES: [u8; 32] = [7u8; 32];
/// Platform fees: 2% on top of each stake; the platform keeps 60% of forfeits, finishers split 40%.
const JOIN_FEE: u16 = 200;
const FORFEIT_FEE: u16 = 6_000;

fn pid() -> Address {
    Address::new_from_array(stake_sync::ID.to_bytes())
}
fn a(p: &Address) -> anchor_lang::prelude::Pubkey {
    anchor_lang::prelude::Pubkey::new_from_array(p.to_bytes())
}
fn pda(seeds: &[&[u8]]) -> Address {
    Address::find_program_address(seeds, &pid()).0
}

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    verifier: Keypair,
    treasury: Keypair,
    mint: Address,
    config: Address,
    treasury_ata: Address,
}

impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let so = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/stake_sync.so");
        svm.add_program_from_file(pid(), so).expect("build the program first: ./scripts/build.sh");
        let admin = Keypair::new();
        let verifier = Keypair::new();
        let treasury = Keypair::new();
        for k in [&admin, &verifier, &treasury] {
            svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
        }
        // Make `admin` the program's upgrade authority (LiteSVM loads programs with none).
        let pdata = Address::find_program_address(&[pid().as_ref()], &solana_address::address!("BPFLoaderUpgradeab1e11111111111111111111111")).0;
        let mut acct = svm.get_account(&pdata).unwrap();
        acct.data[12] = 1;
        acct.data[13..45].copy_from_slice(admin.pubkey().as_ref());
        svm.set_account(pdata, acct).unwrap();

        let mint = CreateMint::new(&mut svm, &admin).decimals(6).send().unwrap();
        let config = pda(&[b"config"]);
        let treasury_ata = CreateAssociatedTokenAccount::new(&mut svm, &treasury, &mint).owner(&treasury.pubkey()).send().unwrap();
        let mut env = Env { svm, admin, verifier, treasury, mint, config, treasury_ata };
        env.set_time(START - 10 * DAY as i64);

        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: stake_sync::ID,
            accounts: stake_sync::accounts::InitializeConfig {
                admin: a(&env.admin.pubkey()),
                config: a(&config),
                usdc_mint: a(&mint),
                program: stake_sync::ID,
                program_data: a(&pdata),
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: stake_sync::instruction::InitializeConfig {
                verifier: a(&env.verifier.pubkey()),
                treasury: a(&env.treasury.pubkey()),
                fees: Fees { forfeit_bps: FORFEIT_FEE, join_bps: JOIN_FEE },
            }
            .data(),
        };
        let admin = env.admin.insecure_clone();
        env.send(ix, &[&admin]).unwrap();
        env
    }
    
    fn set_time(&mut self, t: i64) {
        let mut c: Clock = self.svm.get_sysvar();
        c.unix_timestamp = t;
        self.svm.set_sysvar(&c);
    }

    fn send(&mut self, ix: anchor_lang::solana_program::instruction::Instruction, signers: &[&Keypair]) -> Result<(), String> {
        self.svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(&[ix], Some(&signers[0].pubkey()), signers, self.svm.latest_blockhash());
        self.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e.err))
    }

    fn user(&mut self, usdc: u64) -> (Keypair, Address) {
        let k = Keypair::new();
        self.svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
        let ata = CreateAssociatedTokenAccount::new(&mut self.svm, &k, &self.mint).owner(&k.pubkey()).send().unwrap();
        if usdc > 0 {
            MintTo::new(&mut self.svm, &self.admin, &self.mint, &ata, usdc).send().unwrap();
        }
        (k, ata)
    }

    fn balance(&self, token: &Address) -> u64 {
        let d = self.svm.get_account(token).unwrap().data;
        u64::from_le_bytes(d[64..72].try_into().unwrap())
    }
}

fn args() -> ChallengeArgs {
    ChallengeArgs {
        rules_hash: RULES,
        stake_min: 20 * USDC,
        stake_max: 20 * USDC,
        start_ts: START,
        period_secs: DAY,
        period_count: 10,
        required_periods: 7,
        join_deadline: START,
        dispute_window_secs: 2 * DAY,
        free_strikes: 1,
        penalty_bps: [500, 1_000, 1_500],
        freeze_periods: 2,
        max_participants: 0,
        forfeits_to_finishers: true,
    }
}

struct Ch {
    creator: Keypair,
    challenge: Address,
    vault: Address,
}

fn create(env: &mut Env, id: u64, args: ChallengeArgs) -> Ch {
    let (creator, _) = env.user(0);
    let challenge = pda(&[b"challenge", creator.pubkey().as_ref(), &id.to_le_bytes()]);
    let vault = pda(&[b"vault", challenge.as_ref()]);
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: stake_sync::ID,
        accounts: stake_sync::accounts::CreateChallenge {
            creator: a(&creator.pubkey()),
            config: a(&env.config),
            mint: a(&env.mint),
            challenge: a(&challenge),
            vault: a(&vault),
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: stake_sync::instruction::CreateChallenge { id, args }.data(),
    };
    env.send(ix, &[&creator]).unwrap();
    Ch { creator, challenge, vault }
}

fn join(env: &mut Env, ch: &Ch, user: &Keypair, ata: &Address, stake: u64, rules: [u8; 32]) -> Result<(), String> {
    let participant = pda(&[b"participant", ch.challenge.as_ref(), user.pubkey().as_ref()]);
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: stake_sync::ID,
        accounts: stake_sync::accounts::Join {
            user: a(&user.pubkey()),
            config: a(&env.config),
            challenge: a(&ch.challenge),
            participant: a(&participant),
            mint: a(&env.mint),
            user_token: a(ata),
            vault: a(&ch.vault),
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: stake_sync::instruction::Join { stake, accepted_rules_hash: rules }.data(),
    };
    env.send(ix, &[user])
}

fn sponsor(env: &mut Env, ch: &Ch, who: &Keypair, ata: &Address, amount: u64) {
    let sponsorship = pda(&[b"sponsor", ch.challenge.as_ref(), who.pubkey().as_ref()]);
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: stake_sync::ID,
        accounts: stake_sync::accounts::Sponsor {
            sponsor: a(&who.pubkey()),
            challenge: a(&ch.challenge),
            sponsorship: a(&sponsorship),
            mint: a(&env.mint),
            sponsor_token: a(ata),
            vault: a(&ch.vault),
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: stake_sync::instruction::Sponsor { amount }.data(),
    };
    env.send(ix, &[who]).unwrap();
}

fn verifier_ix(env: &Env, ch: &Ch, user: &Address, data: Vec<u8>) -> anchor_lang::solana_program::instruction::Instruction {
    anchor_lang::solana_program::instruction::Instruction {
        program_id: stake_sync::ID,
        accounts: stake_sync::accounts::VerifierAction {
            verifier: a(&env.verifier.pubkey()),
            config: a(&env.config),
            challenge: a(&ch.challenge),
            participant: a(&pda(&[b"participant", ch.challenge.as_ref(), user.as_ref()])),
        }
        .to_account_metas(None),
        data,
    }
}

fn record(env: &mut Env, ch: &Ch, user: &Address, period: u16, outcome: Outcome) -> Result<(), String> {
    let ix = verifier_ix(env, ch, user, stake_sync::instruction::RecordPeriod { period, outcome }.data());
    let v = env.verifier.insecure_clone();
    env.send(ix, &[&v])
}

fn participant_ix(env: &Env, ch: &Ch, user: &Keypair, data: Vec<u8>) -> anchor_lang::solana_program::instruction::Instruction {
    let _ = env;
    anchor_lang::solana_program::instruction::Instruction {
        program_id: stake_sync::ID,
        accounts: stake_sync::accounts::ParticipantAction {
            user: a(&user.pubkey()),
            challenge: a(&ch.challenge),
            participant: a(&pda(&[b"participant", ch.challenge.as_ref(), user.pubkey().as_ref()])),
        }
        .to_account_metas(None),
        data,
    }
}

fn settle(env: &mut Env, ch: &Ch, user: &Address) -> Result<(), String> {
    let cranker = env.treasury.insecure_clone();
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: stake_sync::ID,
        accounts: stake_sync::accounts::SettleParticipant {
            cranker: a(&cranker.pubkey()),
            challenge: a(&ch.challenge),
            participant: a(&pda(&[b"participant", ch.challenge.as_ref(), user.as_ref()])),
        }
        .to_account_metas(None),
        data: stake_sync::instruction::SettleParticipant {}.data(),
    };
    env.send(ix, &[&cranker])
}

fn finalize(env: &mut Env, ch: &Ch, treasury_ata: &Address) -> Result<(), String> {
    let cranker = env.treasury.insecure_clone();
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: stake_sync::ID,
        accounts: stake_sync::accounts::Finalize {
            cranker: a(&cranker.pubkey()),
            config: a(&env.config),
            challenge: a(&ch.challenge),
            mint: a(&env.mint),
            vault: a(&ch.vault),
            treasury_token: a(treasury_ata),
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
        data: stake_sync::instruction::Finalize {}.data(),
    };
    env.send(ix, &[&cranker])
}

fn withdraw(env: &mut Env, ch: &Ch, user: &Keypair, ata: &Address, data: Vec<u8>) -> Result<(), String> {
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: stake_sync::ID,
        accounts: stake_sync::accounts::Withdraw {
            user: a(&user.pubkey()),
            challenge: a(&ch.challenge),
            participant: a(&pda(&[b"participant", ch.challenge.as_ref(), user.pubkey().as_ref()])),
            mint: a(&env.mint),
            vault: a(&ch.vault),
            user_token: a(ata),
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
        data,
    };
    env.send(ix, &[user])
}

#[test]
fn full_lifecycle_pays_exactly_by_the_rules() {
    let mut env = Env::new();
    let ch = create(&mut env, 1, args());
    let (sponsor_kp, sponsor_ata) = env.user(1_000 * USDC);
    sponsor(&mut env, &ch, &sponsor_kp, &sponsor_ata, 900 * USDC);

    let (alice, alice_ata) = env.user(21 * USDC); // perfect run
    let (bob, bob_ata) = env.user(21 * USDC); // 3 misses: 1 free, then 5% + 10%
    let (carol, carol_ata) = env.user(21 * USDC); // 4 misses: fails (needs 7 of 10)
    for (k, t) in [(&alice, &alice_ata), (&bob, &bob_ata), (&carol, &carol_ata)] {
        join(&mut env, &ch, k, t, 20 * USDC, RULES).unwrap();
    }
    assert_eq!(env.balance(&ch.vault), 900 * USDC + 3 * 20_400_000);

    env.set_time(START + 10 * DAY as i64 + 1);
    for p in 0..10u16 {
        record(&mut env, &ch, &alice.pubkey(), p, Outcome::Verified).unwrap();
        record(&mut env, &ch, &bob.pubkey(), p, if p < 3 { Outcome::Missed } else { Outcome::Verified }).unwrap();
        record(&mut env, &ch, &carol.pubkey(), p, if p < 4 { Outcome::Missed } else { Outcome::Verified }).unwrap();
    }

    // Bob disputes period 0; the moderator upholds it, so Bob ends with 2 misses (1 free + 5%).
    let ix = participant_ix(&env, &ch, &bob, stake_sync::instruction::OpenDispute { period: 0 }.data());
    env.send(ix, &[&bob]).unwrap();
    env.set_time(START + 12 * DAY as i64 + 1);
    fails_with(settle(&mut env, &ch, &alice.pubkey()), E::DisputesOpen);
    let ix = verifier_ix(&env, &ch, &bob.pubkey(), stake_sync::instruction::ResolveDispute { period: 0, upheld: true }.data());
    let v = env.verifier.insecure_clone();
    env.send(ix, &[&v]).unwrap();

    for k in [&alice, &bob, &carol] {
        settle(&mut env, &ch, &k.pubkey()).unwrap();
    }
    let treasury_ata = env.treasury_ata;
    // Joining fees (2% of 20 USDC from each of 3 people = 1.2 USDC) wait in the vault until settlement.
    assert_eq!(env.balance(&treasury_ata), 0);
    finalize(&mut env, &ch, &treasury_ata).unwrap();

    // Forfeits: Bob 5% of 20 = 1 USDC, Carol all 20 = 21 USDC. Platform keeps 60% = 12.6.
    // Finishers share 8.4 plus the 900 sponsored = 908.4, i.e. 454.2 each.
    let platform_share = 12_600_000;
    let reward = (900 * USDC + 21 * USDC - platform_share) / 2;
    assert_eq!(reward, 454_200_000);
    assert_eq!(env.balance(&treasury_ata), 3 * 400_000 + platform_share);

    withdraw(&mut env, &ch, &alice, &alice_ata, stake_sync::instruction::Claim {}.data()).unwrap();
    withdraw(&mut env, &ch, &bob, &bob_ata, stake_sync::instruction::Claim {}.data()).unwrap();
    // Each started with 21 USDC, paid 20 + 0.4 to join.
    assert_eq!(env.balance(&alice_ata), 600_000 + 20 * USDC + reward);
    assert_eq!(env.balance(&bob_ata), 600_000 + 19 * USDC + reward);
    fails_with(withdraw(&mut env, &ch, &carol, &carol_ata, stake_sync::instruction::Claim {}.data()), E::NothingToClaim);
    fails_with(withdraw(&mut env, &ch, &alice, &alice_ata, stake_sync::instruction::Claim {}.data()), E::AlreadyClaimed);
    assert_eq!(env.balance(&ch.vault), 0, "vault fully paid out");
}

#[test]
fn only_the_verifier_records_and_outages_never_become_misses() {
    let mut env = Env::new();
    let ch = create(&mut env, 2, args());
    let (alice, alice_ata) = env.user(21 * USDC);
    join(&mut env, &ch, &alice, &alice_ata, 20 * USDC, RULES).unwrap();

    env.set_time(START + 1);
    fails_with(record(&mut env, &ch, &alice.pubkey(), 0, Outcome::Missed), E::PeriodNotOver);

    env.set_time(START + 2 * DAY as i64);
    let mut forged = verifier_ix(&env, &ch, &alice.pubkey(), stake_sync::instruction::RecordPeriod { period: 0, outcome: Outcome::Verified }.data());
    forged.accounts[0].pubkey = a(&alice.pubkey());
    fails_with(env.send(forged, &[&alice]), E::NotVerifier);

    record(&mut env, &ch, &alice.pubkey(), 0, Outcome::Excused).unwrap();
    fails_with(record(&mut env, &ch, &alice.pubkey(), 0, Outcome::Missed), E::PeriodProtected);
    record(&mut env, &ch, &alice.pubkey(), 0, Outcome::Verified).unwrap();
    fails_with(record(&mut env, &ch, &alice.pubkey(), 0, Outcome::Missed), E::AlreadyRecorded);
}

#[test]
fn joining_requires_the_exact_rules_and_window() {
    let mut env = Env::new();
    let ch = create(&mut env, 3, args());
    let (alice, alice_ata) = env.user(50 * USDC);
    fails_with(join(&mut env, &ch, &alice, &alice_ata, 20 * USDC, [0u8; 32]), E::RulesMismatch);
    fails_with(join(&mut env, &ch, &alice, &alice_ata, 25 * USDC, RULES), E::StakeOutOfRange);
    join(&mut env, &ch, &alice, &alice_ata, 20 * USDC, RULES).unwrap();
    assert!(join(&mut env, &ch, &alice, &alice_ata, 20 * USDC, RULES).is_err(), "one entry per person");

    let (bob, bob_ata) = env.user(21 * USDC);
    env.set_time(START + 1);
    fails_with(join(&mut env, &ch, &bob, &bob_ata, 20 * USDC, RULES), E::JoinClosed);
}

#[test]
fn freeze_protects_periods() {
    let mut env = Env::new();
    let ch = create(&mut env, 4, args());
    let (alice, alice_ata) = env.user(21 * USDC);
    join(&mut env, &ch, &alice, &alice_ata, 20 * USDC, RULES).unwrap();
    let ix = participant_ix(&env, &ch, &alice, stake_sync::instruction::UseFreeze { first_period: 3 }.data());
    env.send(ix, &[&alice]).unwrap();
    let again = participant_ix(&env, &ch, &alice, stake_sync::instruction::UseFreeze { first_period: 6 }.data());
    fails_with(env.send(again, &[&alice]), E::FreezeUnavailable);
    env.set_time(START + 10 * DAY as i64);
    fails_with(record(&mut env, &ch, &alice.pubkey(), 3, Outcome::Missed), E::PeriodProtected);
    fails_with(record(&mut env, &ch, &alice.pubkey(), 4, Outcome::Missed), E::PeriodProtected);
    record(&mut env, &ch, &alice.pubkey(), 5, Outcome::Missed).unwrap();
}

#[test]
fn cancelled_challenge_refunds_everyone_and_admin_cannot_take_funds() {
    let mut env = Env::new();
    let ch = create(&mut env, 5, args());
    let (alice, alice_ata) = env.user(21 * USDC);
    join(&mut env, &ch, &alice, &alice_ata, 20 * USDC, RULES).unwrap();

    // The admin's only lever is cancel-before-start, which can only refund depositors.
    let admin = env.admin.insecure_clone();
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: stake_sync::ID,
        accounts: stake_sync::accounts::CancelChallenge { authority: a(&admin.pubkey()), config: a(&env.config), challenge: a(&ch.challenge) }.to_account_metas(None),
        data: stake_sync::instruction::CancelChallenge {}.data(),
    };
    env.send(ix, &[&admin]).unwrap();

    // Admin tries to "refund" the stake into their own token account: rejected by the participant PDA.
    let admin_ata = CreateAssociatedTokenAccount::new(&mut env.svm, &admin, &env.mint).owner(&admin.pubkey()).send().unwrap();
    assert!(withdraw(&mut env, &ch, &admin, &admin_ata, stake_sync::instruction::RefundCancelled {}.data()).is_err());

    withdraw(&mut env, &ch, &alice, &alice_ata, stake_sync::instruction::RefundCancelled {}.data()).unwrap();
    // Everything back, joining fee included.
    assert_eq!(env.balance(&alice_ata), 21 * USDC);
    assert_eq!(env.balance(&ch.vault), 0);
    let _ = (ch.creator, spl_token::ID);
}
