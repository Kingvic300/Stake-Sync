import type { Challenge } from './entities/challenge.entities.js';

type Sched = Pick<Challenge, 'startsAt' | 'periodSecs' | 'periodCount' | 'disputeWindowSecs'>;

export function periodStart(c: Sched, p: number) {
  return new Date(c.startsAt.getTime() + p * c.periodSecs * 1000);
}

export function periodEnd(c: Sched, p: number) {
  return new Date(c.startsAt.getTime() + (p + 1) * c.periodSecs * 1000);
}

/** Index of the period running now, or null before the start / after the end. */
export function currentPeriod(c: Sched, now = new Date()) {
  const p = Math.floor((now.getTime() - c.startsAt.getTime()) / (c.periodSecs * 1000));
  return p < 0 || p >= c.periodCount ? null : p;
}

/** Number of periods that have fully ended. */
export function endedPeriods(c: Sched, now = new Date()) {
  const n = Math.floor((now.getTime() - c.startsAt.getTime()) / (c.periodSecs * 1000));
  return Math.max(0, Math.min(c.periodCount, n));
}

export function settleAfter(c: Sched) {
  return new Date(c.startsAt.getTime() + c.periodCount * c.periodSecs * 1000 + c.disputeWindowSecs * 1000);
}

/** Midnight of a calendar date (YYYY-MM-DD) in a timezone, as a UTC instant. */
export function zonedMidnight(date: string, timeZone: string) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const offset = (t: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(new Date(t))
        .map((p) => [p.type, p.value]),
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t); // second pass handles DST edges
  return new Date(t);
}

/** Calendar date of an instant in a timezone. */
export function localDate(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
