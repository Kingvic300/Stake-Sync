import { Clock } from 'lucide-react'
import { Button } from './ui'

/** Shown wherever local currency (bank, card, naira) would be, until the payment partner is live. */
export function OnrampSoon({ what = 'Paying in naira or your local currency', onUseWallet }: { what?: string; onUseWallet?: () => void }) {
  return (
    <div className="rounded-2xl bg-gold-soft p-5 text-gold-ink">
      <p className="flex items-center gap-2 font-semibold">
        <Clock size={18} /> Coming soon
      </p>
      <p className="mt-1.5 text-[15px]">{what} is on the way. For now, add USDC from a Solana wallet or an exchange.</p>
      {onUseWallet && (
        <Button size="sm" variant="secondary" className="mt-4" onClick={onUseWallet}>
          Use a Solana wallet instead
        </Button>
      )}
    </div>
  )
}
