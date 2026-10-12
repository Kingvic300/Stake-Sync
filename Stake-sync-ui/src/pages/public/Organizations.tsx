import { Building2, Check, GraduationCap, Megaphone, Users } from 'lucide-react'
import { useRef } from 'react'
import { CtaBand, Faq, PageIntro, SectionHead } from '../../components/marketing'
import { Avatar, Button, ProviderMark } from '../../components/ui'
import type { OrgRank } from '../../data/types'
import { cx, usd } from '../../lib/format'
import { useApiData } from '../../lib/useApiData'
import { useReveal } from '../../lib/useReveal'

const uses = [
  {
    icon: Users,
    who: 'Communities and ecosystems',
    example: 'A developer community runs a 30-day builder challenge for hundreds of members, with a small commitment and a sponsored reward pool.',
    tags: ['GitHub', 'Solana'] as const,
  },
  {
    icon: GraduationCap,
    who: 'Universities and student groups',
    example: 'A campus coding society runs a private problem-solving sprint: 20 students, a small stake and 50 new LeetCode problems each.',
    tags: ['LeetCode'] as const,
  },
  {
    icon: Building2,
    who: 'Companies and teams',
    example: 'An engineering team finishes security training, DevRel publishes four tutorials, and sales completes agreed outreach. No stakes needed.',
    tags: ['GitHub'] as const,
  },
  {
    icon: Megaphone,
    who: 'Brands and sponsors',
    example: 'A fitness brand funds a city-wide 10K build-up. Every verified finisher shares the pool, and the brand gets real engagement.',
    tags: ['Health'] as const,
  },
]

export function Organizations() {
  const root = useRef<HTMLDivElement>(null)
  useReveal(root)
  const top = (useApiData<OrgRank[]>('/leaderboards/orgs').data ?? []).slice(0, 3)

  return (
    <div ref={root}>
      <PageIntro
        title="Challenges for your community, campus or team"
        intro="Give your people a goal worth finishing. Run public competitions or private challenges, sponsor the rewards, and watch verified progress come in."
      >
        <Button to="/signup" size="lg">
          Set up your organization
        </Button>
        <Button href="mailto:stakesync2@gmail.com" size="lg" variant="secondary">
          Talk to us
        </Button>
      </PageIntro>

      {top.length > 0 && (
        <section className="mx-auto max-w-[120rem] px-4 pb-20 sm:px-6 lg:px-12 2xl:px-16">
          <SectionHead title="Leading organizations this month" />
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {top.map((o) => (
              <li key={o.slug} className="rounded-3xl bg-surface p-6 ring-1 ring-line/70">
                <div className="flex items-center gap-3">
                  <Avatar person={o.person} size={44} />
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{o.name}</div>
                    <div className="text-sm text-slate">
                      {o.challenges} {o.challenges === 1 ? 'challenge' : 'challenges'}
                    </div>
                  </div>
                </div>
                <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-4 text-sm">
                  <div>
                    <dt className="text-slate">Active</dt>
                    <dd className="font-display text-xl font-semibold tabular">{o.active.toLocaleString('en-US')}</dd>
                  </div>
                  <div>
                    <dt className="text-slate">Completion</dt>
                    <dd className="font-display text-xl font-semibold tabular">{Math.round(o.rate)}%</dd>
                  </div>
                  <div>
                    <dt className="text-slate">Sponsored</dt>
                    <dd className="font-display text-xl font-semibold text-gold-ink tabular">{usd(o.sponsored)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[120rem] px-4 py-20 sm:px-6 lg:px-12 2xl:px-16">
          <SectionHead title="Who runs challenges on Stake-Sync" />
          <div data-reveal-group className="mt-10 grid gap-4 md:grid-cols-2">
            {uses.map((u) => (
              <article key={u.who} className="rounded-3xl bg-ground p-6 sm:p-8">
                <u.icon size={26} className="text-cobalt" />
                <h3 className="mt-5 text-2xl font-bold">{u.who}</h3>
                <p className="mt-2 text-slate">{u.example}</p>
                <div className="mt-5 flex gap-2">
                  {u.tags.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-sm ring-1 ring-line">
                      <ProviderMark provider={t} size={13} /> {t}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-[120rem] gap-12 px-4 py-20 sm:px-6 lg:px-12 2xl:px-16 lg:grid-cols-[1fr_1.3fr]">
        <SectionHead
          title="Everything you need to run it"
          intro="Your organization gets its own account, admins and dashboard. Challenges can be public or limited to your members."
        />
        <ul data-reveal-group className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {[
            ['Create challenges', 'Use templates or set your own requirement, verification and strike rules.'],
            ['Sponsor rewards', 'Fund a reward pool. It’s held in escrow and paid out by the rules.'],
            ['Invite members', 'Share an invite link or code, or invite people directly.'],
            ['Run internal challenges', 'Private challenges for your team, with or without stakes.'],
            ['Track progress', 'See who’s on track, who’s at risk and daily completion.'],
            ['Post announcements', 'Pinned messages and announcements in every challenge chat.'],
            ['Moderate', 'Remove messages, handle reports and review flagged accounts.'],
            ['Export results', 'Download verified results for prizes, grades or reviews.'],
          ].map(([t, b]) => (
            <li key={t} className="flex gap-3">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-cobalt-soft text-cobalt">
                <Check size={14} strokeWidth={3} />
              </span>
              <div>
                <h3 className="font-sans text-[17px] font-semibold">{t}</h3>
                <p className="mt-0.5 text-[15px] text-slate">{b}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[120rem] px-4 py-20 sm:px-6 lg:px-12 2xl:px-16">
          <SectionHead title="Ways to work with us" intro="Start free with a public challenge. Upgrade when you need private challenges and deeper tools." />
          <div data-reveal-group className="mt-10 grid gap-4 lg:grid-cols-3">
            {[
              {
                name: 'Community',
                price: 'Free',
                note: 'For public challenges',
                items: ['Public challenges', 'Leaderboards and chat', 'Standard verification', 'Sponsor reward pools'],
              },
              {
                name: 'Organization',
                price: 'Monthly plan',
                note: 'For teams, campuses and communities',
                items: ['Everything in Community', 'Private and members-only challenges', 'Organization dashboard and analytics', 'Exports and moderation tools'],
                featured: true,
              },
              {
                name: 'Sponsored campaign',
                price: 'Per campaign',
                note: 'For brands and ecosystems',
                items: ['We help design the challenge', 'Featured placement in Explore', 'Enhanced verification', 'Campaign reporting'],
              },
            ].map((p) => (
              <article
                key={p.name}
                className={cx('flex flex-col rounded-3xl p-6 sm:p-8', p.featured ? 'bg-ink text-white' : 'bg-ground')}
              >
                <h3 className="text-xl font-semibold">{p.name}</h3>
                <div className="mt-4 font-display text-3xl font-bold">{p.price}</div>
                <p className={cx('mt-1 text-[15px]', p.featured ? 'text-white/65' : 'text-slate')}>{p.note}</p>
                <ul className="mt-6 flex-1 space-y-2.5 text-[15px]">
                  {p.items.map((i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <Check size={17} strokeWidth={3} className={cx('mt-0.5 shrink-0', p.featured ? 'text-gold' : 'text-cobalt')} />
                      {i}
                    </li>
                  ))}
                </ul>
                <Button
                  to={p.name === 'Community' ? '/signup' : undefined}
                  href={p.name === 'Community' ? undefined : 'mailto:stakesync2@gmail.com'}
                  variant={p.featured ? 'gold' : 'secondary'}
                  className="mt-8 w-full"
                >
                  {p.name === 'Community' ? 'Start free' : 'Talk to us'}
                </Button>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[120rem] px-4 py-20 sm:px-6 lg:px-12 2xl:px-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
          <SectionHead title="Questions from organizers" />
          <Faq
            items={[
              {
                q: 'Do our members have to stake money?',
                a: 'No. You choose no stake, a fixed stake or a range. Many internal and campus challenges run without stakes.',
              },
              {
                q: 'Where does sponsor money go?',
                a: 'Into the challenge’s escrow on Solana when you fund it. It’s paid out to finishers by the distribution rule you set, and anyone can verify it on-chain.',
              },
              {
                q: 'Can we pay sponsorship in local currency?',
                a: 'Coming soon. Funding in naira, cedi, shilling or dollars by bank transfer or card is on the way. For now, fund in USDC. Later, it’s converted to USDC for the pool.',
              },
              {
                q: 'Can we restrict a challenge to our members?',
                a: 'Yes. Members-only challenges are visible only to people in your organization. Private challenges need an invite link, code or direct invitation.',
              },
            ]}
          />
        </div>
      </section>

      <CtaBand
        title="Give your community something to finish"
        body="Set up your organization in a few minutes and launch your first challenge this week."
        primary="Set up your organization"
      />
    </div>
  )
}
