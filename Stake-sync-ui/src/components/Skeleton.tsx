import { cx } from '../lib/format'

/** One placeholder block. Size it with utility classes. */
export function Bone({ className, dark }: { className?: string; dark?: boolean }) {
  return <span aria-hidden className={cx('bone block rounded-lg', dark && 'bone-dark', className)} />
}

function Loading({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

export function TextLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={cx('block space-y-2.5', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} className={cx('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </span>
  )
}

export function PanelSkeleton({ className, rows = 3 }: { className?: string; rows?: number }) {
  return (
    <div className={cx('rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-7', className)}>
      <Bone className="h-6 w-40" />
      <div className="mt-6 space-y-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Bone className="size-10 shrink-0 rounded-xl" />
            <span className="flex-1 space-y-2">
              <Bone className="h-3.5 w-1/2" />
              <Bone className="h-3 w-3/4" />
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function GridSkeleton({ count = 30, columns = 10, className }: { count?: number; columns?: number; className?: string }) {
  return (
    <span className={cx('grid gap-1.5', className)} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}>
      {Array.from({ length: count }, (_, i) => (
        <Bone key={i} className="aspect-square rounded-[5px]" />
      ))}
    </span>
  )
}

/** Dashboard-style page: heading, a wide panel with a side panel, then two panels. */
export function AppPageSkeleton() {
  return (
    <Loading label="Loading page" className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16 sm:py-10">
      <Bone className="h-10 w-72 max-w-full" />
      <Bone className="mt-3 h-4 w-56" />
      <div className="mt-8 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-3xl bg-surface p-5 ring-1 ring-line/70 sm:p-7">
          <Bone className="h-6 w-48" />
          <GridSkeleton className="mt-6" />
          <div className="mt-6 grid grid-cols-3 gap-4">
            <Bone className="h-10" />
            <Bone className="h-10" />
            <Bone className="h-10" />
          </div>
        </div>
        <div className="rounded-3xl bg-ink p-6">
          <Bone dark className="h-4 w-24" />
          <Bone dark className="mt-3 h-10 w-40" />
          <Bone dark className="mt-8 h-11 w-full rounded-xl" />
        </div>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <PanelSkeleton />
        <PanelSkeleton />
      </div>
    </Loading>
  )
}

/** List page: search bar, filter chips, rows. */
export function ListPageSkeleton() {
  return (
    <Loading label="Loading challenges" className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16 sm:py-10">
      <Bone className="h-10 w-80 max-w-full" />
      <Bone className="mt-6 h-12 w-full rounded-xl" />
      <div className="mt-4 flex gap-2 overflow-hidden">
        {Array.from({ length: 7 }, (_, i) => (
          <Bone key={i} className="h-9 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Bone className="h-64 rounded-3xl" />
        <Bone className="h-64 rounded-3xl" />
      </div>
      <ChallengeRowsSkeleton className="mt-8" />
    </Loading>
  )
}

export function ChallengeRowsSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <ul className={cx('divide-y divide-line', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="grid grid-cols-[1fr_auto] gap-6 px-4 py-5 sm:px-5">
          <span className="space-y-2.5">
            <Bone className="h-3 w-24" />
            <Bone className="h-5 w-64 max-w-full" />
            <Bone className="h-3.5 w-80 max-w-full" />
          </span>
          <span className="flex gap-6">
            <Bone className="h-6 w-14" />
            <Bone className="hidden h-6 w-16 sm:block" />
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Challenge page: title block, facts, tabs and a side card. */
export function DetailPageSkeleton() {
  return (
    <Loading label="Loading challenge" className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16 sm:py-10">
      <Bone className="h-4 w-28" />
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div>
          <Bone className="h-4 w-40" />
          <Bone className="mt-4 h-12 w-3/4" />
          <TextLines className="mt-5 max-w-xl" lines={2} />
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} className="space-y-2">
                <Bone className="h-3 w-16" />
                <Bone className="h-7 w-20" />
              </span>
            ))}
          </div>
          <div className="mt-10 flex gap-6 border-b border-line pb-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Bone key={i} className="h-5 w-20" />
            ))}
          </div>
          <TextLines className="mt-6" lines={5} />
        </div>
        <div className="hidden h-80 rounded-3xl bg-surface p-6 ring-1 ring-line/70 lg:block">
          <Bone className="h-4 w-20" />
          <Bone className="mt-3 h-10 w-28" />
          <TextLines className="mt-6" lines={4} />
          <Bone className="mt-8 h-12 w-full rounded-xl" />
        </div>
      </div>
    </Loading>
  )
}

/** Step form: progress, heading, fields; optional preview column. */
export function FormPageSkeleton({ preview = true }: { preview?: boolean }) {
  return (
    <Loading label="Loading form" className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16 sm:py-10">
      <Bone className="h-10 w-72 max-w-full" />
      <div className={cx('mt-8 grid gap-8', preview && 'lg:grid-cols-[1fr_24rem]')}>
        <div className="rounded-3xl bg-surface p-6 ring-1 ring-line/70 sm:p-8">
          <Bone className="h-1.5 w-full rounded-full" />
          <Bone className="mt-8 h-8 w-64" />
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className="mt-6 block space-y-2">
              <Bone className="h-3.5 w-24" />
              <Bone className="h-12 w-full rounded-xl" />
            </span>
          ))}
        </div>
        {preview && <PanelSkeleton className="hidden lg:block" rows={4} />}
      </div>
    </Loading>
  )
}

/** Profile: identity header, score, tabs, card grid. */
export function ProfilePageSkeleton() {
  return (
    <Loading label="Loading profile" className="mx-auto max-w-[120rem] px-4 py-8 sm:px-6 lg:px-12 2xl:px-16 sm:py-10">
      <div className="flex flex-wrap items-center gap-5">
        <Bone className="size-20 rounded-full" />
        <span className="space-y-2.5">
          <Bone className="h-8 w-56" />
          <Bone className="h-4 w-40" />
        </span>
        <Bone className="ml-auto h-16 w-32 rounded-2xl" />
      </div>
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Bone key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Bone key={i} className="h-36 rounded-3xl" />
        ))}
      </div>
    </Loading>
  )
}

export function AuthSkeleton() {
  return (
    <Loading label="Loading">
      <Bone className="h-10 w-64" />
      <Bone className="mt-3 h-4 w-72 max-w-full" />
      <div className="mt-8 grid grid-cols-2 gap-3">
        <Bone className="h-11 rounded-xl" />
        <Bone className="h-11 rounded-xl" />
      </div>
      {Array.from({ length: 2 }, (_, i) => (
        <span key={i} className="mt-6 block space-y-2">
          <Bone className="h-3.5 w-16" />
          <Bone className="h-12 w-full rounded-xl" />
        </span>
      ))}
      <Bone className="mt-8 h-11 w-full rounded-xl" />
    </Loading>
  )
}

export function MarketingSkeleton() {
  return (
    <Loading label="Loading page" className="mx-auto max-w-[120rem] px-4 pt-14 pb-16 sm:px-6 lg:px-12 2xl:px-16 md:pt-24">
      <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:items-end">
        <span className="space-y-3">
          <Bone className="h-16 w-full" />
          <Bone className="h-16 w-2/3" />
        </span>
        <span>
          <TextLines lines={3} />
          <Bone className="mt-7 h-13 w-40 rounded-xl" />
        </span>
      </div>
      <Bone className="mt-16 h-96 rounded-[32px]" />
    </Loading>
  )
}

/** Inline placeholder while the wallet chunk downloads. */
export function WalletSkeleton() {
  return (
    <Loading label="Loading wallets" className="mt-5 space-y-3">
      <Bone className="h-4 w-3/4" />
      <Bone className="h-11 w-full rounded-xl" />
    </Loading>
  )
}
