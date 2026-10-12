import { Navigate, Outlet, useLocation } from 'react-router'
import { apiEnabled } from '../lib/api'
import { useAdminAuth } from './context'

export function RequireAdmin() {
  const { session } = useAdminAuth()
  const location = useLocation()
  if (!apiEnabled || !session?.accessToken) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}
