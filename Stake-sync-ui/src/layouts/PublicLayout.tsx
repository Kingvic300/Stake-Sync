import { Menu, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/context'
import { Logo } from '../components/Logo'
import { ScrollToTop } from '../components/ScrollToTop'
import { SiteFooter } from '../components/SiteFooter'
import { Button } from '../components/ui'
import { cx } from '../lib/format'
import { gsap, prefersMotion, useGSAP } from '../lib/gsap'

const pages = [
  ['/how-it-works', 'How it works'],
  ['/verification', 'Verification'],
  ['/organizations', 'For organizations'],
]

export function PublicLayout() {
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (!open || !prefersMotion()) return
      gsap
        .timeline()
        .from('[data-menu-panel]', { yPercent: -8, autoAlpha: 0, duration: 0.3, ease: 'power3.out' })
        .from('[data-menu-panel] li', { y: 10, autoAlpha: 0, duration: 0.3, stagger: 0.05, ease: 'power2.out' }, '-=0.15')
    },
    { scope: menu, dependencies: [open] },
  )

  const close = () => setOpen(false)

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>
      <header ref={menu} className="sticky top-0 z-30 border-b border-line/80 bg-ground/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[120rem] items-center gap-8 px-4 sm:px-6 lg:px-12 2xl:px-16">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {pages.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cx(
                    'rounded-lg px-3 py-2 text-[15px] font-semibold transition-colors',
                    isActive ? 'bg-ink/[0.06] text-ink' : 'text-slate hover:text-ink',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {session ? (
              <Button to="/overview" size="sm">
                Open Stake-Sync
              </Button>
            ) : (
              <>
                <Button to="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">
                  Log in
                </Button>
                <Button to="/signup" size="sm">
                  Get started
                </Button>
              </>
            )}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="site-menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
              className="grid size-10 place-items-center rounded-full hover:bg-ink/5 md:hidden"
            >
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {open && (
          <div id="site-menu" data-menu-panel className="border-t border-line bg-surface md:hidden">
            <ul className="px-4 py-3">
              {pages.map(([to, label]) => (
                <li key={to}>
                  <Link to={to} onClick={close} className="block rounded-xl px-3 py-3.5 text-lg font-semibold hover:bg-ground">
                    {label}
                  </Link>
                </li>
              ))}
              {!session && (
                <li className="mt-2 border-t border-line pt-3">
                  <Link to="/login" onClick={close} className="block rounded-xl px-3 py-3.5 text-lg font-semibold hover:bg-ground">
                    Log in
                  </Link>
                </li>
              )}
            </ul>
          </div>
        )}
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
      <ScrollToTop />
    </div>
  )
}
