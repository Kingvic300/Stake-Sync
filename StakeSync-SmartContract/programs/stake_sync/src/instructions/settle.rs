use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::errors::StakeSyncError;
use crate::events::{ChallengeFinalized, Claimed, ParticipantSettled};
use crate::math;
use crate::state::{Challenge, ChallengeStatus, Config, Participant, Sponsorship};
use crate::transfer::pay_out;

#[derive(Accounts)]
pub struct SettleParticipant<'info> {
    /// Anyone can crank settlement; the outcome is fully determined by recorded results.
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [b"challenge", challenge.creator.as_ref(), &challenge.id.to_le_bytes()], bump = challenge.bump)]
    pub challenge: Account<'info, Challenge>,
    #[account(
        mut,
        seeds = [b"participant", challenge.key().as_ref(), participant.user.as_ref()],
        bump = participant.bump,
        has_one = challenge
    )]
    pub participant: Account<'info, Participant>,
}

pub fn settle_participant(ctx: Context<SettleParticipant>) -> Result<()> {
    let c = &mut ctx.accounts.challenge;
    let p = &mut ctx.accounts.participant;
    require!(c.status == ChallengeStatus::Open, StakeSyncError::NotOpen);
    require!(Clock::get()?.unix_timestamp >= c.settle_after(), StakeSyncError::TooEarlyToSettle);
    require!(c.open_disputes == 0, StakeSyncError::DisputesOpen);
    require!(!p.settled, StakeSyncError::AlreadySettled);

    let done = math::completed(p.missed_count, c.period_count, c.required_periods);
    let penalty = if done { math::penalty(p.stake, p.missed_count, c.free_strikes, c.penalty_bps) } else { 0 };
    let forfeit = math::forfeit(p.stake, done, penalty);

    p.settled = true;
    p.completed = done;
    p.penalty = penalty;
    c.settled_count += 1;
    c.forfeited_total = c.forfeited_total.checked_add(forfeit).ok_or(StakeSyncError::Overflow)?;
    if done {
        c.finisher_count += 1;
    }
    emit!(ParticipantSettled { challenge: c.key(), user: p.user, completed: done, penalty });
    Ok(())
}

#[derive(Accounts)]
pub struct Finalize<'info> {
    pub cranker: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"challenge", challenge.creator.as_ref(), &challenge.id.to_le_bytes()], bump = challenge.bump)]
    pub challenge: Account<'info, Challenge>,
    #[account(address = challenge.mint @ StakeSyncError::WrongMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = challenge.vault)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// Must belong to the configured treasury wallet.
    #[account(mut, token::mint = mint, token::authority = config.treasury)]
    pub treasury_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Closes the books once every participant is settled: fixes each finisher's reward
/// and pays the fee and undistributed forfeits to the treasury.
pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
    let c = &ctx.accounts.challenge;
    require!(c.status == ChallengeStatus::Open, StakeSyncError::NotOpen);
    require!(Clock::get()?.unix_timestamp >= c.settle_after(), StakeSyncError::TooEarlyToSettle);
    require!(c.open_disputes == 0, StakeSyncError::DisputesOpen);
    require!(c.settled_count == c.participant_count, StakeSyncError::NotAllSettled);

    let d = math::distribute(c.sponsor_pool, c.forfeited_total, c.finisher_count, c.fee_bps, c.forfeits_to_finishers);
    let to_treasury = d.treasury.checked_add(c.join_fees).ok_or(StakeSyncError::Overflow)?;
    pay_out(&ctx.accounts.token_program, c, &ctx.accounts.vault, &ctx.accounts.mint, &ctx.accounts.treasury_token, to_treasury)?;

    let c = &mut ctx.accounts.challenge;
    c.reward_per_finisher = d.reward_per_finisher;
    c.treasury_amount = to_treasury;
    c.status = ChallengeStatus::Settled;
    emit!(ChallengeFinalized { challenge: c.key(), finishers: c.finisher_count, reward_per_finisher: d.reward_per_finisher, treasury: to_treasury });
    Ok(())
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub user: Signer<'info>,
    #[account(seeds = [b"challenge", challenge.creator.as_ref(), &challenge.id.to_le_bytes()], bump = challenge.bump)]
    pub challenge: Account<'info, Challenge>,
    #[account(
        mut,
        seeds = [b"participant", challenge.key().as_ref(), user.key().as_ref()],
        bump = participant.bump,
        has_one = user,
        has_one = challenge
    )]
    pub participant: Account<'info, Participant>,
    #[account(address = challenge.mint @ StakeSyncError::WrongMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = challenge.vault)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = user)]
    pub user_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Finisher collects their stake (less any penalty) plus their reward share.
pub fn claim(ctx: Context<Withdraw>) -> Result<()> {
    let c = &ctx.accounts.challenge;
    let p = &ctx.accounts.participant;
    require!(c.status == ChallengeStatus::Settled, StakeSyncError::NotSettled);
    require!(!p.claimed, StakeSyncError::AlreadyClaimed);
    require!(p.completed, StakeSyncError::NothingToClaim);
    let amount = (p.stake - p.penalty).checked_add(c.reward_per_finisher).ok_or(StakeSyncError::Overflow)?;

    pay_out(&ctx.accounts.token_program, c, &ctx.accounts.vault, &ctx.accounts.mint, &ctx.accounts.user_token, amount)?;
    ctx.accounts.participant.claimed = true;
    emit!(Claimed { challenge: c.key(), user: ctx.accounts.user.key(), amount });
    Ok(())
}

/// Full refund, joining fee included, when a challenge was cancelled before it started.
pub fn refund_cancelled(ctx: Context<Withdraw>) -> Result<()> {
    let c = &ctx.accounts.challenge;
    let p = &ctx.accounts.participant;
    require!(c.status == ChallengeStatus::Cancelled, StakeSyncError::NotCancelled);
    require!(!p.claimed, StakeSyncError::AlreadyClaimed);
    let amount = p.stake.checked_add(p.join_fee).ok_or(StakeSyncError::Overflow)?;

    pay_out(&ctx.accounts.token_program, c, &ctx.accounts.vault, &ctx.accounts.mint, &ctx.accounts.user_token, amount)?;
    ctx.accounts.participant.claimed = true;
    emit!(Claimed { challenge: c.key(), user: ctx.accounts.user.key(), amount });
    Ok(())
}

#[derive(Accounts)]
pub struct ReclaimSponsorship<'info> {
    pub sponsor: Signer<'info>,
    #[account(seeds = [b"challenge", challenge.creator.as_ref(), &challenge.id.to_le_bytes()], bump = challenge.bump)]
    pub challenge: Account<'info, Challenge>,
    #[account(
        mut,
        seeds = [b"sponsor", challenge.key().as_ref(), sponsor.key().as_ref()],
        bump = sponsorship.bump,
        has_one = sponsor,
        has_one = challenge
    )]
    pub sponsorship: Account<'info, Sponsorship>,
    #[account(address = challenge.mint @ StakeSyncError::WrongMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = challenge.vault)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = sponsor)]
    pub sponsor_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Sponsors get their money back if the challenge was cancelled or nobody finished.
pub fn reclaim_sponsorship(ctx: Context<ReclaimSponsorship>) -> Result<()> {
    let c = &ctx.accounts.challenge;
    let s = &ctx.accounts.sponsorship;
    let allowed = c.status == ChallengeStatus::Cancelled || (c.status == ChallengeStatus::Settled && c.finisher_count == 0);
    require!(allowed, StakeSyncError::CannotReclaim);
    require!(!s.reclaimed, StakeSyncError::AlreadyClaimed);
    let amount = s.amount;

    pay_out(&ctx.accounts.token_program, c, &ctx.accounts.vault, &ctx.accounts.mint, &ctx.accounts.sponsor_token, amount)?;
    ctx.accounts.sponsorship.reclaimed = true;
    Ok(())
}
