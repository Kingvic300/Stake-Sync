// Saved withdrawal account. Placeholder storage until the payments API exists.
export interface Payout {
  bank: string
  number: string
  name: string
}

const KEY = 'stakesync.payout'
// Placeholder list; the payment partner's bank list endpoint supplies this in production.
export const banks = ['Access Bank', 'Fidelity Bank', 'First Bank', 'GTBank', 'Kuda', 'Moniepoint', 'OPay', 'Palmpay', 'Stanbic IBTC', 'UBA', 'Wema Bank', 'Zenith Bank']

export function loadPayout(): Payout | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Payout) : null
  } catch {
    return null
  }
}

export function savePayout(p: Payout) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // kept for this visit only
  }
}

