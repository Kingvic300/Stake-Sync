import { useEffect, useRef, type ReactNode } from 'react'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { JoinCodeForm } from '../../components/JoinCode'
import { Logo } from '../../components/Logo'
import { Button } from '../../components/ui'
import { cx } from '../../lib/format'
import { gsap, motionOK, useGSAP } from '../../lib/gsap'
import { reportError } from '../../lib/report'
import { tileClass } from '../../lib/styles'
import { color } from '../../lib/tokens'

/** A week of verified days with one gap: the brand's way of saying something's missing. */
function MissingDay({ state = 'upcoming' }: { state?: 'upcoming' | 'failed' }) {
  const root = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      gsap.matchMedia().add(motionOK, () => {
        gsap
          .timeline()
          .fromTo(
            '[data-tile]',
            { backgroundColor: color.tile, scale: 0.6 },
            { backgroundColor: color.cobalt, scale: 1, duration: 0.35, stagger: 0.07, ease: 'back.out(2)', clearProps: 'all' },
          )
          .fromTo('[data-gap]', { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.4, ease: 'back.out(2)' }, 0.2)
          .to('[data-gap]', { rotate: -8, duration: 0.12, yoyo: true, repeat: 3, ease: 'power1.inOut' }, '+=0.1')
      })
    },
    { scope: root },
  )
  return (
    <div ref={root} aria-hidden className="mx-auto grid w-fit grid-cols-7 gap-2">
      {Array.from({ length: 7 }, (_, i) =>
        i === 4 ? (
          <span
            key={i}
            data-gap
            className={cx('size-9 rounded-lg sm:size-11', state === 'failed' ? tileClass.failed : 'border-2 border-dashed border-slate/40')}
          />
        ) : (
          <span key={i} data-tile className="size-9 rounded-lg bg-cobalt sm:size-11" />
        ),
      )}
    </div>
  )
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-[120rem] items-center px-4 sm:px-6 lg:px-12 2xl:px-16">
        <Logo />
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-lg text-center">{children}</div>
      </main>
    </div>
  )
}

function NotFoundContent() {
  return (
    <>
      <MissingDay />
      <h1 className="mt-10 text-4xl font-bold sm:text-5xl">We couldn’t find that page</h1>
      <p className="mt-3 text-lg text-slate">
        The link may be mistyped, or the page may have moved. Nothing has happened to your account or your stakes.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Button to="/">Go to the home page</Button>
        <Button to="/explore" variant="secondary">
          Browse challenges
        </Button>
      </div>
      <p className="mt-8 text-sm text-slate">
        Following an invite?{' '}
        <Link to="/join" className="font-semibold text-cobalt hover:underline">
          Enter your invite code
        </Link>
      </p>
    </>
  )
}

/** In-layout 404 for unknown paths. */
export function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center sm:py-28">
      <NotFoundContent />
    </div>
  )
}

/** Router-level catch-all for render errors and failed page loads. Never shows raw errors. */
export function RouteError() {
  const error = useRouteError()
  const missing = isRouteErrorResponse(error) && error.status === 404
  const chunk = error instanceof Error && /dynamically imported module|Loading chunk|Failed to fetch/i.test(error.message)

  useEffect(() => {
    if (!missing) reportError(error, { where: 'route' })
  }, [error, missing])

  if (missing) {
    return (
      <Frame>
        <NotFoundContent />
      </Frame>
    )
  }

  return (
    <Frame>
      <MissingDay state="failed" />
      <h1 className="mt-10 text-4xl font-bold sm:text-5xl">{chunk ? 'This page didn’t finish loading' : 'Something went wrong on our side'}</h1>
      <p className="mt-3 text-lg text-slate">
        {chunk
          ? 'Your connection may have dropped, or we just released an update. Reloading usually fixes it.'
          : 'We’ve logged it and will look into it. Your account, balance and stakes are safe.'}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Button onClick={() => window.location.reload()}>Reload the page</Button>
        <Button href="/" variant="secondary">
          Go to the home page
        </Button>
      </div>
      <p className="mt-8 text-sm text-slate">
        Still stuck? Email{' '}
        <a href="mailto:stakesync2@gmail.com" className="font-semibold text-cobalt hover:underline">
          stakesync2@gmail.com
        </a>
      </p>
    </Frame>
  )
}

/** Public page for typing an invite code by hand. */
export function EnterCode() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:py-24">
      <h1 className="text-4xl font-bold">Join with a code</h1>
      <p className="mt-3 text-lg text-slate">
        Enter the invite code you were given for a challenge or an organization. You’ll see what you’re joining before
        anything happens.
      </p>
      <div className="mt-8 rounded-3xl bg-surface p-6 ring-1 ring-line/70">
        <JoinCodeForm autoFocus />
      </div>
    </div>
  )
}
