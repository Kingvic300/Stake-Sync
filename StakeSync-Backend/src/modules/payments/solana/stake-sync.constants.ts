// On-chain constants for the Stake-Sync escrow program (StakeSync-SmartContract).
// See docs/solana-integration.md for how each one is used.

export const STAKE_SYNC_PROGRAM_ID = 'ANKCFRDYu45J199F1teNEeCiRUC7xYRArMtiHRYkvAcV';

export type SolanaCluster = 'mainnet-beta' | 'devnet';

/** Circle USDC per cluster. The program only accepts the mint stored in its Config account. */
export const USDC_MINT: Record<SolanaCluster, string> = {
  'mainnet-beta': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

export const USDC_DECIMALS = 6;

/** USDC on both clusters uses the classic SPL Token program. */
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/** PDA seed prefixes. Numbers in seeds are little-endian (challenge id is a u64, 8 bytes). */
export const SEEDS = {
  config: 'config', // ["config"]
  challenge: 'challenge', // ["challenge", creator, id_le_u64]
  vault: 'vault', // ["vault", challenge]
  participant: 'participant', // ["participant", challenge, user]
  sponsor: 'sponsor', // ["sponsor", challenge, sponsor]
} as const;

/** Hard limits enforced by the program. Validate against these before building a transaction. */
export const LIMITS = {
  maxPeriods: 128,
  minPeriodSecs: 60,
  maxPeriodSecs: 30 * 86_400,
  minDisputeWindowSecs: 3_600,
  maxDisputeWindowSecs: 7 * 86_400,
  maxFreeStrikes: 10,
  maxFreezePeriods: 14,
  maxPenaltyStepBps: 5_000,
  maxFeeBps: 1_000,
  maxStake: 1_000_000_000_000n, // 1,000,000 USDC in base units
} as const;

/** Program error codes (Anchor custom errors start at 6000). Map these to plain user messages. */
export const STAKE_SYNC_ERRORS = {
  6000: 'Paused',
  6001: 'NotUpgradeAuthority',
  6002: 'FeeTooHigh',
  6003: 'WrongMint',
  6004: 'InvalidRules',
  6005: 'StartInPast',
  6006: 'NotOpen',
  6007: 'JoinClosed',
  6008: 'ChallengeFull',
  6009: 'StakeOutOfRange',
  6010: 'RulesMismatch',
  6011: 'NotVerifier',
  6012: 'PeriodOutOfRange',
  6013: 'PeriodNotOver',
  6014: 'AlreadyRecorded',
  6015: 'PeriodProtected',
  6016: 'FreezeUnavailable',
  6017: 'FreezeInvalid',
  6018: 'NotDisputable',
  6019: 'DisputeWindowClosed',
  6020: 'AlreadyDisputed',
  6021: 'NotDisputed',
  6022: 'TooEarlyToSettle',
  6023: 'DisputesOpen',
  6024: 'AlreadySettled',
  6025: 'NotAllSettled',
  6026: 'NotSettled',
  6027: 'AlreadyClaimed',
  6028: 'NothingToClaim',
  6029: 'TooLateToCancel',
  6030: 'NotAllowedToCancel',
  6031: 'NotCancelled',
  6032: 'CannotReclaim',
  6033: 'ZeroAmount',
  6034: 'Overflow',
} as const;
