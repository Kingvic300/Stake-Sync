import type { AdminRole } from '../data/admin'

/** Server and error logs include IP addresses, so only these roles see them (matches the API). */
export const LOG_ROLES: AdminRole[] = ['Super admin', 'Risk analyst']

/** Revenue and the treasury wallet (matches the API's view_finance permission). */
export const FINANCE_ROLES: AdminRole[] = ['Super admin', 'Risk analyst', 'Finance (view only)']
