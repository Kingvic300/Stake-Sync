import { Compass, House, LayoutGrid, Plus, Trophy, Wallet } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router'
import { Logo } from '../components/Logo'
import { ScrollToTop } from '../components/ScrollToTop'
import { cx, usd, usdShort } from '../lib/format'
import { useLedger } from '../state/ledger-context'
import { NetworkSwitcher } from '../components/NetworkSwitcher'
import { AccountMenu } from './AccountMenu'
import { NotificationsMenu } from './NotificationsMenu'

const nav = [
  { to: '/overview', label: 'Overview', short: 'Home', icon: House },
  { to: '/dashboard', label: 'My challenges', short: 'Mine', icon: LayoutGrid },
  { to: '/create', label: 'Create', icon: Plus },
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy, desktopOnly: true },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
]

export function AppShell() {
  const { available } = useLedger()
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line/80 bg-ground/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[120rem] items-center gap-6 px-4 sm:px-6 lg:px-12 2xl:px-16">
          <Logo to="/overview" />
          <nav aria-label="Main" className="hidden min-w-0 items-center gap-0.5 lg:flex xl:gap-1">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cx(
                    'rounded-lg px-3 py-2 text-[15px] font-semibold whitespace-nowrap transition-colors',
                    isActive ? 'bg-ink/[0.06] text-ink' : 'text-slate hover:text-ink',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <NetworkSwitcher />
            <Link
              to="/wallet"
              aria-label={`Balance ${usd(available, { cents: true })} USDC. Open wallet`}
              title={`${usd(available, { cents: true })} USDC`}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-surface pr-4 pl-3 text-sm font-semibold whitespace-nowrap ring-1 ring-line transition-shadow hover:ring-slate/40"
            >
              <span className="size-2 rounded-full bg-calm" aria-hidden />
              <span className="tabular">{usdShort(available)}</span>
              <span className="hidden font-normal text-slate xl:inline">USDC</span>
            </Link>
            <NotificationsMenu />
            <AccountMenu />
          </div>
        </div>
      </header>

      <main id="main" className="flex-1 pb-24 lg:pb-12">
        <Outlet />
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <ul className="grid grid-cols-5">
          {nav.filter((n) => !('desktopOnly' in n)).map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to}
                className={({ isActive }) =>
                  cx(
                    'flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold',
                    isActive ? 'text-cobalt' : 'text-slate',
                  )
                }
              >
                {n.to === '/create' ? (
                  <span className="grid size-9 place-items-center rounded-xl bg-ink text-white">
                    <n.icon size={20} />
                    <span className="sr-only">{n.label}</span>
                  </span>
                ) : (
                  <>
                    <n.icon size={21} />
                    {'short' in n && n.short ? n.short : n.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <ScrollToTop />
    </div>
  )
}
