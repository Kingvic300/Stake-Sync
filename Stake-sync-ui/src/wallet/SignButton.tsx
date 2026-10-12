import { useWallet } from '@solana/wallet-adapter-react'
import { useSignTransaction } from '@privy-io/react-auth/solana'
import { useState } from 'react'
import { useAuth } from '../auth/context'
import { Button } from '../components/ui'
import { embeddedWalletsEnabled } from '../lib/payments'
import { cx } from '../lib/format'
import { cluster, shortAddress } from './config'
import { useWalletUi } from './context'
import { EmbeddedProvider } from './embedded/EmbeddedProvider'
import { useEmbeddedWallet } from './embedded/useEmbeddedWallet'
import { adapterSigner, type SignBytes } from './sendUsdc'
import { SolanaProvider } from './SolanaProvider'

const chain = cluster === 'mainnet-beta' ? 'solana:mainnet' : (`solana:${cluster}` as 'solana:devnet' | 'solana:testnet')

export interface SignButtonProps {
  label: string
  busyLabel?: string
  disabled?: boolean
  className?: string
  /** Does the work; `sign` asks the person's wallet to sign a transaction. Throw to show an error. */
  onSign: (sign: SignBytes) => Promise<void>
}

/**
 * A primary button that gets a signature from the wallet holding the person's money: the wallet
 * Stake-Sync created for them (Privy) or the one they connected (Phantom, Solflare, Backpack).
 * Load it lazily, so the wallet libraries only download when someone is about to sign.
 */
export default function SignButton(props: SignButtonProps) {
  const { session } = useAuth()
  const primary = session?.wallets?.[0]
  const embedded = embeddedWalletsEnabled && !!primary && !!session?.embeddedWallets?.includes(primary)
  if (embedded) {
    return (
      <EmbeddedProvider>
        <EmbeddedSign {...props} primary={primary} />
      </EmbeddedProvider>
    )
  }
  return (
    <SolanaProvider>
      <AdapterSign {...props} primary={primary} />
    </SolanaProvider>
  )
}

function useRun(onSign: SignButtonProps['onSign']) {
  const [busy, setBusy] = useState(false)
  async function run(sign: SignBytes) {
    if (busy) return
    setBusy(true)
    try {
      await onSign(sign)
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

function AdapterSign({ label, busyLabel, disabled, className, onSign, primary }: SignButtonProps & { primary?: string }) {
  const { publicKey, signTransaction, connecting, wallet } = useWallet()
  const { openModal } = useWalletUi()
  const { busy, run } = useRun(onSign)
  const cls = cx('w-full', className)
  if (!publicKey) {
    return (
      <Button className={cls} onClick={openModal} busy={connecting}>
        {connecting ? 'Waiting for your wallet' : primary ? `Connect ${shortAddress(primary)} to continue` : 'Connect your wallet to continue'}
      </Button>
    )
  }
  if (primary && publicKey.toBase58() !== primary) {
    return (
      <p className="rounded-2xl bg-gold-soft p-3 text-center text-sm text-gold-ink">
        Switch to {shortAddress(primary)} in your wallet app; that’s where your money is.
      </p>
    )
  }
  return (
    <Button className={cls} disabled={disabled || !signTransaction} busy={busy} onClick={() => signTransaction && void run(adapterSigner(signTransaction, wallet?.adapter, publicKey.toBase58()))}>
      {busy ? (busyLabel ?? 'Waiting for your wallet') : label}
    </Button>
  )
}

function EmbeddedSign({ label, busyLabel, disabled, className, onSign, primary }: SignButtonProps & { primary?: string }) {
  const { signTransaction } = useSignTransaction()
  const { busy, run } = useRun(onSign)
  const { ready, wallet: found } = useEmbeddedWallet()
  const wallet = found && (!primary || found.address === primary) ? found : null
  if (ready && !wallet) {
    return <p className="rounded-2xl bg-gold-soft p-3 text-center text-sm text-gold-ink">Your wallet isn’t available right now. Refresh the page and try again.</p>
  }
  return (
    <Button
      className={cx('w-full', className)}
      disabled={disabled || !wallet}
      busy={busy}
      onClick={() => wallet && void run(async (transaction) => (await signTransaction({ transaction, wallet, chain })).signedTransaction)}
    >
      {busy ? (busyLabel ?? 'Waiting for your wallet') : label}
    </Button>
  )
}
