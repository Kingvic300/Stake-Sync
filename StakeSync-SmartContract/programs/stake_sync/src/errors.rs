use anchor_lang::prelude::*;

#[error_code]
pub enum StakeSyncError {
    #[msg("New challenges and joins are paused")]
    Paused,
    #[msg("Only the program upgrade authority can initialize")]
    NotUpgradeAuthority,
    #[msg("Fee is above the 10% cap")]
    FeeTooHigh,
    #[msg("Token mint is not the platform's USDC mint")]
    WrongMint,
    #[msg("Challenge rules are invalid")]
    InvalidRules,
    #[msg("Challenge must start in the future")]
    StartInPast,
    #[msg("This challenge is no longer open")]
    NotOpen,
    #[msg("Joining has closed for this challenge")]
    JoinClosed,
    #[msg("This challenge is full")]
    ChallengeFull,
    #[msg("Stake is outside this challenge's range")]
    StakeOutOfRange,
    #[msg("Accepted rules don't match this challenge's rules")]
    RulesMismatch,
    #[msg("Only the verifier can record results")]
    NotVerifier,
    #[msg("Period is outside the challenge")]
    PeriodOutOfRange,
    #[msg("Results for this period can't be recorded until it ends")]
    PeriodNotOver,
    #[msg("This period already has a final result")]
    AlreadyRecorded,
    #[msg("This period is protected and can't be marked missed")]
    PeriodProtected,
    #[msg("Freezes aren't allowed or have been used")]
    FreezeUnavailable,
    #[msg("A freeze must start in a future period and not cover a missed one")]
    FreezeInvalid,
    #[msg("Only a missed period can be disputed")]
    NotDisputable,
    #[msg("The dispute window for this period has closed")]
    DisputeWindowClosed,
    #[msg("This period is already under dispute")]
    AlreadyDisputed,
    #[msg("This period isn't under dispute")]
    NotDisputed,
    #[msg("Settlement hasn't opened yet")]
    TooEarlyToSettle,
    #[msg("Disputes are still open")]
    DisputesOpen,
    #[msg("Participant already settled")]
    AlreadySettled,
    #[msg("Not every participant has settled yet")]
    NotAllSettled,
    #[msg("Claims aren't open")]
    NotSettled,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("A challenge can only be cancelled before it starts")]
    TooLateToCancel,
    #[msg("Only the creator or admin can cancel")]
    NotAllowedToCancel,
    #[msg("Challenge isn't cancelled")]
    NotCancelled,
    #[msg("Sponsorship can only be reclaimed when nobody finished or the challenge was cancelled")]
    CannotReclaim,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
}
