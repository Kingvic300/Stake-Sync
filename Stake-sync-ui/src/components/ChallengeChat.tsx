import { CornerDownRight, Flag, Megaphone, MoreHorizontal, Pencil, Pin, Send, SmilePlus, Trash2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { io, type Socket } from 'socket.io-client'
import { personOf, useAuth } from '../auth/context'
import type { ChatMessage } from '../data/types'
import { api, ApiError, BASE } from '../lib/api'
import { cx } from '../lib/format'
import { useApiData } from '../lib/useApiData'
import { useToast } from '../toast/context'
import { RetryPanel } from './RetryPanel'
import { Sheet } from './Sheet'
import { PanelSkeleton } from './Skeleton'
import { Avatar, Button } from './ui'

type Message = ChatMessage & { edited?: boolean }
type Reaction = NonNullable<ChatMessage['reactions']>[number]

const EMOJIS = ['🔥', '👏', '💪', '🎉', '❤️', '😂']
const EDIT_WINDOW_MS = 15 * 60_000
const MAX_LENGTH = 2000
const REASONS = ['Spam or scam', 'Harassment', 'Encouraging cheating', 'Off topic', 'Inappropriate', 'Other'] as const

const byTime = (ms: Message[]) => [...ms].sort((a, b) => a.at.localeCompare(b.at))
const dayKey = (iso: string) => new Date(iso).toDateString()

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

/** Keeps your own "mine" flags when the server broadcasts counts without them. */
function mergeReactions(prev: Reaction[] | undefined, next: { emoji: string; count: number }[]): Reaction[] {
  return next.map((r) => ({ ...r, mine: prev?.find((p) => p.emoji === r.emoji)?.mine }))
}

/** Live connection to a challenge's chat room. Messages from others arrive without a refresh. */
function useLiveChat(challengeId: string, enabled: boolean, set: (fn: (ms: Message[]) => Message[]) => void) {
  const { session } = useAuth()
  const token = session?.accessToken
  const setRef = useRef(set)
  useEffect(() => {
    setRef.current = set
  })
  useEffect(() => {
    if (!enabled || !token || !BASE) return
    let socket: Socket
    try {
      socket = io(`${new URL(BASE).origin}/live`, { auth: { token }, transports: ['websocket'] })
    } catch {
      return
    }
    const apply = (fn: (ms: Message[]) => Message[]) => setRef.current(fn)
    socket.on('connect', () => socket.emit('subscribe', { challengeId }))
    socket.on('message', (m: Message) => apply((ms) => (ms.some((x) => x.id === m.id) ? ms : byTime([...ms, { ...m, reactions: [] }]))))
    socket.on('message_updated', (m: Message) => apply((ms) => ms.map((x) => (x.id === m.id ? { ...x, body: m.body, pinned: m.pinned, edited: m.edited } : x))))
    socket.on('message_removed', ({ id }: { id: string }) => apply((ms) => ms.filter((x) => x.id !== id)))
    socket.on('reaction', ({ id, reactions }: { id: string; reactions: { emoji: string; count: number }[] }) =>
      apply((ms) => ms.map((x) => (x.id === id ? { ...x, reactions: mergeReactions(x.reactions, reactions) } : x))),
    )
    return () => {
      socket.emit('unsubscribe', { challengeId })
      socket.disconnect()
    }
  }, [challengeId, enabled, token])
}

/** The challenge chat: live, threaded replies, reactions, edits, reports, and older messages on demand. */
export function ChallengeChat({ id, joined, canModerate }: { id: string; joined: boolean; canModerate?: boolean }) {
  const { session } = useAuth()
  const me = session?.username
  const toast = useToast()
  const src = useApiData<{ items: Message[]; hasMore: boolean }>(joined ? `/challenges/${encodeURIComponent(id)}/messages` : null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const messages = byTime(src.data?.items ?? [])
  const hasMore = src.data?.hasMore ?? false
  const setMessages = (fn: (ms: Message[]) => Message[]) => src.setData((prev) => (prev ? { ...prev, items: fn(prev.items) } : prev))

  useLiveChat(id, joined, setMessages)

  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [picker, setPicker] = useState<string | null>(null)
  const [reporting, setReporting] = useState<Message | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const atBottom = useRef(true)
  const [unseen, setUnseen] = useState(0)
  // The edit window closes on its own; re-check twice a minute.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])
  const lastCount = useRef(0)

  // Stay pinned to the newest message unless you've scrolled up to read; then show a "new" pill.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const grew = messages.length > lastCount.current
    const first = lastCount.current === 0
    lastCount.current = messages.length
    if (!grew) return
    if (first || atBottom.current) el.scrollTop = el.scrollHeight
    else setUnseen((n) => n + 1)
  }, [messages.length])

  function onScroll() {
    const el = box.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (atBottom.current && unseen) setUnseen(0)
  }

  function toBottom() {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' })
    setUnseen(0)
  }

  async function loadOlder() {
    const oldest = messages[0]
    if (!oldest || loadingOlder) return
    setLoadingOlder(true)
    const el = box.current
    const before = el ? el.scrollHeight - el.scrollTop : 0
    try {
      const r = await api<{ items: Message[]; hasMore: boolean }>(`/challenges/${encodeURIComponent(id)}/messages?before=${encodeURIComponent(oldest.at)}`)
      src.setData((prev) => (prev ? { items: [...r.items.filter((m) => !prev.items.some((y) => y.id === m.id)), ...prev.items], hasMore: r.hasMore } : prev))
      // Keep your place instead of jumping to the top.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before
      })
    } catch (err) {
      toast({ tone: 'error', title: 'Couldn’t load older messages', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    } finally {
      setLoadingOlder(false)
    }
  }

  function react(messageId: string, emoji: string) {
    setPicker(null)
    // Instant, then corrected from the server's count.
    setMessages((ms) =>
      ms.map((m) => {
        if (m.id !== messageId) return m
        const rs = m.reactions ?? []
        const r = rs.find((x) => x.emoji === emoji)
        if (!r) return { ...m, reactions: [...rs, { emoji, count: 1, mine: true }] }
        return { ...m, reactions: rs.map((x) => (x.emoji === emoji ? { ...x, count: x.count + (x.mine ? -1 : 1), mine: !x.mine } : x)).filter((x) => x.count > 0) }
      }),
    )
    void api<Reaction[]>(`/messages/${messageId}/reactions`, { method: 'POST', body: { emoji } })
      .then((reactions) => setMessages((ms) => ms.map((m) => (m.id === messageId ? { ...m, reactions } : m))))
      .catch((err) => {
        src.refresh()
        toast({ tone: 'error', title: 'Reaction didn’t save', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
      })
  }

  function send(e: FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body || body.length > MAX_LENGTH) return
    if (editing) return void saveEdit(editing, body)
    const tempId = `pending-${Date.now()}`
    const parent = replyTo
    atBottom.current = true
    setMessages((ms) => [...ms, { id: tempId, person: personOf(session), at: new Date().toISOString(), body, replyTo: parent?.id, reactions: [] }])
    setDraft('')
    setReplyTo(null)
    api<Message>(`/challenges/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { body, replyTo: parent?.id } })
      // The live echo of our own message may arrive first; keep one copy.
      .then((saved) => setMessages((ms) => (ms.some((m) => m.id === saved.id) ? ms.filter((m) => m.id !== tempId) : ms.map((m) => (m.id === tempId ? saved : m)))))
      .catch((err) => {
        setMessages((ms) => ms.filter((m) => m.id !== tempId))
        setDraft(body)
        setReplyTo(parent)
        toast({ tone: 'error', title: 'Message not sent', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
      })
  }

  async function saveEdit(m: Message, body: string) {
    const before = m.body
    setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, body, edited: true } : x)))
    setEditing(null)
    setDraft('')
    try {
      await api(`/messages/${m.id}`, { method: 'PATCH', body: { body } })
    } catch (err) {
      setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, body: before } : x)))
      toast({ tone: 'error', title: 'Edit not saved', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    }
  }

  async function remove(m: Message) {
    setMenu(null)
    const snapshot = messages
    setMessages((ms) => ms.filter((x) => x.id !== m.id))
    try {
      await api(`/messages/${m.id}`, { method: 'DELETE' })
      toast({ title: 'Message deleted', inbox: false })
    } catch (err) {
      setMessages(() => snapshot)
      toast({ tone: 'error', title: 'Message not deleted', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    }
  }

  async function pin(m: Message) {
    setMenu(null)
    const pinned = !m.pinned
    setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, pinned } : x)))
    try {
      await api(`/messages/${m.id}/pin`, { method: 'POST', body: { pinned } })
    } catch (err) {
      setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, pinned: !pinned } : x)))
      toast({ tone: 'error', title: pinned ? 'Couldn’t pin' : 'Couldn’t unpin', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    }
  }

  function startEdit(m: Message) {
    setMenu(null)
    setReplyTo(null)
    setEditing(m)
    setDraft(m.body)
    requestAnimationFrame(() => input.current?.focus())
  }

  if (!joined) return <p className="rounded-2xl bg-ground p-6 text-center text-[15px] text-slate">Join the challenge to read and post in the chat.</p>
  if (!src.data) return src.error ? <RetryPanel onRetry={src.refresh} /> : <PanelSkeleton rows={4} />

  const pinned = messages.filter((m) => m.pinned)
  const over = draft.length > MAX_LENGTH

  return (
    <div className="flex flex-col rounded-3xl bg-surface ring-1 ring-line/70">
      {pinned.length > 0 && (
        <div className="space-y-2 border-b border-line p-4">
          {pinned.slice(-2).map((m) => (
            <div key={m.id} className="rounded-2xl bg-gold-soft px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-gold-ink">
                <Pin size={14} /> Pinned{m.announcement && <> · <Megaphone size={14} /> Announcement</>} · {m.person.name}
              </div>
              <p className="mt-1 line-clamp-3 text-[15px]">{m.body}</p>
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        <div ref={box} onScroll={onScroll} className="h-[min(60vh,560px)] overflow-y-auto overscroll-contain px-3 py-4 sm:px-5" aria-live="polite">
          {hasMore && (
            <div className="mb-4 text-center">
              <Button size="sm" variant="secondary" busy={loadingOlder} onClick={() => void loadOlder()}>
                Load older messages
              </Button>
            </div>
          )}
          {messages.length === 0 && <p className="py-16 text-center text-slate">No messages yet. Say hello and share your plan for day one.</p>}
          <ul>
            {messages.map((m, i) => {
              const prev = messages[i - 1]
              const newDay = !prev || dayKey(prev.at) !== dayKey(m.at)
              // Consecutive messages from one person within five minutes read as one block.
              const grouped = !newDay && prev && prev.person.handle === m.person.handle && new Date(m.at).getTime() - new Date(prev.at).getTime() < 5 * 60_000 && !m.replyTo
              const parent = m.replyTo ? messages.find((x) => x.id === m.replyTo) : null
              const mine = m.person.handle === me
              const pending = m.id.startsWith('pending-')
              const canEdit = mine && !pending && now - new Date(m.at).getTime() < EDIT_WINDOW_MS
              return (
                <li key={m.id}>
                  {newDay && (
                    <div className="my-4 flex items-center gap-3 text-xs font-semibold text-slate">
                      <span className="h-px flex-1 bg-line" /> {dayLabel(m.at)} <span className="h-px flex-1 bg-line" />
                    </div>
                  )}
                  <div className={cx('group relative flex gap-3 rounded-2xl px-2 py-1 hover:bg-ground/70', !grouped && 'mt-3', pending && 'opacity-60')}>
                    <div className="w-9 shrink-0">{!grouped && <Avatar person={m.person} size={36} />}</div>
                    <div className="min-w-0 flex-1">
                      {!grouped && (
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold">{mine ? 'You' : m.person.name}</span>
                          {m.announcement && <span className="rounded-full bg-gold-soft px-2 text-xs font-semibold text-gold-ink">Host</span>}
                          <span className="text-xs text-slate">{new Date(m.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                        </div>
                      )}
                      {parent && (
                        <div className="mt-1 flex items-start gap-1.5 rounded-lg border-l-2 border-line bg-ground px-2 py-1 text-sm text-slate">
                          <CornerDownRight size={14} className="mt-0.5 shrink-0" />
                          <span className="line-clamp-1">
                            <span className="font-semibold">{parent.person.name.split(' ')[0]}</span>: {parent.body}
                          </span>
                        </div>
                      )}
                      <p className="mt-0.5 text-[15px] break-words whitespace-pre-wrap">
                        {m.body.split(/(@\w+)/).map((part, j) =>
                          part.startsWith('@') ? (
                            <span key={j} className={cx('font-semibold', part.slice(1) === me ? 'rounded bg-gold-soft px-0.5 text-gold-ink' : 'text-cobalt')}>
                              {part}
                            </span>
                          ) : (
                            part
                          ),
                        )}
                        {m.edited && <span className="ml-1 text-xs text-slate">(edited)</span>}
                      </p>
                      {(m.reactions?.length ?? 0) > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {m.reactions!.map((r) => (
                            <button
                              key={r.emoji}
                              type="button"
                              onClick={() => react(m.id, r.emoji)}
                              aria-pressed={!!r.mine}
                              aria-label={`${r.emoji} ${r.count}`}
                              className={cx('inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-sm ring-1 ring-inset transition-colors', r.mine ? 'bg-cobalt-soft ring-cobalt/40' : 'bg-surface ring-line hover:ring-slate/40')}
                            >
                              {r.emoji} <span className="tabular">{r.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {!pending && (
                      <div className={cx('absolute -top-3 right-2 flex items-center gap-0.5 rounded-xl bg-surface p-0.5 shadow-sm ring-1 ring-line', menu === m.id || picker === m.id ? 'flex' : 'hidden group-hover:flex group-focus-within:flex')}>
                        <IconButton label="React" onClick={() => setPicker(picker === m.id ? null : m.id)}>
                          <SmilePlus size={16} />
                        </IconButton>
                        <IconButton
                          label="Reply"
                          onClick={() => {
                            setEditing(null)
                            setReplyTo(m)
                            input.current?.focus()
                          }}
                        >
                          <CornerDownRight size={16} />
                        </IconButton>
                        <IconButton label="More" onClick={() => setMenu(menu === m.id ? null : m.id)}>
                          <MoreHorizontal size={16} />
                        </IconButton>
                        {picker === m.id && (
                          <div className="absolute top-9 right-0 z-10 flex gap-1 rounded-xl bg-surface p-1.5 shadow-(--shadow-sheet) ring-1 ring-line">
                            {EMOJIS.map((e) => (
                              <button key={e} type="button" onClick={() => react(m.id, e)} className="grid size-8 place-items-center rounded-lg text-lg hover:bg-ground" aria-label={`React with ${e}`}>
                                {e}
                              </button>
                            ))}
                          </div>
                        )}
                        {menu === m.id && (
                          <div role="menu" className="absolute top-9 right-0 z-10 w-44 rounded-xl bg-surface p-1 shadow-(--shadow-sheet) ring-1 ring-line">
                            {canEdit && <MenuItem icon={<Pencil size={15} />} onClick={() => startEdit(m)}>Edit</MenuItem>}
                            {canModerate && <MenuItem icon={<Pin size={15} />} onClick={() => void pin(m)}>{m.pinned ? 'Unpin' : 'Pin'}</MenuItem>}
                            {(mine || canModerate) && (
                              <MenuItem icon={<Trash2 size={15} />} danger onClick={() => void remove(m)}>
                                Delete
                              </MenuItem>
                            )}
                            {!mine && (
                              <MenuItem
                                icon={<Flag size={15} />}
                                onClick={() => {
                                  setMenu(null)
                                  setReporting(m)
                                }}
                              >
                                Report
                              </MenuItem>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
        {unseen > 0 && (
          <button type="button" onClick={toBottom} className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-white shadow-(--shadow-sheet)">
            {unseen} new {unseen === 1 ? 'message' : 'messages'}
          </button>
        )}
      </div>

      <form onSubmit={send} className="border-t border-line p-2">
        {(replyTo || editing) && (
          <div className="flex items-center justify-between gap-3 px-2 pt-1 pb-2 text-sm text-slate">
            <span className="line-clamp-1">
              {editing ? 'Editing your message' : (
                <>
                  Replying to <span className="font-semibold text-ink">{replyTo!.person.name}</span>: {replyTo!.body}
                </>
              )}
            </span>
            <button
              type="button"
              aria-label="Cancel"
              onClick={() => {
                setReplyTo(null)
                if (editing) setDraft('')
                setEditing(null)
              }}
              className="rounded-full p-1 hover:bg-ground hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <label className="flex-1">
            <span className="sr-only">Message</span>
            <textarea
              ref={input}
              rows={Math.min(5, Math.max(1, draft.split('\n').length))}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) send(e)
                if (e.key === 'Escape') {
                  setReplyTo(null)
                  setEditing(null)
                }
              }}
              placeholder="Share progress or cheer someone on. Use @ to mention"
              aria-invalid={over}
              className="max-h-40 min-h-11 w-full resize-none bg-transparent px-3 py-2.5 text-[15px] outline-none"
            />
          </label>
          <Button type="submit" size="sm" className="mb-1" disabled={!draft.trim() || over} aria-label={editing ? 'Save edit' : 'Send'}>
            {editing ? 'Save' : <Send size={16} />}
          </Button>
        </div>
        {draft.length > MAX_LENGTH - 200 && <p className={cx('px-3 pb-1 text-xs', over ? 'text-miss' : 'text-slate')}>{draft.length} / {MAX_LENGTH}</p>}
      </form>

      {reporting && <ReportSheet m={reporting} onClose={() => setReporting(null)} />}
    </div>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-8 place-items-center rounded-lg text-slate hover:bg-ground hover:text-ink">
      {children}
    </button>
  )
}

function MenuItem({ icon, onClick, danger, children }: { icon: React.ReactNode; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={cx('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-ground', danger ? 'text-miss' : 'text-ink')}>
      {icon} {children}
    </button>
  )
}

function ReportSheet({ m, onClose }: { m: Message; onClose: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit() {
    if (!reason) return
    setBusy(true)
    try {
      await api('/reports', { method: 'POST', body: { kind: 'message', targetId: m.id, reason } })
      toast({ title: 'Report sent', body: 'A moderator will look at it. Nothing is removed until they decide.' })
      onClose()
    } catch (err) {
      toast({ tone: 'error', title: 'Report not sent', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      title="Report this message"
      onClose={onClose}
      width={480}
      footer={
        <Button className="w-full" disabled={!reason} busy={busy} onClick={() => void submit()}>
          Send report
        </Button>
      }
    >
      <p className="rounded-2xl bg-ground p-3 text-[15px]">
        <span className="font-semibold">{m.person.name}:</span> {m.body}
      </p>
      <fieldset className="mt-4 space-y-2">
        <legend className="text-sm font-semibold">What’s wrong?</legend>
        {REASONS.map((r) => (
          <label key={r} className={cx('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-inset', reason === r ? 'bg-cobalt-soft ring-cobalt' : 'ring-line')}>
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} className="accent-[var(--color-cobalt)]" />
            {r}
          </label>
        ))}
      </fieldset>
    </Sheet>
  )
}
