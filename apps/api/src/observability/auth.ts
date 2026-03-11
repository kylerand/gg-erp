export const AUTH_METRICS = {
  authnSuccess: 'authn.success',
  authnFailure: 'authn.failure',
  authzAllow: 'authz.allow',
  authzDeny: 'authz.deny',
  authzScopeDeny: 'authz.scope_deny'
} as const;

export const AUTH_TRACES = {
  authnValidateJwt: 'authn.validate_jwt',
  authzAllow: 'authz.allow',
  authzDeny: 'authz.deny',
  authzScopeDeny: 'authz.scope_deny'
} as const;
