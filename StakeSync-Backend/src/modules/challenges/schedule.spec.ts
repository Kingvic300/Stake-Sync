import { currentPeriod, endedPeriods, localDate, settleAfter, zonedMidnight } from './schedule.js';

describe('challenge schedule', () => {
  it('finds midnight in the challenge timezone', () => {
    expect(zonedMidnight('2026-10-19', 'Africa/Lagos').toISOString()).toBe('2026-10-18T23:00:00.000Z');
    expect(zonedMidnight('2026-10-19', 'UTC').toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(zonedMidnight('2026-07-01', 'America/New_York').toISOString()).toBe('2026-07-01T04:00:00.000Z');
  });

  it('indexes periods and settlement time', () => {
    const c = { startsAt: new Date('2026-10-01T00:00:00Z'), periodSecs: 86_400, periodCount: 7, disputeWindowSecs: 172_800 };
    expect(currentPeriod(c, new Date('2026-09-30T12:00:00Z'))).toBeNull();
    expect(currentPeriod(c, new Date('2026-10-03T12:00:00Z'))).toBe(2);
    expect(endedPeriods(c, new Date('2026-10-03T12:00:00Z'))).toBe(2);
    expect(endedPeriods(c, new Date('2026-11-01T00:00:00Z'))).toBe(7);
    expect(settleAfter(c).toISOString()).toBe('2026-10-10T00:00:00.000Z');
    expect(localDate(new Date('2026-10-18T23:30:00Z'), 'Africa/Lagos')).toBe('2026-10-19');
  });
});
