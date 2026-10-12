import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { AdminAuthProvider } from './auth/AdminAuthProvider'
import { RequireAdmin } from './auth/RequireAdmin'
import { RequireRole } from './auth/RequireRole'
import { LOG_ROLES, FINANCE_ROLES } from './auth/roles'
import { AppPageSkeleton, AuthSkeleton, ListPageSkeleton } from './components/Skeleton'
import './index.css'
import { AdminShell } from './layouts/AdminShell'
import { lazyPage } from './lib/lazyPage'
import { NotFound, RouteError } from './pages/Status'
import { AdminStoreProvider } from './state/AdminStoreProvider'
import { ToastProvider } from './toast/ToastProvider'

const router = createBrowserRouter([
  { path: '/login', element: lazyPage(() => import('./pages/Login'), 'Login', <AuthSkeleton />), errorElement: <RouteError /> },
  {
    element: <RequireAdmin />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AdminShell />,
        children: [
          { index: true, element: lazyPage(() => import('./pages/Overview'), 'Overview', <AppPageSkeleton />) },
          { path: 'disputes', element: lazyPage(() => import('./pages/Disputes'), 'Disputes', <ListPageSkeleton />) },
          { path: 'reviews', element: <RequireRole roles={['Super admin', 'Moderator', 'Support']}>{lazyPage(() => import('./pages/Reviews'), 'Reviews', <ListPageSkeleton />)}</RequireRole> },
          { path: 'risk', element: lazyPage(() => import('./pages/Risk'), 'Risk', <ListPageSkeleton />) },
          { path: 'reports', element: <RequireRole roles={['Super admin', 'Moderator']}>{lazyPage(() => import('./pages/Reports'), 'Reports', <ListPageSkeleton />)}</RequireRole> },
          { path: 'approvals', element: lazyPage(() => import('./pages/Approvals'), 'Approvals', <ListPageSkeleton />) },
          { path: 'users', element: lazyPage(() => import('./pages/Users'), 'Users', <ListPageSkeleton />) },
          { path: 'challenges', element: lazyPage(() => import('./pages/Challenges'), 'Challenges', <ListPageSkeleton />) },
          { path: 'organizations', element: lazyPage(() => import('./pages/Orgs'), 'Orgs', <ListPageSkeleton />) },
          { path: 'health', element: lazyPage(() => import('./pages/Health'), 'Health', <AppPageSkeleton />) },
          { path: 'treasury', element: <RequireRole roles={FINANCE_ROLES}>{lazyPage(() => import('./pages/Treasury'), 'Treasury', <AppPageSkeleton />)}</RequireRole> },
          { path: 'escrow', element: <RequireRole roles={FINANCE_ROLES}>{lazyPage(() => import('./pages/Escrow'), 'Escrow', <AppPageSkeleton />)}</RequireRole> },
          { path: 'audit', element: lazyPage(() => import('./pages/Audit'), 'Audit', <ListPageSkeleton />) },
          { path: 'logs', element: <RequireRole roles={LOG_ROLES}>{lazyPage(() => import('./pages/ServerLog'), 'ServerLog', <ListPageSkeleton />)}</RequireRole> },
          { path: 'errors', element: <RequireRole roles={LOG_ROLES}>{lazyPage(() => import('./pages/ErrorLog'), 'ErrorLog', <ListPageSkeleton />)}</RequireRole> },
          { path: 'team', element: <RequireRole roles={['Super admin']}>{lazyPage(() => import('./pages/Team'), 'Team', <ListPageSkeleton />)}</RequireRole> },
          { path: 'settings', element: <RequireRole roles={['Super admin']}>{lazyPage(() => import('./pages/Settings'), 'Settings', <AppPageSkeleton />)}</RequireRole> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminAuthProvider>
      <ToastProvider>
        <AdminStoreProvider>
          <RouterProvider router={router} />
        </AdminStoreProvider>
      </ToastProvider>
    </AdminAuthProvider>
  </StrictMode>,
)
