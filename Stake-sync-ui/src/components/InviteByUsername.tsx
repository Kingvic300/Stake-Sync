import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Person } from '../data/types'
import { api, ApiError } from '../lib/api'
import { cx } from '../lib/format'
import { inputClass } from '../lib/styles'
import { useToast } from '../toast/context'
import { Avatar, Button } from './ui'

/** Invite people to a challenge by username, with suggestions as you type. */
export function InviteByUsername({ challengeId }: { challengeId: string }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Person[]>([])
  const [found, setFound] = useState<{ q: string; people: Person[] }>({ q: '', people: [] })
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string[]>([])
  const term = q.trim().replace(/^@/, '')

  // Look people up after a short pause in typing.
  useEffect(() => {
    if (term.length < 2) return
    const ctrl = new AbortController()
    const t = window.setTimeout(() => {
      api<Person[]>(`/users/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((people) => setFound({ q: term, people }))
        .catch(() => {})
    }, 250)
    return () => {
      window.clearTimeout(t)
      ctrl.abort()
    }
  }, [term])

  const suggestions = found.q === term && term.length >= 2 ? found.people.filter((p) => !picked.some((x) => x.handle === p.handle)) : []

  function add(p: Person) {
    setPicked((x) => (x.length >= 20 ? x : [...x, p]))
    setQ('')
  }

  async function send() {
    setBusy(true)
    try {
      const r = await api<{ invited: string[]; notFound: string[] }>(`/challenges/${encodeURIComponent(challengeId)}/invitations`, { method: 'POST', body: { handles: picked.map((p) => p.handle) } })
      setSent(r.invited)
      setPicked([])
      toast({ title: r.invited.length === 1 ? 'Invite sent' : `${r.invited.length} invites sent`, body: 'They’ll get a notification and an email with the link.', inbox: false })
    } catch (err) {
      toast({ tone: 'error', title: 'Invites not sent', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-6">
      <div className="text-sm font-semibold">Invite by username</div>
      {picked.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {picked.map((p) => (
            <button key={p.handle} type="button" onClick={() => setPicked((x) => x.filter((y) => y.handle !== p.handle))} className="inline-flex items-center gap-1.5 rounded-full bg-cobalt-soft py-1 pr-2.5 pl-1 text-sm font-semibold text-cobalt-deep" aria-label={`Remove ${p.handle}`}>
              <Avatar person={p} size={20} /> @{p.handle} <X size={13} />
            </button>
          ))}
        </div>
      )}
      <div className="relative mt-2 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && suggestions[0]) {
              e.preventDefault()
              add(suggestions[0])
            }
          }}
          placeholder="@username or name"
          aria-label="Invite by username"
          className={inputClass}
        />
        <Button variant="secondary" disabled={!picked.length} busy={busy} onClick={() => void send()}>
          Invite{picked.length > 1 ? ` ${picked.length}` : ''}
        </Button>
        {suggestions.length > 0 && (
          <ul className="absolute top-full right-24 left-0 z-10 mt-1 overflow-hidden rounded-xl bg-surface shadow-(--shadow-sheet) ring-1 ring-line">
            {suggestions.map((p) => (
              <li key={p.handle}>
                <button type="button" onClick={() => add(p)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-ground">
                  <Avatar person={p} size={28} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    <span className="block truncate text-xs text-slate">@{p.handle}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {term.length >= 2 && found.q === term && !suggestions.length && !found.people.length && (
          <p className="absolute top-full left-0 mt-1 text-sm text-slate">Nobody matches “{term}”.</p>
        )}
      </div>
      {sent.length > 0 && (
        <p role="status" className={cx('mt-2 inline-flex items-center gap-1.5 text-sm text-calm')}>
          <Check size={15} strokeWidth={3} /> Invited {sent.map((h) => `@${h}`).join(', ')}
        </p>
      )}
    </div>
  )
}
