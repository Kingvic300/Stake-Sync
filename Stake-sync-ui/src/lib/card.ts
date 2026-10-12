export type CardBrand = 'Visa' | 'Mastercard' | 'Verve' | null

/** Brand from the leading digits. Verve (Nigeria) ranges checked before Mastercard. */
export function cardBrand(num: string): CardBrand {
  const n = num.replace(/\D/g, '')
  if (/^(506(0|1)|507[89]|6500)/.test(n)) return 'Verve'
  if (/^4/.test(n)) return 'Visa'
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return 'Mastercard'
  return null
}

export function formatCard(num: string) {
  return num
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(.{4})/g, '$1 ')
    .trim()
}

/** Luhn checksum: catches most mistyped card numbers before they reach the partner. */
export function luhn(num: string) {
  const d = num.replace(/\D/g, '')
  if (d.length < 13) return false
  let sum = 0
  for (let i = 0; i < d.length; i++) {
    let x = Number(d[d.length - 1 - i])
    if (i % 2 === 1) {
      x *= 2
      if (x > 9) x -= 9
    }
    sum += x
  }
  return sum % 10 === 0
}

export function formatExpiry(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 4)
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}

export function expiryValid(v: string, now = new Date()) {
  const m = /^(\d{2})\/(\d{2})$/.exec(v)
  if (!m) return false
  const month = Number(m[1])
  const year = 2000 + Number(m[2])
  if (month < 1 || month > 12) return false
  const end = new Date(year, month, 1)
  return end > now
}
