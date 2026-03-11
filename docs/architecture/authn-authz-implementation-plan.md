# AuthN/AuthZ MVP implementation plan (Cognito + RBAC + scoped access)

This document finalizes the MVP authn/authz package and maps directly to the original eight-request scope.

## Explicit assumptions

- API requests arrive with Cognito-issued JWT claims already signature-validated by the edge/auth layer.
- Cognito groups are aligned to internal role codes in `packages/auth/src/roles.ts`.
- Authorization is deny-by-default when principal, permission, or scope data is missing/invalid.
- Org/shop/team identifiers are authoritative from DB grants; JWT org/shop claims are convenience context.

## 1) Cognito setup plan

1. Provision a Cognito User Pool and App Client for ERP web/API access.
2. Define Cognito groups that match ERP roles (`admin`, `shop_manager`, `technician`, etc.).
3. Configure token claims to include:
   - standard: `sub`, `iss`, `aud`, `exp`, `iat`, `token_use`
   - optional custom: `custom:org_id`, `custom:shop_id`
4. Configure API env values:
   - `API_COGNITO_ISSUER`
   - `API_COGNITO_AUDIENCE`
   - `API_COGNITO_USER_POOL_ID`
   - `API_COGNITO_REGION` (or `AWS_REGION`)
   - optional `API_COGNITO_TOKEN_USE`, `API_COGNITO_CLOCK_SKEW_SECONDS`
5. Enforce key rotation and authorizer/JWKS validation in non-local environments.

## 2) JWT claims strategy

- Implemented in `packages/auth/src/jwt.ts` via `normalizeCognitoJwtClaims`.
- Validates issuer, audience, token_use, expiration, and iat skew window.
- Normalizes groups from `cognito:groups`.
- Maps scope hints from `custom:org_id|org_id|orgId` and `custom:shop_id|shop_id|shopId`.
- `apps/api/src/middleware/authenticate-cognito.ts` maps validated claims to `AuthPrincipal`.

## 3) Role/permission matrix

- Canonical role-permission mapping: `packages/auth/src/rbac.ts`.
- Role set: `packages/auth/src/roles.ts`.
- Permission set: `packages/auth/src/permissions.ts`.

| Role                  | Permission profile (MVP) |
| --------------------- | ------------------------ |
| `admin`               | full permission set      |
| `shop_manager`        | broad operational access |
| `technician`          | work-order execution     |
| `parts_manager`       | inventory + parts orders |
| `sales`               | customer + quote flow    |
| `accounting`          | accounting read/write    |
| `trainer_ojt_lead`    | training + visibility    |
| `read_only_executive` | read-only cross-domain   |

## 4) Org/shop/team scoping model

- Additive migration: `apps/api/src/migrations/0003_identity_authn_authz_rbac.sql`.
- Scope hierarchy:
  - `ORG` (`identity.organizations`)
  - `SHOP` (`identity.shops`)
  - `TEAM` (`identity.teams`)
- Authorization binding tables:
  - `identity.role_scope_grants` (role + scope grant)
  - `identity.user_scope_assignments` (user assignment to scope grant)
- Coherence with prior migration:
  - `0002_canonical_erp_domain.sql` defines `identity.users` and `identity.roles`
  - `0003` references them via FK constraints.

## 5) Backend authorization middleware design

- AuthN: `authenticateCognito` validates claims and builds principal/request context.
- AuthZ guards:
  - `authorizePermission` → permission gate
  - `requireScope` → scope gate (org/shop/team)
  - `requireRowLevelAccess` → row-level gate for entity scope
- Runtime composition: `apps/api/src/index.ts` (`authz.guards.compose(...)`).
- Denials are typed (`AuthorizationGuardError`) with deterministic reason codes.

## 6) Row-level access considerations

- Row-level evaluator: `packages/auth/src/row-access.ts`.
- API wrappers: `apps/api/src/middleware/row-level-access.ts`.
- Behavior:
  - fail closed when org/shop/team target data is missing
  - deny cross-shop/team access by default
  - support list filtering (`filterRowsByScope`) and per-request guarding.

## 7) Audit/security recommendations

- Audit points and reason-code reporting:
  - `apps/api/src/audit/auditPoints.ts`
  - `apps/api/src/middleware/authz-denial-reporter.ts`
  - `apps/api/src/observability/auth.ts`
- Recommendations:
  1. Keep JWT signature verification at edge/authorizer mandatory in production.
  2. Keep access tokens short-lived; rely on refresh-token flow.
  3. Enforce least-privilege role assignment and scoped grants.
  4. Alert on repeated `authn.failure` / `authz.scope_deny` metrics.
  5. Preserve immutable audit/event logs for auth decisions.

## 8) Example TypeScript authorization guard composition

```ts
const guard = runtime.authz.guards.compose(
  runtime.authz.guards.authorizePermission('work_orders:read'),
  runtime.authz.guards.requireScope({ level: 'shop', orgId: 'org-1', shopId: 'shop-a' }),
  runtime.authz.guards.requireRowLevelAccess(
    { orgId: 'org-1', shopId: 'shop-a', teamId: 'team-7' },
    { minimumLevel: 'team' }
  )
);

await guard(requestContext); // throws AuthorizationGuardError on deny
```

## Migration and test coverage (auth package)

- Migrations:
  - `apps/api/src/migrations/0002_canonical_erp_domain.sql`
  - `apps/api/src/migrations/0003_identity_authn_authz_rbac.sql`
- Tests:
  - `apps/api/src/tests/authenticate-cognito.test.ts`
  - `apps/api/src/tests/authz-middleware-guards.test.ts`
  - `apps/api/src/tests/row-level-access.test.ts`
  - `apps/api/src/tests/scope-evaluation.test.ts`
  - `apps/api/src/tests/authz-denial-reporter.test.ts`
  - `packages/auth/src/tests/rbac.test.ts`
  - `packages/test-utils/tests/schema-contracts.test.js` (migration contract checks)

## Exact files created/modified in this finalization task

- Created:
  - `docs/architecture/authn-authz-implementation-plan.md`
- Modified:
  - `.env.example`
  - `.env.test.example`
  - `docs/architecture/README.md`
  - `README.md`
  - `packages/test-utils/tests/architecture-files.test.js`
  - `packages/test-utils/tests/schema-contracts.test.js`
  - `apps/api/src/tests/authenticate-cognito.test.ts`
  - `apps/api/src/tests/authz-middleware-guards.test.ts`
