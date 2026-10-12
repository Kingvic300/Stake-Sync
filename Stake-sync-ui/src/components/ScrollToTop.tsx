import { useLayoutEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router'

/**
 * Every new page opens at the top. Back/forward keeps the browser's own position,
 * and links to a section (#hash) scroll to that section instead.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation()
  const type = useNavigationType()

  useLayoutEffect(() => {
    if (type === 'POP') return
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView()
      return
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname, hash, type])

  return null
}
