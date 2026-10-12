import { Check, Copy, Mail, Share2 } from 'lucide-react'
import { InviteByUsername } from './InviteByUsername'
import { useState } from 'react'
import { Sheet } from './Sheet'
import { Button } from './ui'
import { useToast } from '../toast/context'

const channels = [
  { name: 'WhatsApp', href: (url: string, text: string) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}` },
  { name: 'X', href: (url: string, text: string) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}` },
  { name: 'Telegram', href: (url: string, text: string) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}` },
]

/** Invite sharing: link and code to copy, the device share sheet, and common messaging apps. */
export function ShareSheet({
  title,
  intro,
  link,
  code,
  message,
  onClose,
  challengeId,
}: {
  title: string
  intro: string
  link: string
  code?: string
  message: string
  onClose: () => void
  /** Shows the invite-by-username field for this challenge */
  challengeId?: string
}) {
  const [copied, setCopied] = useState<'link' | 'code' | null>(null)
  const toast = useToast()
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function copy(what: 'link' | 'code', text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      toast({ title: what === 'link' ? 'Invite link copied' : 'Invite code copied', inbox: false })
    } catch {
      setCopied(null)
      toast({ tone: 'error', title: 'Couldn’t copy', body: 'Your browser blocked the clipboard. Select the text and copy it instead.', inbox: false })
    }
  }

  return (
    <Sheet title={title} onClose={onClose} width={480}>
      <p className="text-[15px] text-slate">{intro}</p>

      <div className="mt-5 flex items-center gap-2 rounded-2xl bg-ground p-2 pl-4">
        <span className="min-w-0 flex-1 truncate text-[15px]" title={link}>
          {link.replace(/^https?:\/\//, '')}
        </span>
        <Button size="sm" variant={copied === 'link' ? 'secondary' : 'primary'} onClick={() => copy('link', link)}>
          {copied === 'link' ? <Check size={15} strokeWidth={3} /> : <Copy size={15} />}
          {copied === 'link' ? 'Copied' : 'Copy link'}
        </Button>
      </div>

      {code && (
        <div className="mt-2 flex items-center gap-2 rounded-2xl bg-ground p-2 pl-4">
          <span className="flex-1 text-[15px] text-slate">
            Invite code
            <span className="ml-3 font-display text-xl font-bold tracking-wider text-ink">{code}</span>
          </span>
          <Button size="sm" variant="secondary" onClick={() => copy('code', code)}>
            {copied === 'code' ? <Check size={15} strokeWidth={3} /> : <Copy size={15} />}
            {copied === 'code' ? 'Copied' : 'Copy'}
          </Button>
        </div>
      )}

      {code && (
        <p className="mt-2 text-sm text-slate">
          People can enter the code under <span className="font-semibold text-ink">Join with a code</span> in the app, or at{' '}
          <span className="font-semibold text-ink">{window.location.host}/join</span>.
        </p>
      )}

      {challengeId && <InviteByUsername challengeId={challengeId} />}

      <div className="mt-6 text-sm font-semibold">Share with</div>
      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {canShare && (
          <button
            type="button"
            onClick={() => void navigator.share({ title, text: message, url: link }).catch(() => undefined)}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-surface text-sm font-semibold ring-1 ring-line hover:ring-slate/40"
          >
            <Share2 size={16} /> Share
          </button>
        )}
        {channels.map((c) => (
          <a
            key={c.name}
            href={c.href(link, message)}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 items-center justify-center rounded-xl bg-surface text-sm font-semibold ring-1 ring-line hover:ring-slate/40"
          >
            {c.name}
          </a>
        ))}
        <a
          href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${message}\n\n${link}`)}`}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-surface text-sm font-semibold ring-1 ring-line hover:ring-slate/40"
        >
          <Mail size={16} /> Email
        </a>
      </div>
    </Sheet>
  )
}
