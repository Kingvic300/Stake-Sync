import { RotateCcw } from 'lucide-react'
import { Button } from './ui'

/** Where content would be when it couldn't load. The reason is already in a toast. */
export function RetryPanel({ onRetry, className }: { onRetry: () => void; className?: string }) {
  return (
    <div className={`rounded-3xl bg-surface px-6 py-12 text-center ring-1 ring-line/70 ${className ?? ''}`}>
      <p className="font-semibold">This didn’t load</p>
      <Button variant="secondary" className="mt-4" onClick={onRetry}>
        <RotateCcw size={16} /> Try again
      </Button>
    </div>
  )
}
