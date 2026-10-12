import type { Challenge, Provider, VerificationSettings } from '../data/types'

/** One line of the verification matrix as participants read it. */
export interface MatrixRow {
  key: string
  rule: string
  /** How it's checked, in plain words */
  how: string
  /** Checked by software, by a reviewer, or on trust */
  kind: 'auto' | 'review' | 'self'
  when: string
  required: boolean
  note?: string
}

export interface MatrixInput {
  providers: Provider[]
  mode: 'days' | 'count'
  durationDays: number
  requiredDays?: number
  targetCount?: number
  countUnit?: string
  requirement: string
  verification?: VerificationSettings
}

export const LANGUAGES = ['Rust', 'TypeScript', 'JavaScript', 'Python', 'Go', 'Solidity', 'Move', 'Java', 'Kotlin', 'Swift', 'C++', 'C', 'C#', 'Ruby', 'PHP', 'Dart']

const EXERCISE = { pushups: 'push-ups', situps: 'sit-ups', squats: 'squats' } as const
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`)

/** What each verification method checks automatically, as matrix rows. */
function autoRows(p: Provider, m: MatrixInput): MatrixRow[] {
  const v = m.verification ?? {}
  const daily = m.mode === 'days'
  const when = daily ? 'Every day' : 'By the end'
  const auto = (key: string, rule: string, how: string, note?: string): MatrixRow => ({ key, rule, how, kind: 'auto', when, required: true, note })
  switch (p) {
    case 'GitHub': {
      const g = v.github ?? {}
      if (!daily) return [auto('gh-total', `${plural(m.targetCount ?? 0, g.mergedOnly === false ? 'pull request' : 'merged pull request')}${g.repo ? ` in ${g.repo}` : ''}`, 'GitHub, checked automatically')]
      const rows = [
        auto(
          'gh-commits',
          `${plural(g.minCommits ?? 1, 'commit')} with ${g.minChangedLines ?? 5}+ changed lines`,
          'GitHub, checked automatically',
          'Empty, formatting-only and lockfile-only commits don’t count.',
        ),
      ]
      if (g.repo) rows.push(auto('gh-repo', `Commits go to ${g.repo}`, 'GitHub, checked automatically'))
      if (g.languages?.length) rows.push(auto('gh-lang', `Changes are in ${list(g.languages)} files`, 'GitHub, by file type', 'Other files are ignored when counting changed lines.'))
      if (g.paths?.length) rows.push(auto('gh-paths', `Changes touch ${list(g.paths)}`, 'GitHub, by file path'))
      const simple = (g.minCommits ?? 1) === 1 && !g.languages?.length && !g.paths?.length
      if (g.countPullRequests !== false && simple) rows.push({ ...auto('gh-pr', `Or open ${g.mergedOnly ? 'and merge ' : ''}a pull request`, 'GitHub, checked automatically'), required: false, note: 'Counts instead of a commit on that day.' })
      return rows
    }
    case 'LeetCode': {
      const l = v.leetcode
      if (daily && l?.assigned === 'daily') return [auto('lc-daily', 'Solve LeetCode’s daily question', 'LeetCode, checked automatically', 'You get the problem each morning. An accepted submission that day counts.')]
      if (daily && l?.assigned === 'list') {
        const most = Math.max(1, ...(l.schedule ?? []).map((d) => d.length))
        return [auto('lc-list', most > 1 ? 'Solve all of the day’s problems' : 'Solve the day’s problem', 'LeetCode, checked automatically', `The host set ${most > 1 ? `up to ${most} problems a day` : 'one problem a day'}. You get them each morning; each needs an accepted submission that day.`)]
      }
      const level = l?.minDifficulty && l.minDifficulty !== 'Easy' ? ` (${l.minDifficulty} or harder)` : ''
      return [auto('lc', daily ? `A new accepted LeetCode problem${level}` : `${plural(m.targetCount ?? 0, 'new problem')} solved${level}`, 'LeetCode, checked automatically', l?.newOnly !== false ? 'Problems you solved before the challenge don’t count.' : undefined)]
    }
    case 'Codeforces': {
      const r = v.codeforces?.minRating
      return [auto('cf', daily ? `A new accepted Codeforces problem${r ? ` rated ${r}+` : ''}` : `${plural(m.targetCount ?? 0, 'new problem')} solved${r ? `, rated ${r}+` : ''}`, 'Codeforces, checked automatically')]
    }
    case 'WakaTime':
      return [auto('wk', daily ? `${v.wakatime?.minMinutes ?? 30} minutes of tracked coding` : `${plural(m.targetCount ?? 0, 'hour')} of tracked coding`, 'WakaTime, checked automatically')]
    case 'Solana': {
      const s = v.solana
      const what = s?.activity === 'deploy' ? 'a program deployment' : s?.activity === 'program' ? `a transaction with program ${s.programId?.slice(0, 6)}…` : 'an on-chain transaction'
      return [auto('sol', daily ? `${what[0].toUpperCase()}${what.slice(1)} from your linked wallet${s?.cluster === 'devnet' ? ' on devnet' : ''}` : `${plural(m.targetCount ?? 0, 'deployment')}`, 'Solana, checked on-chain')]
    }
    case 'Camera': {
      const c = v.camera ?? { exercise: 'pushups' as const, reps: 100 }
      return [auto('cam', daily ? `${c.reps} ${EXERCISE[c.exercise]}` : `${plural(m.targetCount ?? 0, EXERCISE[c.exercise])} in total`, 'Counted by your phone camera', 'Sets are checked for real movement.')]
    }
    case 'Health': {
      const h = v.health ?? { metric: 'steps' as const, threshold: 10_000 }
      return [auto('health', daily ? (h.metric === 'steps' ? `${h.threshold.toLocaleString('en-US')} steps` : `${(h.threshold / 1000).toLocaleString('en-US')} km walked`) : m.requirement || `${plural(m.targetCount ?? 0, 'km')} walked`, 'Apple Health or Health Connect, via the app')]
    }
    case 'Photo':
      return [{ key: 'photo', rule: `A photo of your progress: ${v.photo?.instructions ?? 'show today’s progress clearly'}`, how: 'Photo, approved by a reviewer', kind: 'review', when, required: true, note: 'A photo waiting for review never counts as a miss.' }]
  }
}

/** The full matrix: what's checked, how, how often, and whether it decides your result. */
export function matrixRows(m: MatrixInput): MatrixRow[] {
  const rows = m.providers.flatMap((p) => autoRows(p, m))
  for (const [i, c] of (m.verification?.criteria ?? []).entries()) {
    rows.push({
      key: c.id ?? `r${i + 1}`,
      rule: c.text,
      how: c.check === 'photo' ? 'In your daily photo, approved by a reviewer' : 'On trust: you report it yourself',
      kind: c.check === 'photo' ? 'review' : 'self',
      when: c.frequency === 'daily' ? 'Every day' : c.frequency === 'weekly' ? 'Each week' : 'By the end',
      required: c.required,
    })
  }
  return rows
}

/** What counts as success and failure, in one sentence each. */
export function outcomes(m: MatrixInput & { freeStrikes: number; penalties: number[]; staked: boolean }) {
  const misses = m.mode === 'days' ? m.durationDays - (m.requiredDays ?? m.durationDays) : 0
  return {
    success: m.mode === 'days' ? `Meet every required rule on at least ${m.requiredDays ?? m.durationDays} of ${m.durationDays} days.` : `Reach ${plural(m.targetCount ?? 0, m.countUnit ?? 'unit')} by the end.`,
    failure:
      m.mode === 'days'
        ? `Missing more than ${plural(misses, 'day')}. A day counts as missed when any required rule isn’t met.`
        : `Ending below ${plural(m.targetCount ?? 0, m.countUnit ?? 'unit')}.`,
    strikes: m.freeStrikes ? `${plural(m.freeStrikes, 'free strike')}: the first misses cost nothing.` : 'No free strikes.',
    penalties: !m.staked
      ? m.mode === 'days'
        ? 'No stake, so misses cost no money, but the next miss after your free strikes takes you out of the challenge.'
        : 'No stake, so misses cost no money.'
      : m.penalties.length ? `After that, each miss costs ${m.penalties.join('%, then ')}% of your stake.` : 'Failing forfeits the stake.',
  }
}

export const matrixFor = (c: Challenge): MatrixInput => ({
  providers: c.providers,
  mode: c.mode,
  durationDays: c.durationDays,
  requiredDays: c.requiredDays,
  targetCount: c.targetCount,
  countUnit: c.countUnit,
  requirement: c.requirement,
  verification: c.verification,
})
