import { Navigate, Outlet } from 'react-router'
import { useAuth } from './context'

/** Log in, sign up and password reset are for signed-out visitors only. */
export function GuestOnly() {
  const { session } = useAuth()
  if (session?.onboarded) return <Navigate to="/overview" replace />
  if (session) return <Navigate to="/start" replace />
  return <Outlet />
}
