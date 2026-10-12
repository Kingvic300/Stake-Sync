import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './context'

/** Sends signed-out visitors to log in, and new accounts through onboarding first. */
export function RequireAuth({ onboarding = false }: { onboarding?: boolean }) {
  const { session } = useAuth()
  const location = useLocation()
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!onboarding && !session.onboarded) return <Navigate to="/start" replace />
  if (onboarding && session.onboarded) return <Navigate to="/overview" replace />
  return <Outlet />
}
