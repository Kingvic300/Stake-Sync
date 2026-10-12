import { useCallback, useEffect, useState } from 'react'
import { api, apiEnabled } from './api'
import { useToast } from '../toast/context'

/** Fetch an admin resource from the API. Missing API config yields an empty state, never fixtures. */
export function useAdminApi<T>(path: string | null) {
  const toast = useToast()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(Boolean(path && apiEnabled))
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((n) => n + 1), [])

  useEffect(() => {
    if (!path || !apiEnabled) {
      setData(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    void api<T>(path, { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setData(null)
        toast({ tone: 'error', title: 'Couldn’t load data', body: e instanceof Error ? e.message : 'Try again.' })
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [path, revision, toast])

  return { data, loading, refresh }
}
