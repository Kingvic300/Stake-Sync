import { ExternalLink, Send } from 'lucide-react'
import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import { cx } from '../lib/format'
import { useApiData } from '../lib/useApiData'
import { inputClass } from '../lib/styles'
import { useToast } from '../toast/context'
import { Button, ProviderMark } from './ui'

interface Problem {
  slug: string
  title: string
  difficulty: string
  url: string
}

const TONE: Record<string, string> = { Easy: 'text-calm', Medium: 'text-gold-ink', Hard: 'text-miss' }

/** The day's set LeetCode problems, with a way to share your solution in the challenge chat. */
export function TodayProblems({ challengeId }: { challengeId: string }) {
  const src = useApiData<{ day: number | null; started?: boolean; problems: Problem[] }>(`/challenges/${encodeURIComponent(challengeId)}/today`)
  const [sharing, setSharing] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const data = src.data
  if (!data?.problems.length) return null

  async function share(p: Problem) {
    const url = link.trim()
    if (!/^https?:\/\/\S+$/.test(url)) return toast({ tone: 'error', title: 'Paste a link to your solution', body: 'For example your LeetCode submission or a GitHub gist.', inbox: false })
    setBusy(true)
    try {
      await api(`/challenges/${encodeURIComponent(challengeId)}/messages`, { method: 'POST', body: { body: `Solved ${p.title} for day ${data!.day}: ${url}` } })
      toast({ title: 'Shared in the chat', inbox: false })
      setSharing(null)
      setLink('')
    } catch (err) {
      toast({ tone: 'error', title: 'Couldn’t share', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-4 rounded-3xl bg-surface p-5 ring-1 ring-line/70">
      <h3 className="flex items-center gap-2 font-sans font-semibold">
        <ProviderMark provider="LeetCode" size={16} /> {data.started ? `Today, day ${data.day}` : 'Day 1 problems'}
      </h3>
      <p className="mt-0.5 text-sm text-slate">Solve {data.problems.length === 1 ? 'it' : 'each one'} on LeetCode today. It’s checked automatically.</p>
      <ul className="mt-3 space-y-2">
        {data.problems.map((p) => (
          <li key={p.slug} className="rounded-2xl bg-ground p-3">
            <div className="flex items-center justify-between gap-3">
              <a href={p.url} target="_blank" rel="noreferrer" className="min-w-0 font-semibold hover:text-cobalt">
                <span className="truncate">{p.title}</span> <ExternalLink size={13} className="inline" />
              </a>
              <span className={cx('text-sm font-semibold', TONE[p.difficulty] ?? 'text-slate')}>{p.difficulty}</span>
            </div>
            {data.started &&
              (sharing === p.slug ? (
                <div className="mt-2 flex gap-2">
                  <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link to your solution" aria-label={`Solution link for ${p.title}`} className={cx(inputClass, 'h-10')} autoFocus />
                  <Button size="sm" busy={busy} onClick={() => void share(p)} aria-label="Share solution">
                    <Send size={15} />
                  </Button>
                </div>
              ) : (
                <button type="button" onClick={() => setSharing(p.slug)} className="mt-1.5 text-sm font-semibold text-cobalt hover:underline">
                  Share my solution
                </button>
              ))}
          </li>
        ))}
      </ul>
    </section>
  )
}
