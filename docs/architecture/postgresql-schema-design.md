# Aurora PostgreSQL Schema Design (Golfin Garage ERP)

This document defines the MVP domain table model for Aurora PostgreSQL Serverless v2. It is intentionally implementation-ready for migration authoring, while keeping the MVP small and leaving explicit extension points for phase 2.

## Explicit assumptions

1. **Single company tenant in MVP** with support for multiple physical locations/bays inside that tenant.
2. **Cognito remains the credential authority**; PostgreSQL stores ERP user profile, role mapping, and authorization state.
3. **UUID primary keys (`gen_random_uuid()`) are standard** for all business tables and cross-domain references.
4. **Timestamps are required** (`created_at`, `updated_at`) on mutable records; append-only records also include `created_at`.
5. **Soft deletes are used for mutable master/reference data** (users, employees, parts, locations, SOP metadata). Transaction/event/ledger tables are not soft-deleted.
6. **Optimistic locking (`version` integer) is required** on high-contention mutable tables (inventory reservations/balances, work orders, schedule assignments, sync jobs).
7. **Inventory movement history is immutable and append-only**; corrections are modeled as reversing entries, never in-place edits.
8. **Every mutating API action provides actor and correlation metadata** for auditability (`actor_user_id`, `correlation_id`, optional `request_id`).
9. **Planner and scheduling data must support deterministic reruns** using persisted scenario inputs and constraints.

## Cross-cutting schema conventions

| Concern | MVP standard |
|---|---|
| Primary keys | `id UUID` with DB-generated value |
| Time columns | `created_at timestamptz`, `updated_at timestamptz` on mutable entities |
| Soft delete | `deleted_at`, `deleted_by_user_id`, `delete_reason` on eligible master/reference entities |
| Optimistic locking | `version INT NOT NULL DEFAULT 0` incremented on successful update |
| Audit hooks | `created_by_user_id`, `updated_by_user_id`, `correlation_id` captured at write boundaries |
| Immutability | Ledger/audit/history/outbox tables are append-only and never hard-updated except processing metadata where needed |
| Ownership | One schema per domain owner; cross-domain writes are prohibited and replaced by events/outbox |

## Deliverable 1: Domain table inventory

### 1) Identity (`identity` schema)

**Design justification:** keep authentication-adjacent authorization state separate from HR and operations so role/security changes can be audited and evolved without coupling to scheduling or ticket workflows.

| Table | Purpose | Why it exists for MVP | Extension points |
|---|---|---|---|
| `identity.users` | ERP user profile mapped to Cognito subject and employee record | Needed for actor tracking, permissions, and ownership metadata across all modules | Add SSO provider links, delegated-admin flags, break-glass access markers |
| `identity.roles` | Defines application roles (technician, manager, admin, etc.) | Required for baseline RBAC in API handlers | Add role scoping by location/team and temporal activation windows |
| `identity.permissions` | Atomic permission catalog for role composition | Enables explicit authorization checks and future policy tooling | Add permission versioning and policy bundles |
| `identity.role_permissions` | Role-to-permission mapping table | Keeps RBAC maintainable without hardcoding permissions | Add conditional permission attributes (e.g., per location) |
| `identity.user_roles` | Current active role assignment per user | Supports fast auth evaluation and audit attribution | Add effective-dated assignment ranges and emergency override roles |
| `identity.user_role_history` (append-only) | Historical record of role grants/revocations | Required for compliance and incident forensics | Add approval workflow references and ticket links |

### 2) HR / Employee Access (`hr` schema)

**Design justification:** operational workforce attributes (skills, availability, certifications) change differently from security roles; isolating them protects planning data integrity and enables future workforce optimization.

| Table | Purpose | Why it exists for MVP | Extension points |
|---|---|---|---|
| `hr.employees` | Employee master profile and employment state | Core employee roster for assignments, OJT, and visibility controls | Add payroll/system-of-record references and richer org hierarchy |
| `hr.employee_locations` | Maps employees to one or more shop locations/bays | Needed for location-aware assignment and permissions | Add percentage allocation and home-location prioritization |
| `hr.employee_skills` | Skill tags/capabilities with proficiency | Baseline skill matching for work-order assignment and planning feasibility | Add weighted skills and decay/re-certification logic |
| `hr.employee_availability_windows` | Shift/availability windows and exceptions | Supports MVP slot planning with real labor constraints | Add recurring patterns, overtime constraints, and union rules |
| `hr.employee_certifications` | Safety/compliance certifications with expiry | Prevents invalid assignments to restricted work | Add document attachments and automated renewal tasks |

### 3) Inventory (`inventory` schema)

**Design justification:** inventory needs strict consistency and immutable movement history; separating master data, reservations, and ledger supports correctness now and forecasting later.

| Table | Purpose | Why it exists for MVP | Extension points |
|---|---|---|---|
| `inventory.parts` | Part catalog and operational attributes | Required to reserve/consume parts on work orders | Add vendor pricing tiers, alternates, and supersession chains |
| `inventory.stock_locations` | Physical stock locations (warehouse, bay, van) | Needed for location-specific availability and pick flows | Add bin-level hierarchy and geofencing metadata |
| `inventory.stock_lots` | Lot/serial buckets for traceable stock | Enables traceability and controlled issue/recall handling | Add expiration, QA hold, and warranty tracking |
| `inventory.inventory_ledger_entries` (append-only) | Immutable quantity/value movements by part/location/lot | Canonical source of truth for all stock mutations and audits | Add costing method detail (FIFO/LIFO/average) and valuation snapshots |
| `inventory.inventory_balances` | Current on-hand/reserved projection per part/location/lot | Fast reads for APIs/planner without replaying full ledger | Add materialized refresh strategy and historical snapshots |
| `inventory.inventory_reservations` | Work-order holds against available stock | Prevents over-allocation and supports shortage handling | Add reservation priority, auto-expiry, and backorder conversion |

### 4) Work Orders (`work_orders` schema)

**Design justification:** work orders are the operational aggregate root; modeling operations, dependencies, and part requirements gives a stable demand signal for both execution and optimization.

| Table | Purpose | Why it exists for MVP | Extension points |
|---|---|---|---|
| `work_orders.work_orders` | Work-order header (customer asset, status, priority) | Core lifecycle object for service/build operations | Add SLA fields, customer communication preferences, and billing links |
| `work_orders.work_order_operations` | Discrete steps/tasks with duration and required skills | Required for assignability and planner input granularity | Add setup/teardown times and machine/tool constraints |
| `work_orders.work_order_operation_dependencies` | Directed dependencies between operations | Enables precedence-aware scheduling and deterministic execution order | Add critical-path metadata and blocking reason taxonomy |
| `work_orders.work_order_parts` | Required/consumed parts per work order or operation | Connects inventory reservations/consumption to operational demand | Add substitution rules and auto-pick suggestions |
| `work_orders.work_order_assignments` | Actual execution assignment records | Needed for accountability and live execution tracking | Add effort/cost actuals and mobile check-in/out events |
| `work_orders.work_order_status_history` (append-only) | Immutable status transitions with actor/reason | Required for auditability and process analytics | Add SLA breach tagging and automated escalation linkage |

### 5) Scheduling / Planning (`planning` schema)

**Design justification:** keep planning artifacts separate from operational truth so optimization algorithms can evolve independently while publishing explicit, auditable plan outputs.

| Table | Purpose | Why it exists for MVP | Extension points |
|---|---|---|---|
| `planning.planner_runs` | Planner execution metadata (algorithm version, runtime, outcome) | Enables deterministic reruns and failure diagnostics | Add cost metrics, solver telemetry, and canary comparison fields |
| `planning.planning_scenarios` | Scenario header for objective weights and planning horizon | Supports what-if planning and controlled publication | Add scenario branching, approvals, and simulation ownership |
| `planning.planning_constraints` | Structured constraints snapshot tied to scenario/run | Guarantees planner inputs are explicit and reproducible | Add richer constraint DSL and externalized rule templates |
| `planning.capacity_slots` | Time-boxed labor/bay capacity units | Required to map demand onto available capacity in MVP | Add machine resources, setup calendars, and blackout handling |
| `planning.plan_assignments` | Proposed assignment of operation -> slot -> employee | Primary planner output used for publication and dispatch | Add confidence scores, alternative candidates, and fairness signals |
| `planning.schedule_overrides` | Manual planner override records with reason | Preserves human-in-the-loop control with audit trail | Add approval thresholds and reversible override bundles |
| `planning.plan_publications` | Published-plan pointer/state for consumers | Prevents ambiguity about the active schedule | Add staged rollout (location-by-location) and rollback checkpoints |

### 6) SOP / OJT (`sop_ojt` schema)

**Design justification:** SOP content and training progress are operational knowledge assets; isolating them supports controlled revision history and assignment gating for skilled work.

| Table | Purpose | Why it exists for MVP | Extension points |
|---|---|---|---|
| `sop_ojt.sop_documents` | SOP metadata and current published revision pointer | Required for document assignment and retrieval | Add ownership workflow, tags, and document lifecycle states |
| `sop_ojt.sop_document_versions` (append-only) | Immutable SOP content revisions | Ensures training/procedure execution can reference exact content | Add approval signatures and release channels |
| `sop_ojt.training_modules` | Trainable modules linked to SOPs | Core unit for OJT assignment and progress tracking | Add quizzes, practical checklists, and expiration policies |
| `sop_ojt.training_assignments` | Employee-module assignment lifecycle | Needed to enforce required training and visibility | Add due-date policies and supervisor reassignment flows |
| `sop_ojt.training_progress_events` (append-only) | Progress event stream (started, step completed, passed) | Required for auditable competency tracking | Add scoring rubrics and assessor signatures |
| `sop_ojt.operation_training_requirements` | Maps work-order operation types to required modules | Prevents scheduling unqualified staff for sensitive work | Add conditional requirements by location/equipment class |

### 7) Integrations (`integrations` schema)

**Design justification:** integration state must be first-class data (not logs) to support retries, reconciliation, and provider swap flexibility without contaminating core domains.

| Table | Purpose | Why it exists for MVP | Extension points |
|---|---|---|---|
| `integrations.integration_accounts` | Provider connection metadata and status | Required to manage QuickBooks and future connectors centrally | Add credential rotation metadata and per-scope feature flags |
| `integrations.sync_jobs` | Batch/trigger-level sync execution records | Gives observable, retryable sync lifecycle | Add priority queues and dependency graph between jobs |
| `integrations.sync_job_items` | Per-record sync result and error tracking | Isolates partial failures and supports replay | Add semantic diff snapshots and retry backoff policy overrides |
| `integrations.external_id_mappings` | Internal UUID to provider ID crosswalk | Prevents duplicate creates and preserves referential continuity | Add validity periods and provider-namespace partitioning |
| `integrations.webhook_inbox_events` | Idempotent receipt of inbound provider events | Required for safe replay and duplicate suppression | Add signature validation evidence and replay quarantine flags |
| `integrations.integration_error_events` (append-only) | Structured integration exceptions | Supports operations triage and trend analysis | Add auto-classification and incident linkage |

### 8) Audit / Ops (`audit`, `ops`, `obs` schemas)

**Design justification:** compliance-grade audit and operational control metadata are cross-cutting concerns and should be isolated from business domains to avoid accidental mutation and simplify retention policy enforcement.

| Table | Purpose | Why it exists for MVP | Extension points |
|---|---|---|---|
| `audit.audit_events` (append-only) | Canonical mutation audit trail (who, what, when, correlation) | Mandatory for strong auditability across all domains | Add cryptographic hash chain and notarization exports |
| `audit.entity_change_sets` (append-only) | Structured before/after change payload references | Enables targeted forensic analysis without overloading business rows | Add field-level sensitivity tags and redaction policy versions |
| `audit.access_audit_events` (append-only) | Logs sensitive read/export actions | Covers compliance use cases beyond write auditing | Add data-classification and legal-hold tags |
| `ops.idempotency_keys` | Request de-duplication records for unsafe operations | Prevents duplicate effects during retries/network failures | Add expiration policies and replay diagnostics |
| `ops.async_job_executions` | Workflow/job execution control state | Centralized operational state for retries/cancel/timeout handling | Add worker leasing and runbook link metadata |
| `obs.correlation_context` | Correlates request IDs, trace IDs, actor IDs, and key entity IDs | Enables debugging across API, workflows, and events | Add derived SLO dimension fields and incident timeline linkage |
| `ops.dead_letter_records` | Persisted failed async/event payload references | Required for controlled recovery and support workflows | Add auto-requeue policies and resolution SLA fields |

### 9) Outbox / Events (`events` schema)

**Design justification:** outbox/inbox mechanics should be isolated from domain tables to guarantee reliable event publication, idempotent consumption, and replay without weakening transactional boundaries.

| Table | Purpose | Why it exists for MVP | Extension points |
|---|---|---|---|
| `events.outbox_events` | Transactionally written domain events awaiting publication | Guarantees at-least-once publication without dual-write risk | Add partitioning, event envelopes, and schema registry references |
| `events.outbox_publish_attempts` (append-only) | Publish attempt history with provider responses/errors | Needed for observability, retry tuning, and failure root cause | Add adaptive retry policy and back-pressure signals |
| `events.event_consumer_inbox` | Idempotency ledger for consumed external/internal events | Prevents duplicate downstream processing | Add consumer-group namespacing and TTL archiving |
| `events.event_replay_requests` | Managed replay jobs for selected event ranges | Supports recovery and controlled backfills | Add dry-run replays and approval workflow |

## Failure cases and operational hooks

| Failure case | Schema-level handling |
|---|---|
| Concurrent update collision on mutable business entity | Optimistic locking (`version`) returns conflict; caller retries with fresh read |
| Inventory oversell attempt | Reservation write checks projected availability and records denial reason; no ledger mutation on failure |
| Planner run timeout or solver error | `planning.planner_runs` records failure state; no publication change in `planning.plan_publications` |
| External provider outage/rate limiting | `integrations.sync_jobs` + `sync_job_items` persist retry state; failures emit outbox events and dead-letter records |
| Event bus publish failure | Event remains in `events.outbox_events` with attempt history in `events.outbox_publish_attempts` |
| Unauthorized/sensitive action | Mutation/access attempt emits `audit.audit_events`/`audit.access_audit_events` with actor and correlation IDs |
| Soft-deleted reference used by new transaction | Service-layer guard rejects action; audit event captures attempted action and reason |

## DDL reference

- Baseline schema bootstrap: `apps/api/src/migrations/0001_initial_schema.sql`
- Canonical ERP domain DDL: `apps/api/src/migrations/0002_canonical_erp_domain.sql`
- Future additive changes should continue as sequential migrations under `apps/api/src/migrations/` (for example, `0003_<change_name>.sql`).
