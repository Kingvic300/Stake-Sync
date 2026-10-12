import { useEffect } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Logo } from '../components/Logo'
import { Button } from '../components/ui'
import { reportError } from '../lib/report'

export function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-4xl font-bold">We couldn’t find that page</h1>
      <p className="mt-3 text-slate">The link may be wrong, or the page moved. Try search with Ctrl K.</p>
      <Button to="/" className="mt-8">
        Back to overview
      </Button>
    </div>
  )
}

/** Catches render errors and failed page loads. Admins see a plain message; details go to the log. */
export function RouteError() {
  const error = useRouteError()
  const missing = isRouteErrorResponse(error) && error.status === 404
  useEffect(() => {
    if (!missing) reportError(error, { where: 'admin-route' })
  }, [error, missing])
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-5">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 text-center">
        <div className="max-w-lg">
          <h1 className="text-4xl font-bold">{missing ? 'We couldn’t find that page' : 'Something went wrong'}</h1>
          <p className="mt-3 text-slate">
            {missing ? 'The link may be wrong, or the page moved.' : 'It’s been logged. No action was taken on any account or challenge.'}
          </p>
          <div className="mt-8 flex justify-center gap-2">
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button href="/" variant="secondary">
              Overview
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
