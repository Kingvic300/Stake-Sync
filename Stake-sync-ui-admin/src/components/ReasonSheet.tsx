import { KeyRound } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cx } from '../lib/format'
import { inputClass } from '../lib/styles'
import { Sheet } from './Sheet'
import { Button } from './ui'

/**
 * Confirms an admin decision. A reason is always required (it goes to the audit log and,
 * where relevant, to the user). Four-eyes actions say so and are sent for a second approval.
 */
export function ReasonSheet({
  title,
  effect,
  confirm,
  tone = 'primary',
  fourEyes,
  presets = [],
  onConfirm,
  onClose,
}: {
  title: string
  effect: ReactNode
  confirm: string
  tone?: 'primary' | 'danger'
  fourEyes?: boolean
  presets?: string[]
  onConfirm: (reason: string) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const ok = reason.trim().length >= 8

  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className={cx('flex-1', tone === 'danger' && 'bg-miss hover:bg-miss/90')}
            disabled={!ok}
            onClick={() => {
              onConfirm(reason.trim())
              onClose()
            }}
          >
            {fourEyes ? 'Send for approval' : confirm}
          </Button>
        </div>
      }
    >
      <div className="text-[15px] text-slate">{effect}</div>
      {fourEyes && (
        <p className="mt-4 flex items-start gap-2.5 rounded-2xl bg-gold-soft p-4 text-[15px] text-gold-ink">
          <KeyRound size={18} className="mt-0.5 shrink-0" />
          This needs a second admin. It takes effect once someone else approves it.
        </p>
      )}
      {presets.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setReason(p)}
              className={cx('rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset', reason === p ? 'bg-ink text-white ring-ink' : 'ring-line hover:ring-slate/40')}
            >
              {p}
            </button>
          ))}
        </div>
      )}
      <label className="mt-5 block">
        <span className="text-sm font-semibold">Reason</span>
        <span className="mt-0.5 block text-sm text-slate">Recorded in the audit log. At least 8 characters.</span>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={cx(inputClass, 'mt-2 resize-y')} />
      </label>
    </Sheet>
  )
}
