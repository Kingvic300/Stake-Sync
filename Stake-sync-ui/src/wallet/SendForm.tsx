import { useState, type ReactNode } from 'react'
import { Button, Field } from '../components/ui'
import { ApiError } from '../lib/api'
import { cx } from '../lib/format'
import { inputClass } from '../lib/styles'
import { useFieldError, useToast } from '../toast/context'
import { sendUsdc, type SignBytes } from './sendUsdc'

const looksLikeAddress = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)

/**
 * Address field and send button, shared by connected and embedded wallets. `sign` is the person's
 * wallet; until it's ready, `blocked` explains what to do instead of the button.
 */
export function SendForm({
  amount,
  amountOk,
  sign,
  blocked,
  onSent,
}: {
  amount: number
  amountOk: boolean
  sign: SignBytes | null
  blocked?: ReactNode
  onSent: (to: string) => void
}) {
  const toast = useToast()
  const [to, setTo] = useState('')
  const [addressError, setAddressError] = useState(false)
  const [, setError] = useFieldError()
  const [busy, setBusy] = useState(false)

  async function send() {
    const address = to.trim()
    if (!looksLikeAddress(address)) {
      setAddressError(true)
      return setError('Enter a Solana wallet address. It’s 32 to 44 letters and numbers.')
    }
    if (!sign) return
    setAddressError(false)
    setBusy(true)
    try {
      const r = await sendUsdc(address, amount, sign)
      if (r.status === 'pending') toast({ tone: 'info', title: 'Transfer sent', body: 'The network is still confirming it. It shows in your history once it lands.' })
      onSent(address)
    } catch (err) {
      const declined = /reject|declin|cancel/i.test(String(err))
      toast({
        tone: 'error',
        title: declined ? 'Transfer cancelled' : 'Couldn’t send',
        body: err instanceof ApiError ? err.message : declined ? 'You declined it in your wallet, so nothing was sent.' : 'Nothing was sent. Please try again.',
        inbox: false,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Wallet address to send to" hint="Only send to a Solana wallet that accepts USDC. Transfers can’t be reversed.">
        <input
          value={to}
          onChange={(e) => {
            setTo(e.target.value)
            setAddressError(false)
          }}
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. 7Kp2…Y6aB"
          aria-invalid={addressError}
          className={cx(inputClass, 'font-mono text-[14px]', addressError && 'ring-miss')}
        />
      </Field>
      {blocked ?? (
        <Button className="w-full" onClick={() => void send()} disabled={!amountOk || !to.trim() || !sign} busy={busy}>
          {busy ? 'Waiting for your wallet' : `Send ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`}
        </Button>
      )}
    </div>
  )
}
