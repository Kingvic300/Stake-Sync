import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export const ADMIN_ROLES = ['Super admin', 'Moderator', 'Risk analyst', 'Support', 'Finance (view only)'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Who may do what in the admin app. Nobody can move escrowed funds: the program doesn't allow it. */
export const PERMISSIONS = {
  view: ADMIN_ROLES,
  decide_disputes: ['Super admin', 'Moderator'],
  review_proof: ['Super admin', 'Moderator', 'Support'],
  restrict_accounts: ['Super admin', 'Risk analyst'],
  declare_outage: ['Super admin', 'Risk analyst'],
  manage_challenges: ['Super admin', 'Moderator'],
  approve_orgs: ['Super admin', 'Support'],
  view_finance: ['Super admin', 'Risk analyst', 'Finance (view only)'],
  /** Server and error logs include IP addresses, so only security-facing roles see them. */
  view_logs: ['Super admin', 'Risk analyst'],
  moderate_reports: ['Super admin', 'Moderator'],
  manage_team: ['Super admin'],
  manage_settings: ['Super admin'],
} as const satisfies Record<string, readonly AdminRole[]>;
export type Permission = keyof typeof PERMISSIONS;

export interface AuthUser {
  id: string;
  sessionId: string;
  /** Present only on tokens issued by the admin sign-in. */
  adminRole?: AdminRole;
  /** The admin passed two-step verification for this session. */
  mfa?: boolean;
}

export const IS_PUBLIC = 'isPublic';
export const OPTIONAL_AUTH = 'optionalAuth';
export const ADMIN_PERMISSION = 'adminPermission';
export const ALLOW_WITHOUT_MFA = 'allowWithoutMfa';

/** No sign-in needed. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Works signed out, but knows who you are when signed in. */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH, true);
/** Reachable by an admin who hasn't set up two-step verification yet (the setup endpoints). */
export const AllowWithoutMfa = () => SetMetadata(ALLOW_WITHOUT_MFA, true);
/** Admin token with this permission required. */
export const Admin = (permission: Permission = 'view') => SetMetadata(ADMIN_PERMISSION, permission);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
  return req.user;
});
