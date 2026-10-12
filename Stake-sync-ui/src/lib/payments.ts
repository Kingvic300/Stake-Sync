import bs58 from 'bs58'
import { api } from './api'

/** Privy is on when its app ID is set. Without it, people connect their own wallet instead. */
export const embeddedWalletsEnabled = Boolean(import.meta.env.VITE_PRIVY_APP_ID)

/** Paying in local currency and cashing out to a bank (LocalRamp). Off until the partner account is live. */
export const onrampEnabled = import.meta.env.VITE_ONRAMP_ENABLED === 'true'

/** What to show when someone picks bank or card while it's switched off. */
export const ONRAMP_SOON = {
  tone: 'info' as const,
  title: 'Coming soon',
  body: 'Paying in naira and cashing out to your bank are on the way. For now, use USDC from a crypto wallet or exchange.',
  inbox: false,
}

type OnrampStart =
  | { provider: 'onramper'; url: string }
  | { provider: 'localramp'; reference: string; widget: { script: string; global: 'LocalRampBuy' | 'LocalRampSell'; options: Record<string, string> } }

type LocalRampGlobal = { initialize: (options: Record<string, unknown>) => void }

/** Loads a provider's script once. */
function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('The payment window couldn’t load. Check your connection and try again.'))
    document.head.appendChild(el)
  })
}

/**
 * Opens the payment partner to buy USDC into the person's own wallet, or sell it to their bank. The
 * partner shows the rate and fee and takes the payment; we never touch the money.
 * LocalRamp opens as a pop-up over the app; when it closes we ask the API to check the payment,
 * then go to the wallet page. Onramper opens as its own page and comes back to the wallet page.
 */
export async function openOnramp(mode: 'buy' | 'sell', opts: { fiat?: string; amount?: number } = {}): Promise<{ paid: boolean } | undefined> {
  const r = await api<OnrampStart>('/payments/onramp', { method: 'POST', body: { mode, ...opts } })
  if (r.provider !== 'localramp') {
    window.location.assign(r.url)
    return undefined
  }
  await loadScript(r.widget.script)
  const lr = (window as unknown as Record<string, LocalRampGlobal | undefined>)[r.widget.global]
  if (!lr) throw new Error('The payment window couldn’t load. Please try again.')
  return new Promise((resolve) => {
    lr.initialize({
      ...r.widget.options,
      // Called whether or not they paid, so ask LocalRamp (through our API) what happened.
      onClose: () => {
        if (mode === 'sell') return resolve({ paid: true }) // LocalRamp reports cash-outs by webhook only
        api<{ state: string }>(`/payments/onramp/${encodeURIComponent(r.reference)}/check`, { method: 'POST' })
          .then((s) => resolve({ paid: s.state === 'paid' || s.state === 'completed' }))
          .catch(() => resolve({ paid: false }))
      },
    })
  })
}

/** Proves a wallet belongs to the signed-in person: they sign a one-time message (free, moves no money). */
export async function linkWallet(address: string, signMessage: (message: Uint8Array) => Promise<Uint8Array>, kind: 'external' | 'embedded' = 'external') {
  const { message, nonce } = await api<{ message: string; nonce: string }>('/auth/wallet/link/nonce', { method: 'POST', body: { address } })
  const signature = await signMessage(new TextEncoder().encode(message))
  await api('/auth/wallet/link', { method: 'POST', body: { address, nonce, signature: bs58.encode(signature), kind } })
}
