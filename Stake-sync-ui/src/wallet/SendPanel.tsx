import { useWallet } from '@solana/wallet-adapter-react'
import { useAuth } from '../auth/context'
import { Button } from '../components/ui'
import { shortAddress } from './config'
import { useWalletUi } from './context'
import { SendForm } from './SendForm'
import { adapterSigner } from './sendUsdc'
import { SolanaProvider } from './SolanaProvider'

/**
 * Sends USDC from the person's linked wallet (Phantom, Solflare, Backpack) to another Solana
 * wallet. Lazy-loaded with the wallet adapter, since their own wallet signs the transfer.
 */
export default function SendPanel(props: { amount: number; amountOk: boolean; onSent: (to: string) => void }) {
  return (
    <SolanaProvider>
      <SendBody {...props} />
    </SolanaProvider>
  )
}

function SendBody({ amount, amountOk, onSent }: { amount: number; amountOk: boolean; onSent: (to: string) => void }) {
  const { publicKey, signTransaction, connecting, wallet } = useWallet()
  const { openModal } = useWalletUi()
  const primary = useAuth().session?.wallets?.[0]

  if (!primary) {
    return (
      <p className="rounded-2xl bg-ground p-4 text-[15px] text-slate">
        Link a wallet first: choose <span className="font-semibold text-ink">Add money</span>, then <span className="font-semibold text-ink">Solana wallet</span>.
      </p>
    )
  }

  // The money is in the linked wallet, so that wallet has to sign.
  const blocked = !publicKey ? (
    <Button className="w-full" onClick={openModal} busy={connecting}>
      {connecting ? 'Waiting for your wallet' : `Connect ${shortAddress(primary)} to send`}
    </Button>
  ) : publicKey.toBase58() !== primary ? (
    <p className="rounded-2xl bg-gold-soft p-4 text-[15px] text-gold-ink">
      Your money is in {shortAddress(primary)}, but {shortAddress(publicKey.toBase58())} is connected. Switch to {shortAddress(primary)} in your wallet app to send.
    </p>
  ) : undefined

  return <SendForm amount={amount} amountOk={amountOk} sign={signTransaction && publicKey ? adapterSigner(signTransaction, wallet?.adapter, publicKey.toBase58()) : null} blocked={blocked} onSent={onSent} />
}
