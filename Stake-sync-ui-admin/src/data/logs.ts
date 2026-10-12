// Shapes returned by the API's /admin/logs and /admin/errors endpoints.

export type LogLevel = 'info' | 'warn' | 'error'
export type LogKind = 'request' | 'app' | 'security' | 'error'

export interface LogEntry {
  id: string
  at: string
  level: LogLevel
  kind: LogKind
  context: string
  message: string
  requestId: string | null
  method: string | null
  path: string | null
  status: number | null
  durationMs: number | null
  user: { name: string; handle: string } | null
  ip: string | null
  userAgent: string | null
  meta: Record<string, unknown>
  errorGroupId: string | null
  hasStack: boolean
}

export interface LogDetail extends LogEntry {
  stack: string | null
  related: LogEntry[]
}

export interface LogStats {
  hours: number
  requests: number
  serverErrors: number
  clientErrors: number
  errors: number
  security: number
  warnings: number
  p50: number
  p95: number
  errorRate: number
  openErrors: number
  series: { hour: string; requests: number; errors: number }[]
  slowest: { path: string; p95: number; count: number }[]
  securityEvents: { event: string; count: number }[]
}

export interface ErrorGroupRow {
  id: string
  message: string
  context: string
  where: string | null
  count: number
  last24h: number
  usersAffected: number
  firstSeen: string
  lastSeen: string
  status: 'open' | 'resolved'
  resolvedBy: string | null
  resolvedAt: string | null
  resolution: string | null
}

export interface ErrorDetail extends ErrorGroupRow {
  stack: string | null
  lastRequestId: string | null
  occurrences: LogEntry[]
}

/** Plain names for security event codes. */
export const securityLabels: Record<string, string> = {
  login_failed: 'Failed sign-in',
  admin_login_failed: 'Failed admin sign-in',
  admin_login_non_admin: 'Non-admin tried admin sign-in',
  login_locked: 'Attempt on locked account',
  account_locked: 'Account locked',
  admin_2fa_failed: 'Wrong two-step code',
  refresh_token_reuse: 'Reused session token',
  invalid_wallet_signature: 'Bad wallet signature',
  admin_forbidden: 'Blocked admin request',
  admin_ip_blocked: 'Admin access from unknown network',
  rate_limited: 'Rate limit hit',
}
