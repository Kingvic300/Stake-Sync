import { X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useFieldError } from '../toast/context'
import { useNavigate } from 'react-router'
import { cx } from '../lib/format'
import { inviteTarget } from '../lib/invite'
import { inputBase } from '../lib/styles'
import { Sheet } from './Sheet'
import { Button } from './ui'

/** The code field itself, used in the sheet and on the public /join page. */
export function JoinCodeForm({ autoFocus, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useFieldError()
  const navigate = useNavigate()

  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const to = await inviteTarget(code)
      if (!to) return setError('That code doesn’t match an open challenge or organization. Check it with whoever invited you.')
      onDone?.()
      navigate(to)
    } catch {
      setError('Couldn’t check that code right now. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="invite-code" className="text-sm font-semibold">
        Invite code
      </label>
      <div className="relative mt-2">
        <input
          id="invite-code"
          autoFocus={autoFocus}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase())
            setError('')
          }}
          placeholder="e.g. CODE-30"
          aria-invalid={!!error}
          className={cx(inputBase, 'h-14 pr-11 font-display text-2xl font-semibold tracking-wider uppercase', error && 'ring-miss')}
        />
        {code && (
          <button
            type="button"
            onClick={() => setCode('')}
            aria-label="Clear code"
            className="absolute top-1/2 right-3 -translate-y-1/2 text-slate hover:text-ink"
          >
            <X size={18} />
          </button>
        )}
      </div>
      <Button type="submit" className="mt-5 w-full" disabled={code.trim().length < 3} busy={busy}>
        Continue
      </Button>
    </form>
  )
}

export function JoinCodeSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Join with a code" onClose={onClose} width={440}>
      <p className="mb-5 text-[15px] text-slate">
        Got a code from a friend, your class or your organization? Enter it to see what you’re joining.
      </p>
      <JoinCodeForm autoFocus onDone={onClose} />
    </Sheet>
  )
}
