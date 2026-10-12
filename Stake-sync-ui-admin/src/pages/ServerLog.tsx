import { Bug, Copy, Download, Search, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Select } from '../components/Select'
import { Sheet } from '../components/Sheet'
import { Bone } from '../components/Skeleton'
import { Tabs } from '../components/Tabs'
import { Button, PageHeader, Panel, Tag, Toggle } from '../components/ui'
import { securityLabels, type LogDetail, type LogEntry, type LogLevel, type LogStats } from '../data/logs'
import { apiEnabled } from '../lib/api'
import { compact, cx } from '../lib/format'
import { inputClass } from '../lib/styles'
import { stamp } from '../lib/time'
import { fetchLogDetail, useLogStats, useServerLogs } from '../lib/useLogs'
import { useToast } from '../toast/context'

type KindTab = 'all' | 'request' | 'app' | 'security' | 'error'

const levelStyle: Record<LogLevel, { dot: string; label: string }> = {
  info: { dot: 'bg-slate/50', label: 'Info' },
  warn: { dot: 'bg-gold', label: 'Warning' },
  error: { dot: 'bg-miss', label: 'Error' },
}

const kindLabel: Record<LogEntry['kind'], string> = { request: 'Request', app: 'App', security: 'Security', error: 'Error' }

function statusTone(s: number | null) {
  if (s === null) return 'text-slate'
  if (s >= 500) return 'text-miss'
  if (s >= 400) return 'text-gold-ink'
  return 'text-calm'
}

function ms(n: number | null) {
  if (n === null) return ''
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`
}

/** Second line for security events: who or what it was about, not a repeat of the title. */
function securityDetail(l: LogEntry) {
  const parts = [typeof l.meta.email === 'string' ? l.meta.email : null, l.user ? `@${l.user.handle}` : null, l.path ? l.path.split('?')[0] : null]
  const extra = parts.filter(Boolean).join(' · ')
  if (extra) return extra
  return l.message !== (securityLabels[l.context] ?? '') ? l.message : (l.ip ?? '')
}

/** One line: what happened, in words people can scan. */
function summary(l: LogEntry) {
  if (l.kind === 'request') return `${l.method} ${l.path?.split('?')[0]}`
  if (l.kind === 'security') return securityLabels[l.context] ?? l.message
  return l.message
}

/** Requests per hour with errors stacked on top (errors on their own scale, so a few still show). */
function HourBars({ series }: { series: LogStats['series'] }) {
  // Always 24 hourly slots ending at the latest hour with data, so a quiet day still reads as a day.
  const byHour = new Map(series.map((s) => [new Date(s.hour).getTime(), s]))
  const end = Math.max(0, ...byHour.keys())
  const slots = Array.from({ length: 24 }, (_, i) => {
    const t = end - (23 - i) * 3_600_000
    return byHour.get(t) ?? { hour: new Date(t).toISOString(), requests: 0, errors: 0 }
  })
  const max = Math.max(1, ...slots.map((s) => s.requests))
  const maxErr = Math.max(1, ...slots.map((s) => s.errors))
  return (
    <div className="flex h-16 items-end gap-[3px]" aria-hidden>
      {slots.map((s) => {
        const err = s.errors ? 8 + (s.errors / maxErr) * 30 : 0
        return (
          <div key={s.hour} className="flex h-full flex-1 flex-col justify-end" title={`${stamp(s.hour)}: ${s.requests} requests, ${s.errors} errors`}>
            {err > 0 && <div className="rounded-t-sm bg-miss" style={{ height: `${err}%` }} />}
            <div className={cx(s.requests ? 'bg-cobalt/70' : 'bg-line', err ? '' : 'rounded-t-sm')} style={{ height: `${Math.max(3, (s.requests / max) * (100 - err))}%` }} />
          </div>
        )
      })}
    </div>
  )
}

function Stats({ stats }: { stats: LogStats | null }) {
  if (!stats) {
    if (!apiEnabled) return <p className="rounded-2xl bg-ground px-4 py-3 text-sm text-slate">Connect the admin API to view server logs.</p>
    return (
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Bone key={i} className={cx('h-28 rounded-3xl', i === 4 && 'col-span-2 xl:col-span-1')} />
        ))}
      </div>
    )
  }
  const cards = [
    { label: 'Requests, 24h', value: compact(stats.requests), sub: `${compact(stats.clientErrors)} were 4xx` },
    { label: 'Server error rate', value: `${stats.errorRate}%`, sub: `${stats.serverErrors} responses were 5xx`, bad: stats.errorRate >= 1 },
    { label: 'Response time', value: ms(stats.p95), sub: `p95 · median ${ms(stats.p50)}`, bad: stats.p95 >= 2000 },
    { label: 'Security events', value: compact(stats.security), sub: stats.securityEvents[0] ? `Most: ${securityLabels[stats.securityEvents[0].event] ?? stats.securityEvents[0].event}` : 'None', warn: stats.security > 0 },
    { label: 'Open errors', value: stats.openErrors, sub: 'Grouped by cause', to: '/errors', bad: stats.openErrors > 0 },
  ]
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {cards.map((c, i) => {
          const body = (
            <>
              <p className="text-sm text-slate">{c.label}</p>
              <p className={cx('mt-1 font-display text-3xl font-semibold tabular', c.bad ? 'text-miss' : c.warn ? 'text-gold-ink' : '')}>{c.value}</p>
              <p className="mt-1 truncate text-sm text-slate">{c.sub}</p>
            </>
          )
          return (
            <li key={c.label} className={cx('rounded-3xl bg-surface p-4 ring-1 ring-line/70 sm:p-5', i === cards.length - 1 && 'col-span-2 xl:col-span-1')}>
              {c.to ? (
                <Link to={c.to} className="block rounded-xl">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          )
        })}
      </ul>
      <Panel className="mt-3">
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Last 24 hours</p>
            <p className="text-sm text-slate">
              Requests per hour, <span className="text-miss">errors</span> on top
            </p>
            <div className="mt-4">
              <HourBars series={stats.series} />
            </div>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:w-[44%]">
            <div>
              <p className="text-sm font-semibold">Slowest routes (p95)</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {stats.slowest.length === 0 && <li className="text-slate">Not enough traffic yet</li>}
                {stats.slowest.map((s) => (
                  <li key={s.path} className="flex justify-between gap-3">
                    <span className="truncate text-slate">{s.path}</span>
                    <span className="shrink-0 font-semibold tabular">{ms(s.p95)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold">Security events</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {stats.securityEvents.length === 0 && <li className="text-slate">None in the last 24 hours</li>}
                {stats.securityEvents.map((s) => (
                  <li key={s.event} className="flex justify-between gap-3">
                    <span className="truncate text-slate">{securityLabels[s.event] ?? s.event}</span>
                    <span className="shrink-0 font-semibold tabular">{compact(s.count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Panel>
    </>
  )
}

function RowsSkeleton() {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5">
          <Bone className="h-4 w-24" />
          <Bone className="size-2.5 rounded-full" />
          <Bone className="h-4 w-16" />
          <Bone className="h-4 flex-1" />
          <Bone className="hidden h-4 w-28 md:block" />
        </div>
      ))}
    </div>
  )
}

function Detail({ entry, onClose, onTrace }: { entry: LogEntry; onClose: () => void; onTrace: (requestId: string) => void }) {
  const toast = useToast()
  const [detail, setDetail] = useState<LogDetail | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetchLogDetail(entry.id)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : 'Couldn’t load this entry.'))
  }, [entry.id])

  function copy(text: string, what: string) {
    void navigator.clipboard?.writeText(text).then(
      () => toast({ title: `${what} copied`, inbox: false }),
      () => toast({ tone: 'error', title: `Couldn’t copy the ${what.toLowerCase()}`, inbox: false }),
    )
  }

  const facts: [string, string | null | undefined][] = [
    ['When', stamp(entry.at)],
    ['Type', `${kindLabel[entry.kind]} · ${levelStyle[entry.level].label}`],
    ['Source', entry.kind === 'security' ? `${securityLabels[entry.context] ?? entry.context} (${entry.context})` : entry.context],
    ['Request', entry.method ? `${entry.method} ${entry.path}` : null],
    ['Status', entry.status ? `${entry.status}${entry.durationMs !== null ? ` in ${ms(entry.durationMs)}` : ''}` : null],
    ['Person', entry.user ? `${entry.user.name} (@${entry.user.handle})` : null],
    ['IP address', entry.ip],
    ['Device', entry.userAgent],
  ]

  return (
    <Sheet title="Log entry" onClose={onClose} width={680}>
      <p className="font-semibold break-words">{entry.message}</p>
      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[8rem_1fr]">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        {entry.requestId && (
          <div className="contents">
            <dt className="text-slate">Request ID</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <code className="text-[13px] break-all">{entry.requestId}</code>
              <button type="button" onClick={() => copy(entry.requestId!, 'Request ID')} className="inline-flex items-center gap-1 text-sm font-semibold text-cobalt">
                <Copy size={14} /> Copy
              </button>
              <button type="button" onClick={() => onTrace(entry.requestId!)} className="text-sm font-semibold text-cobalt">
                Show everything from this request
              </button>
            </dd>
          </div>
        )}
      </dl>
      {Object.keys(entry.meta).length > 0 && (
        <>
          <p className="mt-5 text-sm font-semibold">Details</p>
          <pre className="mt-2 max-h-48 overflow-auto rounded-2xl bg-ground p-4 text-[13px] leading-relaxed">{JSON.stringify(entry.meta, null, 2)}</pre>
        </>
      )}
      {error && <p className="mt-5 text-sm text-miss">{error}</p>}
      {!detail && !error && entry.hasStack && <Bone className="mt-5 h-32 rounded-2xl" />}
      {detail?.stack && (
        <>
          <div className="mt-5 flex items-center justify-between">
            <p className="text-sm font-semibold">Stack trace</p>
            <button type="button" onClick={() => copy(detail.stack!, 'Stack trace')} className="inline-flex items-center gap-1 text-sm font-semibold text-cobalt">
              <Copy size={14} /> Copy
            </button>
          </div>
          <pre className="mt-2 max-h-72 overflow-auto rounded-2xl bg-ink p-4 text-[12.5px] leading-relaxed text-white/90">{detail.stack}</pre>
        </>
      )}
      {entry.errorGroupId && (
        <Button to={`/errors?e=${entry.errorGroupId}`} variant="secondary" className="mt-5">
          <Bug size={16} /> Open in error log
        </Button>
      )}
      {detail && detail.related.length > 0 && (
        <>
          <p className="mt-6 text-sm font-semibold">Same request</p>
          <ul className="mt-2 divide-y divide-line rounded-2xl ring-1 ring-line/70">
            {detail.related.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', levelStyle[r.level].dot)} />
                <span className="min-w-0 flex-1 break-words">{r.message}</span>
                <span className="shrink-0 text-slate">{kindLabel[r.kind]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  )
}

/**
 * Every request, app message and security event the API records. Searchable, filterable, and live.
 * IP addresses are personal data: this page is for Super admins and Risk analysts only.
 */
export function ServerLog() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [kind, setKind] = useState<KindTab>((params.get('kind') as KindTab) ?? 'all')
  const [level, setLevel] = useState(params.get('level') ?? 'any')
  const [status, setStatus] = useState(params.get('status') ?? 'any')
  const [q, setQ] = useState(params.get('q') ?? '')
  const [debounced, setDebounced] = useState(q)
  const [live, setLive] = useState(true)
  const [open, setOpen] = useState<LogEntry | null>(null)
  const requestId = params.get('request') ?? undefined
  const stats = useLogStats()

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const filters = useMemo(() => {
    const handle = debounced.startsWith('@') ? debounced : undefined
    return {
      kind: kind === 'all' ? undefined : kind,
      level: level === 'any' ? undefined : level,
      status: kind === 'request' || kind === 'all' ? (status === 'any' ? undefined : status) : undefined,
      q: handle ? undefined : debounced || undefined,
      user: handle,
      requestId,
    }
  }, [kind, level, status, debounced, requestId])
  const { items, error, hasMore, loadMore, loadingMore, retry } = useServerLogs(filters, live && !requestId)

  function trace(id: string) {
    setOpen(null)
    setParams({ request: id })
  }

  function exportCsv() {
    if (!items?.length) return
    const rows = [['time', 'level', 'kind', 'source', 'message', 'status', 'ms', 'user', 'ip', 'request_id'], ...items.map((l) => [l.at, l.level, l.kind, l.context, l.message, l.status ?? '', l.durationMs ?? '', l.user?.handle ?? '', l.ip ?? '', l.requestId ?? ''])]
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'stake-sync-server-log.csv'
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: 'Server log exported', body: `${items.length} entries`, inbox: false })
  }

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16">
      <PageHeader
        title="Server log"
        intro="Every request, app message and security event the API records. Passwords, tokens and codes are never stored."
        actions={
          <>
            <label className="flex h-11 items-center gap-2.5 rounded-full px-3 text-sm font-semibold ring-1 ring-line">
              <Toggle checked={live} onChange={setLive} label="Live updates" />
              Live
            </label>
            <Button variant="secondary" onClick={exportCsv} disabled={!items?.length}>
              <Download size={17} /> Export
            </Button>
          </>
        }
      />
      <Stats stats={stats} />

      <div className="mt-8">
        <Tabs<KindTab>
          label="Log type"
          active={kind}
          onChange={(k) => {
            setKind(k)
            if (requestId) setParams({})
          }}
          tabs={[
            { id: 'all', label: 'Everything' },
            { id: 'request', label: 'Requests' },
            { id: 'app', label: 'App' },
            { id: 'security', label: 'Security', count: stats?.security },
            { id: 'error', label: 'Errors', count: stats?.errors },
          ]}
        />
      </div>
      <div className="mt-4 flex flex-col gap-3 lg:flex-row">
        <label className="relative flex-1 lg:max-w-md">
          <span className="sr-only">Search the log</span>
          <Search size={17} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-slate" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Message, path, IP, or @username" className={cx(inputClass, 'pl-11')} />
        </label>
        <Select
          label="Level"
          value={level}
          onChange={setLevel}
          className="lg:w-48"
          options={[
            { value: 'any', label: 'All levels' },
            { value: 'error', label: 'Errors' },
            { value: 'warn,error', label: 'Warnings and errors' },
            { value: 'info', label: 'Info only' },
          ]}
        />
        {(kind === 'all' || kind === 'request') && (
          <Select
            label="Status"
            value={status}
            onChange={setStatus}
            className="lg:w-44"
            options={[
              { value: 'any', label: 'Any status' },
              { value: '2xx', label: '2xx success' },
              { value: '3xx', label: '3xx redirect' },
              { value: '4xx', label: '4xx refused' },
              { value: '5xx', label: '5xx failed' },
            ]}
          />
        )}
      </div>
      {requestId && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-cobalt-soft px-4 py-3 text-sm text-cobalt-deep">
          <span>
            Showing everything from request <code className="font-semibold">{requestId}</code>
          </span>
          <button type="button" onClick={() => setParams({})} className="font-semibold underline">
            Show all
          </button>
        </div>
      )}

      <div className="mt-5 overflow-hidden rounded-3xl bg-surface ring-1 ring-line/70">
        {error ? (
          <div className="px-5 py-12 text-center">
            <p className="font-semibold">The log didn’t load</p>
            <p className="mt-1 text-slate">{error}</p>
            <Button variant="secondary" className="mt-4" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : !items ? (
          <RowsSkeleton />
        ) : items.length === 0 ? (
          <p className="px-5 py-12 text-center text-slate">Nothing matches. Try a wider filter.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => setOpen(l)} className="grid w-full grid-cols-[auto_1fr] items-start gap-x-4 gap-y-1 px-5 py-3 text-left text-[15px] hover:bg-ground/70 md:grid-cols-[8.5rem_6.5rem_1fr_auto_9rem]">
                  <span className="text-sm whitespace-nowrap text-slate tabular">{stamp(l.at)}</span>
                  <span className="flex items-center gap-2 text-sm md:order-none">
                    <span className={cx('size-2.5 shrink-0 rounded-full', levelStyle[l.level].dot)} title={levelStyle[l.level].label} />
                    {l.kind === 'security' ? (
                      <Tag tone="gold">
                        <ShieldAlert size={12} /> Security
                      </Tag>
                    ) : l.kind === 'error' ? (
                      <Tag tone="ink">Error</Tag>
                    ) : (
                      <span className="text-slate">{l.kind === 'request' ? 'Request' : l.context}</span>
                    )}
                  </span>
                  <span className="col-span-2 min-w-0 md:col-span-1">
                    <span className="block truncate font-medium">{summary(l)}</span>
                    {l.kind !== 'request' && l.kind !== 'security' && l.context && <span className="block truncate text-sm text-slate">{l.context}</span>}
                    {l.kind === 'security' && <span className="block truncate text-sm text-slate">{securityDetail(l)}</span>}
                  </span>
                  <span className={cx('hidden text-sm font-semibold whitespace-nowrap tabular md:block', statusTone(l.status))}>
                    {l.status ? [l.status, ms(l.durationMs)].filter(Boolean).join(' · ') : ''}
                  </span>
                  <span className="hidden truncate text-sm text-slate md:block">{l.user ? `@${l.user.handle}` : (l.ip ?? '')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {hasMore && (
        <div className="mt-4 text-center">
          <Button variant="secondary" onClick={() => void loadMore()} busy={loadingMore}>
            Load older entries
          </Button>
        </div>
      )}
      {open && <Detail entry={open} onClose={() => setOpen(null)} onTrace={trace} />}
    </div>
  )
}
