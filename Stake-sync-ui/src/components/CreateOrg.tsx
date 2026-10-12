import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { api, ApiError } from '../lib/api'
import { refreshMyOrgs } from '../lib/useMyOrgs'
import { cx } from '../lib/format'
import { inputClass } from '../lib/styles'
import { useToast } from '../toast/context'
import { Sheet } from './Sheet'
import { Button, Field } from './ui'

const kinds = ['Community', 'University or school', 'Company or team', 'Brand or sponsor'] as const
const API_KIND = { Community: 'Community', 'University or school': 'University', 'Company or team': 'Company', 'Brand or sponsor': 'Brand' } as const

export function CreateOrgSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<(typeof kinds)[number]>('Community')
  const [about, setAbout] = useState('')
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const ok = name.trim().length >= 3
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    try {
      const org = await api<{ slug: string }>('/orgs', { method: 'POST', body: { name: name.trim(), kind: API_KIND[kind], about: about.trim() || `${kind} on Stake-Sync` } })
      void refreshMyOrgs()
      toast({ title: `${name.trim()} is set up`, body: 'Invite members and launch your first challenge.' })
      onClose()
      navigate(`/org/${org.slug}`)
    } catch (err) {
      toast({ tone: 'error', title: 'Organization not created', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      title="Create an organization"
      onClose={onClose}
      footer={
        <Button type="submit" form="create-org" className="w-full" disabled={!ok} busy={busy}>
          Create organization
        </Button>
      }
    >
      <form id="create-org" onSubmit={submit} className="space-y-5">
        <p className="text-[15px] text-slate">Run challenges for your members, sponsor rewards and see everyone’s progress in one dashboard. You’ll be the owner.</p>
        <Field label="Organization name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lagos Dev Circle" className={inputClass} />
        </Field>
        <fieldset>
          <legend className="text-sm font-semibold">What kind of organization?</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cx('rounded-xl p-3 text-left text-[15px] font-semibold ring-1 ring-inset', kind === k ? 'bg-cobalt-soft ring-2 ring-cobalt' : 'ring-line hover:ring-slate/40')}
              >
                {k}
              </button>
            ))}
          </div>
        </fieldset>
        <Field label="About" hint="Optional. Shown on invites.">
          <textarea rows={2} maxLength={160} value={about} onChange={(e) => setAbout(e.target.value)} className={cx(inputClass, 'resize-none')} />
        </Field>
        {slug && <p className="text-sm text-slate">Your dashboard: /org/{slug}</p>}
      </form>
    </Sheet>
  )
}
