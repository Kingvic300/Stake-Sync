// TypeScript port of the program's math.rs. Same integer rules, so previews and off-chain
// (no-money) challenges settle exactly as the program would (PRD §30).

const BPS = 10_000n;

/**
 * First `freeStrikes` misses cost nothing; each further miss adds the next ladder step (last
 * repeats). `ladderPercent` is in percent, e.g. [5, 10, 15].
 */
export function penalty(stake: bigint, missed: number, freeStrikes: number, ladderPercent: number[]): bigint {
  const penalized = Math.max(0, missed - freeStrikes);
  const steps = ladderBps(ladderPercent);
  let bps = 0n;
  for (let i = 0; i < penalized; i++) {
    bps += BigInt(steps[Math.min(i, 2)]);
    if (bps >= BPS) return stake;
  }
  return (stake * bps) / BPS;
}

/** Only proven misses count. */
export const completed = (missed: number, periodCount: number, required: number) => missed <= Math.max(0, periodCount - required);

export const forfeit = (stake: bigint, done: boolean, pen: bigint) => (done ? (pen < stake ? pen : stake) : stake);

/** Joining fee, paid on top of the stake. */
export const joinFee = (stake: bigint, joinFeeBps: number) => (stake * BigInt(joinFeeBps)) / BPS;

/**
 * The platform keeps `feeBps` of forfeited stakes and penalties (60% by default); finishers split
 * the rest plus all sponsor money equally. A finisher's own stake, less penalties, is never charged.
 */
export function distribute(sponsorPool: bigint, forfeited: bigint, finishers: number, feeBps: number, toFinishers: boolean) {
  const fee = (forfeited * BigInt(feeBps)) / BPS;
  const net = forfeited - fee;
  if (finishers === 0) return { rewardPerFinisher: 0n, treasury: forfeited, sponsorsReclaim: true };
  const pool = sponsorPool + (toFinishers ? net : 0n);
  const reward = pool / BigInt(finishers);
  const dust = pool - reward * BigInt(finishers);
  return { rewardPerFinisher: reward, treasury: fee + (toFinishers ? 0n : net) + dust, sponsorsReclaim: false };
}

/** Pads the approved ladder (percent) to the program's three basis-point steps. */
export function ladderBps(percent: number[]): [number, number, number] {
  const bps = percent.map((p) => Math.round(p * 100));
  const a = bps[0] ?? 0;
  const b = bps[1] ?? a;
  return [a, b, bps[2] ?? b];
}
