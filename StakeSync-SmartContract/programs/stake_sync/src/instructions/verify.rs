use anchor_lang::prelude::*;

use crate::errors::StakeSyncError;
use crate::events::{DisputeResolved, PeriodRecorded};
use crate::state::{bit, clear_bit, set_bit, Challenge, ChallengeStatus, Config, Outcome, Participant};

#[derive(Accounts)]
pub struct VerifierAction<'info> {
    pub verifier: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, constraint = config.verifier == verifier.key() @ StakeSyncError::NotVerifier)]
    pub config: Account<'info, Config>,
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

/// Records one period's verification result. Results are final once written, except that
/// an excused period may later be verified. Only a proven miss ever counts against someone.
pub fn record_period(ctx: Context<VerifierAction>, period: u16, outcome: Outcome) -> Result<()> {
    let c = &ctx.accounts.challenge;
    let p = &mut ctx.accounts.participant;
    require!(c.status == ChallengeStatus::Open && !p.settled, StakeSyncError::NotOpen);
    require!(period < c.period_count, StakeSyncError::PeriodOutOfRange);
    require!(Clock::get()?.unix_timestamp >= c.period_end(period), StakeSyncError::PeriodNotOver);
    require!(!bit(&p.verified, period) && !bit(&p.missed, period), StakeSyncError::AlreadyRecorded);

    match outcome {
        Outcome::Verified => {
            clear_bit(&mut p.excused, period);
            set_bit(&mut p.verified, period);
            p.verified_count += 1;
        }
        Outcome::Missed => {
            // A provider outage or an emergency freeze can never turn into a miss (PRD §3, §20, §32).
            require!(!bit(&p.excused, period) && !bit(&p.frozen, period), StakeSyncError::PeriodProtected);
            set_bit(&mut p.missed, period);
            p.missed_count += 1;
        }
        Outcome::Excused => {
            require!(!bit(&p.excused, period), StakeSyncError::AlreadyRecorded);
            set_bit(&mut p.excused, period);
        }
    }
    emit!(PeriodRecorded { challenge: c.key(), user: p.user, period, outcome });
    Ok(())
}

/// Moderator decision on a dispute, submitted through the verifier key. Upheld turns the
/// miss into a verified period; rejected keeps the miss. Either way the hold is released.
pub fn resolve_dispute(ctx: Context<VerifierAction>, period: u16, upheld: bool) -> Result<()> {
    let p = &mut ctx.accounts.participant;
    let c = &mut ctx.accounts.challenge;
    require!(period < c.period_count, StakeSyncError::PeriodOutOfRange);
    require!(bit(&p.disputed, period), StakeSyncError::NotDisputed);

    if upheld {
        clear_bit(&mut p.missed, period);
        p.missed_count -= 1;
        set_bit(&mut p.verified, period);
        p.verified_count += 1;
    }
    clear_bit(&mut p.disputed, period);
    p.open_disputes -= 1;
    c.open_disputes -= 1;
    emit!(DisputeResolved { challenge: c.key(), user: p.user, period, upheld });
    Ok(())
}
