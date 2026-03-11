# Ticketing Rework Subsystem Design (MVP)

This document defines an MVP-first redesign of the ticketing rework subsystem for ERP operations.  
It is intentionally TypeScript-first, operationally auditable, event-driven, and additive to the current architecture.

## Explicit assumptions

1. Ticketing remains its own bounded context and **owns all writes** under the `tickets` schema.
2. Cross-context links (work orders, inventory, SOP/OJT) are references + validated reads; no direct cross-schema writes from ticketing.
3. Every mutation request includes `X-Correlation-Id`; retry-safe mutations include `Idempotency-Key`.
4. SLA clocks are computed server-side using policy definitions (not client-provided deadlines).
5. A ticket has a single primary assignee at a time in MVP; watcher/collaborator support is optional extension.
6. Existing `ticket.rework.*` event names remain supported during transition (compatibility alias mapping allowed).
7. Escalation in MVP is deterministic rule-based (thresholds + role routing), not ML/optimization driven.
8. AI categorization is recommendation-only in MVP; humans confirm type/severity before commit.
9. Migrations are additive and sequential from current chain (`0004_inventory_module_scaffold.sql`).
10. This todo delivers architecture design only; implementation is a follow-up execution task.

## Exact files to create or modify (implementation contract)

> This architecture todo is documentation-only. The files below are the exact implementation targets for the follow-up build task.

### Create (new)

- `apps/api/src/migrations/<next_sequence>_ticketing_rework_subsystem.sql`
  - create `tickets` subsystem tables, constraints, and indexes.
- `apps/api/src/migrations/<next_sequence_plus_one>_ticketing_rework_sla_seed_and_backfill.sql`
  - seed default SLA policies and backfill existing rework issues into the new schema shape.
- `apps/api/src/contexts/tickets/ticket.repository.ts`
  - transactional persistence for ticket aggregate, assignments, SLA updates, and links.
- `apps/api/src/contexts/tickets/ticket.service.ts`
  - command orchestration and invariants (type/severity/status/SLA lifecycle).
- `apps/api/src/contexts/tickets/ticketSla.service.ts`
  - SLA due-time calculation, pause/resume logic, breach detection.
- `apps/api/src/contexts/tickets/ticketAssignment.service.ts`
  - assignment/reassignment + escalation trigger logic.
- `apps/api/src/contexts/tickets/ticketLink.service.ts`
  - validates and persists links to work orders, inventory entities, and SOP/OJT entities.
- `apps/api/src/contexts/tickets/ticket.query.ts`
  - ticket list/detail/read models optimized for queue + dashboard views.
- `apps/api/src/contexts/tickets/ticketEscalation.job.ts`
  - periodic SLA/escalation processing command.
- `apps/api/src/tests/ticketing-rework-failure-cases.test.ts`
  - lifecycle, SLA, assignment, and cross-context validation failures.
- `apps/api/src/tests/ticketing-escalation-flow.test.ts`
  - escalation ladder and idempotent escalation-event coverage.
- `apps/web/src/features/tickets/api.ts`
  - typed client contracts for ticketing routes.
- `apps/web/src/features/tickets/TicketQueuePage.ts`
  - queue/triage list flow scaffold.
- `apps/web/src/features/tickets/TicketDetailPage.ts`
  - detail timeline, links, assignment, SLA panel scaffold.
- `apps/workers/src/jobs/ticket-sla-escalation.job.ts`
  - worker-side escalation processing for asynchronous reminders/escalations.

### Modify (existing)

- `packages/domain/src/model/tickets.ts`
  - expand ticket type/severity/SLA/assignment contracts and lifecycle rules.
- `packages/domain/src/model/apiOperations.ts`
  - include ticketing rework operations in canonical operation catalog.
- `packages/domain/src/events.ts`
  - add canonical ticket SLA/escalation/linkage event names.
- `apps/api/src/contexts/tickets/ticket.routes.ts`
  - expose new command/query route surface.
- `apps/api/src/contexts/tickets/ticketRework.service.ts`
  - migrate to repository-backed aggregate and compatibility wrapper for old rework endpoints.
- `apps/api/src/contexts/tickets/technicianTask.service.ts`
  - integrate with new assignment references where technician tasks derive from ticket actions.
- `apps/api/src/audit/auditPoints.ts`
  - add explicit ticketing audit points (triage, assignment, escalation, SLA pause/resume).
- `apps/api/src/index.ts`
  - wire ticketing services/routes + escalation job registration.
- `apps/api/src/tests/context-failure-cases.test.ts`
  - extend cross-context failures (inventory linkage, SOP linkage, SLA edge failures).
- `apps/web/src/app/router.ts`
  - register ticketing routes for queue/detail pages.
- `apps/workers/src/index.ts`
  - register ticket SLA escalation worker subscription/schedule.

## Standards alignment snapshot (explicit)

- **TypeScript-first interfaces/contracts:** core ticketing model, route inputs, and event payloads are defined first as TS types/enums.
- **Modular design over clever abstractions:** separate `ticket`, `sla`, `assignment`, and `link` modules with explicit responsibilities.
- **Repository/service justification where useful:** repository handles transactional persistence; services enforce business invariants and side effects.
- **Tests and failure cases:** dedicated test matrix includes lifecycle, SLA, escalation, linkage, idempotency, and publish-failure paths.
- **Audit logging points:** all mutation commands map to explicit audit actions.
- **Event emission points:** each lifecycle/assignment/SLA/escalation mutation emits canonical events via outbox.
- **Observability hooks:** metric/trace/log hooks are attached to all command and escalation paths.
- **Migrations not skipped:** implementation requires `<next_sequence>_ticketing_rework_subsystem.sql` and `<next_sequence_plus_one>_ticketing_rework_sla_seed_and_backfill.sql`.
- **MVP-simple with extension points:** deterministic rules first; pluggable policy engines later.
- **Explicit assumptions:** captured above and treated as implementation contract.
- **Exact files to create/modify:** enumerated above as required implementation scope.

### MVP simplicity with extension points

| MVP choice | Why simple now | Extension point |
|---|---|---|
| Deterministic rule table for assignment/escalation | Easy to test and reason about | Policy DSL or optimizer-based routing |
| Single active assignee | Clear accountability | Add collaborator pools and shift handoff |
| SLA policy rows keyed by type+severity | No runtime rule interpreter needed | Timezone/business-hours policy engine |
| Explicit link table to external contexts | Stable referential model | Graph-based dependency model |
| AI recommendation-only | Low risk rollout | Human-approved automation actions |

## 1) Ticket types and severity model

### Ticket types (MVP)

| Type | Purpose | Default owner role | Typical linkage |
|---|---|---|---|
| `REWORK_DEFECT` | Build defect/non-conformance requiring correction | Production lead | `work_orders.work_orders`, `work_orders.work_order_operations` |
| `MATERIAL_SHORTAGE` | Missing/insufficient parts blocking progress | Inventory coordinator | `inventory.parts`, `inventory.inventory_reservations` |
| `SOP_GAP` | Procedure mismatch, unclear or outdated instruction | SOP owner / training lead | `sop_ojt.sop_documents`, `sop_ojt.training_modules` |
| `QUALITY_HOLD` | QA hold requiring explicit disposition | QA manager | Work order + optional SOP |
| `SAFETY_INCIDENT` | Safety-related operational issue | Safety/compliance lead | Work order + SOP |
| `CUSTOMER_CHANGE` | Mid-build requested change impacting execution | Service advisor | Work order + inventory impact |

### Severity model (MVP)

- `S0_BLOCKER` — immediate stop-work impact or safety-critical risk.
- `S1_CRITICAL` — major production impact; same-shift mitigation required.
- `S2_HIGH` — significant impact but controlled workaround possible.
- `S3_MEDIUM` — localized impact; standard queue handling.
- `S4_LOW` — minor issue/documentation cleanup.

### TypeScript-first contract (proposed)

```ts
export type TicketType =
  | 'REWORK_DEFECT'
  | 'MATERIAL_SHORTAGE'
  | 'SOP_GAP'
  | 'QUALITY_HOLD'
  | 'SAFETY_INCIDENT'
  | 'CUSTOMER_CHANGE';

export type TicketSeverity = 'S0_BLOCKER' | 'S1_CRITICAL' | 'S2_HIGH' | 'S3_MEDIUM' | 'S4_LOW';

export type TicketStatus =
  | 'OPEN'
  | 'TRIAGED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'WAITING_EXTERNAL'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REOPENED'
  | 'CANCELLED';

export interface ReworkTicket {
  id: string;
  ticketNumber: string;
  type: TicketType;
  severity: TicketSeverity;
  status: TicketStatus;
  title: string;
  description: string;
  workOrderId?: string;
  workOrderOperationId?: string;
  firstResponseDueAt: string;
  resolveByAt: string;
  slaPausedAt?: string;
  assigneeEmployeeId?: string;
  escalationLevel: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  closedAt?: string;
}
```

## 2) SLA model

### SLA policy dimensions

- SLA policy key: `(ticket_type, severity, stock_location_id?)`.
- Clock model:
  - `first_response_due_at`
  - `mitigation_due_at` (optional for high severities)
  - `resolve_by_at`
- Pause reasons allowed in MVP: `WAITING_VENDOR`, `WAITING_CUSTOMER_APPROVAL`, `WAITING_ENGINEERING_DECISION`.
- Pauses are audit-logged and tracked with total paused duration.

### Default SLA matrix (MVP baseline)

| Severity | First response | Mitigation target | Resolution target | Warning threshold | Escalation threshold |
|---|---:|---:|---:|---:|---:|
| `S0_BLOCKER` | 15 min | 60 min | 4 hrs | 70% elapsed | 100% elapsed |
| `S1_CRITICAL` | 30 min | 2 hrs | 8 hrs | 75% elapsed | 100% elapsed |
| `S2_HIGH` | 2 hrs | 8 hrs | 24 hrs | 80% elapsed | 100% elapsed |
| `S3_MEDIUM` | 4 hrs | N/A | 3 business days | 85% elapsed | 100% elapsed |
| `S4_LOW` | 1 business day | N/A | 7 business days | 90% elapsed | 100% elapsed |

### SLA failure behavior

1. Warning event on threshold crossing (`ticket.sla_warning`).
2. Breach event + escalation creation on due-time crossing (`ticket.sla_breached`, `ticket.escalated`).
3. Repeated breaches for same ticket are idempotent by `(ticket_id, escalation_level, breach_bucket)`.

## 3) Assignment and escalation rules

### Assignment rules (MVP deterministic)

1. Ticket enters `TRIAGED` with suggested owner role from `(type, severity)`.
2. Auto-assignment allowed only when:
   - exactly one active eligible assignee is available for owner role and location, and
   - no active capacity conflict flag exists.
3. If auto-assignment conditions fail, ticket remains in queue and requires manual assignment.
4. Reassignment increments assignment version and writes assignment history.
5. `S0_BLOCKER` and `S1_CRITICAL` cannot move to `RESOLVED` without an explicit assignee and mitigation note.

### Escalation ladder

| Level | Trigger | Destination role | Action |
|---|---|---|---|
| 1 | SLA warning crossed | Shift supervisor | notify + require acknowledgement |
| 2 | SLA breached | Department manager | notify + assignment override allowed |
| 3 | 2nd breach interval elapsed | Operations manager | incident review required |
| 4 | Safety or repeated unresolved blocker | Compliance/leadership | executive escalation + postmortem |

### Repository/service split (justified)

- **`TicketRepository` (required):** multi-table transactional writes (`tickets`, assignments, escalations, links, comments) and optimistic locking.
- **`TicketService` (required):** lifecycle invariants, status transitions, and orchestration of audit/event/observability side effects.
- **`TicketSlaService` (required):** deterministic due-time calculations and pause/resume math.
- **`TicketAssignmentService` (required):** assignment constraints, owner-role resolution, reassignment logic.
- **`TicketLinkService` (required):** cross-context reference validation and link metadata normalization.

## 4) Database schema (additive migration design)

Migration files (required, do not skip):

1. `apps/api/src/migrations/<next_sequence>_ticketing_rework_subsystem.sql`
2. `apps/api/src/migrations/<next_sequence_plus_one>_ticketing_rework_sla_seed_and_backfill.sql`

### Core tables

| Table | Purpose | Key columns | Notes |
|---|---|---|---|
| `tickets.rework_tickets` | Aggregate root | `id`, `ticket_number`, `type`, `severity`, `status`, `sla_policy_id`, `assignee_employee_id`, `escalation_level`, `version` | FK to work order/operation where applicable |
| `tickets.ticket_sla_policies` | SLA rule source | `id`, `ticket_type`, `severity`, `first_response_minutes`, `resolve_minutes`, `warning_percent` | default seeded in `<next_sequence_plus_one>` migration |
| `tickets.ticket_assignments` | Assignment history | `id`, `ticket_id`, `employee_id`, `assignment_state`, `assigned_by_user_id`, `assigned_at`, `ended_at` | append-only transitions |
| `tickets.ticket_escalations` | Escalation tracking | `id`, `ticket_id`, `escalation_level`, `reason_code`, `escalated_to_role`, `acknowledged_at` | idempotency key index |
| `tickets.ticket_links` | Cross-context linkage | `id`, `ticket_id`, `link_type`, `target_schema`, `target_table`, `target_id` | supports work order/inventory/SOP links |
| `tickets.ticket_comments` | Timeline and disposition notes | `id`, `ticket_id`, `comment_type`, `comment_body`, `created_by_user_id`, `created_at` | immutable timeline |
| `tickets.ticket_ai_suggestions` | AI recommendation history | `id`, `ticket_id`, `model_name`, `suggested_type`, `suggested_severity`, `confidence`, `accepted` | recommendation-only guardrail |

### Required cross-context foreign keys

- `rework_tickets.work_order_id -> work_orders.work_orders(id)` (nullable)
- `rework_tickets.work_order_operation_id -> work_orders.work_order_operations(id)` (nullable)
- `ticket_links.target_id` constrained by `link_type` validation (application-level for polymorphic targets):
  - `WORK_ORDER`, `WORK_ORDER_OPERATION`
  - `INVENTORY_PART`, `INVENTORY_RESERVATION`, `INVENTORY_LOT`
  - `SOP_DOCUMENT`, `SOP_TRAINING_MODULE`

### Required indexes

- `rework_tickets(status, severity, resolve_by_at)`
- `rework_tickets(type, stock_location_id, status)`
- `ticket_assignments(ticket_id, assignment_state, assigned_at desc)`
- `ticket_escalations(ticket_id, escalation_level)`
- `ticket_links(ticket_id, link_type)` and `ticket_links(link_type, target_id)`
- `ticket_ai_suggestions(ticket_id, created_at desc)`

## 5) API routes (MVP contract)

All mutating routes require `X-Correlation-Id`; retry-safe routes require `Idempotency-Key`.

| Method | Path | Purpose | Failure cases |
|---|---|---|---|
| `POST` | `/tickets/rework` | Create ticket | invalid type/severity; missing link target; duplicate idempotency key payload mismatch |
| `GET` | `/tickets/rework` | Queue/list query | invalid filter combination; unauthorized scope |
| `GET` | `/tickets/rework/:id` | Ticket detail + links + SLA snapshot | ticket not found; scope denied |
| `PATCH` | `/tickets/rework/:id/status` | Transition status | invalid transition; optimistic lock conflict; resolve without assignee |
| `POST` | `/tickets/rework/:id/assignments` | Assign/reassign owner | employee not found; inactive employee; no required role |
| `POST` | `/tickets/rework/:id/escalations` | Manual escalation | invalid level jump; duplicate escalation idempotency conflict |
| `POST` | `/tickets/rework/:id/links` | Add context link | target missing; unsupported link type; duplicate active link |
| `POST` | `/tickets/rework/:id/comments` | Add timeline note | empty note; invalid comment type |
| `POST` | `/tickets/rework/:id/sla/pause` | Pause SLA clock | invalid pause reason; already paused |
| `POST` | `/tickets/rework/:id/sla/resume` | Resume SLA clock | not paused; pause window exceeds policy max |
| `POST` | `/tickets/rework/:id/resolve` | Resolve with disposition | required fields missing; unresolved blockers remain |
| `POST` | `/tickets/rework/ai-categorize` | AI suggestion endpoint | model unavailable; low confidence below threshold; policy rejection |

Compatibility routes to keep during migration:

- `POST /tickets/rework-issues` -> internally mapped to `POST /tickets/rework`.
- `PATCH /tickets/rework-issues/:id/state` -> internally mapped to status transition command.

## 6) Event model

### Canonical ticketing events

| Event | Trigger | Key payload fields |
|---|---|---|
| `ticket.rework.created` | ticket created | `ticketId`, `type`, `severity`, `workOrderId`, `resolveByAt` |
| `ticket.rework.triaged` | type/severity/owner role confirmed | `ticketId`, `triagedBy`, `ownerRole`, `slaPolicyId` |
| `ticket.rework.assigned` | assignment/reassignment | `ticketId`, `employeeId`, `assignmentState`, `previousEmployeeId?` |
| `ticket.rework.linked` | cross-context link added | `ticketId`, `linkType`, `targetId` |
| `ticket.rework.sla_warning` | warning threshold crossed | `ticketId`, `severity`, `elapsedPercent`, `resolveByAt` |
| `ticket.rework.sla_breached` | SLA breach detected | `ticketId`, `severity`, `breachType`, `breachedAt` |
| `ticket.rework.escalated` | escalation level added | `ticketId`, `escalationLevel`, `escalatedToRole` |
| `ticket.rework.resolved` | ticket resolved | `ticketId`, `resolvedBy`, `resolutionCode`, `resolvedAt` |
| `ticket.rework.reopened` | resolved ticket reopened | `ticketId`, `reopenedBy`, `reasonCode` |
| `ticket.rework.closed` | final closure | `ticketId`, `closedBy`, `closedAt` |

### TypeScript event contract sketch

```ts
export interface TicketEventPayloadBase {
  ticketId: string;
  correlationId: string;
  actorId?: string;
  occurredAt: string;
}

export interface TicketSlaBreachedPayload extends TicketEventPayloadBase {
  severity: TicketSeverity;
  breachType: 'FIRST_RESPONSE' | 'RESOLUTION';
  escalationLevel: number;
}
```

## 7) Linkage to work orders, inventory, and SOPs

### Link strategy

| Linked context | Link mechanism | Validation rule | Side effect |
|---|---|---|---|
| Work orders | `work_order_id`, `work_order_operation_id`, and `ticket_links` rows | work order/operation must exist and be active for mutation operations | emit `ticket.rework.linked`; queue planner visibility refresh |
| Inventory | `ticket_links` rows to part/reservation/lot IDs | referenced inventory entity must exist; shortage tickets require at least one inventory link before `ASSIGNED` | emit `ticket.rework.linked`; optional `inventory.shortage_detected` follow-up |
| SOP/OJT | `ticket_links` rows to SOP document/training module | SOP document/module must exist and not be deleted | emit `ticket.rework.linked`; enables SOP feedback workflow |

### Cross-context ownership guardrail

- Ticketing context **never mutates** `work_orders`, `inventory`, or `sop_ojt` tables directly.
- Cross-context updates happen through event consumers in owning contexts.

## 8) Suggested UI flow

1. **Intake (Create Ticket)**
   - User enters summary/details, selects type/severity (with AI suggestion prefill).
   - Optional links to work order, operation, inventory part/reservation, SOP doc/module.
2. **Triage Queue**
   - Board view grouped by severity and SLA risk (`On Track`, `Warning`, `Breached`).
   - Triage actions: confirm type/severity, assign owner, add required links.
3. **Ticket Detail Workspace**
   - Timeline (comments, status changes, escalations, SLA pauses).
   - Linked entities panel (work order/inventory/SOP).
   - Assignment and escalation panel with role-aware actions.
4. **Resolution**
   - Resolution form requires cause code + corrective action note.
   - For `SOP_GAP`, optionally open SOP revision follow-up task.
5. **Closure / Reopen**
   - Close after verification; reopen path requires explicit reason code and audit note.

## 9) AI-assisted categorization opportunities

### MVP-safe opportunities

1. Suggest ticket `type` and `severity` from free-text description.
2. Suggest probable owner role/team based on historical routing outcomes.
3. Suggest likely linked SOP document/module from similar incidents.
4. Suggest likely impacted part/reservation when shortage language is detected.
5. Generate concise triage summary for queue cards.

### Guardrails (required)

- AI outputs are suggestions only; no autonomous status transition/closure/escalation.
- Persist AI output + confidence + acceptance decision to `tickets.ticket_ai_suggestions`.
- Require explicit human acceptance when confidence `< 0.90` for severity `S0/S1`.
- Log prompts/responses in redacted form for auditability and incident review.

## Tests and failure matrix (required before rollout)

| Area | Test file(s) | Minimum failure cases |
|---|---|---|
| Lifecycle transitions | `apps/api/src/tests/ticketing-rework-failure-cases.test.ts` | invalid transitions, resolve without assignee, optimistic lock conflicts |
| SLA | `apps/api/src/tests/ticketing-rework-failure-cases.test.ts` | invalid pause/resume, breach detection, idempotent warning/breach emits |
| Assignment | `apps/api/src/tests/ticketing-escalation-flow.test.ts` | assign inactive employee, duplicate active assignment, reassignment race |
| Escalation | `apps/api/src/tests/ticketing-escalation-flow.test.ts` | duplicate escalation event, invalid level jump, escalation after close |
| Cross-context linkage | `apps/api/src/tests/context-failure-cases.test.ts` | missing work order, missing inventory entity, missing SOP module |
| Outbox/event failure | `apps/api/src/tests/context-failure-cases.test.ts` | publish failure marks outbox `FAILED` without double-write |

## Explicit audit logging points

| Command | Audit action (new) | Entity type |
|---|---|---|
| Create ticket | `ticket.rework.create` | `ReworkTicket` |
| Triage update | `ticket.rework.triage` | `ReworkTicket` |
| Assign/reassign | `ticket.rework.assign` | `TicketAssignment` |
| Add link | `ticket.rework.link` | `TicketLink` |
| Pause SLA | `ticket.rework.sla.pause` | `ReworkTicket` |
| Resume SLA | `ticket.rework.sla.resume` | `ReworkTicket` |
| Escalate | `ticket.rework.escalate` | `TicketEscalation` |
| Resolve/close/reopen | `ticket.rework.state_change` | `ReworkTicket` |
| Accept/reject AI suggestion | `ticket.rework.ai_review` | `TicketAiSuggestion` |

## Event emission points

| Command boundary | Event(s) emitted |
|---|---|
| ticket created | `ticket.rework.created` |
| triage committed | `ticket.rework.triaged` |
| assignment committed | `ticket.rework.assigned` |
| link created | `ticket.rework.linked` |
| warning threshold crossed | `ticket.rework.sla_warning` |
| breach detected | `ticket.rework.sla_breached`, `ticket.rework.escalated` |
| resolution committed | `ticket.rework.resolved` |
| close committed | `ticket.rework.closed` |
| reopen committed | `ticket.rework.reopened` |

## Observability hooks

- **Metrics**
  - `ticket_rework.create.success|fail`
  - `ticket_rework.transition.success|fail`
  - `ticket_rework.sla.warning_count`
  - `ticket_rework.sla.breach_count`
  - `ticket_rework.escalation.count`
  - `ticket_rework.ai.suggestion_accept_rate`
- **Traces**
  - `ticket.rework.command.create`
  - `ticket.rework.command.transition`
  - `ticket.rework.command.assign`
  - `ticket.rework.sla.evaluator`
  - `ticket.rework.escalation.job`
- **Structured logs**
  - include `correlationId`, `ticketId`, `actorId`, `severity`, `status`, `escalationLevel`.
- **Alerts**
  - breach-rate spike per severity/type/location,
  - repeated escalation loops (`>=3` escalations same ticket in 24h),
  - outbox publish failure rate above threshold.

## Rollout sequencing (MVP implementation guidance)

1. Domain contracts + migration `<next_sequence>` + repository scaffolding.
2. Route/service layer for create/triage/assign/resolve.
3. SLA policy + evaluator + escalation processing (`<next_sequence_plus_one>` seed/backfill).
4. Worker escalation job + event-driven notifications.
5. UI queue/detail flows and AI suggestion integration.

This sequence keeps MVP implementation simple while preserving clear extension points for richer automation and optimization later.
