# Data Ownership by Module

## Ownership model

Aurora PostgreSQL uses schema-level ownership to keep context boundaries explicit.

| Schema (Owner Context) | Core Tables (source of truth) | Read Access Pattern |
|---|---|---|
| `identity` | `users`, `roles`, `user_role_history` | Token claims + read-only joins from other contexts |
| `inventory` | `parts`, `stock_levels`, `stock_movements`, `reservations` | Read models for planning and tickets |
| `tickets` | `tickets`, `ticket_comments`, `ticket_assignments` | Event-fed projections for dashboards |
| `sop_ojt` | `sop_documents`, `training_modules`, `employee_progress` | Search index and AI retrieval views |
| `planning` | `planning_inputs`, `slot_plans`, `planner_runs` | Published plans consumed by tickets/workspace |
| `accounting` | `qb_sync_jobs`, `qb_sync_items`, `qb_reconciliation` | Finance dashboard projection |
| `migration` | `shopmonkey_import_batches`, `shopmonkey_import_records`, `migration_errors` | Migration observability dashboards |
| `audit` | `audit_logs` | Query-only for compliance + incident response |
| `obs` | `trace_links`, `metric_rollups`, `alert_events` | Operational dashboards |

## Data ownership rules

1. Only owning context writes to its schema.
2. Cross-context communication is event-first; direct cross-schema writes are prohibited.
3. Read models are generated from events or read-only SQL views.
4. External sync state is persisted in `accounting` (never inferred from transient logs).

## MVP row-level access and security controls

- Row-level checks are enforced in the application layer at repository/service boundaries using centralized scope helpers (`filterRowsByScope` / `evaluateRowLevelAccess`) and guard wrappers (`requireScope` / `requireRowLevelAccess`).
- Default behavior is fail-closed: if required `shopId` or `teamId` scope dimensions are missing, authorization denies with deterministic reasons (`DENY_SCOPE_MISSING_SHOP`, `DENY_SCOPE_MISSING_TEAM`).
- Authn/authz lifecycle events are auditable via dedicated audit points (`authn.success`, `authn.failure`, `authz.allow`, `authz.deny`, `authz.scope_deny`, `authz.row_scope_deny`).
- Auth observability baseline is explicit and queryable (`authn.success`, `authn.failure`, `authz.allow`, `authz.deny`, `authz.scope_deny` metrics + matching traces).

## Phase 2 direction: PostgreSQL RLS

- MVP intentionally keeps row-level policy in app-layer code for speed and determinism while schema ownership hardens.
- Phase 2 should add PostgreSQL Row-Level Security policies on identity-scoped operational tables, with app-layer checks retained as defense-in-depth and for deterministic denial telemetry/audit reasons.
- RLS rollout should be additive: enable policy shadow mode first, compare app-layer denials vs DB policy outcomes, then enforce.

## Migrations (mandatory)

- Migration files are versioned and reviewed before deployment.
- Initial schema baseline is in `apps/api/src/migrations/0001_initial_schema.sql`.
- Every schema change includes rollback notes and backward-compatible sequencing.

## Audit and retention defaults

- Business mutations require an audit record with actor, action, entity, and diff summary.
- Audit logs are immutable append-only.
- Migration/error records are retained until explicit archival policies are approved.
