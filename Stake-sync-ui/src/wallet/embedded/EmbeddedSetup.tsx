import { useCreateWallet, useExportWallet, useSignMessage } from '@privy-io/react-auth/solana'
import { CopyAddress } from '../../components/CopyAddress'
import { Check, KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/context'
import { Bone } from '../../components/Skeleton'
import { Button } from '../../components/ui'
import { ApiError } from '../../lib/api'
import { linkWallet } from '../../lib/payments'
import { useLedger } from '../../state/ledger-context'
import { useToast } from '../../toast/context'
import { EmbeddedProvider } from './EmbeddedProvider'
import { useEmbeddedWallet } from './useEmbeddedWallet'

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

/**
 * "We'll create a wallet for you": makes a Solana wallet with Privy and links it to the account.
 * The person owns the key (they can export it); Stake-Sync can't move their money.
 */
export default function EmbeddedSetup(props: { onReady?: () => void; onUnavailable?: () => void }) {
  return (
    <EmbeddedProvider>
      <SetupBody {...props} />
    </EmbeddedProvider>
  )
}

function SetupBody({ onReady, onUnavailable }: { onReady?: () => void; onUnavailable?: () => void }) {
  const { session, refreshUser } = useAuth()
  const ledger = useLedger()
  const toast = useToast()
  const { ready, authenticated, wallet, waitFor } = useEmbeddedWallet()
  const { createWallet } = useCreateWallet()
  const { signMessage } = useSignMessage()
  const { exportWallet } = useExportWallet()
  const [busy, setBusy] = useState(false)
  const linked = wallet ? Boolean(session?.wallets?.includes(wallet.address)) : false
  const waiting = !ready || !authenticated

  // If Privy can't sign the person in (outage, or a setup problem on our side), don't leave them
  // staring at a skeleton: say so and offer their own wallet instead.
  useEffect(() => {
    if (!waiting) return
    const t = window.setTimeout(() => {
      toast({ tone: 'error', title: 'Can’t create a wallet right now', body: 'You can connect a wallet app instead, or try again later.', inbox: false })
      onUnavailable?.()
    }, 12_000)
    return () => window.clearTimeout(t)
  }, [waiting, toast, onUnavailable])

  if (waiting) {
    return (
      <div role="status" aria-label="Preparing your wallet">
        <Bone className="h-24 rounded-2xl" />
      </div>
    )
  }

  async function setUp() {
    setBusy(true)
    try {
      // Reuse a wallet made earlier (e.g. on another device); otherwise create one.
      const signer = wallet ?? (await waitFor((await createWallet()).wallet.address))
      const address = signer.address
      // Prove it to our API the same way as any wallet, so it can receive money and stake.
      await linkWallet(address, async (message) => (await signMessage({ message, wallet: signer })).signature, 'embedded')
      await refreshUser()
      ledger.refresh()
      toast({ title: 'Your wallet is ready', body: `${short(address)} is yours. Only you can move what’s in it.` })
      onReady?.()
    } catch (err) {
      const declined = /reject|declin|cancel|exit/i.test(String(err))
      toast({
        tone: 'error',
        title: declined ? 'Wallet setup stopped' : 'Couldn’t set up your wallet',
        body: err instanceof ApiError ? err.message : declined ? 'Nothing was created or charged. You can try again any time.' : 'Please try again. If you created a wallet, it’s kept and will be linked next time.',
        inbox: false,
      })
    } finally {
      setBusy(false)
    }
  }

  if (wallet && linked) {
    return (
      <div className="rounded-2xl bg-calm-soft p-4">
        <p className="flex items-center gap-2 font-semibold text-calm">
          <Check size={17} strokeWidth={3} /> Your wallet <CopyAddress address={wallet.address} className="text-calm" /> is ready
        </p>
        <p className="mt-1 text-[15px] text-slate">Only you can move what’s in it. You can take the key to any Solana wallet app.</p>
        <button
          type="button"
          onClick={() => void exportWallet({ address: wallet.address }).catch(() => {})}
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-cobalt hover:underline"
        >
          <KeyRound size={15} /> Export my private key
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-cobalt-soft p-4">
      <p className="font-semibold">{wallet ? 'Link your wallet' : 'Create your wallet'}</p>
      <p className="mt-1 text-[15px] text-slate">
        A Solana wallet for your USDC, protected by your Stake-Sync sign-in. It’s yours: we can’t move your money, and you can
        export the key to any wallet app.
      </p>
      <Button className="mt-3 w-full" onClick={() => void setUp()} busy={busy}>
        {busy ? 'Setting up your wallet' : wallet ? 'Link my wallet' : 'Create my wallet'}
      </Button>
    </div>
  )
}
