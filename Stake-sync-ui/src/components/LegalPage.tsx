import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { cx } from '../lib/format'
import { ScrollTrigger, useGSAP } from '../lib/gsap'
import { Select } from './Select'

export interface LegalSection {
  id: string
  title: string
  body: ReactNode
}

/**
 * Long-form legal document: contents list on the left (a select on phones),
 * numbered sections on the right. The contents entry for the section in view is highlighted.
 */
export function LegalPage({
  title,
  summary,
  updated,
  sections,
  other,
}: {
  title: string
  summary: ReactNode
  updated: string
  sections: LegalSection[]
  other: { to: string; label: string }
}) {
  const root = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(sections[0].id)

  useGSAP(
    () => {
      sections.forEach((s) => {
        ScrollTrigger.create({
          trigger: `#${s.id}`,
          start: 'top 30%',
          end: 'bottom 30%',
          onToggle: (self) => self.isActive && setActive(s.id),
        })
      })
    },
    { scope: root },
  )

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    history.replaceState(null, '', `#${id}`)
  }

  return (
    <div ref={root} className="mx-auto max-w-[120rem] px-4 pt-12 pb-24 sm:px-6 lg:px-12 2xl:px-16 md:pt-20">
      <header className="max-w-3xl">
        <p className="text-slate">Last updated {updated}</p>
        <h1 className="mt-2 text-[clamp(2.5rem,6vw,4rem)] leading-[1.02] font-extrabold tracking-[-0.03em]">{title}</h1>
        <div className="mt-5 text-lg text-slate">{summary}</div>
      </header>

      <div className="mt-12 grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16">
        <nav aria-label="Contents" className="lg:sticky lg:top-24 lg:self-start">
          <label className="lg:hidden">
            <span className="text-sm font-semibold">Jump to section</span>
            <Select
              label="Jump to section"
              value={active}
              onChange={jump}
              className="mt-2"
              options={sections.map((s, i) => ({ value: s.id, label: `${i + 1}. ${s.title}` }))}
            />
          </label>
          <ol className="hidden border-l border-line lg:block">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    jump(s.id)
                  }}
                  aria-current={active === s.id ? 'location' : undefined}
                  className={cx(
                    '-ml-px block border-l-2 py-1.5 pl-4 text-sm transition-colors',
                    active === s.id ? 'border-cobalt font-semibold text-ink' : 'border-transparent text-slate hover:text-ink',
                  )}
                >
                  <span className="tabular">{i + 1}.</span> {s.title}
                </a>
              </li>
            ))}
          </ol>
          <Link to={other.to} className="mt-6 hidden text-sm font-semibold text-cobalt hover:underline lg:block">
            {other.label}
          </Link>
        </nav>

        <article className="max-w-[68ch]">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24 border-t border-line py-10 first:border-t-0 first:pt-0">
              <h2 className="text-2xl font-bold">
                <span className="mr-2 text-slate/50 tabular">{i + 1}.</span>
                {s.title}
              </h2>
              <div className="legal mt-4 space-y-4 text-[17px] leading-relaxed text-ink/90">{s.body}</div>
            </section>
          ))}
          <div className="border-t border-line pt-8 text-[15px] text-slate">
            Questions about this document? Email{' '}
            <a href="mailto:stakesync2@gmail.com" className="font-semibold text-cobalt hover:underline">
              stakesync2@gmail.com
            </a>
            . See also our{' '}
            <Link to={other.to} className="font-semibold text-cobalt hover:underline">
              {other.label}
            </Link>
            .
          </div>
        </article>
      </div>
    </div>
  )
}
