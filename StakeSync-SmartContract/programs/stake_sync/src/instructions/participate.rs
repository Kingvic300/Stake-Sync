use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::StakeSyncError;
use crate::events::{DisputeOpened, FreezeUsed, Joined};
use crate::math;
use crate::state::{bit, set_bit, Challenge, ChallengeStatus, Config, Participant};
use crate::transfer::deposit;

#[derive(Accounts)]
pub struct Join<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"challenge", challenge.creator.as_ref(), &challenge.id.to_le_bytes()], bump = challenge.bump)]
    pub challenge: Account<'info, Challenge>,
    #[account(
        init,
        payer = user,
        space = 8 + Participant::INIT_SPACE,
        seeds = [b"participant", challenge.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub participant: Account<'info, Participant>,
    #[account(address = challenge.mint @ StakeSyncError::WrongMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = user)]
    pub user_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = challenge.vault)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Joining requires the hash of the exact rules the person accepted (PRD §7). A one-person,
/// one-participant record is enforced by the PDA seeds.
pub fn join(ctx: Context<Join>, stake: u64, accepted_rules_hash: [u8; 32]) -> Result<()> {
    require!(!ctx.accounts.config.paused, StakeSyncError::Paused);
    let c = &ctx.accounts.challenge;
    require!(c.status == ChallengeStatus::Open, StakeSyncError::NotOpen);
    require!(Clock::get()?.unix_timestamp <= c.join_deadline, StakeSyncError::JoinClosed);
    require!(c.max_participants == 0 || c.participant_count < c.max_participants, StakeSyncError::ChallengeFull);
    require!(stake >= c.stake_min && stake <= c.stake_max, StakeSyncError::StakeOutOfRange);
    require!(accepted_rules_hash == c.rules_hash, StakeSyncError::RulesMismatch);

    // Stake and joining fee both go into escrow. The fee reaches the treasury only when the
    // challenge settles, so a cancelled challenge refunds it in full.
    let fee = math::join_fee(stake, c.join_fee_bps);
    let total = stake.checked_add(fee).ok_or(StakeSyncError::Overflow)?;
    deposit(&ctx.accounts.token_program, &ctx.accounts.user_token, &ctx.accounts.mint, &ctx.accounts.vault, &ctx.accounts.user, total)?;

    let p = &mut ctx.accounts.participant;
    p.challenge = ctx.accounts.challenge.key();
    p.user = ctx.accounts.user.key();
    p.stake = stake;
    p.join_fee = fee;
    p.joined_at = Clock::get()?.unix_timestamp;
    p.bump = ctx.bumps.participant;

    let c = &mut ctx.accounts.challenge;
    c.participant_count = c.participant_count.checked_add(1).ok_or(StakeSyncError::Overflow)?;
    c.total_staked = c.total_staked.checked_add(stake).ok_or(StakeSyncError::Overflow)?;
    c.join_fees = c.join_fees.checked_add(fee).ok_or(StakeSyncError::Overflow)?;
    emit!(Joined { challenge: c.key(), user: p.user, stake, fee });
    Ok(())
}

#[derive(Accounts)]
pub struct ParticipantAction<'info> {
    pub user: Signer<'info>,
    #[account(mut, seeds = [b"challenge", challenge.creator.as_ref(), &challenge.id.to_le_bytes()], bump = challenge.bump)]
    pub challenge: Account<'info, Challenge>,
    #[account(
        mut,
        seeds = [b"participant", challenge.key().as_ref(), user.key().as_ref()],
        bump = participant.bump,
        has_one = user,
        has_one = challenge
    )]
    pub participant: Account<'info, Participant>,
}

/// Emergency freeze (PRD §20): once per challenge, for a fixed number of future periods,
/// and never over a period already recorded as missed.
pub fn use_freeze(ctx: Context<ParticipantAction>, first_period: u16) -> Result<()> {
    let c = &ctx.accounts.challenge;
    let p = &mut ctx.accounts.participant;
    require!(c.status == ChallengeStatus::Open, StakeSyncError::NotOpen);
    require!(c.freeze_periods > 0 && !p.freeze_used, StakeSyncError::FreezeUnavailable);

    let now = Clock::get()?.unix_timestamp;
    let current = if now < c.start_ts { 0 } else { ((now - c.start_ts) / c.period_secs as i64) as u16 };
    let last = first_period.checked_add(c.freeze_periods as u16 - 1).ok_or(StakeSyncError::Overflow)?;
    require!(first_period >= current && last < c.period_count, StakeSyncError::FreezeInvalid);
    for i in first_period..=last {
        require!(!bit(&p.missed, i), StakeSyncError::FreezeInvalid);
    }
    for i in first_period..=last {
        set_bit(&mut p.frozen, i);
    }
    p.freeze_used = true;
    emit!(FreezeUsed { challenge: c.key(), user: p.user, first_period, periods: c.freeze_periods });
    Ok(())
}

/// Contest a missed period. Holds settlement for the whole challenge until it's resolved (PRD §21).
pub fn open_dispute(ctx: Context<ParticipantAction>, period: u16) -> Result<()> {
    let p = &mut ctx.accounts.participant;
    let c = &mut ctx.accounts.challenge;
    require!(c.status == ChallengeStatus::Open, StakeSyncError::NotOpen);
    require!(period < c.period_count, StakeSyncError::PeriodOutOfRange);
    require!(bit(&p.missed, period), StakeSyncError::NotDisputable);
    require!(!bit(&p.disputed, period), StakeSyncError::AlreadyDisputed);
    require!(!p.settled, StakeSyncError::AlreadySettled);
    // Disputes stay open until settlement starts, so a late-recorded miss can still be contested.
    require!(Clock::get()?.unix_timestamp < c.settle_after(), StakeSyncError::DisputeWindowClosed);

    set_bit(&mut p.disputed, period);
    p.open_disputes = p.open_disputes.checked_add(1).ok_or(StakeSyncError::Overflow)?;
    c.open_disputes = c.open_disputes.checked_add(1).ok_or(StakeSyncError::Overflow)?;
    emit!(DisputeOpened { challenge: c.key(), user: p.user, period });
    Ok(())
}
