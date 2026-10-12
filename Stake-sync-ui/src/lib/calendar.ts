import type { Challenge } from '../data/types'

export interface ReminderPlan {
  challenge: Challenge
  /** First day to remind, YYYY-MM-DD */
  from: string
  /** Number of daily reminders */
  count: number
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`

/** Remaining days of a challenge from today. */
export function planFor(c: Challenge): ReminderPlan {
  const start = new Date(`${c.startsAt}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const first = start > today ? start : today
  const end = new Date(start)
  end.setDate(end.getDate() + c.durationDays - 1)
  const count = Math.max(1, Math.round((end.getTime() - first.getTime()) / 86_400_000) + 1)
  const local = `${first.getFullYear()}-${pad(first.getMonth() + 1)}-${pad(first.getDate())}`
  return { challenge: c, from: local, count }
}

function escape(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function description(c: Challenge, url: string) {
  return `Today's requirement: ${c.requirement}.\nThe day closes at 11:59 pm.\n\nOpen your progress: ${url}`
}

/**
 * A repeating daily event at `time` (HH:MM, floating local time so each device uses its own zone),
 * with an alert when it starts. One VEVENT per challenge.
 */
export function buildIcs(plans: ReminderPlan[], time: string, origin: string) {
  const [h, m] = time.split(':').map(Number)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const events = plans.map(({ challenge: c, from, count }) => {
    const day = from.replace(/-/g, '')
    const startT = `${pad(h)}${pad(m)}00`
    const endMin = h * 60 + m + 15
    const endT = `${pad(Math.floor(endMin / 60) % 24)}${pad(endMin % 60)}00`
    const url = `${origin}/c/${c.id}`
    return [
      'BEGIN:VEVENT',
      `UID:${c.id}-${day}@stakesync.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${day}T${startT}`,
      `DTEND:${day}T${endT}`,
      `RRULE:FREQ=DAILY;COUNT=${count}`,
      `SUMMARY:${escape(`Stake-Sync: ${c.title}`)}`,
      `DESCRIPTION:${escape(description(c, url))}`,
      `URL:${url}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escape(`Have you done today's ${c.title}?`)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n')
  })
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stake-Sync//Reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events, 'END:VCALENDAR'].join('\r\n')
}

export function downloadIcs(plans: ReminderPlan[], time: string) {
  const ics = buildIcs(plans, time, window.location.origin)
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = plans.length === 1 ? `${plans[0].challenge.id}-reminders.ics` : 'stake-sync-reminders.ics'
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function googleCalendarUrl(plan: ReminderPlan, time: string) {
  const c = plan.challenge
  const [h, m] = time.split(':').map(Number)
  const start = new Date(`${plan.from}T00:00:00`)
  start.setHours(h, m)
  const end = new Date(start.getTime() + 15 * 60_000)
  const t = (d: Date) => `${ymd(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Stake-Sync: ${c.title}`,
    dates: `${t(start)}/${t(end)}`,
    details: description(c, `${window.location.origin}/c/${c.id}`),
    recur: `RRULE:FREQ=DAILY;COUNT=${plan.count}`,
    ctz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  return `https://calendar.google.com/calendar/render?${params}`
}
