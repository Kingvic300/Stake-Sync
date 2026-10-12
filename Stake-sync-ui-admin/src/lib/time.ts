
const now = () => Date.now()

export function timeAgo(iso: string) {
  const t = new Date(iso).getTime()
  const base = Date.now()
  const mins = Math.max(0, Math.round((base - t) / 60000))
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / 1440)}d ago`
}

/** "in 2h", "in 1d", or "overdue 3h" for SLA deadlines. */
export function untilLabel(iso: string) {
  const mins = Math.round((new Date(iso).getTime() - new Date().getTime()) / 60000)
  const fmt = (m: number) => (m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`)
  return mins >= 0 ? `in ${fmt(mins)}` : `overdue ${fmt(-mins)}`
}

export function isOverdue(iso: string) {
  return new Date(iso).getTime() < new Date().getTime()
}

export function stamp(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export { now as clockNow }
