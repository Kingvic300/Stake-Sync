import { Megaphone } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { ReasonSheet } from '../components/ReasonSheet'
import { Sheet } from '../components/Sheet'
import { Strikes } from '../components/DayGrid'
import { Button, Field, PageHeader } from '../components/ui'
import { apiEnabled } from '../lib/api'
import { api } from '../lib/api'
import { cx } from '../lib/format'
import { inputClass } from '../lib/styles'
import { useAdminApi } from '../lib/useAdminApi'
import { useToast } from '../toast/context'

interface PenaltyStructure {
  key: string
  name: string
  freeStrikes: number
  penalties: [number, number, number]
  note: string
}

interface Limits {
  maxStakeUsd: number
  maxSponsorUsd: number
  maxParticipants: number
  maxDurationDays: number
}

interface SettingsData {
  structures: PenaltyStructure[]
  fees: { joinBps: number; forfeitBps: number }
  banner: string | null
  limits: Limits
}

export function Settings() {
  const toast = useToast()
  const { data, refresh } = useAdminApi<SettingsData>('/admin/settings')
  const [limits, setLimits] = useState<Limits>({ maxStakeUsd: 0, maxSponsorUsd: 0, maxParticipants: 0, maxDurationDays: 0 })
  const [banner, setBanner] = useState('')
  const [live, setLive] = useState<string | null>(null)
  const [editing, setEditing] = useState<PenaltyStructure | null>(null)
  const [saveLimits, setSaveLimits] = useState(false)

  useEffect(() => {
    if (!data) return
    setLimits(data.limits)
    setLive(data.banner)
  }, [data])

  async function publishBanner(text: string | null) {
    try {
      await api('/admin/settings/banner', { method: 'PUT', body: { text } })
      setLive(text)
      setBanner('')
      refresh()
      toast({ title: text ? 'Banner is live' : 'Banner removed', body: text ? 'Everyone sees it at the top of the app.' : undefined })
    } catch (e) {
      toast({ tone: 'error', title: 'Couldn’t update banner', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  async function updateLimits(reason: string) {
    try {
      await api('/admin/settings/limits', { method: 'PUT', body: { limits, reason } })
      refresh()
      toast({ title: 'Platform limits saved' })
    } catch (e) {
      toast({ tone: 'error', title: 'Couldn’t save platform limits', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  async function proposeStructure(next: PenaltyStructure, reason: string) {
    if (!data) return
    try {
      const structures = data.structures.map((s) => s.key === next.key ? next : s)
      await api('/admin/settings/structures', { method: 'POST', body: { structures, reason } })
      toast({ tone: 'info', title: 'Change sent for approval', body: 'A second admin must approve the penalty rule change.' })
      setEditing(null)
    } catch (e) {
      toast({ tone: 'error', title: 'Couldn’t propose penalty structure', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  const setLimit = (key: keyof Limits, value: string) => setLimits((current) => ({ ...current, [key]: Number(value.replace(/\D/g, '')) || 0 }))

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16">
      <PageHeader title="Settings" intro="Platform rules that apply to every challenge. Changes are logged, and changes to money rules need a second admin." />

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-7">
          <h2 className="text-xl font-bold">Approved penalty structures</h2>
          <p className="mt-1 text-[15px] text-slate">Creators can only pick from these. Existing challenges keep the structure they started with.</p>
          <ul className="mt-5 divide-y divide-line">
            {(data?.structures ?? []).map((s) => (
              <li key={s.key} className="flex flex-wrap items-center gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 font-semibold">
                    {s.name}
                    <Strikes total={s.freeStrikes} used={0} size={14} />
                  </div>
                  <div className="text-sm text-slate">{s.freeStrikes} free, then {s.penalties.join('%, ')}% of the stake. {s.note}</div>
                </div>
                <Button size="sm" variant="secondary" disabled={!apiEnabled} onClick={() => setEditing(s)}>
                  Propose change
                </Button>
              </li>
            ))}
            {data && data.structures.length === 0 && <li className="py-4 text-sm text-slate">No penalty structures configured.</li>}
          </ul>
        </section>

        <section className="rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-7">
          <h2 className="text-xl font-bold">Platform limits</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Maximum stake" hint="USDC per participant">
              <input inputMode="numeric" value={limits.maxStakeUsd || ''} onChange={(e) => setLimit('maxStakeUsd', e.target.value)} className={inputClass} />
            </Field>
            <Field label="Maximum sponsor pool" hint="USDC per challenge">
              <input inputMode="numeric" value={limits.maxSponsorUsd || ''} onChange={(e) => setLimit('maxSponsorUsd', e.target.value)} className={inputClass} />
            </Field>
            <Field label="Maximum participants">
              <input inputMode="numeric" value={limits.maxParticipants || ''} onChange={(e) => setLimit('maxParticipants', e.target.value)} className={inputClass} />
            </Field>
            <Field label="Maximum duration" hint="Days">
              <input inputMode="numeric" value={limits.maxDurationDays || ''} onChange={(e) => setLimit('maxDurationDays', e.target.value)} className={inputClass} />
            </Field>
          </div>
          {data && <p className="mt-4 text-sm text-slate">Join fee {data.fees.joinBps / 100}%. Platform share of forfeits {data.fees.forfeitBps / 100}%.</p>}
          <Button className="mt-5" disabled={!data} onClick={() => setSaveLimits(true)}>Save limits</Button>
        </section>

        <section className="rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-7 xl:col-span-2">
          <h2 className="flex items-center gap-2 text-xl font-bold"><Megaphone size={20} /> Incident banner</h2>
          <p className="mt-1 text-[15px] text-slate">Shows at the top of the member app for everyone. Use it for outages and anything that affects money.</p>
          {live && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gold-soft px-4 py-3 text-[15px] text-gold-ink">
              <span><span className="font-semibold">Live now:</span> {live}</span>
              <button type="button" className="font-semibold underline" onClick={() => void publishBanner(null)}>Remove</button>
            </div>
          )}
          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
            <Field label="Message">
              <input value={banner} onChange={(e) => setBanner(e.target.value)} maxLength={240} placeholder="Solana is slow right now. Results are pending and nobody will be penalised." className={inputClass} />
            </Field>
            <Button disabled={!apiEnabled || banner.trim().length < 10} onClick={() => void publishBanner(banner.trim())}>Publish banner</Button>
          </div>
        </section>
      </div>

      {saveLimits && <ReasonSheet title="Save platform limits?" confirm="Save limits" effect="New limits apply to challenges created from now on. The reason is recorded in the audit log." onConfirm={(reason) => void updateLimits(reason)} onClose={() => setSaveLimits(false)} />}
      {editing && <StructureEditor structure={editing} onClose={() => setEditing(null)} onSave={proposeStructure} />}
    </div>
  )
}

function StructureEditor({ structure, onClose, onSave }: { structure: PenaltyStructure; onClose: () => void; onSave: (structure: PenaltyStructure, reason: string) => Promise<void> }) {
  const [freeStrikes, setFreeStrikes] = useState(String(structure.freeStrikes))
  const [penalties, setPenalties] = useState(structure.penalties.join(', '))
  const [note, setNote] = useState(structure.note)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const values = penalties.split(',').map((x) => Number(x.trim()))
  const valid = values.length === 3 && values.every((x) => Number.isInteger(x) && x >= 0 && x <= 50) && Number(freeStrikes) >= 0 && Number(freeStrikes) <= 10 && reason.trim().length >= 8
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    await onSave({ ...structure, freeStrikes: Number(freeStrikes), penalties: values as [number, number, number], note }, reason.trim())
    setBusy(false)
  }
  return (
    <Sheet title={`Propose ${structure.name} structure`} onClose={onClose} footer={<Button type="submit" form="structure-form" className="w-full" disabled={!valid} busy={busy}>Send for approval</Button>}>
      <form id="structure-form" onSubmit={submit} className="space-y-4">
        <Field label="Free strikes"><input inputMode="numeric" value={freeStrikes} onChange={(e) => setFreeStrikes(e.target.value.replace(/\D/g, ''))} className={inputClass} /></Field>
        <Field label="Penalty percentages" hint="Three values, separated by commas; last value repeats."><input value={penalties} onChange={(e) => setPenalties(e.target.value)} className={inputClass} /></Field>
        <Field label="Description"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} className={inputClass} /></Field>
        <Field label="Reason" hint="Recorded in the audit log."><textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className={cx(inputClass, 'resize-y')} /></Field>
      </form>
    </Sheet>
  )
}
