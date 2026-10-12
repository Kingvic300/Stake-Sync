import { CheckCircle2, Copy, RotateCcw, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ReasonSheet } from '../components/ReasonSheet'
import { Sheet } from '../components/Sheet'
import { Bone } from '../components/Skeleton'
import { Tabs } from '../components/Tabs'
import { Button, PageHeader, Tag } from '../components/ui'
import type { ErrorDetail, ErrorGroupRow } from '../data/logs'
import { apiEnabled } from '../lib/api'
import { compact, cx } from '../lib/format'
import { inputClass } from '../lib/styles'
import { stamp, timeAgo } from '../lib/time'
import { fetchErrorDetail, setErrorStatus, useErrorGroups } from '../lib/useLogs'
import { useToast } from '../toast/context'

type StatusTab = 'open' | 'resolved' | 'all'

function CardsSkeleton() {
  return (
    <ul className="space-y-3">
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className="rounded-3xl bg-surface p-5 ring-1 ring-line/70">
          <Bone className="h-5 w-2/3" />
          <Bone className="mt-3 h-4 w-1/3" />
          <div className="mt-4 flex gap-6">
            <Bone className="h-8 w-16" />
            <Bone className="h-8 w-16" />
            <Bone className="h-8 w-20" />
          </div>
        </li>
      ))}
    </ul>
  )
}

function Detail({ row, onClose, onChanged }: { row: ErrorGroupRow; onClose: () => void; onChanged: (patch: Partial<ErrorGroupRow>) => void }) {
  const toast = useToast()
  const [detail, setDetail] = useState<ErrorDetail | null>(null)
  const [error, setError] = useState('')
  const [resolving, setResolving] = useState(false)
  const [busy, setBusy] = useState(false)
  const status = detail?.status ?? row.status

  useEffect(() => {
    fetchErrorDetail(row.id)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : 'Couldn’t load this error.'))
  }, [row.id])

  async function change(resolve: boolean, reason?: string) {
    // Update right away; put it back if the server refuses.
    const before = { status: row.status, resolution: row.resolution }
    const patch: Partial<ErrorGroupRow> = resolve ? { status: 'resolved', resolution: reason ?? null } : { status: 'open', resolution: null }
    onChanged(patch)
    setDetail((d) => (d ? { ...d, ...patch } : d))
    setBusy(true)
    try {
      await setErrorStatus(row.id, resolve, reason)
      toast({ title: resolve ? 'Marked resolved' : 'Reopened', body: resolve ? 'It reopens on its own if it happens again.' : undefined })
    } catch (e) {
      onChanged(before)
      setDetail((d) => (d ? { ...d, ...before } : d))
      toast({ tone: 'error', title: 'That didn’t save', body: e instanceof Error ? e.message : 'Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  function copy(text: string) {
    void navigator.clipboard?.writeText(text).then(
      () => toast({ title: 'Stack trace copied', inbox: false }),
      () => toast({ tone: 'error', title: 'Couldn’t copy the stack trace', inbox: false }),
    )
  }

  return (
    <>
      <Sheet
        title="Error"
        onClose={onClose}
        width={760}
        footer={
          status === 'open' ? (
            <Button className="w-full" onClick={() => setResolving(true)} busy={busy}>
              <CheckCircle2 size={17} /> Mark resolved
            </Button>
          ) : (
            <Button variant="secondary" className="w-full" onClick={() => void change(false)} busy={busy}>
              <RotateCcw size={17} /> Reopen
            </Button>
          )
        }
      >
        <p className="font-mono text-[15px] font-semibold break-words">{row.message}</p>
        <p className="mt-1 text-sm text-slate">{row.where ?? row.context}</p>
        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ['Times', compact(row.count)],
            ['Last 24h', compact(row.last24h)],
            ['People affected', compact(row.usersAffected)],
            ['First seen', stamp(row.firstSeen)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-sm text-slate">{k}</dt>
              <dd className="mt-0.5 font-display text-lg font-semibold tabular">{v}</dd>
            </div>
          ))}
        </dl>
        {status === 'resolved' && (detail?.resolution ?? row.resolution) && (
          <p className="mt-5 rounded-2xl bg-calm-soft px-4 py-3 text-sm text-calm">
            Resolved{(detail?.resolvedBy ?? row.resolvedBy) ? ` by ${detail?.resolvedBy ?? row.resolvedBy}` : ''}: {detail?.resolution ?? row.resolution}
          </p>
        )}
        {error && <p className="mt-5 text-sm text-miss">{error}</p>}
        {!detail && !error ? (
          <Bone className="mt-6 h-40 rounded-2xl" />
        ) : (
          detail?.stack && (
            <>
              <div className="mt-6 flex items-center justify-between">
                <p className="text-sm font-semibold">Stack trace</p>
                <button type="button" onClick={() => copy(detail.stack!)} className="inline-flex items-center gap-1 text-sm font-semibold text-cobalt">
                  <Copy size={14} /> Copy
                </button>
              </div>
              <pre className="mt-2 max-h-80 overflow-auto rounded-2xl bg-ink p-4 text-[12.5px] leading-relaxed text-white/90">{detail.stack}</pre>
            </>
          )
        )}
        {detail && detail.occurrences.length > 0 && (
          <>
            <p className="mt-6 text-sm font-semibold">Recent occurrences</p>
            <ul className="mt-2 divide-y divide-line rounded-2xl ring-1 ring-line/70">
              {detail.occurrences.slice(0, 20).map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                  <span className="text-slate tabular">{stamp(o.at)}</span>
                  <span className="min-w-0 flex-1 truncate">{o.path ? `${o.method} ${o.path.split('?')[0]}` : o.context}</span>
                  {o.user && <span className="text-slate">@{o.user.handle}</span>}
                  {o.requestId && (
                    <Link to={`/logs?request=${o.requestId}`} className="font-semibold text-cobalt">
                      View request
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Sheet>
      {resolving && (
        <ReasonSheet
          title="Mark this error resolved"
          confirm="Mark resolved"
          effect="It moves to Resolved. If the same error happens again it reopens automatically."
          presets={['Fixed in the latest release', 'Provider outage, now recovered', 'Expected; handled elsewhere']}
          onConfirm={(reason) => {
            setResolving(false)
            void change(true, reason)
          }}
          onClose={() => setResolving(false)}
        />
      )}
    </>
  )
}

/**
 * Exceptions grouped by cause, Sentry-style: one row per problem with how often it happens and who
 * it affects. Resolving one moves it out of the way until it comes back.
 */
export function ErrorLog() {
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<StatusTab>('open')
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const { items, error, refresh, setItems } = useErrorGroups(tab, debounced)
  const focus = params.get('e')
  const [open, setOpen] = useState<ErrorGroupRow | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  // Deep link from the server log: /errors?e=<id>
  useEffect(() => {
    if (!focus || open) return
    fetchErrorDetail(focus)
      .then((d) => setOpen(d))
      .catch(() => setParams({}))
  }, [focus, open, setParams])

  function patch(id: string, p: Partial<ErrorGroupRow>) {
    setItems((list) => list?.map((r) => (r.id === id ? { ...r, ...p } : r)) ?? null)
    setOpen((o) => (o && o.id === id ? { ...o, ...p } : o))
  }

  const openCount = tab === 'open' ? items?.length : undefined

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16">
      <PageHeader title="Error log" intro="Problems grouped by cause, with how often they happen and who they affect. Resolve one when it’s fixed; it reopens if it happens again." />
      {!apiEnabled && <p className="-mt-4 mb-6 rounded-2xl bg-ground px-4 py-3 text-sm text-slate">Connect the admin API to view error logs.</p>}

      <Tabs<StatusTab>
        label="Error status"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'open', label: 'Open', count: openCount },
          { id: 'resolved', label: 'Resolved' },
          { id: 'all', label: 'All' },
        ]}
      />
      <label className="relative mt-4 block sm:max-w-md">
        <span className="sr-only">Search errors</span>
        <Search size={17} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-slate" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Message, route or job" className={cx(inputClass, 'pl-11')} />
      </label>

      <div className="mt-5">
        {error ? (
          <div className="rounded-3xl bg-surface px-5 py-12 text-center ring-1 ring-line/70">
            <p className="font-semibold">Errors didn’t load</p>
            <p className="mt-1 text-slate">{error}</p>
            <Button variant="secondary" className="mt-4" onClick={refresh}>
              Try again
            </Button>
          </div>
        ) : !items ? (
          <CardsSkeleton />
        ) : items.length === 0 ? (
          <div className="rounded-3xl bg-surface px-5 py-12 text-center ring-1 ring-line/70">
            <CheckCircle2 size={28} className="mx-auto text-calm" />
            <p className="mt-2 font-semibold">{tab === 'open' ? 'No open errors' : 'Nothing here'}</p>
            <p className="mt-1 text-slate">{tab === 'open' ? 'Everything that went wrong has been dealt with.' : 'Try a different search.'}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((g) => (
              <li key={g.id}>
                <button type="button" onClick={() => setOpen(g)} className="block w-full rounded-3xl bg-surface p-5 text-left ring-1 ring-line/70 hover:ring-cobalt/40">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[15px] font-semibold break-words">{g.message}</p>
                      <p className="mt-1 truncate text-sm text-slate">{g.where ?? g.context}</p>
                    </div>
                    {g.status === 'resolved' ? <Tag tone="plain">Resolved</Tag> : g.last24h > 0 ? <Tag tone="gold">Active</Tag> : <Tag tone="cobalt">Quiet</Tag>}
                  </div>
                  <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
                    <div>
                      <dt className="text-slate">Times</dt>
                      <dd className="font-display text-lg font-semibold tabular">{compact(g.count)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate">Last 24h</dt>
                      <dd className={cx('font-display text-lg font-semibold tabular', g.last24h > 0 && g.status === 'open' && 'text-miss')}>{compact(g.last24h)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate">People affected</dt>
                      <dd className="font-display text-lg font-semibold tabular">{compact(g.usersAffected)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate">Last seen</dt>
                      <dd className="font-display text-lg font-semibold">{timeAgo(g.lastSeen)}</dd>
                    </div>
                  </dl>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && (
        <Detail
          row={open}
          onClose={() => {
            setOpen(null)
            if (focus) setParams({})
          }}
          onChanged={(p) => patch(open.id, p)}
        />
      )}
    </div>
  )
}
