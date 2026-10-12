import { ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '../auth/context'
import { Logo } from './Logo'
import { Button, ProviderMark } from './ui'

const columns: { title: string; links: [string, string][] }[] = [
  {
    title: 'Product',
    links: [
      ['/how-it-works', 'How it works'],
      ['/verification', 'Verification'],
      ['/organizations', 'For organizations'],
    ],
  },
  {
    title: 'Account',
    links: [
      ['/signup', 'Create an account'],
      ['/login', 'Log in'],
      ['/overview', 'Open the app'],
    ],
  },
  {
    title: 'Legal',
    links: [
      ['/terms', 'Terms and Conditions'],
      ['/privacy', 'Privacy Policy'],
    ],
  },
]

// A month of verified days with two misses: the brand's one decorative device.
const strip = Array.from({ length: 30 }, (_, i) => (i === 8 || i === 20 ? 'bg-miss' : i > 25 ? 'bg-white/10' : 'bg-cobalt'))

export function SiteFooter() {
  const { session } = useAuth()
  return (
    <footer className="bg-ink text-white">
      <div className="mx-auto max-w-[120rem] px-4 pt-16 pb-10 sm:px-6 lg:px-12 2xl:px-16">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_2fr]">
          <div className="max-w-sm">
            <Logo invert className="[&_span]:text-white" />
            <p className="mt-5 text-[15px] text-white/65">
              Put money behind your goals, prove you followed through with the tools you already use, and earn for
              finishing.
            </p>
            {!session && (
              <div className="mt-6 flex flex-wrap gap-2">
                <Button to="/signup" size="sm">
                  Get started
                </Button>
                <Button to="/login" size="sm" variant="ghost" className="text-white ring-1 ring-white/20 hover:bg-white/10">
                  Log in
                </Button>
              </div>
            )}
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {columns.map((col) => (
              <div key={col.title}>
                <h2 className="font-sans text-sm font-semibold text-white/50">{col.title}</h2>
                <ul className="mt-4 space-y-3">
                  {col.links.map(([to, label]) => (
                    <li key={to}>
                      <Link to={to} className="text-[15px] text-white/85 transition-colors hover:text-white">
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div aria-hidden className="mt-14 grid grid-cols-[repeat(30,minmax(0,1fr))] gap-1">
          {strip.map((c, i) => (
            <span key={i} className={`h-2 rounded-[2px] ${c}`} />
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-4 text-sm text-white/55 md:flex-row md:items-center md:justify-between">
          <p>© 2026 Stake-Sync. All rights reserved.</p>
          <p className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-calm" />
            Stakes are held in a Solana escrow program. Nobody at Stake-Sync can move them.
          </p>
          <p className="flex items-center gap-2">
            <ProviderMark provider="Solana" size={14} tone={false} />
            Built on Solana
          </p>
        </div>
      </div>
    </footer>
  )
}
