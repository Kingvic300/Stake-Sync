use anchor_lang::prelude::*;

use crate::state::Outcome;

// Events let the backend index on-chain activity and keep off-chain records in sync (PRD §28).

#[event]
pub struct ChallengeCreated {
    pub challenge: Pubkey,
    pub creator: Pubkey,
    pub id: u64,
    pub rules_hash: [u8; 32],
}

#[event]
pub struct Sponsored {
    pub challenge: Pubkey,
    pub sponsor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Joined {
    pub challenge: Pubkey,
    pub user: Pubkey,
    pub stake: u64,
    /// Joining fee paid to the treasury on top of the stake.
    pub fee: u64,
}

#[event]
pub struct PeriodRecorded {
    pub challenge: Pubkey,
    pub user: Pubkey,
    pub period: u16,
    pub outcome: Outcome,
}

#[event]
pub struct FreezeUsed {
    pub challenge: Pubkey,
    pub user: Pubkey,
    pub first_period: u16,
    pub periods: u8,
}

#[event]
pub struct DisputeOpened {
    pub challenge: Pubkey,
    pub user: Pubkey,
    pub period: u16,
}

#[event]
pub struct DisputeResolved {
    pub challenge: Pubkey,
    pub user: Pubkey,
    pub period: u16,
    pub upheld: bool,
}

#[event]
pub struct ParticipantSettled {
    pub challenge: Pubkey,
    pub user: Pubkey,
    pub completed: bool,
    pub penalty: u64,
}

#[event]
pub struct ChallengeFinalized {
    pub challenge: Pubkey,
    pub finishers: u32,
    pub reward_per_finisher: u64,
    pub treasury: u64,
}

#[event]
pub struct Claimed {
    pub challenge: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}
