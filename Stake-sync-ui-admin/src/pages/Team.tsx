import { Check, ShieldAlert, UserPlus, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useAdminAuth } from '../auth/context'
import { ReasonSheet } from '../components/ReasonSheet'
import { Sheet } from '../components/Sheet'
import { PanelSkeleton } from '../components/Skeleton'
import { Avatar, Button, Field, PageHeader, Tag } from '../components/ui'
import { permissions, type AdminRole } from '../data/admin'
import type { Person } from '../data/types'
import { api, apiEnabled } from '../lib/api'
import { cx } from '../lib/format'
import { inputClass } from '../lib/styles'
import { timeAgo } from '../lib/time'
import { useToast } from '../toast/context'
import { Select } from '../components/Select'

const roles: AdminRole[] = ['Super admin', 'Moderator', 'Risk analyst', 'Support', 'Finance (view only)']

interface TeamMember {
  id: string
  person: Person
  email: string | null
  role: AdminRole
  twoFactor: boolean
  lastActive: string | null
}

export function Team() {
  const { session } = useAdminAuth()
  const toast = useToast()
  const [team, setTeam] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [inviting, setInviting] = useState(false)
  const [pendingRole, setPendingRole] = useState<{ member: TeamMember; role: AdminRole } | null>(null)
  const missing2fa = team.filter((a) => !a.twoFactor)

  useEffect(() => {
    const controller = new AbortController()
    if (!apiEnabled) {
      setLoading(false)
      return () => controller.abort()
    }
    void api<TeamMember[]>('/admin/team', { signal: controller.signal }).then(setTeam).catch((e) => {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toast({ tone: 'error', title: 'Couldn’t load admin team', body: e instanceof Error ? e.message : 'Try again.' })
    }).finally(() => setLoading(false))
    return () => controller.abort()
  }, [toast])

  async function saveRole(email: string, role: AdminRole, reason: string) {
    try {
      await api('/admin/team', { method: 'PUT', body: { email, role, reason } })
      setTeam((current) => current.map((member) => member.email === email ? { ...member, role } : member))
      toast({ title: 'Role updated', body: `${email} is now ${role}.` })
    } catch (e) {
      toast({ tone: 'error', title: 'Couldn’t update role', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  async function grantRole(email: string, role: AdminRole, reason: string) {
    try {
      await api('/admin/team', { method: 'PUT', body: { email, role, reason } })
      setTeam(await api<TeamMember[]>('/admin/team'))
      toast({ title: 'Admin access granted', body: `${email} can now sign in as ${role}.` })
      return true
    } catch (e) {
      toast({ tone: 'error', title: 'Couldn’t grant admin access', body: e instanceof Error ? e.message : 'Try again.' })
      return false
    }
  }

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16">
      <PageHeader
        title="Team and roles"
        intro="Who can do what in admin. Roles limit each person to the work they need, and nobody can move escrowed funds."
        actions={
          <Button onClick={() => setInviting(true)}>
            <UserPlus size={17} /> Upgrade user to admin
          </Button>
        }
      />

      {missing2fa.length > 0 && (
        <p role="status" className="mb-5 flex items-start gap-3 rounded-2xl bg-miss-soft p-4 text-[15px] text-[oklch(45%_0.17_23)]">
          <ShieldAlert size={18} className="mt-0.5 shrink-0" />
          {missing2fa.map((a) => a.person.name).join(', ')} {missing2fa.length === 1 ? 'hasn’t' : 'haven’t'} set up two-step verification. They can’t take actions until they do.
        </p>
      )}

      {loading ? <PanelSkeleton className="mt-8" rows={5} /> : <div className="overflow-x-auto rounded-3xl bg-surface ring-1 ring-line/70">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-line text-left text-sm text-slate">
              <th className="px-5 py-3 font-normal">Admin</th>
              <th className="py-3 font-normal">Role</th>
              <th className="hidden py-3 font-normal md:table-cell">Two-step</th>
              <th className="hidden px-5 py-3 font-normal lg:table-cell">Last active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
              {team.map((a) => (
              <tr key={a.id}>
                <td className="px-5 py-3">
                  <span className="flex items-center gap-3">
                    <Avatar person={a.person} size={32} />
                    <span className="min-w-0">
                      <span className="block font-semibold">{a.person.name}</span>
                      <span className="block truncate text-sm text-slate">{a.email ?? 'No email on account'}</span>
                    </span>
                  </span>
                </td>
                <td className="py-3 pr-4">
                  {a.email && a.email.toLowerCase() !== session?.email.toLowerCase() ? <Select
                    look="compact"
                    label={`Role for ${a.person.name}`}
                    value={a.role}
                    onChange={(role) => role !== a.role && setPendingRole({ member: a, role })}
                    options={roles.map((r) => ({ value: r, label: r }))}
                  /> : <span>{a.role}</span>}
                </td>
                <td className="hidden py-3 md:table-cell">{a.twoFactor ? <Tag tone="cobalt">On</Tag> : <Tag tone="gold">Not set up</Tag>}</td>
                  <td className="hidden px-5 py-3 text-slate lg:table-cell">{a.lastActive ? timeAgo(a.lastActive) : 'Never'}</td>
              </tr>
            ))}
            {!team.length && <tr><td colSpan={4} className="px-5 py-8 text-center text-slate">No admin accounts yet.</td></tr>}
          </tbody>
        </table>
      </div>}

      <h2 className="mt-10 text-2xl font-bold">What each role can do</h2>
      <div className="mt-4 overflow-x-auto rounded-3xl bg-surface ring-1 ring-line/70">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-line text-left text-sm text-slate">
              <th className="px-5 py-3 font-normal">Action</th>
              {roles.map((r) => (
                <th key={r} className="px-3 py-3 text-center font-normal">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {permissions.map((p) => (
              <tr key={p.action} className={cx(p.roles.length === 0 && 'bg-ground/70')}>
                <td className="px-5 py-3 font-medium">
                  {p.action}
                  {p.roles.length === 0 && <span className="block text-sm font-normal text-slate">Handled only by the escrow program</span>}
                </td>
                {roles.map((r) => (
                  <td key={r} className="px-3 py-3 text-center">
                    {p.roles.includes(r) ? (
                      <Check size={17} strokeWidth={3} className="mx-auto text-calm" aria-label="Allowed" />
                    ) : (
                      <X size={15} className="mx-auto text-slate/40" aria-label="Not allowed" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pendingRole && <ReasonSheet title="Change admin role?" effect={<span>{pendingRole.member.person.name} will become <strong>{pendingRole.role}</strong>. This change is recorded in the audit log.</span>} confirm="Update role" onConfirm={(reason) => { if (pendingRole.member.email) void saveRole(pendingRole.member.email, pendingRole.role, reason) }} onClose={() => setPendingRole(null)} />}
      {inviting && <InviteAdmin onClose={() => setInviting(false)} onInvite={grantRole} />}
    </div>
  )
}

function InviteAdmin({ onClose, onInvite }: { onClose: () => void; onInvite: (email: string, role: AdminRole, reason: string) => Promise<boolean> }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AdminRole>('Support')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && reason.trim().length >= 8

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok) return
    setBusy(true)
    if (await onInvite(email.trim(), role, reason.trim())) onClose()
    setBusy(false)
  }

  return (
    <Sheet
      title="Upgrade user to admin"
      onClose={onClose}
      footer={
        <Button type="submit" form="invite-admin" className="w-full" disabled={!ok} busy={busy}>
          Grant admin access
        </Button>
      }
    >
      <form id="invite-admin" onSubmit={submit} className="space-y-4">
        <Field label="Account email" hint="User must already have a Stake-Sync account.">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Role" hint="Start with the least access they need. You can change it later.">
          <Select label="Role" value={role} onChange={setRole} options={roles.map((r) => ({ value: r, label: r }))} />
        </Field>
        <Field label="Reason" hint="Required for the audit log.">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className={inputClass} />
        </Field>
        <p className="text-sm text-slate">They must set up two-step verification before they can sign in.</p>
      </form>
    </Sheet>
  )
}
