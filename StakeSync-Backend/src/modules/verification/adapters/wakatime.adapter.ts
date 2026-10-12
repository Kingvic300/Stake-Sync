import { Injectable } from '@nestjs/common';
import { localDate } from '../../challenges/schedule.js';
import { wakatimeDailySeconds } from '../clients/wakatime.js';
import type { AdapterContext, CountResult, DayResult, VerificationAdapter } from './adapter.js';

/** Tracked coding time. Harder to fake than commit counts, and a good partner to GitHub. */
@Injectable()
export class WakatimeAdapter implements VerificationAdapter {
  readonly key = 'wakatime' as const;

  async day(ctx: AdapterContext): Promise<DayResult> {
    const min = ctx.challenge.verificationConfig.wakatime?.minMinutes ?? 30;
    // Periods are calendar days in the challenge timezone; WakaTime reports days in the person's timezone.
    const date = localDate(ctx.from, ctx.challenge.timezone);
    const days = await wakatimeDailySeconds(ctx.token!, date, date);
    const minutes = Math.round((days.get(date) ?? 0) / 60);
    return minutes >= min
      ? { outcome: 'verified', detail: `${minutes} minutes of tracked coding`, evidence: { date, minutes }, units: minutes }
      : { outcome: 'failed', detail: `${minutes} of ${min} minutes of tracked coding`, evidence: { date, minutes } };
  }

  async count(ctx: AdapterContext): Promise<CountResult> {
    const days = await wakatimeDailySeconds(ctx.token!, localDate(ctx.from, ctx.challenge.timezone), localDate(new Date(ctx.to.getTime() - 1), ctx.challenge.timezone));
    const hours = Math.floor([...days.values()].reduce((s, v) => s + v, 0) / 3600);
    return { total: hours, detail: `${hours} hours of tracked coding` };
  }
}
