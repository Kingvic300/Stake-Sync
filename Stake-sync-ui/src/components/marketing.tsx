import { Plus } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { cx } from '../lib/format'
import { gsap, prefersMotion, useGSAP } from '../lib/gsap'
import { Button } from './ui'

/** Opening block for the public pages: big statement left, supporting copy and actions right. */
export function PageIntro({ title, intro, children }: { title: ReactNode; intro: ReactNode; children?: ReactNode }) {
  const root = useRef<HTMLElement>(null)
  useGSAP(
    () => {
      if (!prefersMotion()) return
      gsap.from('[data-intro] > *', { y: 26, autoAlpha: 0, duration: 0.7, stagger: 0.09, ease: 'power3.out', delay: 0.1 })
    },
    { scope: root },
  )
  return (
    <section ref={root} className="mx-auto max-w-[120rem] px-4 pt-14 pb-16 sm:px-6 lg:px-12 2xl:px-16 md:pt-24 md:pb-20">
      <div data-intro className="grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:items-end">
        <h1 className="text-[clamp(2.6rem,6.4vw,4.75rem)] leading-[0.98] font-extrabold tracking-[-0.035em]">{title}</h1>
        <div>
          <p className="text-lg text-slate sm:text-xl">{intro}</p>
          {children && <div className="mt-7 flex flex-wrap gap-3">{children}</div>}
        </div>
      </div>
    </section>
  )
}

export function SectionHead({ title, intro, className }: { title: ReactNode; intro?: ReactNode; className?: string }) {
  return (
    <div className={cx('max-w-2xl', className)}>
      <h2 className="text-3xl font-bold sm:text-4xl">{title}</h2>
      {intro && <p className="mt-3 text-lg text-slate">{intro}</p>}
    </div>
  )
}

export function CtaBand({ title, body, primary = 'Create your account', to = '/signup' }: { title: string; body: string; primary?: string; to?: string }) {
  return (
    <section className="mx-auto max-w-[120rem] px-4 pb-20 sm:px-6 lg:px-12 2xl:px-16">
      <div className="flex flex-col items-start gap-6 rounded-[32px] bg-cobalt px-6 py-10 text-white sm:px-10 sm:py-12 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="max-w-[22ch] text-3xl font-bold sm:text-4xl">{title}</h2>
          <p className="mt-2 max-w-xl text-white/80">{body}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <Button to={to} size="lg" variant="secondary" className="ring-0">
            {primary}
          </Button>
          <Button to="/login" size="lg" variant="ghost" className="text-white hover:bg-white/10">
            Log in
          </Button>
        </div>
      </div>
    </section>
  )
}

/** Accordion; the answer's height animates open and closed in response to the click. */
export function Faq({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {items.map((it) => (
        <FaqItem key={it.q} {...it} />
      ))}
    </ul>
  )
}

function FaqItem({ q, a }: { q: string; a: ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLLIElement>(null)
  const first = useRef(true)

  useGSAP(
    () => {
      const body = root.current?.querySelector<HTMLElement>('[data-answer]')
      const icon = root.current?.querySelector<HTMLElement>('[data-icon]')
      if (!body || !icon) return
      const d = first.current || !prefersMotion() ? 0 : 0.4
      first.current = false
      gsap.to(body, { height: open ? 'auto' : 0, autoAlpha: open ? 1 : 0, duration: d, ease: 'power3.inOut' })
      gsap.to(icon, { rotate: open ? 45 : 0, duration: d, ease: 'power3.inOut' })
    },
    { scope: root, dependencies: [open] },
  )

  return (
    <li ref={root}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-6 py-5 text-left text-lg font-semibold"
      >
        {q}
        <span data-icon className="grid size-8 shrink-0 place-items-center rounded-full bg-surface ring-1 ring-line">
          <Plus size={16} />
        </span>
      </button>
      <div data-answer className="h-0 overflow-hidden opacity-0">
        <div className="max-w-3xl pb-6 text-[17px] text-slate">{a}</div>
      </div>
    </li>
  )
}
