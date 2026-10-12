//! Pure settlement math. No accounts, no I/O: deterministic and unit-tested, and the backend can
//! run the same functions to preview or audit any payout (PRD §30).

pub const BPS: u64 = 10_000;

/// Total penalty for a participant: the first `free_strikes` misses cost nothing, each further
/// miss adds the next value from `ladder` (the last value repeats). Capped at the full stake.
pub fn penalty(stake: u64, missed: u16, free_strikes: u8, ladder: [u16; 3]) -> u64 {
    let penalized = missed.saturating_sub(free_strikes as u16) as usize;
    let mut bps: u64 = 0;
    for i in 0..penalized {
        bps += ladder[i.min(2)] as u64;
        if bps >= BPS {
            return stake;
        }
    }
    ((stake as u128 * bps as u128) / BPS as u128) as u64
}

/// Completion only counts proven misses. Periods with no result (provider down, or never
/// recorded) never count against anyone (PRD §3, §10, §32).
pub fn completed(missed: u16, period_count: u16, required_periods: u16) -> bool {
    missed <= period_count.saturating_sub(required_periods)
}

/// What a participant forfeits: their penalty if they finished, otherwise their whole stake.
pub fn forfeit(stake: u64, done: bool, penalty: u64) -> u64 {
    if done {
        penalty.min(stake)
    } else {
        stake
    }
}

/// Joining fee, charged on top of the stake.
pub fn join_fee(stake: u64, join_fee_bps: u16) -> u64 {
    ((stake as u128 * join_fee_bps as u128) / BPS as u128) as u64
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Distribution {
    pub reward_per_finisher: u64,
    /// Platform share of forfeits, undistributed forfeits and rounding dust.
    pub treasury: u64,
    /// True when nobody finished and sponsors can take their money back.
    pub sponsors_reclaim: bool,
}

/// Splits the pot once every participant has settled. The platform keeps `fee_bps` of forfeited
/// stakes and penalties; finishers split the rest plus all sponsor money equally. A finisher's own
/// stake (minus penalties) is never charged.
pub fn distribute(sponsor_pool: u64, forfeited: u64, finishers: u32, fee_bps: u16, forfeits_to_finishers: bool) -> Distribution {
    let fee = ((forfeited as u128 * fee_bps as u128) / BPS as u128) as u64;
    let forfeit_net = forfeited - fee;
    if finishers == 0 {
        return Distribution { reward_per_finisher: 0, treasury: forfeited, sponsors_reclaim: true };
    }
    let pool = sponsor_pool + if forfeits_to_finishers { forfeit_net } else { 0 };
    let reward_per_finisher = pool / finishers as u64;
    let dust = pool - reward_per_finisher * finishers as u64;
    let undistributed = if forfeits_to_finishers { 0 } else { forfeit_net };
    Distribution { reward_per_finisher, treasury: fee + undistributed + dust, sponsors_reclaim: false }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LADDER: [u16; 3] = [500, 1_000, 1_500];

    #[test]
    fn strikes_absorb_first_misses() {
        assert_eq!(penalty(20_000_000, 3, 3, LADDER), 0);
        assert_eq!(penalty(20_000_000, 4, 3, LADDER), 1_000_000); // 5%
        assert_eq!(penalty(20_000_000, 5, 3, LADDER), 3_000_000); // 5% + 10%
        assert_eq!(penalty(20_000_000, 6, 3, LADDER), 6_000_000); // + 15%
        assert_eq!(penalty(20_000_000, 7, 3, LADDER), 9_000_000); // last step repeats
    }

    #[test]
    fn penalty_never_exceeds_stake() {
        assert_eq!(penalty(20_000_000, 100, 0, [5_000, 5_000, 5_000]), 20_000_000);
        assert_eq!(penalty(0, 10, 0, LADDER), 0);
    }

    #[test]
    fn platform_keeps_sixty_percent_of_forfeits_and_finishers_share_forty() {
        assert_eq!(join_fee(20_000_000, 200), 400_000); // 20 USDC stake pays 0.40 to join
        // 100 USDC sponsored, one loser forfeits 20, two finishers.
        let d = distribute(100_000_000, 20_000_000, 2, 6_000, true);
        // Platform 12 (60% of 20); finishers get 8 + all 100 sponsored = 54 each.
        assert_eq!(d.treasury, 12_000_000);
        assert_eq!(d.reward_per_finisher, 54_000_000);
    }

    #[test]
    fn completion_counts_only_proven_misses() {
        assert!(completed(5, 30, 25));
        assert!(!completed(6, 30, 25));
        assert!(completed(0, 30, 30));
    }

    /// Every token that went in comes out exactly once, whoever finishes.
    #[test]
    fn distribution_conserves_funds() {
        let stakes = [20_000_000u64, 20_000_000, 15_000_000, 7_000_000];
        for fee in [0u16, 1_000, 6_000] {
            for to_finishers in [true, false] {
                for mask in 0u8..16 {
                    let sponsor = 5_000_000_003u64;
                    let mut forfeited = 0;
                    let mut finishers = 0;
                    let mut returned = 0;
                    for (i, s) in stakes.iter().enumerate() {
                        let done = mask & (1 << i) != 0;
                        let p = if done { penalty(*s, 4, 3, LADDER) } else { 0 };
                        let f = forfeit(*s, done, p);
                        forfeited += f;
                        if done {
                            finishers += 1;
                            returned += s - f;
                        }
                    }
                    let d = distribute(sponsor, forfeited, finishers, fee, to_finishers);
                    let rewards = d.reward_per_finisher * finishers as u64;
                    let sponsor_back = if d.sponsors_reclaim { sponsor } else { 0 };
                    let total_in: u64 = stakes.iter().sum::<u64>() + sponsor;
                    assert_eq!(returned + rewards + d.treasury + sponsor_back, total_in, "fee {fee} to_finishers {to_finishers} mask {mask}");
                }
            }
        }
    }
}
