# Bounded Contexts and Modules

## Module boundaries

| Context | Responsibility | Synchronous API Surface | Emitted Events | Notes |
|---|---|---|---|---|
| Identity & Access | Employee/admin authN/authZ | `POST /auth/login`, `GET /auth/me` | `identity.user.logged_in`, `identity.user.role_changed` | Cognito is source for identity; app roles mapped in Aurora. |
| Employee Workspace | Shell UI composition and task dashboard | `GET /workspace/summary` | `workspace.viewed` | Thin orchestration layer for frontend composition. |
| Inventory | Parts, stock locations, reservations | `GET/POST /inventory/*` | `inventory.part_reserved`, `inventory.shortage_detected` | Strong consistency for reservations is required. |
| Tickets | Service/build ticket lifecycle | `POST /tickets`, `PATCH /tickets/:id` | `ticket.created`, `ticket.status_changed` | Ticket is workflow anchor for operations. |
| SOP/OJT | SOP library, training assignments, progress | `GET /sop/*`, `POST /ojt/*` | `ojt.assignment_created`, `ojt.step_completed` | Integrates existing OJT concepts from `gg-ojt`. |
| Build Planning | Slot optimization using labor + parts | `POST /planning/slots/compute` | `planning.slot_plan_published` | Uses Step Functions for deterministic planner runs. |
| Accounting Integration | QuickBooks sync + reconciliation | `POST /integrations/quickbooks/sync` | `accounting.sync_started`, `accounting.sync_failed` | Outbox + idempotency keys required for external sync reliability. |
| Migration Intake | ShopMonkey extraction, transform, import | `POST /migration/shopmonkey/start` | `migration.batch_imported`, `migration.record_failed` | Separate context to isolate cutover risk. |
| AI Orchestration | Bedrock prompts/tools and guardrails | `POST /ai/query` | `ai.request_completed`, `ai.request_blocked` | AI does not mutate core data directly in MVP. |
| Platform Controls | Audit log + observability control plane | N/A (internal) | `audit.recorded`, `observability.alert_triggered` | Cross-cutting module with strict ownership. |

## Repository/service pattern policy

- Use repository pattern for contexts with multiple persistence backends or complex query logic (`Inventory`, `Tickets`, `Accounting Integration`, `Migration Intake`).
- Use direct data access + pure domain modules for simple workflows (`SOP/OJT`, `AI Orchestration`) to keep MVP simple.
- Service layer is justified only when it encapsulates cross-aggregate business rules.
- For scoped data, repositories/services must apply centralized row-level scope helpers at boundary methods (fail-closed when required shop/team scope dimensions are missing).
- Authorization deny paths must emit deterministic reason codes and attach correlation IDs so audit + observability can trace every denied security decision.

## Extension points

- Add new planner heuristics via strategy contracts in `build-planning`.
- Add new accounting providers via adapter contracts in `integrations`.
- Add new AI tools via explicit tool registry with allow-list enforcement.
