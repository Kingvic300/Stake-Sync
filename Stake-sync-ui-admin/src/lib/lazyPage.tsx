import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'

/**
 * Route element that loads its page on demand. Navigation happens immediately and a
 * skeleton shaped like the destination shows until the code arrives.
 */
export function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K, fallback: ReactNode) {
  const Page = lazy(() => load().then((m) => ({ default: m[name] as ComponentType })))
  return (
    <Suspense fallback={fallback}>
      <Page />
    </Suspense>
  )
}
