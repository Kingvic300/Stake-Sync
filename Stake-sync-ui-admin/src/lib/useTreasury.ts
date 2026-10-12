import { useCallback, useEffect, useState } from 'react'
import type { Treasury } from '../data/treasury'
import { api, apiEnabled } from './api'

/** The treasury summary from the API. */
export function useTreasury() {
  const [data, setData] = useState<Treasury | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!apiEnabled) {
      setData(null)
      setError('The admin API isn’t configured.')
      return
    }
    const ctrl = new AbortController()
    api<Treasury>('/admin/treasury', { signal: ctrl.signal })
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return
        setError(e instanceof Error ? e.message : 'Couldn’t load the treasury.')
      })
    return () => ctrl.abort()
  }, [tick])

  const refresh = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, refresh }
}
