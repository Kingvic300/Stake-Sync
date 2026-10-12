import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { DependencyList, RefObject } from 'react'

gsap.registerPlugin(useGSAP, ScrollTrigger)

export { gsap, ScrollTrigger, useGSAP }

export const motionOK = '(prefers-reduced-motion: no-preference)'

/**
 * useGSAP that only runs its animations when the viewer allows motion.
 * The rendered markup is always the final state, so reduced-motion users see it as-is.
 */
export function useMotion(
  fn: () => void,
  scope: RefObject<HTMLElement | null>,
  dependencies: DependencyList = [],
) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(motionOK, fn)
    },
    { scope, dependencies: [...dependencies], revertOnUpdate: true },
  )
}

export function prefersMotion() {
  return typeof window !== 'undefined' && window.matchMedia(motionOK).matches
}
