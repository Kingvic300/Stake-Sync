//! Stake-Sync escrow: commitment challenges with USDC stakes, sponsor pools, strikes,
//! disputes and deterministic settlement. No instruction lets an admin move escrowed funds.
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;
pub mod transfer;

use instructions::*;
use state::{ChallengeArgs, Outcome};

declare_id!("ANKCFRDYu45J199F1teNEeCiRUC7xYRArMtiHRYkvAcV");

#[program]
pub mod stake_sync {
    use super::*;

    // Governance
    pub fn initialize_config(ctx: Context<InitializeConfig>, verifier: Pubkey, treasury: Pubkey, fees: Fees) -> Result<()> {
        instructions::admin::initialize_config(ctx, verifier, treasury, fees)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, update: ConfigUpdate) -> Result<()> {
        instructions::admin::update_config(ctx, update)
    }

    // Challenges
    pub fn create_challenge(ctx: Context<CreateChallenge>, id: u64, args: ChallengeArgs) -> Result<()> {
        instructions::challenge::create_challenge(ctx, id, args)
    }

    pub fn sponsor(ctx: Context<Sponsor>, amount: u64) -> Result<()> {
        instructions::challenge::sponsor(ctx, amount)
    }

    pub fn cancel_challenge(ctx: Context<CancelChallenge>) -> Result<()> {
        instructions::challenge::cancel_challenge(ctx)
    }

    // Participants
    pub fn join(ctx: Context<Join>, stake: u64, accepted_rules_hash: [u8; 32]) -> Result<()> {
        instructions::participate::join(ctx, stake, accepted_rules_hash)
    }

    pub fn use_freeze(ctx: Context<ParticipantAction>, first_period: u16) -> Result<()> {
        instructions::participate::use_freeze(ctx, first_period)
    }

    pub fn open_dispute(ctx: Context<ParticipantAction>, period: u16) -> Result<()> {
        instructions::participate::open_dispute(ctx, period)
    }

    // Verification (verifier key only)
    pub fn record_period(ctx: Context<VerifierAction>, period: u16, outcome: Outcome) -> Result<()> {
        instructions::verify::record_period(ctx, period, outcome)
    }

    pub fn resolve_dispute(ctx: Context<VerifierAction>, period: u16, upheld: bool) -> Result<()> {
        instructions::verify::resolve_dispute(ctx, period, upheld)
    }

    // Settlement (permissionless cranks) and withdrawals
    pub fn settle_participant(ctx: Context<SettleParticipant>) -> Result<()> {
        instructions::settle::settle_participant(ctx)
    }

    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        instructions::settle::finalize(ctx)
    }

    pub fn claim(ctx: Context<Withdraw>) -> Result<()> {
        instructions::settle::claim(ctx)
    }

    pub fn refund_cancelled(ctx: Context<Withdraw>) -> Result<()> {
        instructions::settle::refund_cancelled(ctx)
    }

    pub fn reclaim_sponsorship(ctx: Context<ReclaimSponsorship>) -> Result<()> {
        instructions::settle::reclaim_sponsorship(ctx)
    }
}
