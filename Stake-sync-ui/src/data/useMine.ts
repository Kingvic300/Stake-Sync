import { useMemo } from 'react'
import { useApiData } from '../lib/useApiData'
import type { Challenge, Participation } from './types'

/** Progress as the API sends it: the app's Participation plus settlement details. */
export type MyParticipation = Participation & { status?: string; completed?: boolean; claimable?: number; claimed?: boolean; stakeRemaining?: number; penaltySoFar?: number }

export interface MineItem {
  c: Challenge & { endsAt?: string }
  p: MyParticipation
}

export interface PastItem {
  id: string
  title: string
  result: 'Completed' | 'Not completed' | 'Out of strikes'
  when: string
  /** Gain (reward) or loss (forfeit) in dollars */
  earned: number
}

const month = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

/** The challenges the signed-in person is in (GET /me/challenges), split into running and finished. */
export function useMine() {
  const src = useApiData<{ challenge: MineItem['c']; participation: MyParticipation }[]>('/me/challenges')
  const split = useMemo(() => {
    if (!src.data) return null
    const active: MineItem[] = []
    const finished: PastItem[] = []
    for (const { challenge: c, participation: p } of src.data) {
      if (c.status === 'ended' || p.status === 'completed' || p.status === 'failed' || p.status === 'refunded') {
        const completed = Boolean(p.completed)
        finished.push({
          id: c.id,
          title: c.title,
          // Struck out of a no-stake challenge that is still running.
          result: completed ? 'Completed' : p.status === 'failed' && c.status !== 'ended' ? 'Out of strikes' : 'Not completed',
          when: month(c.endsAt ?? c.startsAt),
          earned: Math.round((completed ? (p.claimable ?? p.stake) - p.stake : -(p.stake - (p.stakeRemaining ?? 0))) * 100) / 100,
        })
      } else {
        active.push({ c, p })
      }
    }
    return { active, finished }
  }, [src.data])
  return { ...src, mine: split }
}
