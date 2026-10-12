use anchor_lang::prelude::*;

/// Longest challenge, in periods (days, weeks or checkpoints). Bitmaps below hold one bit per period.
pub const MAX_PERIODS: u16 = 128;
pub const BITMAP_BYTES: usize = (MAX_PERIODS as usize) / 8;

/// Platform settings. The admin governs settings and the verifier key, but nothing here
/// lets any key move escrowed funds (PRD §17, §29).
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Backend key that records verification results. Should be a multisig or HSM-held key.
    pub verifier: Pubkey,
    /// Wallet that receives the platform fee and undistributed forfeits.
    pub treasury: Pubkey,
    pub usdc_mint: Pubkey,
    /// Platform's share of forfeited stakes and penalties; finishers split the rest.
    pub fee_bps: u16,
    /// Fee charged on top of each stake when joining.
    pub join_fee_bps: u16,
    /// Stops new challenges and new joins. Running challenges, claims and refunds keep working.
    pub paused: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum ChallengeStatus {
    /// Accepting joins and recording results until settlement.
    Open,
    /// Every participant settled; claims open.
    Settled,
    /// Cancelled before it started; everyone gets their money back.
    Cancelled,
}

/// Rules a creator picks when creating a challenge. Locked once created.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct ChallengeArgs {
    /// sha256 of the full off-chain rules document participants accept.
    pub rules_hash: [u8; 32],
    /// Equal min and max means a fixed stake; both zero means no stake.
    pub stake_min: u64,
    pub stake_max: u64,
    pub start_ts: i64,
    pub period_secs: u32,
    pub period_count: u16,
    pub required_periods: u16,
    pub join_deadline: i64,
    pub dispute_window_secs: u32,
    pub free_strikes: u8,
    /// Extra share of the stake lost on each miss after the free strikes, in basis points.
    /// The last value repeats for further misses.
    pub penalty_bps: [u16; 3],
    pub freeze_periods: u8,
    /// 0 means unlimited.
    pub max_participants: u32,
    /// Share forfeited stakes with finishers; otherwise they go to the treasury.
    pub forfeits_to_finishers: bool,
}

#[account]
#[derive(InitSpace)]
pub struct Challenge {
    pub creator: Pubkey,
    pub id: u64,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub rules_hash: [u8; 32],
    pub stake_min: u64,
    pub stake_max: u64,
    pub start_ts: i64,
    pub period_secs: u32,
    pub period_count: u16,
    pub required_periods: u16,
    pub join_deadline: i64,
    pub dispute_window_secs: u32,
    pub free_strikes: u8,
    pub penalty_bps: [u16; 3],
    pub freeze_periods: u8,
    pub max_participants: u32,
    pub forfeits_to_finishers: bool,
    /// Copied from Config at creation, so later fee changes never touch running challenges.
    pub fee_bps: u16,
    pub join_fee_bps: u16,

    pub status: ChallengeStatus,
    pub participant_count: u32,
    pub total_staked: u64,
    /// Joining fees held in the vault; paid to the treasury at finalize, refunded on cancel.
    pub join_fees: u64,
    pub sponsor_pool: u64,
    pub open_disputes: u32,

    pub settled_count: u32,
    pub finisher_count: u32,
    pub forfeited_total: u64,
    pub reward_per_finisher: u64,
    pub treasury_amount: u64,

    pub bump: u8,
    pub vault_bump: u8,
}

impl Challenge {
    pub fn end_ts(&self) -> i64 {
        self.start_ts + (self.period_secs as i64) * (self.period_count as i64)
    }

    /// End of a period: results for it can only be recorded after this.
    pub fn period_end(&self, period: u16) -> i64 {
        self.start_ts + (self.period_secs as i64) * (period as i64 + 1)
    }

    /// Settlement opens once the last period has closed and its dispute window has passed.
    pub fn settle_after(&self) -> i64 {
        self.end_ts() + self.dispute_window_secs as i64
    }
}

#[account]
#[derive(InitSpace)]
pub struct Participant {
    pub challenge: Pubkey,
    pub user: Pubkey,
    pub stake: u64,
    /// Joining fee paid on top of the stake.
    pub join_fee: u64,
    pub joined_at: i64,
    pub verified: [u8; BITMAP_BYTES],
    pub missed: [u8; BITMAP_BYTES],
    /// Provider was down: protected, can never become a miss.
    pub excused: [u8; BITMAP_BYTES],
    pub frozen: [u8; BITMAP_BYTES],
    pub disputed: [u8; BITMAP_BYTES],
    pub verified_count: u16,
    pub missed_count: u16,
    pub open_disputes: u8,
    pub freeze_used: bool,
    pub settled: bool,
    pub completed: bool,
    pub penalty: u64,
    pub claimed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Sponsorship {
    pub challenge: Pubkey,
    pub sponsor: Pubkey,
    pub amount: u64,
    pub reclaimed: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Outcome {
    Verified,
    Missed,
    /// The verification provider was unavailable. Protects the period from ever becoming a miss.
    Excused,
}

pub fn bit(map: &[u8; BITMAP_BYTES], i: u16) -> bool {
    map[(i / 8) as usize] & (1 << (i % 8)) != 0
}

pub fn set_bit(map: &mut [u8; BITMAP_BYTES], i: u16) {
    map[(i / 8) as usize] |= 1 << (i % 8);
}

pub fn clear_bit(map: &mut [u8; BITMAP_BYTES], i: u16) {
    map[(i / 8) as usize] &= !(1 << (i % 8));
}
