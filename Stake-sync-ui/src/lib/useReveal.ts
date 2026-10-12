import type { RefObject } from 'react'
import { usd } from './format'
import { gsap, motionOK, useGSAP } from './gsap'

/**
 * Scroll reveals for marketing pages, driven by data attributes:
 *  - data-reveal-group: direct children rise in, staggered, when the group enters view
 *  - data-count="941" (+ data-format="usd"): number counts up from zero
 *  - data-grow="x" | "y": bar grows from its start edge
 * Markup is always the finished state, so reduced motion just shows the page.
 */
export function useReveal(root: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      gsap.matchMedia().add(motionOK, () => {
        const scope = root.current
        const once = (trigger: Element, start = 'top 84%') => ({ trigger, start, once: true })

        gsap.utils.toArray<HTMLElement>('[data-reveal-group]', scope).forEach((group) => {
          gsap.from(group.children, {
            y: 22,
            autoAlpha: 0,
            duration: 0.6,
            ease: 'power3.out',
            stagger: 0.08,
            clearProps: 'transform,opacity,visibility',
            scrollTrigger: once(group),
          })
        })

        gsap.utils.toArray<HTMLElement>('[data-grow]', scope).forEach((bar, i) => {
          const y = bar.dataset.grow === 'y'
          gsap.from(bar, {
            [y ? 'scaleY' : 'scaleX']: 0,
            transformOrigin: y ? 'center bottom' : 'left center',
            duration: 0.9,
            delay: (i % 12) * 0.04,
            ease: 'power3.out',
            scrollTrigger: once(bar, 'top 92%'),
          })
        })

        gsap.utils.toArray<HTMLElement>('[data-count]', scope).forEach((el) => {
          const target = Number(el.dataset.count)
          const fmt = (n: number) => (el.dataset.format === 'usd' ? usd(Math.round(n)) : Math.round(n).toLocaleString('en-US'))
          const n = { v: 0 }
          gsap.to(n, {
            v: target,
            duration: 1.4,
            ease: 'power2.out',
            scrollTrigger: once(el, 'top 92%'),
            onStart: () => {
              el.textContent = fmt(0)
            },
            onUpdate: () => {
              el.textContent = fmt(n.v)
            },
          })
        })
      })
    },
    { scope: root },
  )
}
