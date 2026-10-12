use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::StakeSyncError;
use crate::events::{ChallengeCreated, Sponsored};
use crate::state::{Challenge, ChallengeArgs, ChallengeStatus, Config, Sponsorship, MAX_PERIODS};
use crate::transfer::deposit;

/// Ceiling on any single stake: 1,000,000 USDC (6 decimals).
pub const MAX_STAKE: u64 = 1_000_000_000_000;

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateChallenge<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(address = config.usdc_mint @ StakeSyncError::WrongMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = creator,
        space = 8 + Challenge::INIT_SPACE,
        seeds = [b"challenge", creator.key().as_ref(), &id.to_le_bytes()],
        bump
    )]
    pub challenge: Account<'info, Challenge>,
    /// Holds every stake and sponsor deposit. Owned by the challenge PDA, so only this
    /// program's rules can move funds out of it.
    #[account(
        init,
        payer = creator,
        seeds = [b"vault", challenge.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = challenge,
        token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

fn validate(a: &ChallengeArgs, now: i64) -> Result<()> {
    require!(a.start_ts > now, StakeSyncError::StartInPast);
    require!(a.period_secs >= 60 && a.period_secs <= 30 * 86_400, StakeSyncError::InvalidRules);
    require!(a.period_count >= 1 && a.period_count <= MAX_PERIODS, StakeSyncError::InvalidRules);
    require!(a.required_periods >= 1 && a.required_periods <= a.period_count, StakeSyncError::InvalidRules);
    require!(a.stake_min <= a.stake_max && a.stake_max <= MAX_STAKE, StakeSyncError::InvalidRules);
    require!(a.dispute_window_secs >= 3_600 && a.dispute_window_secs <= 7 * 86_400, StakeSyncError::InvalidRules);
    require!(a.free_strikes <= 10 && a.freeze_periods <= 14, StakeSyncError::InvalidRules);
    // Approved-structure bounds: no single step above 50%, no runaway ladders (PRD §8, §19).
    require!(a.penalty_bps.iter().all(|b| *b <= 5_000), StakeSyncError::InvalidRules);
    let end = a.start_ts + (a.period_secs as i64) * (a.period_count as i64);
    require!(a.join_deadline > now && a.join_deadline < end, StakeSyncError::InvalidRules);
    Ok(())
}

pub fn create_challenge(ctx: Context<CreateChallenge>, id: u64, args: ChallengeArgs) -> Result<()> {
    require!(!ctx.accounts.config.paused, StakeSyncError::Paused);
    validate(&args, Clock::get()?.unix_timestamp)?;

    let c = &mut ctx.accounts.challenge;
    c.creator = ctx.accounts.creator.key();
    c.id = id;
    c.mint = ctx.accounts.mint.key();
    c.vault = ctx.accounts.vault.key();
    c.rules_hash = args.rules_hash;
    c.stake_min = args.stake_min;
    c.stake_max = args.stake_max;
    c.start_ts = args.start_ts;
    c.period_secs = args.period_secs;
    c.period_count = args.period_count;
    c.required_periods = args.required_periods;
    c.join_deadline = args.join_deadline;
    c.dispute_window_secs = args.dispute_window_secs;
    c.free_strikes = args.free_strikes;
    c.penalty_bps = args.penalty_bps;
    c.freeze_periods = args.freeze_periods;
    c.max_participants = args.max_participants;
    c.forfeits_to_finishers = args.forfeits_to_finishers;
    c.fee_bps = ctx.accounts.config.fee_bps;
    c.join_fee_bps = ctx.accounts.config.join_fee_bps;
    c.status = ChallengeStatus::Open;
    c.bump = ctx.bumps.challenge;
    c.vault_bump = ctx.bumps.vault;

    emit!(ChallengeCreated { challenge: c.key(), creator: c.creator, id, rules_hash: c.rules_hash });
    Ok(())
}

#[derive(Accounts)]
pub struct Sponsor<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,
    #[account(mut, seeds = [b"challenge", challenge.creator.as_ref(), &challenge.id.to_le_bytes()], bump = challenge.bump)]
    pub challenge: Account<'info, Challenge>,
    #[account(
        init_if_needed,
        payer = sponsor,
        space = 8 + Sponsorship::INIT_SPACE,
        seeds = [b"sponsor", challenge.key().as_ref(), sponsor.key().as_ref()],
        bump
    )]
    pub sponsorship: Account<'info, Sponsorship>,
    #[account(address = challenge.mint @ StakeSyncError::WrongMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = sponsor)]
    pub sponsor_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = challenge.vault)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Anyone can add to the reward pool until the challenge ends.
pub fn sponsor(ctx: Context<Sponsor>, amount: u64) -> Result<()> {
    require!(amount > 0, StakeSyncError::ZeroAmount);
    let c = &ctx.accounts.challenge;
    require!(c.status == ChallengeStatus::Open, StakeSyncError::NotOpen);
    require!(Clock::get()?.unix_timestamp < c.end_ts(), StakeSyncError::NotOpen);

    deposit(
        &ctx.accounts.token_program,
        &ctx.accounts.sponsor_token,
        &ctx.accounts.mint,
        &ctx.accounts.vault,
        &ctx.accounts.sponsor,
        amount,
    )?;

    let s = &mut ctx.accounts.sponsorship;
    s.challenge = ctx.accounts.challenge.key();
    s.sponsor = ctx.accounts.sponsor.key();
    s.amount = s.amount.checked_add(amount).ok_or(StakeSyncError::Overflow)?;
    s.bump = ctx.bumps.sponsorship;

    let c = &mut ctx.accounts.challenge;
    c.sponsor_pool = c.sponsor_pool.checked_add(amount).ok_or(StakeSyncError::Overflow)?;
    emit!(Sponsored { challenge: c.key(), sponsor: s.sponsor, amount });
    Ok(())
}

#[derive(Accounts)]
pub struct CancelChallenge<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"challenge", challenge.creator.as_ref(), &challenge.id.to_le_bytes()], bump = challenge.bump)]
    pub challenge: Account<'info, Challenge>,
}

/// Before it starts, the creator or admin can cancel. Cancelling only unlocks refunds to the
/// people who deposited; it never sends funds anywhere else.
pub fn cancel_challenge(ctx: Context<CancelChallenge>) -> Result<()> {
    let who = ctx.accounts.authority.key();
    let c = &mut ctx.accounts.challenge;
    require!(who == c.creator || who == ctx.accounts.config.admin, StakeSyncError::NotAllowedToCancel);
    require!(c.status == ChallengeStatus::Open, StakeSyncError::NotOpen);
    require!(Clock::get()?.unix_timestamp < c.start_ts, StakeSyncError::TooLateToCancel);
    c.status = ChallengeStatus::Cancelled;
    Ok(())
}
