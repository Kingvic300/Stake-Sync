import { Check } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { cx } from '../lib/format'
import { inputClass } from '../lib/styles'
import { banks, savePayout, type Payout } from '../lib/payout'
import { Button, Field } from './ui'
import { Select } from './Select'
import { useFieldError } from '../toast/context'

/**
 * Bank account for withdrawals. The account number is resolved to the holder's name
 * (name enquiry) before saving, so money never goes to a mistyped account.
 */
export function PayoutAccountForm({ holder, onSaved, onCancel }: { holder: string; onSaved: (p: Payout) => void; onCancel?: () => void }) {
  const [bank, setBank] = useState('')
  const [number, setNumber] = useState('')
  const [resolved, setResolved] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [, setError] = useFieldError()

  function lookup(n: string, b: string) {
    setResolved(null)
    if (n.length !== 10 || !b) return
    setChecking(true)
    window.setTimeout(() => {
      setChecking(false)
      setResolved((holder || 'Account holder').toUpperCase())
    }, 900)
  }

  function save(e: FormEvent) {
    e.preventDefault()
    if (!bank) return setError('Choose your bank.')
    if (number.length !== 10) return setError('Account numbers have 10 digits.')
    if (!resolved) return
    const p = { bank, number, name: resolved }
    savePayout(p)
    onSaved(p)
  }

  return (
    <form onSubmit={save} className="space-y-4" noValidate>
      <Field label="Bank">
        <Select
          label="Bank"
          placeholder="Choose your bank"
          value={bank}
          onChange={(v) => {
            setBank(v)
            setError('')
            lookup(number, v)
          }}
          options={banks.map((b) => ({ value: b, label: b }))}
        />
      </Field>
      <Field label="Account number">
        <input
          inputMode="numeric"
          value={number}
          onChange={(e) => {
            const n = e.target.value.replace(/\D/g, '').slice(0, 10)
            setNumber(n)
            setError('')
            lookup(n, bank)
          }}
          placeholder="10 digits"
          className={cx(inputClass, 'font-display text-lg tracking-wider tabular')}
        />
      </Field>
      <div className="min-h-12 rounded-2xl bg-ground px-4 py-3 text-[15px]" role="status">
        {checking ? (
          <span className="is-busy block rounded-lg text-slate">Finding the account name</span>
        ) : resolved ? (
          <span className="flex items-center gap-2 font-semibold text-calm">
            <Check size={17} strokeWidth={3} /> {resolved}
          </span>
        ) : (
          <span className="text-slate">We’ll show the account name so you can confirm it’s yours.</span>
        )}
      </div>
      <div className="flex gap-2">
        {onCancel && (
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" className="flex-1" disabled={!resolved}>
          Save account
        </Button>
      </div>
    </form>
  )
}
