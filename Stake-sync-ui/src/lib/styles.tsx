import { Check, CloudOff, Hourglass, Scale, Snowflake, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Challenge, ProofState, Provider } from '../data/types'
import { cx, usd } from './format'

export type Variant = 'primary' | 'secondary' | 'ghost' | 'gold' | 'ink'
export type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-cobalt text-white hover:bg-cobalt-deep active:bg-cobalt-deep',
  ink: 'bg-ink text-white hover:bg-ink/90',
  gold: 'bg-gold text-ink hover:brightness-95',
  secondary: 'bg-surface text-ink ring-1 ring-inset ring-line hover:ring-slate/40',
  ghost: 'text-ink hover:bg-ink/5',
}

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm gap-1.5 rounded-lg',
  md: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
  lg: 'h-13 px-6 text-base gap-2 rounded-xl',
}

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra?: string) {
  return cx(
    'inline-flex select-none items-center justify-center font-semibold whitespace-nowrap transition-[background-color,box-shadow,filter,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-45',
    variants[variant],
    sizes[size],
    extra,
  )
}

export const proofMeta: Record<ProofState, { label: string; chip: string; icon: ReactNode }> = {
  verified: { label: 'Verified', chip: 'bg-cobalt-soft text-cobalt-deep', icon: <Check size={13} strokeWidth={3} /> },
  failed: { label: 'Missed', chip: 'bg-miss-soft text-[oklch(45%_0.17_23)]', icon: <X size={13} strokeWidth={3} /> },
  pending: { label: 'Checking', chip: 'bg-tile text-slate', icon: <Hourglass size={13} strokeWidth={2.5} /> },
  unavailable: {
    label: 'Provider down, not counted',
    chip: 'bg-tile text-slate',
    icon: <CloudOff size={13} strokeWidth={2.5} />,
  },
  disputed: { label: 'Under review', chip: 'bg-gold-soft text-gold-ink', icon: <Scale size={13} strokeWidth={2.5} /> },
  frozen: { label: 'Frozen', chip: 'bg-cobalt-soft text-cobalt-deep', icon: <Snowflake size={13} strokeWidth={2.5} /> },
  upcoming: { label: 'Upcoming', chip: 'bg-tile text-slate', icon: null },
}

export const tileClass: Record<ProofState, string> = {
  verified: 'bg-cobalt',
  failed: 'bg-miss',
  pending: 'tile-pending',
  unavailable: 'tile-hatch',
  disputed: 'bg-gold',
  frozen: 'bg-cobalt-soft ring-1 ring-inset ring-cobalt/30',
  upcoming: 'bg-tile',
}

export function stakeLabel(c: Challenge) {
  if (c.stakeMode === 'none') return 'No stake'
  if (c.stakeMode === 'range' && c.stakeRange) return `${usd(c.stakeRange[0])}–${usd(c.stakeRange[1])}`
  return usd(c.stake)
}

/** Input chrome without a font size, for inputs that set their own. */
export const inputBase =
  'w-full rounded-xl bg-surface px-4 py-3 ring-1 ring-inset ring-line placeholder:text-slate/70 transition-shadow focus:outline-none focus:ring-2 focus:ring-cobalt'

export const inputClass =
  'w-full rounded-xl bg-surface px-4 py-3 text-[15px] ring-1 ring-inset ring-line placeholder:text-slate/70 transition-shadow focus:outline-none focus:ring-2 focus:ring-cobalt'

const providerNames: Record<Provider, string> = {
  GitHub: 'GitHub',
  Solana: 'Solana',
  LeetCode: 'LeetCode',
  Codeforces: 'Codeforces',
  WakaTime: 'WakaTime',
  Camera: 'your phone camera',
  Health: 'Apple Health or Health Connect',
  Photo: 'photo review',
}

export function verifiedBy(providers: Provider[]) {
  return providers.map((p) => providerNames[p]).join(' and ')
}

/** How a challenge's progress gets checked, in plain words. */
export function howChecked(providers: Provider[]) {
  if (providers.includes('Photo')) return 'You upload a photo each day. It’s checked for duplicates and edits, then reviewed by people before it counts'
  if (providers.includes('Camera')) return 'Reps are counted by your phone camera in the Stake-Sync app. Video stays on your phone'
  if (providers.includes('Health')) return 'Read from Apple Health or Health Connect by the Stake-Sync mobile app. Manually added data doesn’t count'
  return `${providers.join(' and ')}, checked automatically. Provider outages never count against you`
}
