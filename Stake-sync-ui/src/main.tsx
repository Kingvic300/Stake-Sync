import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { GuestOnly } from './auth/GuestOnly'
import { RequireAuth } from './auth/RequireAuth'
import {
  AppPageSkeleton,
  AuthSkeleton,
  DetailPageSkeleton,
  FormPageSkeleton,
  ListPageSkeleton,
  MarketingSkeleton,
  ProfilePageSkeleton,
} from './components/Skeleton'
import './index.css'
import { AppShell } from './layouts/AppShell'
import { lazyPage } from './lib/lazyPage'
import { AuthLayout } from './layouts/AuthLayout'
import { PublicLayout } from './layouts/PublicLayout'
import { Landing } from './pages/Landing'
import { EnterCode, NotFound, RouteError } from './pages/system/Status'
import { LedgerProvider } from './state/LedgerProvider'
import { InboxProvider } from './notifications/InboxProvider'
import { ToastProvider } from './toast/ToastProvider'

const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Landing /> },
      { path: 'join', element: <EnterCode /> },
      { path: 'how-it-works', element: lazyPage(() => import('./pages/public/HowItWorks'), 'HowItWorks', <MarketingSkeleton />) },
      { path: 'verification', element: lazyPage(() => import('./pages/public/Verification'), 'Verification', <MarketingSkeleton />) },
      { path: 'organizations', element: lazyPage(() => import('./pages/public/Organizations'), 'Organizations', <MarketingSkeleton />) },
      { path: 'i/:code', element: lazyPage(() => import('./pages/public/Invite'), 'ChallengeInvite', <MarketingSkeleton />) },
      { path: 'join/:code', element: lazyPage(() => import('./pages/public/Invite'), 'OrgInvite', <MarketingSkeleton />) },
      { path: 'terms', element: lazyPage(() => import('./pages/public/Legal'), 'Terms', <MarketingSkeleton />) },
      { path: 'privacy', element: lazyPage(() => import('./pages/public/Legal'), 'Privacy', <MarketingSkeleton />) },
    ],
  },
  {
    element: <AuthLayout />,
    errorElement: <RouteError />,
    children: [
      {
        element: <GuestOnly />,
        children: [
          { path: 'login', element: lazyPage(() => import('./pages/auth/AuthForms'), 'Login', <AuthSkeleton />) },
          { path: 'signup', element: lazyPage(() => import('./pages/auth/AuthForms'), 'Signup', <AuthSkeleton />) },
          { path: 'forgot', element: lazyPage(() => import('./pages/auth/AuthForms'), 'Forgot', <AuthSkeleton />) },
        ],
      },
      // One-time links: they work whether or not someone is signed in.
      { path: 'auth/callback/:provider', element: lazyPage(() => import('./pages/auth/AuthForms'), 'AuthCallback', <AuthSkeleton />) },
      { path: 'reset-password', element: lazyPage(() => import('./pages/auth/AuthForms'), 'ResetPassword', <AuthSkeleton />) },
      { path: 'verify-email', element: lazyPage(() => import('./pages/auth/AuthForms'), 'VerifyEmail', <AuthSkeleton />) },
      {
        element: <RequireAuth onboarding />,
        children: [{ path: 'start', element: lazyPage(() => import('./pages/auth/Onboarding'), 'Onboarding', <AuthSkeleton />) }],
      },
    ],
  },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: 'overview', element: lazyPage(() => import('./pages/app/Overview'), 'Overview', <AppPageSkeleton />) },
          { path: 'dashboard', element: lazyPage(() => import('./pages/app/MyChallenges'), 'MyChallenges', <AppPageSkeleton />) },
          { path: 'explore', element: lazyPage(() => import('./pages/app/Explore'), 'Explore', <ListPageSkeleton />) },
          { path: 'c/:id', element: lazyPage(() => import('./pages/app/ChallengeDetail'), 'ChallengeDetail', <DetailPageSkeleton />) },
          { path: 'create', element: lazyPage(() => import('./pages/app/Create'), 'Create', <FormPageSkeleton />) },
          { path: 'leaderboard', element: lazyPage(() => import('./pages/app/Leaderboard'), 'Leaderboard', <ListPageSkeleton />) },
          { path: 'workout/:id', element: lazyPage(() => import('./pages/app/Workout'), 'Workout', <AppPageSkeleton />) },
          { path: 'wallet', element: lazyPage(() => import('./pages/app/Wallet'), 'Wallet', <AppPageSkeleton />) },
          { path: 'u/:handle', element: lazyPage(() => import('./pages/app/Profile'), 'Profile', <ProfilePageSkeleton />) },
          { path: 'org/:slug', element: lazyPage(() => import('./pages/app/OrgDashboard'), 'OrgDashboard', <AppPageSkeleton />) },
          { path: 'disputes', element: lazyPage(() => import('./pages/app/Disputes'), 'Disputes', <ListPageSkeleton />) },
          { path: 'home', element: <Navigate to="/overview" replace /> },
        ],
      },
    ],
  },
  { path: '*', element: <PublicLayout />, errorElement: <RouteError />, children: [{ path: '*', element: <NotFound /> }] },
])

// After a deploy, an open tab may ask for page files that no longer exist. Reload once to get the new ones.
window.addEventListener('vite:preloadError', (e) => {
  try {
    if (sessionStorage.getItem('stakesync.reloaded')) return
    sessionStorage.setItem('stakesync.reloaded', '1')
  } catch {
    return
  }
  e.preventDefault()
  window.location.reload()
})
// A page that loaded fine clears the flag, so the next deploy can reload again.
window.addEventListener('load', () => window.setTimeout(() => sessionStorage.removeItem('stakesync.reloaded'), 10_000))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <LedgerProvider>
        <InboxProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </InboxProvider>
      </LedgerProvider>
    </AuthProvider>
  </StrictMode>,
)
