import { useRef } from 'react'
import { Outlet, useLocation } from 'react-router'
import { DayGrid, Strikes } from '../components/DayGrid'
import { Logo } from '../components/Logo'
import { ScrollToTop } from '../components/ScrollToTop'
import type { DayRecord } from '../data/types'
import { gsap, motionOK, useGSAP } from '../lib/gsap'
import { cx } from '../lib/format'
import { color } from '../lib/tokens'

const grid: DayRecord[] = Array.from({ length: 42 }, (_, i) => ({
  day: i + 1,
  state: i === 11 ? 'failed' : i < 30 ? 'verified' : 'upcoming',
}))

/** Split screen: form on the left, a quiet brand panel on the right (desktop only). */
export function AuthLayout() {
  const art = useRef<HTMLDivElement>(null)
  const flow = useLocation().pathname === '/start'

  useGSAP(
    () => {
      gsap.matchMedia().add(motionOK, () => {
        gsap.fromTo(
          '.day-tile[data-state="verified"], .day-tile[data-state="failed"]',
          { backgroundColor: color.tile, scale: 0.6 },
          {
            backgroundColor: (_: number, el: HTMLElement) => (el.dataset.state === 'failed' ? color.miss : color.cobalt),
            scale: 1,
            duration: 0.4,
            ease: 'back.out(2)',
            stagger: { each: 0.03, grid: [6, 7], from: 'start' },
            clearProps: 'backgroundColor,transform',
            delay: 0.2,
          },
        )
        gsap.from('[data-art-copy] > *', { y: 16, autoAlpha: 0, duration: 0.6, stagger: 0.1, ease: 'power3.out', delay: 0.5 })
      })
    },
    { scope: art },
  )

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,46%)]">
      <div className={cx('flex flex-col px-4 pt-6 sm:px-10', !flow && 'pb-6')}>
        <Logo />
        {/* Onboarding runs edge to edge so its pinned action sits flush with the screen bottom on every step */}
        <main id="main" className={cx('flex flex-1 justify-center', flow ? 'pt-10' : 'items-center py-10')}>
          <div className="w-full max-w-[26rem]">
            <Outlet />
          </div>
        </main>
      </div>
      <aside
        ref={art}
        aria-hidden
        className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between"
      >
        <div className="max-w-sm">
          <DayGrid days={grid} columns={7} size="lg" className="[&>li[data-state=upcoming]]:bg-white/10" />
          <div className="mt-5 flex items-center justify-between text-sm text-white/60">
            <span>Day 30 of 42</span>
            <Strikes total={3} used={1} size={18} className="[&_.heart.text-line]:text-white/25" />
          </div>
        </div>
        <div data-art-copy>
          <p className="font-display text-4xl leading-tight font-bold">Join. Commit. Complete. Earn.</p>
          <p className="mt-3 max-w-md text-white/65">
            Your progress is verified by the tools you already use, and your stake comes back when you follow through.
          </p>
        </div>
      </aside>
      <ScrollToTop />
    </div>
  )
}
