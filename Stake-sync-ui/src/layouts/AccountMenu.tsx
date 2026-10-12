import { ChevronRight, HelpCircle, KeyRound, LogOut, Plus, Scale, Settings, Trophy, User, Wallet } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { personOf, useAuth } from '../auth/context'
import { CreateOrgSheet } from '../components/CreateOrg'
import { JoinCodeSheet } from '../components/JoinCode'
import { Avatar } from '../components/ui'
import { useApiData } from '../lib/useApiData'
import { cx, usd } from '../lib/format'
import { gsap, prefersMotion, useGSAP } from '../lib/gsap'
import { canManage, useMyOrgs } from '../lib/useMyOrgs'
import { useLedger } from '../state/ledger-context'
import { useToast } from '../toast/context'

export function AccountMenu() {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState(false)
  const [creating, setCreating] = useState(false)
  const orgs = useMyOrgs()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const { session, signOut } = useAuth()
  const { available } = useLedger()
  const navigate = useNavigate()
  const toast = useToast()
  const handle = session?.username ?? ''
  // Read when the menu opens, so a closed menu costs nothing.
  const score = useApiData<{ score: number }>(open && handle ? `/users/${encodeURIComponent(handle)}` : null).data?.score
  const openDisputes = (useApiData<{ status: string }[]>(open ? '/disputes' : null).data ?? []).filter((d) => d.status === 'Under review' || d.status === 'Needs evidence').length
  const me = personOf(session)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useGSAP(
    () => {
      if (!open) return
      root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
      if (!prefersMotion()) return
      gsap
        .timeline()
        // Opacity only: visibility:hidden would block focusing the first item.
        .from('[data-account-panel]', { y: -8, scale: 0.97, opacity: 0, transformOrigin: 'top right', duration: 0.26, ease: 'power3.out' })
        .from('[data-account-panel] [data-row]', { y: 6, opacity: 0, duration: 0.25, stagger: 0.025, ease: 'power2.out', clearProps: 'all' }, '-=0.12')
    },
    { scope: root, dependencies: [open] },
  )

  // Arrow keys move between items, like a native menu.
  function onMenuKey(e: ReactKeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  const close = () => setOpen(false)

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
        className={cx('grid size-10 place-items-center rounded-full transition-shadow hover:ring-4 hover:ring-ink/5', open && 'ring-4 ring-cobalt/20')}
      >
        <Avatar person={me} size={34} src={session?.avatar} />
      </button>

      {open && (
        <div
          data-account-panel
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKey}
          className="absolute top-12 right-0 z-40 w-[19rem] overflow-hidden rounded-3xl bg-surface shadow-(--shadow-sheet) ring-1 ring-line"
        >
          <Link
            to={`/u/${handle}`}
            role="menuitem"
            onClick={close}
            data-row
            className="group flex items-center gap-3 p-4 transition-colors hover:bg-ground focus-visible:bg-ground"
          >
            <Avatar person={me} size={44} src={session?.avatar} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{me.name}</span>
              <span className="block truncate text-sm text-slate">{session?.email}</span>
            </span>
            {score !== undefined && (
              <span className="rounded-full bg-cobalt-soft px-2.5 py-1 font-display text-sm font-bold text-cobalt-deep tabular" title="Commitment score">
                {score}
              </span>
            )}
          </Link>

          <div className="border-t border-line p-1.5">
            <Item to={`/u/${handle}`} icon={<User size={18} />} onClick={close}>
              Your profile
            </Item>
            <Item to="/wallet" icon={<Wallet size={18} />} onClick={close} trail={<span className="text-sm text-slate tabular">{usd(available, { cents: true })}</span>}>
              Wallet
            </Item>
            <Item to="/leaderboard" icon={<Trophy size={18} />} onClick={close}>
              Leaderboard
            </Item>
            <Item
              to="/disputes"
              icon={<Scale size={18} />}
              onClick={close}
              trail={
                openDisputes > 0 && (
                  <span className="grid min-w-5 place-items-center rounded-full bg-gold-soft px-1.5 text-xs font-bold text-gold-ink tabular">{openDisputes}</span>
                )
              }
            >
              Disputes
            </Item>
            <Item to={`/u/${handle}?tab=settings`} icon={<Settings size={18} />} onClick={close}>
              Settings
            </Item>
          </div>

          <div className="border-t border-line p-1.5">
            <div data-row className="px-3 pt-2 pb-1 text-xs font-semibold text-slate">
              Organizations
            </div>
            {orgs.map((o) => (
              <Item
                key={o.slug}
                to={canManage(o.role) ? `/org/${o.slug}` : `/join/${o.inviteCode}`}
                onClick={close}
                icon={<Avatar person={o.person} size={22} />}
                trail={<span className="text-xs text-slate">{o.role}</span>}
              >
                {o.name}
              </Item>
            ))}
            <button
              type="button"
              role="menuitem"
              data-row
              onClick={() => {
                close()
                setCode(true)
              }}
              className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] text-slate transition-colors hover:bg-ground hover:text-ink focus-visible:bg-ground"
            >
              <span className="grid size-6 shrink-0 place-items-center text-slate group-hover:text-ink">
                <KeyRound size={18} />
              </span>
              Join with a code
            </button>
            <button
              type="button"
              role="menuitem"
              data-row
              onClick={() => {
                close()
                setCreating(true)
              }}
              className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] text-slate transition-colors hover:bg-ground hover:text-ink focus-visible:bg-ground"
            >
              <span className="grid size-6 shrink-0 place-items-center text-slate group-hover:text-ink">
                <Plus size={18} />
              </span>
              Create an organization
            </button>
          </div>

          <div className="border-t border-line p-1.5">
            <Item to="/how-it-works" icon={<HelpCircle size={18} />} onClick={close} muted>
              Help and how it works
            </Item>
            <button
              type="button"
              role="menuitem"
              data-row
              onClick={() => {
                signOut()
                navigate('/')
                toast({ tone: 'info', title: 'You’re logged out', inbox: false })
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-semibold text-[oklch(52%_0.19_23)] transition-colors hover:bg-miss-soft focus-visible:bg-miss-soft"
            >
              <LogOut size={18} />
              Log out
            </button>
          </div>
        </div>
      )}
      {code && <JoinCodeSheet onClose={() => setCode(false)} />}
      {creating && <CreateOrgSheet onClose={() => setCreating(false)} />}
    </div>
  )
}

function Item({
  to,
  icon,
  children,
  trail,
  onClick,
  muted,
}: {
  to: string
  icon: ReactNode
  children: ReactNode
  trail?: ReactNode
  onClick: () => void
  muted?: boolean
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onClick}
      data-row
      className={cx(
        'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors hover:bg-ground focus-visible:bg-ground',
        muted ? 'text-slate hover:text-ink' : 'font-medium text-ink',
      )}
    >
      <span className="grid size-6 shrink-0 place-items-center text-slate group-hover:text-ink">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trail}
      {!trail && !muted && <ChevronRight size={16} className="text-slate/0 transition-colors group-hover:text-slate" />}
    </Link>
  )
}
