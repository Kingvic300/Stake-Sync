import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { cx } from '../lib/format'
import { shortAddress } from '../wallet/config'

/** A wallet address, shortened, that copies the full address when clicked. */
export function CopyAddress({ address, className }: { address: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title={address}
      aria-label={copied ? 'Address copied' : `Copy wallet address ${address}`}
      onClick={() => {
        void navigator.clipboard?.writeText(address)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      }}
      className={cx('inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 tabular text-slate hover:bg-black/5 hover:text-ink', className)}
    >
      {shortAddress(address)}
      {copied ? <Check size={14} className="text-calm" strokeWidth={3} /> : <Copy size={14} />}
    </button>
  )
}
