import { Check, Smartphone } from 'lucide-react'
import { useState } from 'react'
import type { Challenge } from '../data/types'
import { api, ApiError } from '../lib/api'
import { useToast } from '../toast/context'
import { cx } from '../lib/format'
import { inputClass } from '../lib/styles'
import { ImageDrop, type EvidenceImage } from './ImageDrop'
import { Sheet } from './Sheet'
import { Button, ProviderMark } from './ui'

/** Daily photo proof for challenges without an integration. Reviewed before it counts. */
export function PhotoProofSheet({ c, onClose, onSubmitted }: { c: Challenge; onClose: () => void; onSubmitted: () => void }) {
  const [images, setImages] = useState<EvidenceImage[]>([])
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  async function submit() {
    setBusy(true)
    const form = new FormData()
    form.append('challengeId', c.id)
    form.append('file', images[0].file)
    if (note.trim()) form.append('note', note.trim())
    try {
      await api('/verification/proofs/photo', { method: 'POST', body: form })
      setSent(true)
      onSubmitted()
    } catch (err) {
      toast({ tone: 'error', title: 'Proof not sent', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      title={sent ? 'Sent for review' : 'Submit today’s proof'}
      onClose={() => {
        if (!sent) images.forEach((i) => URL.revokeObjectURL(i.url))
        onClose()
      }}
      footer={
        sent ? (
          <Button className="w-full" onClick={onClose}>
            Done
          </Button>
        ) : (
          <Button
            className="w-full"
            disabled={!images.length}
            busy={busy}
            onClick={() => void submit()}
          >
            Submit for review
          </Button>
        )
      }
    >
      {sent ? (
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-calm text-white">
            <Check size={20} strokeWidth={3} />
          </span>
          <p className="text-[15px] text-slate">
            Today is marked <span className="font-semibold text-ink">checking</span>. Reviews usually finish within a few hours, and
            a pending review never counts as a miss.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-[15px] text-slate">{c.requirement}. Take the photo today; older photos and edited images are rejected.</p>
          <ImageDrop value={images} onChange={setImages} max={1} label="Photo" hint="PNG, JPG or WebP. Taken today." />
          <label className="block">
            <span className="text-sm font-semibold">Note for reviewers</span>
            <span className="mt-0.5 block text-sm text-slate">Optional</span>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Finished chapter 6, page 142" className={cx(inputClass, 'mt-2 resize-none')} />
          </label>
        </div>
      )}
    </Sheet>
  )
}

/** Phone health data needs the native app: HealthKit and Health Connect have no web API. */
export function HealthAppSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Sync steps from your phone" onClose={onClose} width={480}>
      <div className="flex items-start gap-3 rounded-2xl bg-ground p-4">
        <ProviderMark provider="Health" size={22} />
        <p className="text-[15px]">
          Steps and distance come from <span className="font-semibold">Apple Health</span> on iPhone or{' '}
          <span className="font-semibold">Health Connect</span> on Android. Phones only share this data with installed apps, so it
          syncs through the Stake-Sync mobile app.
        </p>
      </div>
      <ol className="mt-5 space-y-3 text-[15px]">
        {['Install the Stake-Sync app and log in with this account', 'Allow it to read steps and walking distance', 'Your daily total syncs automatically every evening'].map(
          (t, i) => (
            <li key={t} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-cobalt-soft text-xs font-bold text-cobalt-deep tabular">{i + 1}</span>
              {t}
            </li>
          ),
        )}
      </ol>
      <div className="mt-6 grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled>
          <Smartphone size={16} /> App Store
        </Button>
        <Button variant="secondary" disabled>
          <Smartphone size={16} /> Google Play
        </Button>
      </div>
      <p className="mt-3 text-center text-sm text-slate">The mobile app is coming soon. We’ll email you when it’s ready.</p>
    </Sheet>
  )
}
