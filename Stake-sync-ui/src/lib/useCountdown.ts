import { useEffect, useState } from 'react'
const clock = () => Date.now()

/** Time left until `deadline` refreshed every 30 seconds. */
export function useCountdown(deadline: string | null) {
  const [now, setNow] = useState(clock)
  useEffect(() => {
    const id = window.setInterval(() => setNow(clock()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  const ms = deadline ? Math.max(0, new Date(deadline).getTime() - now) : 0
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const d = Math.floor(h / 24)
  if (!deadline) return { ms: 0, label: '', urgent: false }
  return { ms, label: d >= 1 ? `${d} day${d > 1 ? 's' : ''} left` : `${h}h ${m}m left`, urgent: ms < 6 * 3_600_000 }
}
