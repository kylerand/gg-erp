import type { Permission } from '../../../../packages/auth/src/permissions.js';
import type { AuthPrincipal } from '../../../../packages/auth/src/principal.js';
import { hasPermission } from '../../../../packages/auth/src/rbac.js';
import type { RequestContext } from './request-context.js';

export type AuthorizationFailureCode =
  | 'AUTH_PRINCIPAL_MISSING'
  | 'AUTH_PRINCIPAL_INVALID'
  | 'AUTH_PERMISSION_DENIED'
  | 'AUTH_SCOPE_DENIED'
  | 'AUTH_ROW_SCOPE_DENIED';

export type AuthorizationFailureReason =
  | 'UNAUTHENTICATED'
  | 'INVALID_PRINCIPAL'
  | 'DENY_PERMISSION'
  | 'DENY_SCOPE'
  | 'DENY_SCOPE_MISSING_ORG'
  | 'DENY_SCOPE_MISSING_SHOP'
  | 'DENY_SCOPE_MISSING_TEAM'
  | 'DENY_ROW_SCOPE';

export interface AuthorizationFailure {
  statusCode: 401 | 403;
  code: AuthorizationFailureCode;
  reason: AuthorizationFailureReason;
  message: string;
  requestContext: RequestContext;
  principal?: AuthPrincipal;
  permission?: Permission;
}

export interface AuthorizationGuardHooks {
  onDenied?(failure: AuthorizationFailure): void;
}

export interface AuthorizationGuardErrorInput {
  statusCode: 401 | 403;
  code: AuthorizationFailureCode;
  reason: AuthorizationFailureReason;
  message: string;
}

export class AuthorizationGuardError extends Error {
  readonly statusCode: 401 | 403;
  readonly code: AuthorizationFailureCode;
  readonly reason: AuthorizationFailureReason;

  constructor(input: AuthorizationGuardErrorInput) {
    super(input.message);
    this.name = 'AuthorizationGuardError';
    this.statusCode = input.statusCode;
    this.code = input.code;
    this.reason = input.reason;
  }
}

export type AuthorizationGuard = (requestContext: RequestContext) => void | Promise<void>;

export interface AuthorizePermissionOptions extends AuthorizationGuardHooks {
  message?: string;
}

export function authorizePermission(
  permission: Permission,
  options: AuthorizePermissionOptions = {}
): AuthorizationGuard {
  return (requestContext) => {
    const principal = requireAuthenticatedPrincipal(requestContext, options);
    const roles = requestContext.roles.length > 0 ? requestContext.roles : principal.roles;
    if (hasPermission(roles, permission)) {
      return;
    }

    throwAuthorizationFailure(
      {
        statusCode: 403,
        code: 'AUTH_PERMISSION_DENIED',
        reason: 'DENY_PERMISSION',
        message: options.message ?? `Permission denied: ${permission}`,
        requestContext,
        principal,
        permission
      },
      options
    );
  };
}

export function composeAuthorizationGuards(
  ...guards: readonly AuthorizationGuard[]
): AuthorizationGuard {
  return async (requestContext) => {
    for (const guard of guards) {
      await guard(requestContext);
    }
  };
}

export function requireAuthenticatedPrincipal(
  requestContext: RequestContext,
  hooks?: AuthorizationGuardHooks
): AuthPrincipal {
  const principal = requestContext.principal;
  if (!principal) {
    throwAuthorizationFailure(
      {
        statusCode: 401,
        code: 'AUTH_PRINCIPAL_MISSING',
        reason: 'UNAUTHENTICATED',
        message: 'Authentication required: principal is missing',
        requestContext
      },
      hooks
    );
  }

  if (!principal.userId.trim()) {
    throwAuthorizationFailure(
      {
        statusCode: 401,
        code: 'AUTH_PRINCIPAL_INVALID',
        reason: 'INVALID_PRINCIPAL',
        message: 'Authentication required: principal userId is invalid',
        requestContext,
        principal
      },
      hooks
    );
  }

  return principal;
}

export function throwAuthorizationFailure(
  failure: AuthorizationFailure,
  hooks?: AuthorizationGuardHooks
): never {
  const error = new AuthorizationGuardError({
    statusCode: failure.statusCode,
    code: failure.code,
    reason: failure.reason,
    message: failure.message
  });

  try {
    hooks?.onDenied?.(failure);
  } finally {
    throw error;
  }
}
