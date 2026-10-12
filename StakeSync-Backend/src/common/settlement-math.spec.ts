import { completed, distribute, forfeit, joinFee, ladderBps, penalty } from './settlement-math.js';

const USDC = 1_000_000n;
const LADDER = [5, 10, 15];

// Same cases as programs/stake_sync/src/math.rs, so the backend and the program agree.
describe('settlement math (parity with the escrow program)', () => {
  it('free strikes absorb the first misses, then the ladder applies', () => {
    expect(penalty(20n * USDC, 3, 3, LADDER)).toBe(0n);
    expect(penalty(20n * USDC, 4, 3, LADDER)).toBe(1n * USDC);
    expect(penalty(20n * USDC, 5, 3, LADDER)).toBe(3n * USDC);
    expect(penalty(20n * USDC, 6, 3, LADDER)).toBe(6n * USDC);
    expect(penalty(20n * USDC, 7, 3, LADDER)).toBe(9n * USDC);
  });

  it('never takes more than the stake', () => {
    expect(penalty(20n * USDC, 100, 0, [50, 50, 50])).toBe(20n * USDC);
    expect(penalty(0n, 10, 0, LADDER)).toBe(0n);
  });

  it('only proven misses count toward completion', () => {
    expect(completed(5, 30, 25)).toBe(true);
    expect(completed(6, 30, 25)).toBe(false);
  });

  it('forfeits the penalty for finishers and the stake otherwise', () => {
    expect(forfeit(20n, true, 3n)).toBe(3n);
    expect(forfeit(20n, false, 0n)).toBe(20n);
  });

  it('matches the program test suite full lifecycle', () => {
    const d = distribute(900n * USDC, 21n * USDC, 2, 500, true);
    expect(d.treasury + d.rewardPerFinisher * 2n).toBe(921n * USDC);
    expect(d.rewardPerFinisher).toBe((900n * USDC + 21n * USDC - 1_050_000n) / 2n);
  });

  it('conserves funds with rounding dust going to the treasury', () => {
    for (const [pool, forfeited, finishers, fee, share] of [
      [1000n, 7n, 3, 500, true],
      [999_999n, 123_457n, 7, 1000, false],
      [0n, 50n, 1, 0, true],
    ] as const) {
      const d = distribute(pool, forfeited, finishers, fee, share);
      expect(d.rewardPerFinisher * BigInt(finishers) + d.treasury).toBe(pool + forfeited);
    }
  });

  it('lets sponsors reclaim when nobody finishes', () => {
    expect(distribute(500n, 40n, 0, 6000, true)).toEqual({ rewardPerFinisher: 0n, treasury: 40n, sponsorsReclaim: true });
  });

  it('charges 2% to join; platform keeps 60% of forfeits, finishers split 40% plus all sponsor money', () => {
    expect(joinFee(20n * USDC, 200)).toBe(400_000n);
    // 100 sponsored, one loser forfeits 20, two finishers: platform 12, finishers 8 + 100 = 54 each.
    const d = distribute(100n * USDC, 20n * USDC, 2, 6000, true);
    expect(d.treasury).toBe(12n * USDC);
    expect(d.rewardPerFinisher).toBe(54n * USDC);
  });

  it('pads approved ladders to three basis-point steps', () => {
    expect(ladderBps([5, 10, 15])).toEqual([500, 1000, 1500]);
    expect(ladderBps([10, 15])).toEqual([1000, 1500, 1500]);
    expect(ladderBps([])).toEqual([0, 0, 0]);
  });
});
