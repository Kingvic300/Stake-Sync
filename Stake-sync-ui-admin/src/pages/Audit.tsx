import { Download, Search } from 'lucide-react'
import { useState } from 'react'
import { Button, PageHeader } from '../components/ui'
import { cx } from '../lib/format'
import { inputClass } from '../lib/styles'
import { stamp } from '../lib/time'
import { useAdmin } from '../state/context'
import { useToast } from '../toast/context'
import { Select } from '../components/Select'

/** Append-only record of every admin action. Entries can't be edited or deleted from here. */
export function Audit() {
  const { audit } = useAdmin()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [actor, setActor] = useState('all')
  const actors = [...new Set(audit.map((a) => a.actor))]
  const list = audit.filter((a) => (actor === 'all' || a.actor === actor) && `${a.action} ${a.target} ${a.reason}`.toLowerCase().includes(q.toLowerCase()))

  function exportCsv() {
    const rows = [['time', 'admin', 'action', 'target', 'reason'], ...list.map((a) => [a.at, a.actor, a.action, a.target, a.reason])]
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'stake-sync-audit-log.csv'
    link.click()
    URL.revokeObjectURL(url)
    toast({ title: 'Audit log exported', body: `${list.length} entries` })
  }

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16">
      <PageHeader
        title="Audit log"
        intro="Every admin action, who took it and why. Entries can’t be changed or deleted."
        actions={
          <Button variant="secondary" onClick={exportCsv}>
            <Download size={17} /> Export CSV
          </Button>
        }
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1 sm:max-w-sm">
          <span className="sr-only">Search the audit log</span>
          <Search size={17} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-slate" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Action, target or reason" className={cx(inputClass, 'pl-11')} />
        </label>
        <Select
          label="Admin"
          value={actor}
          onChange={setActor}
          className="sm:w-56"
          options={[{ value: 'all', label: 'All admins' }, ...actors.map((a) => ({ value: a, label: a }))]}
        />
      </div>
      <div className="mt-5 overflow-x-auto rounded-3xl bg-surface ring-1 ring-line/70">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-line text-left text-sm text-slate">
              <th className="px-5 py-3 font-normal">When</th>
              <th className="py-3 font-normal">Admin</th>
              <th className="py-3 font-normal">Action</th>
              <th className="py-3 font-normal">Target</th>
              <th className="hidden px-5 py-3 font-normal lg:table-cell">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((a) => (
              <tr key={a.id} className="align-top">
                <td className="px-5 py-3 whitespace-nowrap text-slate tabular">{stamp(a.at)}</td>
                <td className="py-3 pr-4 font-semibold whitespace-nowrap">{a.actor}</td>
                <td className="py-3 pr-4">{a.action}</td>
                <td className="py-3 pr-4">{a.target}</td>
                <td className="hidden px-5 py-3 text-slate lg:table-cell">{a.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <p className="px-5 py-10 text-center text-slate">No entries match.</p>}
      </div>
    </div>
  )
}
