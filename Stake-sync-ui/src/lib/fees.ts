// Stake-Sync platform fees. These mirror the API's defaults (GET /api/platform returns the live
// values, and each challenge keeps the fees it was created with).

export const FEES = {
  /** On top of each stake when joining. Refunded if the challenge is cancelled. */
  joinPct: 2,
  /** Stake-Sync's share of forfeited stakes and penalties. Finishers split the rest. */
  platformSharePct: 60,
}

const round = (n: number) => Math.round(n * 100) / 100

export const joinFee = (stake: number) => round((stake * FEES.joinPct) / 100)

export function feesText(hasStake: boolean) {
  return hasStake
    ? `${FEES.joinPct}% joining fee on top of your stake (refunded if the challenge is cancelled). Of the stakes and penalties people forfeit, Stake-Sync keeps ${FEES.platformSharePct}% and finishers split ${100 - FEES.platformSharePct}%. Your own stake back and sponsor prizes are never charged.`
    : 'No Stake-Sync fees. Sponsor prizes go entirely to finishers.'
}
