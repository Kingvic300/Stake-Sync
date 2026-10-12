import { useSignTransaction } from '@privy-io/react-auth/solana'
import { useAuth } from '../../auth/context'
import { Bone } from '../../components/Skeleton'
import { cluster } from '../config'
import { SendForm } from '../SendForm'
import { EmbeddedProvider } from './EmbeddedProvider'
import { useEmbeddedWallet } from './useEmbeddedWallet'

const chain = cluster === 'mainnet-beta' ? 'solana:mainnet' : (`solana:${cluster}` as 'solana:devnet' | 'solana:testnet')

/** Sends USDC from the wallet Stake-Sync created for the person; Privy asks them to approve it. */
export default function EmbeddedSend(props: { amount: number; amountOk: boolean; onSent: (to: string) => void }) {
  return (
    <EmbeddedProvider>
      <SendBody {...props} />
    </EmbeddedProvider>
  )
}

function SendBody({ amount, amountOk, onSent }: { amount: number; amountOk: boolean; onSent: (to: string) => void }) {
  const { ready, wallet } = useEmbeddedWallet()
  const primary = useAuth().session?.wallets?.[0]
  const { signTransaction } = useSignTransaction()

  if (!ready) return <Bone className="h-32 rounded-2xl" />
  const usable = wallet && wallet.address === primary ? wallet : null
  return (
    <SendForm
      amount={amount}
      amountOk={amountOk}
      sign={usable ? async (transaction) => (await signTransaction({ transaction, wallet: usable, chain })).signedTransaction : null}
      blocked={usable ? undefined : <p className="rounded-2xl bg-gold-soft p-4 text-[15px] text-gold-ink">Your wallet isn’t available right now. Refresh the page and try again.</p>}
      onSent={onSent}
    />
  )
}
