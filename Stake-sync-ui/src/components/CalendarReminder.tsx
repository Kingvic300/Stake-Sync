import { CalendarPlus, Check } from 'lucide-react'
import { useState } from 'react'
import type { Challenge } from '../data/types'
import { downloadIcs, googleCalendarUrl, planFor } from '../lib/calendar'
import { cx } from '../lib/format'
import { inputClass } from '../lib/styles'
import { Sheet } from './Sheet'
import { Button } from './ui'
import { useToast } from '../toast/context'

const PREF = 'stakesync.reminderTime'
const presets = [
  ['18:00', '6 pm'],
  ['20:00', '8 pm'],
  ['21:00', '9 pm'],
  ['22:00', '10 pm'],
] as const

function savedTime() {
  try {
    return localStorage.getItem(PREF) ?? '21:00'
  } catch {
    return '21:00'
  }
}

function label(time: string) {
  const [h, m] = time.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
}

function hoursBeforeClose(time: string) {
  const [h, m] = time.split(':').map(Number)
  const mins = 23 * 60 + 59 - (h * 60 + m)
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m ` : ''}before the day closes` : `${mins} minutes before the day closes`
}

/** Adds a daily reminder before each day's deadline to the person's own calendar app. */
export function CalendarReminderSheet({ challenges, onClose }: { challenges: Challenge[]; onClose: () => void }) {
  const [time, setTime] = useState(savedTime)
  const [added, setAdded] = useState<'file' | 'google' | null>(null)
  const toast = useToast()
  const plans = challenges.filter((c) => c.status !== 'ended').map(planFor)
  const single = plans.length === 1 ? plans[0] : null
  const late = time > '23:30'

  function remember() {
    try {
      localStorage.setItem(PREF, time)
    } catch {
      // preference just isn't remembered
    }
  }

  const from = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <Sheet
      title="Add reminders to your calendar"
      onClose={onClose}
      width={480}
      footer={
        <div className="space-y-2">
          <Button
            className="w-full"
            disabled={late || !plans.length}
            onClick={() => {
              remember()
              downloadIcs(plans, time)
              toast({ title: 'Calendar file ready', body: 'Open it and tap Add to save your reminders.' })
              setAdded('file')
            }}
          >
            {added === 'file' ? <Check size={18} strokeWidth={3} /> : <CalendarPlus size={18} />}
            {added === 'file' ? 'Calendar file downloaded' : 'Add to my phone’s calendar'}
          </Button>
          {single && (
            <Button
              variant="secondary"
              className="w-full"
              disabled={late}
              href={late ? undefined : googleCalendarUrl(single, time)}
              onClick={() => {
                remember()
                setAdded('google')
              }}
            >
              Add to Google Calendar
            </Button>
          )}
        </div>
      }
    >
      <p className="text-[15px] text-slate">
        Get a calendar alert every day before the deadline, so you never lose a strike to forgetting. It works with your
        phone’s calendar, Google, Outlook and Apple Calendar.
      </p>

      <fieldset className="mt-6">
        <legend className="text-sm font-semibold">Remind me at</legend>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {presets.map(([v, l]) => (
            <button
              key={v}
              type="button"
              aria-pressed={time === v}
              onClick={() => setTime(v)}
              className={cx(
                'h-10 rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition-colors',
                time === v ? 'bg-ink text-white ring-ink' : 'bg-surface ring-line hover:ring-slate/40',
              )}
            >
              {l}
            </button>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Custom time</span>
            <input type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} className={cx(inputClass, 'h-10 w-32 py-0')} />
          </label>
        </div>
        <p className={cx('mt-2 text-sm', late ? 'text-miss' : 'text-slate')}>
          {late ? 'Pick a time before 11:30 pm so you still have time to finish.' : `${label(time)}, ${hoursBeforeClose(time)}.`}
        </p>
      </fieldset>

      <ul className="mt-6 divide-y divide-line rounded-2xl bg-ground px-4">
        {plans.map((p) => (
          <li key={p.challenge.id} className="flex items-center justify-between gap-4 py-3 text-[15px]">
            <span className="min-w-0 truncate font-semibold">{p.challenge.title}</span>
            <span className="shrink-0 text-sm text-slate">
              {p.count} {p.count === 1 ? 'day' : 'days'} from {from(p.from)}
            </span>
          </li>
        ))}
      </ul>

      {added && (
        <p role="status" className="mt-4 rounded-2xl bg-calm-soft p-4 text-[15px] text-calm">
          {added === 'file'
            ? 'Open the downloaded file and tap Add. On iPhone it opens straight in Calendar.'
            : 'Google Calendar opened in a new tab. Save the event there to finish.'}
        </p>
      )}
    </Sheet>
  )
}
