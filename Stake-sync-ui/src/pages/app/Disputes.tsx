import { Check, ChevronRight, CloudOff, FileText, Link2, Lock, Plus, Scale, X } from 'lucide-react'
import { lazy, Suspense, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ImageDrop, type EvidenceImage } from '../../components/ImageDrop'
import { Sheet } from '../../components/Sheet'
import { Button, Field, PageHeader, ProofChip, ProviderMark } from '../../components/ui'
import { useMine } from '../../data/useMine'
import { api, ApiError } from '../../lib/api'
import { useApiData } from '../../lib/useApiData'
import { RetryPanel } from '../../components/RetryPanel'
import { PanelSkeleton } from '../../components/Skeleton'
import { signAndSubmit, type SignBytes } from '../../wallet/sendUsdc'

const SignButton = lazy(() => import('../../wallet/SignButton'))
import type { Dispute, VerificationEvent } from '../../data/types'
import { cx, usd } from '../../lib/format'
import { gsap, prefersMotion, useGSAP } from '../../lib/gsap'
import { inputClass } from '../../lib/styles'
import { useToast } from '../../toast/context'
import { Select } from '../../components/Select'

type Status = Dispute['status']
interface Case extends Dispute {
  evidence: string[]
  images: { name: string; url: string }[]
  /** Challenge title, from the API */
  challenge?: string
}

/** GET /disputes item. Photos are only viewable by moderators, so they're listed, not shown. */
interface ApiDispute extends Omit<Case, 'evidence' | 'images'> {
  evidence: { kind: 'image' | 'link' | 'note'; value: string; at: string }[]
}
const fromApi = (d: ApiDispute): Case => ({
  ...d,
  evidence: d.evidence.filter((e) => e.kind !== 'image').map((e) => e.value),
  images: d.evidence.filter((e) => e.kind === 'image').map((_, i) => ({ name: `Photo ${i + 1}`, url: '' })),
})

const statusStyle: Record<Status, string> = {
  'Under review': 'bg-gold-soft text-gold-ink',
  'Needs evidence': 'bg-miss-soft text-[oklch(45%_0.17_23)]',
  Approved: 'bg-calm-soft text-calm',
  'Failure confirmed': 'bg-tile text-slate',
}

const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function Disputes() {
  const src = useApiData<Case[], ApiDispute[]>('/disputes', (r) => r.map(fromApi))
  const cases = src.data ?? []
  const setCases = (fn: (cs: Case[]) => Case[]) => src.setData((prev) => fn(prev ?? []))
  const [chosen, setSelected] = useState<string | null>(null)
  const selected = chosen ?? cases[0]?.id ?? null
  const [opening, setOpening] = useState(false)
  const detail = useRef<HTMLDivElement>(null)
  const current = cases.find((c) => c.id === selected)
  const open = cases.filter((c) => c.status === 'Under review' || c.status === 'Needs evidence')
  const locked = open.reduce((n, c) => n + c.amountLocked, 0)

  useGSAP(
    () => {
      if (!prefersMotion()) return
      gsap.from('[data-detail] > *', { y: 10, autoAlpha: 0, duration: 0.35, stagger: 0.05, ease: 'power2.out', clearProps: 'all' })
    },
    { scope: detail, dependencies: [selected] },
  )

  function choose(id: string) {
    setSelected(id)
    if (window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => detail.current?.scrollIntoView({ behavior: prefersMotion() ? 'smooth' : 'auto', block: 'start' }))
    }
  }

  function update(id: string, fn: (c: Case) => Case) {
    setCases((cs) => cs.map((c) => (c.id === id ? fn(c) : c)))
  }

  if (!src.data) {
    return (
      <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16 sm:py-10">
        {src.error ? <RetryPanel onRetry={src.refresh} /> : <PanelSkeleton rows={5} />}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16 sm:py-10">
      <PageHeader
        title="Disputes"
        intro="Think a verification result is wrong? Contest it here. Any money it affects stays locked until a moderator decides."
        actions={
          <Button onClick={() => setOpening(true)}>
            <Plus size={18} /> Open a dispute
          </Button>
        }
      />

      <dl className="grid grid-cols-3 overflow-hidden rounded-3xl bg-surface ring-1 ring-line/70">
        {[
          ['Open', String(open.length)],
          ['Money on hold', usd(locked, { cents: true })],
          ['Resolved', String(cases.length - open.length)],
        ].map(([k, v], i) => (
          <div key={k} className={cx('p-5 sm:p-6', i > 0 && 'border-l border-line')}>
            <dt className="text-sm text-slate">{k}</dt>
            <dd className="mt-1 font-display text-2xl font-bold tabular sm:text-3xl">{v}</dd>
          </div>
        ))}
      </dl>

      {cases.length === 0 ? (
        <div className="mt-6 rounded-3xl bg-surface px-6 py-16 text-center ring-1 ring-line/70">
          <Scale className="mx-auto text-slate" size={26} />
          <h2 className="mt-4 text-2xl font-bold">No disputes</h2>
          <p className="mt-1 text-slate">If a day is ever marked wrongly, open a dispute within 48 hours of the result.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[22rem_1fr]">
          <ul className="space-y-2 lg:self-start" aria-label="Your disputes">
            {cases.map((d) => {
              const on = d.id === selected
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    aria-current={on}
                    onClick={() => choose(d.id)}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-2xl p-4 text-left ring-1 ring-inset transition-[background-color,box-shadow]',
                      on ? 'bg-surface shadow-(--shadow-lift) ring-cobalt' : 'bg-surface/60 ring-line hover:bg-surface',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{d.challenge}</span>
                      <span className="block text-sm text-slate">
                        Day {d.day}, opened {new Date(d.opened).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      <span className={cx('mt-2 inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold', statusStyle[d.status])}>{d.status}</span>
                    </span>
                    <ChevronRight size={18} className={on ? 'text-cobalt' : 'text-slate'} />
                  </button>
                </li>
              )
            })}
          </ul>

          <div ref={detail} className="scroll-mt-24">
            {current && <CaseDetail key={current.id} d={current} onUpdate={(fn) => update(current.id, fn)} onSent={src.refresh} />}
          </div>
        </div>
      )}

      <section className="mt-12">
        <h2 className="text-2xl font-bold">How disputes work</h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-3">
          {[
            ['You open it', 'Pick the result, explain what happened and link your evidence. Do it within 48 hours.'],
            ['A moderator reviews', 'They check the verification data and what the provider reported, and may ask for more.'],
            ['They decide', 'The day is approved, or the miss is confirmed. Locked money then follows the challenge rules.'],
          ].map(([t, b], i) => (
            <li key={t} className="rounded-3xl bg-surface p-6 ring-1 ring-line/70">
              <span className="font-display text-3xl font-bold text-slate/40 tabular">{i + 1}</span>
              <h3 className="mt-2 text-lg font-semibold">{t}</h3>
              <p className="mt-1 text-[15px] text-slate">{b}</p>
            </li>
          ))}
        </ol>
      </section>

      {opening && (
        <OpenSheet
          onClose={() => setOpening(false)}
          onSubmit={(d) => {
            setCases((cs) => [d, ...cs.filter((c) => c.id !== d.id)])
            setSelected(d.id)
          }}
        />
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- Detail */

function CaseDetail({ d, onUpdate, onSent }: { d: Case; onUpdate: (fn: (c: Case) => Case) => void; onSent?: () => void }) {
  const c = useMine().mine?.active.find((x) => x.c.id === d.challengeId)?.c
  const [sending, setSending] = useState(false)
  const [link, setLink] = useState('')
  const [note, setNote] = useState('')
  const [images, setImages] = useState<EvidenceImage[]>([])
  const [viewing, setViewing] = useState<{ name: string; url: string } | null>(null)
  const needs = d.status === 'Needs evidence'
  const toast = useToast()
  const openCase = d.status === 'Under review' || needs

  async function submitEvidence() {
    const items = [link.trim(), note.trim()].filter(Boolean)
    if (!items.length && !images.length) return
    setSending(true)
    const form = new FormData()
    if (note.trim()) form.append('note', note.trim())
    if (link.trim()) form.append('links', link.trim())
    images.forEach((i) => form.append('images', i.file))
    try {
      await api(`/disputes/${d.id}/evidence`, { method: 'POST', body: form })
    } catch (err) {
      setSending(false)
      return toast({ tone: 'error', title: 'Evidence not sent', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    }
    setSending(false)
    onSent?.()
    const added = images.map(({ name, url }) => ({ name, url }))
    onUpdate((x) => ({
      ...x,
      status: 'Under review',
      evidence: [...x.evidence, ...items],
      images: [...x.images, ...added],
      timeline: [...x.timeline, { at: new Date().toISOString(), text: 'You added evidence. Back with the moderator' }],
    }))
    setLink('')
    setNote('')
    setImages([])
    toast({ title: 'Evidence sent', body: 'The moderator has been notified and the review continues.' })
  }

  return (
    <article data-detail className="space-y-5 rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate">
            {c?.providers.map((p) => (
              <ProviderMark key={p} provider={p} size={14} />
            ))}
            Dispute {d.id.toUpperCase()}
          </div>
          <h2 className="mt-1 text-2xl font-bold sm:text-3xl">
            {d.challenge}, day {d.day}
          </h2>
        </div>
        <span className={cx('inline-flex h-8 items-center rounded-full px-3.5 text-sm font-semibold', statusStyle[d.status])}>{d.status}</span>
      </header>

      {openCase && d.amountLocked > 0 && (
        <div className="flex items-start gap-3 rounded-2xl bg-ground p-4">
          <Lock size={18} className="mt-0.5 shrink-0 text-slate" />
          <p className="text-[15px]">
            <span className="font-semibold">{usd(d.amountLocked, { cents: true })} is on hold.</span> It can’t be paid out or forfeited until this
            dispute is decided.
          </p>
        </div>
      )}
      {d.status === 'Approved' && (
        <div className="flex items-start gap-3 rounded-2xl bg-calm-soft p-4">
          <Check size={18} strokeWidth={3} className="mt-0.5 shrink-0 text-calm" />
          <p className="text-[15px]">Approved. Day {d.day} now counts as verified and nothing was taken from your stake.</p>
        </div>
      )}

      <section>
        <h3 className="font-sans text-sm font-semibold text-slate">What you reported</h3>
        <p className="mt-1.5 text-[16px]">{d.reason}</p>
      </section>

      {(d.evidence.length > 0 || d.images.length > 0) && (
        <section>
          <h3 className="font-sans text-sm font-semibold text-slate">Evidence</h3>
          {d.images.length > 0 && (
            <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {d.images.map((img) => (
                <li key={img.url}>
                  <button
                    type="button"
                    onClick={() => setViewing(img)}
                    className="block w-full overflow-hidden rounded-xl ring-1 ring-line transition-shadow hover:shadow-(--shadow-lift)"
                    aria-label={`View ${img.name}`}
                  >
                    <img src={img.url} alt={img.name} className="aspect-[4/3] w-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <ul className="mt-2 space-y-2">
            {d.evidence.map((e) => (
              <li key={e} className="flex items-center gap-2.5 rounded-xl bg-ground px-3.5 py-2.5 text-[15px]">
                {e.startsWith('http') ? <Link2 size={16} className="shrink-0 text-cobalt" /> : <FileText size={16} className="shrink-0 text-slate" />}
                <span className="truncate">{e}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="font-sans text-sm font-semibold text-slate">Timeline</h3>
        <ol className="relative mt-3 space-y-4 border-l border-line pl-5">
          {d.timeline.map((t, i) => {
            const last = i === d.timeline.length - 1
            return (
              <li key={i} className="relative">
                <span className={cx('absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-surface', last ? 'bg-cobalt' : 'bg-line')} />
                <p className={cx('text-[15px]', last && 'font-semibold')}>{t.text}</p>
                <p className="text-sm text-slate">{fmt(t.at)}</p>
              </li>
            )
          })}
        </ol>
      </section>

      {needs && (
        <section className="rounded-2xl bg-gold-soft/60 p-5 ring-1 ring-gold/30">
          <h3 className="text-lg font-semibold">The moderator needs more evidence</h3>
          <p className="mt-1 text-[15px] text-slate">Add links to the submissions or a short note. The review continues as soon as you send it.</p>
          <div className="mt-4 space-y-3">
            <Field label="Link">
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://leetcode.com/submissions/detail/…" className={inputClass} />
            </Field>
            <Field label="Note">
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Both were accepted on Oct 3 before 11 pm." className={cx(inputClass, 'resize-y')} />
            </Field>
            <ImageDrop value={images} onChange={setImages} />
            <Button busy={sending} onClick={() => void submitEvidence()} disabled={!link.trim() && !note.trim() && !images.length}>
              Send evidence
            </Button>
          </div>
        </section>
      )}

      {viewing && (
        <Sheet title={viewing.name} onClose={() => setViewing(null)} width={880}>
          <img src={viewing.url} alt={viewing.name} className="w-full rounded-2xl bg-ground object-contain" />
        </Sheet>
      )}
    </article>
  )
}

/* ------------------------------------------------------------- Open sheet */

const reasons = [
  ['missed', 'My activity wasn’t detected', 'I did the work but it wasn’t counted'],
  ['counted', 'It was counted wrong', 'Some of my activity was ignored or miscounted'],
  ['outage', 'The provider had a problem', 'GitHub, LeetCode, Codeforces, WakaTime or Solana was having issues'],
  ['other', 'Something else', 'Explain it in your own words'],
] as const

/** Builds a freshly opened dispute. Runs from the submit handler, never during render. */

function OpenSheet({ onClose, onSubmit }: { onClose: () => void; onSubmit: (d: Case) => void }) {
  const [step, setStep] = useState<'result' | 'why' | 'done'>('result')
  const { mine } = useMine()
  const mineItems = mine?.active ?? []
  const [picked, setChallengeId] = useState<string | null>(null)
  const challengeId = picked ?? mineItems[0]?.c.id ?? ''
  const [event, setEvent] = useState<VerificationEvent | null>(null)
  const [reason, setReason] = useState<(typeof reasons)[number][0] | null>(null)
  const [details, setDetails] = useState('')
  const [links, setLinks] = useState<string[]>([''])
  const [images, setImages] = useState<EvidenceImage[]>([])
  const body = useRef<HTMLDivElement>(null)

  const toast = useToast()
  const item = mineItems.find((x) => x.c.id === challengeId)
  const p = item?.p ?? { history: [], today: 0, stake: 0 }
  const onChain = Boolean((item?.c as { escrow?: unknown } | undefined)?.escrow)
  const [sending, setSending] = useState(false)
  const contestable = p.history.filter((h) => h.state === 'failed' || h.state === 'unavailable' || h.state === 'pending')

  useGSAP(
    () => {
      if (!prefersMotion()) return
      if (step === 'done') gsap.from('[data-mark]', { scale: 0, rotate: -40, duration: 0.55, ease: 'back.out(2.4)' })
      gsap.from('[data-step] > *', { x: 18, autoAlpha: 0, duration: 0.35, stagger: 0.04, ease: 'power3.out', clearProps: 'all' })
    },
    { scope: body, dependencies: [step] },
  )

  const why = () => details.trim() || reasons.find((r) => r[0] === reason)![1]

  /** Opens it through the API; on challenges with escrow the person's wallet signs the on-chain flag. */
  async function submitLive(sign?: SignBytes) {
    setSending(true)
    const form = new FormData()
    form.append('challengeId', challengeId)
    form.append('day', String(event?.day ?? p.today))
    form.append('reason', why())
    links.map((l) => l.trim()).filter(Boolean).forEach((l) => form.append('links', l))
    images.forEach((i) => form.append('images', i.file))
    try {
      const r = await api<{ status: string; dispute: ApiDispute; transaction?: string }>('/disputes', { method: 'POST', body: form })
      if (r.status === 'needs_signature' && r.transaction && sign) {
        const signature = await signAndSubmit(r.transaction, sign)
        await api(`/disputes/${r.dispute.id}/confirm`, { method: 'POST', body: { signature } })
      }
      toast({ title: 'Dispute opened', body: 'The affected money stays on hold until a moderator decides.' })
      onSubmit(fromApi(r.dispute))
      setStep('done')
    } catch (err) {
      const declined = /reject|declin|cancel/i.test(String(err))
      toast({ tone: 'error', title: declined ? 'Dispute not opened' : 'Couldn’t open the dispute', body: err instanceof ApiError ? err.message : declined ? 'You declined it in your wallet.' : 'Please try again.', inbox: false })
    } finally {
      setSending(false)
    }
  }


  const footer =
    step === 'result' ? (
      <Button className="w-full" disabled={!event} onClick={() => setStep('why')}>
        Continue
      </Button>
    ) : step === 'why' ? (
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setStep('result')}>
          Back
        </Button>
        {onChain ? (
          <div className="flex-1">
            <Suspense fallback={<Button className="w-full" busy>Open dispute</Button>}>
              <SignButton label="Open dispute" disabled={!reason || details.trim().length < 10} onSign={submitLive} />
            </Suspense>
          </div>
        ) : (
          <Button className="flex-1" disabled={!reason || details.trim().length < 10} busy={sending} onClick={() => void submitLive()}>
            Open dispute
          </Button>
        )}
      </div>
    ) : (
      <Button className="w-full" onClick={onClose}>
        Done
      </Button>
    )

  return (
    <Sheet
      title={step === 'done' ? 'Dispute opened' : 'Open a dispute'}
      onClose={() => {
        // Previews of unsent screenshots are no longer needed.
        if (step !== 'done') images.forEach((i) => URL.revokeObjectURL(i.url))
        onClose()
      }}
      footer={footer}
    >
      <div ref={body}>
        <div data-step key={step}>
          {step === 'result' && (
            <>
              <Field label="Challenge">
                <Select
                  label="Challenge"
                  value={challengeId}
                  onChange={(v) => {
                    setChallengeId(v)
                    setEvent(null)
                  }}
                  options={mineItems.map((x) => ({ value: x.c.id, label: x.c.title }))}
                />
              </Field>
              <fieldset className="mt-5">
                <legend className="text-sm font-semibold">Which result?</legend>
                {contestable.length ? (
                  <ul className="mt-2 space-y-2">
                    {contestable.map((h) => {
                      const on = event?.id === h.id
                      return (
                        <li key={h.id}>
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() => setEvent(h)}
                            className={cx(
                              'w-full rounded-2xl p-4 text-left ring-1 ring-inset transition-[background-color,box-shadow]',
                              on ? 'bg-cobalt-soft ring-2 ring-cobalt' : 'ring-line hover:ring-slate/40',
                            )}
                          >
                            <span className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold">{h.day ? `Day ${h.day}` : 'Latest check'}</span>
                              <ProofChip state={h.state} />
                            </span>
                            <span className="mt-1 block text-sm text-slate">{h.detail}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="mt-2 rounded-2xl bg-ground p-4 text-[15px] text-slate">Nothing to contest here. Every recent result was verified.</p>
                )}
              </fieldset>
              {event?.state === 'unavailable' && (
                <p className="mt-4 flex items-start gap-2 rounded-2xl bg-ground p-4 text-[15px]">
                  <CloudOff size={18} className="mt-0.5 shrink-0 text-slate" />
                  Provider outages are already not counted against you. Only dispute this if it stays unresolved.
                </p>
              )}
            </>
          )}

          {step === 'why' && (
            <>
              <fieldset>
                <legend className="text-sm font-semibold">What went wrong?</legend>
                <div className="mt-2 grid gap-2">
                  {reasons.map(([k, t, s]) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={reason === k}
                      onClick={() => setReason(k)}
                      className={cx('rounded-2xl p-3.5 text-left ring-1 ring-inset', reason === k ? 'bg-cobalt-soft ring-2 ring-cobalt' : 'ring-line hover:ring-slate/40')}
                    >
                      <span className="block font-semibold">{t}</span>
                      <span className="text-sm text-slate">{s}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="mt-5">
                <Field label="Explain what happened" hint="At least 10 characters. Be specific about times and links.">
                  <textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} className={cx(inputClass, 'resize-y')} />
                </Field>
              </div>
              <fieldset className="mt-5">
                <legend className="text-sm font-semibold">Evidence links</legend>
                <div className="mt-2 space-y-2">
                  {links.map((l, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        value={l}
                        onChange={(e) => setLinks(links.map((x, j) => (j === i ? e.target.value : x)))}
                        placeholder="https://"
                        aria-label={`Evidence link ${i + 1}`}
                        className={inputClass}
                      />
                      {links.length > 1 && (
                        <button
                          type="button"
                          aria-label="Remove link"
                          onClick={() => setLinks(links.filter((_, j) => j !== i))}
                          className="grid size-12 shrink-0 place-items-center rounded-xl text-slate hover:bg-ink/5"
                        >
                          <X size={18} />
                        </button>
                      )}
                    </div>
                  ))}
                  {links.length < 4 && (
                    <button type="button" onClick={() => setLinks([...links, ''])} className="text-sm font-semibold text-cobalt hover:underline">
                      Add another link
                    </button>
                  )}
                </div>
              </fieldset>
              <div className="mt-5">
                <ImageDrop value={images} onChange={setImages} />
              </div>
              <p className="mt-5 flex items-start gap-2 text-sm text-slate">
                <Lock size={15} className="mt-0.5 shrink-0" /> Your {usd(p.stake)} stake in this challenge stays locked until the dispute is decided.
              </p>
            </>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center py-4 text-center">
              <span data-mark className="grid size-16 place-items-center rounded-full bg-gold text-ink">
                <Scale size={28} />
              </span>
              <h3 className="mt-5 text-2xl font-bold">A moderator will review it</h3>
              <p className="mt-2 text-slate">Most disputes are decided within 2 days. We’ll notify you if they need anything else.</p>
              <Link to="/how-it-works" className="mt-4 text-sm font-semibold text-cobalt hover:underline">
                How disputes are decided
              </Link>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  )
}
