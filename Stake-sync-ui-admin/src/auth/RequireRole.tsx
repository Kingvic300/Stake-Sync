import { ShieldAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../components/ui'
import type { AdminRole } from '../data/admin'
import { useAdminAuth } from './context'

/** Shows a plain explanation instead of the page when the admin's role can't use it. */
export function RequireRole({ roles, children }: { roles: AdminRole[]; children: ReactNode }) {
  const { session } = useAdminAuth()
  if (session && roles.includes(session.role)) return children
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <ShieldAlert size={32} className="mx-auto text-gold-ink" />
      <h1 className="mt-4 text-3xl font-bold">You don’t have access to this page</h1>
      <p className="mt-2 text-slate">It’s for {roles.join(' and ').toLowerCase()}s. Ask a super admin if you need it.</p>
      <Button to="/" variant="secondary" className="mt-6">
        Back to overview
      </Button>
    </div>
  )
}
