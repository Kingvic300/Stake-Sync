import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../toast/context'
import { api, ApiError } from './api'

export interface ApiData<T> {
  /** API data once loaded; null while loading or when there's nothing to load. */
  data: T | null
  /** A plain sentence, never a raw error. */
  error: string
  /** HTTP status of a failed load (404 = doesn't exist or isn't visible), 0 if none. */
  status: number
  refresh: () => void
  /** Replace the data locally, e.g. after an optimistic change. */
  setData: (update: (prev: T | null) => T | null) => void
}

/**
 * Reads `path` from the API. `path` null means "nothing to load yet".
 * `map` turns the API's response into the screen's shape.
 */
export function useApiData<T, R = T>(path: string | null, map?: (raw: R) => T): ApiData<T> {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string; status: number }>({ key: null, data: null, error: '', status: 0 })
  const [tick, setTick] = useState(0)
  const key = path ? `${path}#${tick}` : null

  useEffect(() => {
    if (!key || !path) return
    const ctrl = new AbortController()
    api<R>(path, { signal: ctrl.signal })
      .then((raw) => setState({ key, data: map ? map(raw) : (raw as unknown as T), error: '', status: 0 }))
      .catch((e) => {
        if (ctrl.signal.aborted) return
        setState({ key, data: null, error: e instanceof ApiError ? e.message : 'Couldn’t load this. Please try again.', status: e instanceof ApiError ? e.status : 0 })
      })
    return () => ctrl.abort()
    // map is a pure function supplied inline; the path decides what to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, path])

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  // Problems show as a toast with a retry, like everywhere else in the app.
  const toast = useToast()
  // A 404 is an answer (the page says so), not a failure worth a toast.
  const failed = state.key === key && state.status !== 404 ? state.error : ''
  useEffect(() => {
    if (failed) toast({ tone: 'error', title: 'Couldn’t load this', body: failed, action: { label: 'Try again', onClick: refresh }, inbox: false })
  }, [failed, refresh, toast])
  const setData = useCallback((update: (prev: T | null) => T | null) => setState((s) => ({ ...s, data: update(s.data) })), [])

  const current = state.key === key
  return { data: current ? state.data : null, error: current ? state.error : '', status: current ? state.status : 0, refresh, setData }
}
