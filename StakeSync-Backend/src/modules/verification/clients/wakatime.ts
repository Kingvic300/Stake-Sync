import { fetchJson } from '../../../common/http.js';

// WakaTime's free plan includes API access to recent coding activity, enough for daily checks.

/** Seconds of tracked coding per day (YYYY-MM-DD, in the person's WakaTime timezone). */
export async function wakatimeDailySeconds(token: string, start: string, end: string) {
  const res = await fetchJson<{ data: { grand_total: { total_seconds: number }; range: { date: string } }[] }>(
    `https://wakatime.com/api/v1/users/current/summaries?${new URLSearchParams({ start, end })}`,
    { headers: { Authorization: `Bearer ${token}` }, provider: 'wakatime' },
  );
  return new Map(res.data.map((d) => [d.range.date, d.grand_total.total_seconds]));
}
