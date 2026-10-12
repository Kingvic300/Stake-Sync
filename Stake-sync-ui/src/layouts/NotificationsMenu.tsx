import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Check,
  CircleDollarSign,
  Flag,
  Heart,
  Megaphone,
  MessageCircle,
  Scale,
  Trophy,
  TrendingUp,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useInbox } from '../notifications/context'
import type { NotificationKind } from '../data/types'
import { cx } from '../lib/format'
import { gsap, prefersMotion, useGSAP } from '../lib/gsap'

const kindStyle: Record<NotificationKind, { icon: typeof Bell; tone: string }> = {
  starting: { icon: CalendarClock, tone: 'bg-cobalt-soft text-cobalt-deep' },
  verified: { icon: Check, tone: 'bg-cobalt-soft text-cobalt-deep' },
  deadline: { icon: CalendarClock, tone: 'bg-gold-soft text-gold-ink' },
  strike: { icon: Heart, tone: 'bg-miss-soft text-miss' },
  penalty: { icon: AlertTriangle, tone: 'bg-miss-soft text-miss' },
  message: { icon: MessageCircle, tone: 'bg-tile text-ink' },
  leaderboard: { icon: TrendingUp, tone: 'bg-calm-soft text-calm' },
  completed: { icon: Trophy, tone: 'bg-gold-soft text-gold-ink' },
  reward: { icon: CircleDollarSign, tone: 'bg-calm-soft text-calm' },
  dispute: { icon: Scale, tone: 'bg-gold-soft text-gold-ink' },
  announcement: { icon: Megaphone, tone: 'bg-tile text-ink' },
  activity: { icon: Check, tone: 'bg-calm-soft text-calm' },
  problem: { icon: AlertTriangle, tone: 'bg-miss-soft text-miss' },
}

function ago(n: { id: string; at: string }) {
  const now = Date.now()
  const mins = Math.round((now - new Date(n.at).getTime()) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / 1440)}d`
}

export function NotificationsMenu() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const { items, unread, markAll, markOne: read } = useInbox()
  const root = useRef<HTMLDivElement>(null)
  const list = tab === 'unread' ? items.filter((n) => n.unread) : items

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useGSAP(
    () => {
      if (!open || !prefersMotion()) return
      gsap
        .timeline()
        .from('[data-notif-panel]', { y: -8, scale: 0.97, autoAlpha: 0, transformOrigin: 'top right', duration: 0.28, ease: 'power3.out' })
        .from('[data-notif-item]', { y: 8, autoAlpha: 0, duration: 0.3, stagger: 0.035, ease: 'power2.out', clearProps: 'all' }, '-=0.12')
    },
    { scope: root, dependencies: [open] },
  )

  const markOne = (id: string) => {
    read(id)
    setOpen(false)
  }

  return (
    <div ref={root} className="sm:relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Notifications, ${unread} unread`}
        className={cx(
          'relative grid size-10 place-items-center rounded-full text-ink transition-colors hover:bg-ink/5',
          open && 'bg-ink/[0.06]',
        )}
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 grid min-w-4 place-items-center rounded-full bg-miss px-1 text-[10px] font-bold text-white ring-2 ring-ground">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div
          data-notif-panel
          role="dialog"
          aria-label="Notifications"
          className="absolute inset-x-2 top-[calc(100%+6px)] z-40 flex max-h-[min(36rem,calc(100dvh-6rem))] flex-col overflow-hidden rounded-3xl bg-surface shadow-(--shadow-sheet) ring-1 ring-line sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[25rem]"
        >
          <header className="flex items-center justify-between px-5 pt-5">
            <h2 className="text-xl font-bold">Notifications</h2>
            <button
              type="button"
              onClick={markAll}
              disabled={unread === 0}
              className="text-sm font-semibold text-cobalt hover:underline disabled:text-slate disabled:no-underline"
            >
              Mark all as read
            </button>
          </header>
          <div role="tablist" aria-label="Filter" className="mt-3 flex gap-1 px-4">
            {(
              [
                ['all', 'All'],
                ['unread', `Unread${unread ? ` (${unread})` : ''}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cx(
                  'h-8 rounded-full px-3 text-sm font-semibold transition-colors',
                  tab === id ? 'bg-ink text-white' : 'text-slate hover:bg-ink/5 hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <ul className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
            {list.length === 0 && (
              <li className="px-4 py-12 text-center">
                <Flag className="mx-auto text-slate" size={22} />
                <p className="mt-3 font-semibold">You’re all caught up</p>
                <p className="text-sm text-slate">New verifications and messages will show up here.</p>
              </li>
            )}
            {list.map((n) => {
              const k = kindStyle[n.kind]
              return (
                <li key={n.id} data-notif-item>
                  <Link
                    to={n.href}
                    onClick={() => markOne(n.id)}
                    className="flex gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-ground"
                  >
                    <span className={cx('grid size-9 shrink-0 place-items-center rounded-xl', k.tone)}>
                      <k.icon size={17} strokeWidth={2.4} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className={cx('truncate text-[15px]', n.unread ? 'font-semibold' : 'font-medium')}>{n.title}</span>
                        <span className="shrink-0 text-xs text-slate tabular">{ago(n)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-sm text-slate">{n.body}</span>
                    </span>
                    <span className={cx('mt-2 size-2 shrink-0 rounded-full', n.unread ? 'bg-cobalt' : 'bg-transparent')} aria-hidden />
                    {n.unread && <span className="sr-only">Unread</span>}
                  </Link>
                </li>
              )
            })}
          </ul>
          <footer className="border-t border-line px-5 py-3 text-sm text-slate">
            Choose what you get in{' '}
            <Link to="/u/ladipo?tab=settings" onClick={() => setOpen(false)} className="font-semibold text-cobalt hover:underline">
              notification settings
            </Link>
            .
          </footer>
        </div>
      )}
    </div>
  )
}
