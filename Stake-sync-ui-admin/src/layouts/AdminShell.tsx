import {
  Activity,
  BadgeCheck,
  Bug,
  Building2,
  Camera,
  ClipboardList,
  Flag,
  Gauge,
  KeyRound,
  Landmark,
  LogOut,
  Menu,
  Scale,
  ScrollText,
  Search,
  Settings,
  ShieldAlert,
  Trophy,
  Users,
  Wallet as WalletIcon,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAdminAuth } from '../auth/context'
import { FINANCE_ROLES, LOG_ROLES } from '../auth/roles'
import { Logo } from '../components/Logo'
import { ScrollToTop } from '../components/ScrollToTop'
import { Avatar } from '../components/ui'
import type { AdminChallenge, AdminUser } from '../data/admin'
import { cx } from '../lib/format'
import { gsap, prefersMotion, useGSAP } from '../lib/gsap'
import { useAdminApi } from '../lib/useAdminApi'
import { useAdmin } from '../state/context'
import { useToast } from '../toast/context'

// Production runs on Solana mainnet; set VITE_SOLANA_CLUSTER=devnet only for test environments.
const cluster = import.meta.env.VITE_SOLANA_CLUSTER || 'mainnet-beta'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  count?: number
}

function useNav(): { title: string; items: NavItem[] }[] {
  const { disputes, reviews, risks, reports, approvals } = useAdmin()
  const { session } = useAdminAuth()
  const seesLogs = Boolean(session && LOG_ROLES.includes(session.role))
  const seesFinance = Boolean(session && FINANCE_ROLES.includes(session.role))
  const seesReviews = Boolean(session && ['Super admin', 'Moderator', 'Support'].includes(session.role))
  const seesReports = Boolean(session && ['Super admin', 'Moderator'].includes(session.role))
  const seesTeam = session?.role === 'Super admin'
  const open = (s: string) => s !== 'Approved' && s !== 'Failure confirmed'
  return [
    { title: '', items: [{ to: '/', label: 'Overview', icon: Gauge }] },
    {
      title: 'Queues',
      items: [
        { to: '/disputes', label: 'Disputes', icon: Scale, count: disputes.filter((d) => open(d.status)).length },
        ...(seesReviews ? [{ to: '/reviews', label: 'Proof reviews', icon: Camera, count: reviews.length }] : []),
        { to: '/risk', label: 'Risk and Sybil', icon: ShieldAlert, count: risks.filter((r) => r.status === 'Open').length },
        ...(seesReports ? [{ to: '/reports', label: 'Reports', icon: Flag, count: reports.length }] : []),
        { to: '/approvals', label: 'Approvals', icon: KeyRound, count: approvals.length },
      ],
    },
    {
      title: 'Platform',
      items: [
        { to: '/users', label: 'Users', icon: Users },
        { to: '/challenges', label: 'Challenges', icon: Trophy },
        { to: '/organizations', label: 'Organizations', icon: Building2 },
        { to: '/health', label: 'Verification health', icon: Activity },
      ],
    },
    {
      title: 'Money',
      items: [
        ...(seesFinance ? [{ to: '/escrow', label: 'Escrow and settlements', icon: Landmark }, { to: '/treasury', label: 'Treasury', icon: WalletIcon }] : []),
      ],
    },
    ...(seesLogs
      ? [
          {
            title: 'System',
            items: [
              { to: '/logs', label: 'Server log', icon: ScrollText },
              { to: '/errors', label: 'Error log', icon: Bug },
            ],
          },
        ]
      : []),
    {
      title: 'Governance',
      items: [
        { to: '/audit', label: 'Audit log', icon: ClipboardList },
        ...(seesTeam ? [{ to: '/team', label: 'Team and roles', icon: BadgeCheck }, { to: '/settings', label: 'Settings', icon: Settings }] : []),
      ],
    },
  ]
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const groups = useNav()
  return (
    <nav aria-label="Admin" className="flex flex-col gap-6 px-3 py-5">
      {groups.map((g) => (
        <div key={g.title || 'top'}>
          {g.title && <div className="px-3 pb-1.5 text-xs font-semibold text-slate">{g.title}</div>}
          <ul className="space-y-0.5">
            {g.items.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cx(
                      'flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] font-medium transition-colors',
                      isActive ? 'bg-ink text-white' : 'text-ink/80 hover:bg-ink/5 hover:text-ink',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <n.icon size={18} className={isActive ? 'text-white' : 'text-slate'} />
                      <span className="flex-1 truncate">{n.label}</span>
                      {!!n.count && (
                        <span
                          className={cx(
                            'grid min-w-6 place-items-center rounded-full px-1.5 text-xs font-bold tabular',
                            isActive ? 'bg-white/15 text-white' : 'bg-gold-soft text-gold-ink',
                          )}
                        >
                          {n.count}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/** ⌘K / Ctrl+K: jump to any page, user or challenge. */
function CommandPalette({ onClose }: { onClose: () => void }) {
  const groups = useNav()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const { reports } = useAdmin()
  const { data: users } = useAdminApi<AdminUser[]>(q.trim().length >= 2 ? `/admin/users?q=${encodeURIComponent(q.trim())}` : null)
  const { data: challenges } = useAdminApi<AdminChallenge[]>(q.trim().length >= 2 ? '/admin/challenges' : null)

  const items = [
    ...groups.flatMap((g) => g.items.map((n) => ({ label: n.label, hint: 'Page', to: n.to }))),
    ...(users ?? []).map((u) => ({ label: u.person.name, hint: `User @${u.person.handle}`, to: `/users?u=${u.person.handle}` })),
    ...(challenges ?? []).map((c) => ({ label: c.title, hint: `Challenge, ${c.host}`, to: `/challenges?c=${c.id}` })),
    ...reports.map((r) => ({ label: `Report on @${r.author.handle}`, hint: r.reason, to: '/reports' })),
  ].filter((x) => `${x.label} ${x.hint}`.toLowerCase().includes(q.toLowerCase()))
  const shown = items.slice(0, 8)

  useGSAP(
    () => {
      if (!prefersMotion()) return
      gsap.from('[data-palette]', { y: -12, scale: 0.98, opacity: 0, duration: 0.22, ease: 'power3.out' })
    },
    { scope: root },
  )

  function go(to: string) {
    navigate(to)
    onClose()
  }

  return (
    <div ref={root} className="fixed inset-0 z-[80] flex items-start justify-center bg-ink/40 p-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        data-palette
        role="dialog"
        aria-label="Search"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-3xl bg-surface shadow-(--shadow-sheet) ring-1 ring-line"
      >
        <div className="flex items-center gap-3 border-b border-line px-5">
          <Search size={18} className="text-slate" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setI(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setI((x) => Math.min(x + 1, shown.length - 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setI((x) => Math.max(x - 1, 0))
              }
              if (e.key === 'Enter' && shown[i]) go(shown[i].to)
              if (e.key === 'Escape') onClose()
            }}
            placeholder="Search pages, users, challenges"
            aria-label="Search"
            className="h-14 flex-1 bg-transparent text-[16px] outline-none"
          />
          <kbd className="rounded-md bg-ground px-1.5 py-0.5 text-xs text-slate">Esc</kbd>
        </div>
        <ul role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {shown.length === 0 && <li className="px-4 py-8 text-center text-slate">Nothing matches “{q}”.</li>}
          {shown.map((x, k) => (
            <li key={`${x.to}-${x.label}`} role="option" aria-selected={k === i}>
              <button
                type="button"
                onMouseEnter={() => setI(k)}
                onClick={() => go(x.to)}
                className={cx('flex w-full items-center justify-between gap-4 rounded-xl px-4 py-2.5 text-left', k === i && 'bg-ground')}
              >
                <span className="truncate font-semibold">{x.label}</span>
                <span className="shrink-0 text-sm text-slate">{x.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function AdminShell() {
  const { session, signOut } = useAdminAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const me = { name: session?.name ?? 'Admin', handle: 'admin', hue: 250 }

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-16 shrink-0 items-center border-b border-line px-5">
          <Logo />
        </div>
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
          <Sidebar />
        </div>
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-label="Navigation">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setDrawer(false)} />
          <div className="relative h-full w-72 overflow-y-auto bg-surface">
            <div className="flex h-16 items-center justify-between px-5">
              <Logo />
              <button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="grid size-9 place-items-center rounded-full hover:bg-ink/5">
                <X size={18} />
              </button>
            </div>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur-md sm:px-6 lg:px-12 2xl:px-16">
          <button type="button" aria-label="Open menu" onClick={() => setDrawer(true)} className="grid size-10 place-items-center rounded-full hover:bg-ink/5 lg:hidden">
            <Menu size={20} />
          </button>
          <button
            type="button"
            onClick={() => setPalette(true)}
            className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl bg-ground px-3.5 text-left text-sm text-slate ring-1 ring-transparent transition-shadow hover:ring-line sm:max-w-sm"
          >
            <Search size={16} />
            <span className="flex-1 truncate">Search users, challenges, pages</span>
            <kbd className="hidden rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-line sm:inline">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-3">
          <span
            className={cx(
              'hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold sm:inline-flex',
              cluster === 'mainnet-beta' ? 'bg-calm-soft text-calm' : 'bg-gold-soft text-gold-ink',
            )}
            title={`Connected to Solana ${cluster === 'mainnet-beta' ? 'mainnet' : cluster}`}
          >
            <span className={cx('size-1.5 rounded-full', cluster === 'mainnet-beta' ? 'bg-calm' : 'bg-gold')} /> {cluster === 'mainnet-beta' ? 'Mainnet' : 'Devnet'}
          </span>
          <span aria-hidden className="hidden h-6 w-px bg-line sm:block" />
          <div className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={menu} aria-label="Admin menu" onClick={() => setMenu((v) => !v)} className="flex items-center gap-2 rounded-full p-1 pr-3 hover:bg-ink/5">
              <Avatar person={me} size={32} />
              <span className="hidden text-left text-sm leading-tight md:block">
                <span className="block font-semibold">{session?.name}</span>
                <span className="block text-slate">{session?.role}</span>
              </span>
            </button>
            {menu && (
              <div role="menu" className="absolute top-12 right-0 z-40 w-56 rounded-2xl bg-surface p-1.5 shadow-(--shadow-sheet) ring-1 ring-line">
                <div className="px-3 py-2 text-sm">
                  <div className="font-semibold">{session?.email}</div>
                  <div className="text-slate">{session?.role}</div>
                </div>
                <div className="my-1 h-px bg-line" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    signOut()
                    navigate('/login')
                    toast({ tone: 'info', title: 'Signed out of admin' })
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-semibold text-[oklch(52%_0.19_23)] hover:bg-miss-soft"
                >
                  <LogOut size={18} /> Sign out
                </button>
              </div>
            )}
          </div>
          </div>
        </header>
        <main id="main" key={pathname} className="min-w-0 flex-1 bg-ground">
          <Outlet />
        </main>
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      <ScrollToTop />
    </div>
  )
}
