import { completed, distribute, forfeit, penalty } from './settlement-math.js';

// The rules Stake-Sync locks in (30-day challenge, 25 days required, "Gentle" structure):
//   misses 1–3 free · 4th −5% · 5th −10% more (−15% total) · 6th or more: full forfeit
//   everyone who completes shares the reward pool equally, penalties or not.
const USDC = 1_000_000n;
const STAKE = 20n * USDC;
const DAYS = 30;
const REQUIRED = 25;
const FREE = 3;
const LADDER = [5, 10, 15];

function outcome(missed: number) {
  const done = completed(missed, DAYS, REQUIRED);
  const pen = done ? penalty(STAKE, missed, FREE, LADDER) : 0n;
  return { done, lost: forfeit(STAKE, done, pen) };
}

describe('locked strike rules', () => {
  it('first three misses are free', () => {
    for (const m of [0, 1, 2, 3]) expect(outcome(m)).toEqual({ done: true, lost: 0n });
  });

  it('4th miss costs 5%, 5th costs 10% more (15% total)', () => {
    expect(outcome(4)).toEqual({ done: true, lost: 1n * USDC });
    expect(outcome(5)).toEqual({ done: true, lost: 3n * USDC });
  });

  it('6th miss or more forfeits the whole stake', () => {
    for (const m of [6, 7, 30]) expect(outcome(m)).toEqual({ done: false, lost: STAKE });
  });

  it('everyone who completes shares the pool equally, including people with penalties', () => {
    // Three people: clean (0 misses), penalised (5 misses), failed (6 misses). 900 USDC sponsored;
    // Stake-Sync keeps 60% of forfeits, finishers split 40% plus all sponsor money.
    const people = [0, 5, 6].map(outcome);
    const finishers = people.filter((p) => p.done).length;
    const forfeited = people.reduce((s, p) => s + p.lost, 0n);
    const d = distribute(900n * USDC, forfeited, finishers, 6000, true);
    // Forfeited 23 (3 penalty + 20 stake): platform 13.8, finishers share 9.2 + 900.
    expect(d.treasury).toBe(13_800_000n);
    expect(d.rewardPerFinisher).toBe(454_600_000n);
    expect(finishers).toBe(2);
    const clean = STAKE + d.rewardPerFinisher;
    const penalised = STAKE - 3n * USDC + d.rewardPerFinisher;
    expect(clean - penalised).toBe(3n * USDC); // same reward share; only the penalty differs
    // Every unit is accounted for: payouts + treasury = stakes + sponsor pool.
    expect(clean + penalised + d.treasury).toBe(3n * STAKE + 900n * USDC);
  });
});
