export function usd(n: number, opts: { cents?: boolean } = {}) {
  const cents = opts.cents ?? !Number.isInteger(n)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(n)
}

/** Money for tight spaces: exact up to $100,000, then $1.2M / $3.4B style. */
export function usdShort(n: number) {
  if (Math.abs(n) < 100_000) return usd(n, { cents: true })
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(n)
}

export function compact(n: number) {
  return new Intl.NumberFormat('en-US', { notation: 'compact' }).format(n)
}

export function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function daysUntil(iso: string, from = new Date()) {
  return Math.ceil((new Date(iso).getTime() - from.getTime()) / 86_400_000)
}

export function relative(iso: string) {
  const d = daysUntil(iso)
  if (d <= 0) return 'today'
  if (d === 1) return 'tomorrow'
  return `in ${d} days`
}

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}
