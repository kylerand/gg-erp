# Work Order Module Design (Custom Golf Cart Builder)

This document defines an MVP-ready work order module design for manufacturing custom golf carts.

It is intentionally TypeScript-first, explicit about state transitions, and aligned with auditable/event-driven ERP constraints already present in this repository.

## Explicit assumptions

1. A released build configuration exists per cart before work order release.
2. BOM expansion is deterministic for a given configuration version.
3. Routing is modeled as a DAG (no dependency cycles).
4. Work order state transitions are optimistic-lock protected (`version` checks).
5. All mutation APIs require `X-Correlation-Id`; idempotent mutations also require `Idempotency-Key`.
6. QC failures do not hard-cancel work orders; they open rework loops.
7. Rework loops are bounded by policy (default max: 3) to avoid infinite churn.
8. Existing `work_orders.*`, `inventory.*`, and `planning.*` tables remain source-of-truth; new schema is additive via migration.
9. Legacy `SCHEDULED` status can remain during transition; service logic should treat it as compatible with `RELEASED` until full backfill is complete.

## Exact files to create or modify (implementation contract)

These are the concrete files to create/modify when implementing this design:

- `apps/api/src/migrations/<next_sequence>_work_order_module_extensions.sql` (create)
- `packages/domain/src/model/workOrderExecution.ts` (create)
- `packages/domain/src/model/index.ts` (modify export)
- `packages/domain/src/events.ts` (modify event catalog)
- `apps/api/src/contexts/build-planning/workOrderExecution.service.ts` (create)
- `apps/api/src/contexts/build-planning/workOrderExecution.routes.ts` (create)
- `apps/workers/src/step-functions/work-order-orchestration.asl.json` (create)
- `apps/workers/src/jobs/work-order-orchestration.job.ts` (create)
- `apps/web/src/features/work-orders/execution/*` (create)
- `apps/web/src/features/work-orders/manager-board/*` (create)

This architecture update only documents those changes; implementation can follow in a separate execution phase.

## Standards alignment snapshot (explicit)

- **TypeScript-first:** domain contracts are defined as TypeScript interfaces/enums and rollout tests explicitly include TypeScript domain tests.
- **Modularity over cleverness:** aggregate boundaries, repository boundaries, and service boundaries are explicit to keep reasoning/debugging simple and deterministic.
- **Repository/service usage is justified:** repositories are scoped to transactional/concurrency-heavy persistence work; orchestration and invariant checks live in services.
- **Tests/failure/audit/event/observability hooks are required:** API surface, workflow section, event section, and rollout matrix each include explicit hooks.
- **Migrations are not skipped:** schema evolution is additive and pinned to `<next_sequence>_work_order_module_extensions.sql`.
- **Assumptions are explicit:** section `Explicit assumptions` is a hard contract for MVP scope.

### MVP simplicity with extension points

| MVP choice | Why simple for MVP | Extension point |
|---|---|---|
| Deterministic status/state tables with guarded transitions | Keeps operator/debug model clear and auditable | Add sub-states per workstation without breaking top-level lifecycle |
| Poll-based execution wait loop in orchestration example | Low integration complexity across services | Move to event callback/task-token model for lower latency |
| Manager/manual reassignment as primary path | Safer rollout than auto-dispatch under uncertain constraints | Add rules-based or optimization-based assignment engine |
| Single aggregate lock/version checks for critical transitions | Straightforward concurrency correctness | Split hot paths into finer-grained aggregates if contention appears |

## 1) Domain model

### Aggregate boundaries and design justification

- **Aggregate root:** `WorkOrderExecution`
  - Why: status, release gating, and completion semantics must be consistent under concurrency.
- **Child entities:** `WorkOrderStep`, `MaterialRequirement`, `TechnicianAssignment`, `QCGateResult`, `ReworkLoop`
  - Why: they mutate at different rates but are causally tied to work order lifecycle.
- **Repository pattern usage:** justified for `WorkOrderExecutionRepository` and `AssignmentRepository`
  - Why: both need complex transactional reads/writes and conflict handling (`SELECT ... FOR UPDATE`, version increments).
- **Service layer usage:** justified for orchestration and invariant checks across aggregate boundaries (material readiness + dependencies + QC/rework).

### TypeScript-first domain contract (proposed)

```ts
export enum WorkOrderExecutionStatus {
  DRAFT = 'DRAFT',
  MATERIAL_PENDING = 'MATERIAL_PENDING',
  READY = 'READY',
  RELEASED = 'RELEASED',
  IN_PROGRESS = 'IN_PROGRESS',
  BLOCKED = 'BLOCKED',
  QC_PENDING = 'QC_PENDING',
  REWORK_REQUIRED = 'REWORK_REQUIRED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

export interface BuildTemplatePackage {
  id: string;
  packageCode: string;
  packageName: string;
  templateVersion: number;
  defaultRoutingCode: string;
  state: 'DRAFT' | 'RELEASED' | 'SUPERSEDED';
}

export interface WorkOrderExecution {
  id: string;
  workOrderNumber: string;
  templatePackageId: string;
  buildConfigurationId: string;
  bomRevision: number;
  status: WorkOrderExecutionStatus;
  laborEstimateMinutes: number;
  materialReadinessStatus: 'NOT_READY' | 'PARTIAL' | 'READY';
  activeReworkLoopCount: number;
  version: number;
  updatedAt: string;
}

export interface WorkOrderStep {
  id: string;
  workOrderId: string;
  stepCode: string;
  sequenceNo: number;
  status: 'PENDING' | 'READY' | 'ASSIGNED' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE';
  estimatedMinutes: number;
  dependencyStepIds: string[];
  requiredSkillCodes: string[];
  qcGateCodes: string[];
}

export interface MaterialRequirement {
  id: string;
  workOrderId: string;
  workOrderStepId?: string;
  partId: string;
  requiredQty: number;
  reservedQty: number;
  consumedQty: number;
  readiness: 'NOT_READY' | 'PARTIAL' | 'READY';
}

export interface TechnicianAssignment {
  id: string;
  workOrderId: string;
  workOrderStepId: string;
  employeeId: string;
  state: 'ASSIGNED' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  assignmentSource: 'PLANNER' | 'MANUAL' | 'REASSIGNMENT';
  assignedAt: string;
}

export interface QCGateResult {
  id: string;
  workOrderId: string;
  workOrderStepId: string;
  gateCode: string;
  outcome: 'PENDING' | 'PASSED' | 'FAILED';
  evidenceRefs: string[];
  checkedByEmployeeId?: string;
  checkedAt?: string;
}

export interface ReworkLoop {
  id: string;
  workOrderId: string;
  sourceQcGateCode: string;
  loopNo: number;
  state: 'OPEN' | 'IN_PROGRESS' | 'VALIDATION_PENDING' | 'CLOSED';
  openedReason: string;
  closedReason?: string;
}
```

## 2) State machine

### Work order state machine

| From | To | Guard | Failure case |
|---|---|---|---|
| `DRAFT` | `MATERIAL_PENDING` | Template selected and config locked | Missing package/config -> `400` |
| `MATERIAL_PENDING` | `READY` | All critical material lines `READY` and route expanded | Any critical line short -> remain `MATERIAL_PENDING` + shortage event |
| `READY` | `RELEASED` | Manager release + capacity available | Labor/capacity conflict -> `409` |
| `RELEASED` | `IN_PROGRESS` | First executable step starts | Invalid actor/skill -> `403` |
| `IN_PROGRESS` | `BLOCKED` | Step blocked by shortage/dependency/tooling | Missing blocker reason -> `422` |
| `BLOCKED` | `IN_PROGRESS` | Blocker resolved and dependencies satisfied | Dependency still unmet -> `409` |
| `IN_PROGRESS` | `QC_PENDING` | All required routing steps `DONE` | Open steps remain -> `409` |
| `QC_PENDING` | `REWORK_REQUIRED` | Any required QC gate fails | Evidence missing on failure -> `422` |
| `REWORK_REQUIRED` | `IN_PROGRESS` | Rework loop released to execution | Loop limit exceeded -> `409` + escalation |
| `QC_PENDING` | `COMPLETED` | All required QC gates pass | Unclosed rework loop -> `409` |
| `DRAFT/READY/RELEASED` | `CANCELLED` | Authorized cancellation reason | Already in terminal state -> `409` |

### Step-level execution machine

`PENDING -> READY -> ASSIGNED -> IN_PROGRESS -> DONE`, with side paths:
- `IN_PROGRESS -> BLOCKED -> IN_PROGRESS`
- `READY/ASSIGNED -> CANCELLED` (if parent work order cancelled)

Dependency rule: a step can become `READY` only when all predecessor steps are terminal (`DONE` or explicit skip policy).

## 3) Schema (additive migration design)

### Existing tables reused

- `work_orders.work_orders`
- `work_orders.work_order_operations`
- `work_orders.work_order_operation_dependencies`
- `work_orders.work_order_parts`
- `work_orders.work_order_assignments`
- `work_orders.work_order_status_history`

### New tables/columns required

Migration file (do not skip): `apps/api/src/migrations/<next_sequence>_work_order_module_extensions.sql`

```sql
-- build templates/packages
create table if not exists planning.build_template_packages (
  id uuid primary key default gen_random_uuid(),
  package_code text not null unique,
  package_name text not null,
  template_version integer not null check (template_version > 0),
  default_routing_code text not null,
  state text not null check (state in ('DRAFT', 'RELEASED', 'SUPERSEDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists planning.build_template_bom_lines (
  id uuid primary key default gen_random_uuid(),
  template_package_id uuid not null references planning.build_template_packages(id) on delete cascade,
  route_step_code text,
  part_id uuid not null references inventory.parts(id),
  quantity_per_unit numeric(14,3) not null check (quantity_per_unit > 0),
  is_critical boolean not null default true
);

create table if not exists planning.build_template_routing_steps (
  id uuid primary key default gen_random_uuid(),
  template_package_id uuid not null references planning.build_template_packages(id) on delete cascade,
  step_code text not null,
  sequence_no integer not null check (sequence_no > 0),
  workstation_code text not null,
  estimated_minutes integer not null check (estimated_minutes > 0),
  unique (template_package_id, step_code),
  unique (template_package_id, sequence_no)
);

-- execution extensions
alter table work_orders.work_orders
  add column if not exists template_package_id uuid references planning.build_template_packages(id),
  add column if not exists material_readiness_status text not null default 'NOT_READY'
    check (material_readiness_status in ('NOT_READY', 'PARTIAL', 'READY')),
  add column if not exists labor_estimate_minutes integer not null default 0 check (labor_estimate_minutes >= 0),
  add column if not exists active_rework_loop_count integer not null default 0 check (active_rework_loop_count >= 0);

-- expand allowed lifecycle states while retaining legacy SCHEDULED rows during transition
alter table work_orders.work_orders
  drop constraint if exists work_orders_status_check;

alter table work_orders.work_orders
  add constraint work_orders_status_check
  check (
    status in (
      'DRAFT',
      'MATERIAL_PENDING',
      'READY',
      'SCHEDULED',
      'RELEASED',
      'IN_PROGRESS',
      'BLOCKED',
      'QC_PENDING',
      'REWORK_REQUIRED',
      'COMPLETED',
      'CANCELLED'
    )
  );

create table if not exists work_orders.work_order_qc_gates (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders.work_orders(id) on delete cascade,
  work_order_operation_id uuid not null references work_orders.work_order_operations(id) on delete cascade,
  gate_code text not null,
  outcome text not null default 'PENDING' check (outcome in ('PENDING', 'PASSED', 'FAILED')),
  failure_reason text,
  evidence_refs jsonb not null default '[]'::jsonb,
  checked_by_employee_id uuid references hr.employees(id),
  checked_at timestamptz
);

create table if not exists work_orders.work_order_rework_loops (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders.work_orders(id) on delete cascade,
  source_qc_gate_id uuid not null references work_orders.work_order_qc_gates(id),
  loop_no integer not null check (loop_no > 0),
  state text not null check (state in ('OPEN', 'IN_PROGRESS', 'VALIDATION_PENDING', 'CLOSED')),
  opened_reason text not null,
  closed_reason text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
```

### Schema decisions and rationale

- Keep templates in `planning.*` because they are planning-time definitions.
- Keep execution data in `work_orders.*` for clear ownership of floor operations.
- Additive migration only; no destructive rewrite of current work-order tables.
- Continue optimistic locking on mutable rows (`version`) for concurrency safety.

## 4) API surface

### Required headers for all mutating endpoints

- `X-Correlation-Id` (required)
- `Idempotency-Key` (required for create/release/reassign/retry actions)
- `If-Match` (required for stale-write sensitive updates; maps to `version`)

### Endpoints

| Endpoint | Purpose | Failure cases | Audit/event/obs hooks |
|---|---|---|---|
| `POST /planning/work-orders/from-template` | Create work order from package + config | Template not released (`422`), duplicate number (`409`) | `audit.work_order.created`, `work_order.created`, metric `work_order.create.latency_ms` |
| `POST /planning/work-orders/:id/bom-expansion` | Expand config-specific BOM lines | Config mismatch (`409`), missing parts (`422`) | `audit.work_order.bom_expanded`, `work_order.bom_expanded` |
| `POST /planning/work-orders/:id/release` | Release to execution queue | Material not ready (`409`), missing labor estimate (`422`) | `audit.work_order.released`, `work_order.released` |
| `PATCH /planning/work-orders/:id/status` | Controlled status transitions | Illegal transition (`409`), stale version (`409`) | `audit.work_order.status_changed`, `work_order.status_changed` |
| `POST /planning/work-orders/:id/steps/:stepId/assign` | Assign/reassign technician | Double assignment race (`409`), skill mismatch (`422`) | `audit.technician.assigned`, `technician.assignment.changed`, metric `assignment.conflicts` |
| `POST /planning/work-orders/:id/steps/:stepId/start` | Start step execution | Dependency not met (`409`), missing assignment (`422`) | `audit.step.started`, `work_order.step.started` |
| `POST /planning/work-orders/:id/steps/:stepId/block` | Block step with reason | Empty reason (`422`) | `audit.step.blocked`, `work_order.step.blocked` |
| `POST /planning/work-orders/:id/qc/:gateId/pass` | Pass QC gate | Required evidence missing (`422`) | `audit.qc.passed`, `work_order.qc.passed` |
| `POST /planning/work-orders/:id/qc/:gateId/fail` | Fail QC and open rework loop | Loop cap exceeded (`409`) | `audit.qc.failed`, `work_order.rework.opened` |
| `POST /planning/work-orders/:id/rework/:loopId/close` | Close rework loop and return to QC | Unresolved child tasks (`409`) | `audit.rework.closed`, `work_order.rework.closed` |

## 5) Example workflow orchestration with Step Functions

### Why Step Functions here

The work order module has long-running, failure-prone orchestration points (BOM expansion, readiness checks, assignment dispatch, QC/rework loop). Step Functions gives deterministic retries, explicit state history, and safer operator recovery.

### Example ASL (simplified)

```json
{
  "Comment": "Work order release and execution orchestration",
  "StartAt": "ValidateWorkOrder",
  "States": {
    "ValidateWorkOrder": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:validateWorkOrder",
      "Next": "ExpandConfigBom",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "AuditAndFail" }]
    },
    "ExpandConfigBom": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:expandBom",
      "Next": "CheckMaterialReadiness"
    },
    "CheckMaterialReadiness": {
      "Type": "Choice",
      "Choices": [{ "Variable": "$.materialReady", "BooleanEquals": true, "Next": "ReleaseWorkOrder" }],
      "Default": "MarkBlockedForMaterial"
    },
    "MarkBlockedForMaterial": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:markBlocked",
      "Next": "EmitMaterialBlockedEvent"
    },
    "EmitMaterialBlockedEvent": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:emitEvent",
      "End": true
    },
    "ReleaseWorkOrder": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:releaseWorkOrder",
      "Next": "DispatchAssignments"
    },
    "DispatchAssignments": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:dispatchAssignments",
      "Next": "WaitForExecutionEvents"
    },
    "WaitForExecutionEvents": {
      "Type": "Wait",
      "Seconds": 30,
      "Next": "EvaluateExecutionState"
    },
    "EvaluateExecutionState": {
      "Type": "Choice",
      "Choices": [
        { "Variable": "$.status", "StringEquals": "QC_PENDING", "Next": "RunQcGateChecks" },
        { "Variable": "$.status", "StringEquals": "BLOCKED", "Next": "WaitForExecutionEvents" },
        { "Variable": "$.status", "StringEquals": "COMPLETED", "Next": "PublishCompletion" }
      ],
      "Default": "WaitForExecutionEvents"
    },
    "RunQcGateChecks": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:runQcChecks",
      "Next": "QcOutcome"
    },
    "QcOutcome": {
      "Type": "Choice",
      "Choices": [{ "Variable": "$.qcPassed", "BooleanEquals": true, "Next": "PublishCompletion" }],
      "Default": "OpenReworkLoop"
    },
    "OpenReworkLoop": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:openRework",
      "Next": "WaitForExecutionEvents"
    },
    "PublishCompletion": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:emitCompletionEvent",
      "End": true
    },
    "AuditAndFail": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:...:recordFailure",
      "End": true
    }
  }
}
```

### Observability hooks for the workflow

- Metrics: `workflow.work_order.duration_ms`, `workflow.work_order.retry_count`, `workflow.work_order.rework_loops`
- Structured logs on every state with `workOrderId`, `correlationId`, `executionArn`
- Alert when `AuditAndFail` exceeds threshold or loop count spikes

## 6) Event definitions

| Event | Producer | Required payload fields | Primary consumers |
|---|---|---|---|
| `work_order.template_applied` | Build planning API | `workOrderId`, `templatePackageId`, `configId`, `actorId` | Planning projections, audit fanout |
| `work_order.bom_expanded` | Build planning API | `workOrderId`, `bomRevision`, `lineCount`, `criticalShortCount` | Inventory, manager dashboard |
| `work_order.routing_expanded` | Build planning API | `workOrderId`, `stepCount`, `criticalPathMinutes` | Assignment engine |
| `work_order.material_readiness.updated` | Inventory projection | `workOrderId`, `readyLines`, `shortLines`, `status` | Work-order state guard, UI |
| `work_order.step.ready` | Work-order service | `workOrderId`, `stepId`, `dependencyState` | Technician queue |
| `technician.assignment.changed` | Assignment service | `workOrderId`, `stepId`, `fromEmployeeId`, `toEmployeeId`, `reasonCode` | Notifications, manager board |
| `work_order.step.started` | Technician action API | `workOrderId`, `stepId`, `employeeId`, `startedAt` | Time logging |
| `work_order.step.blocked` | Technician action API | `workOrderId`, `stepId`, `reasonCode`, `ownerRole` | Blocked alerts |
| `work_order.qc.passed` | QC API | `workOrderId`, `stepId`, `gateCode`, `checkedBy` | Completion guard |
| `work_order.qc.failed` | QC API | `workOrderId`, `stepId`, `gateCode`, `failureReason` | Rework creation |
| `work_order.rework.opened` | Rework service | `workOrderId`, `loopId`, `loopNo`, `sourceGateCode` | Technician queue, manager alerting |
| `work_order.rework.closed` | Rework service | `workOrderId`, `loopId`, `resolutionCode` | QC rerun orchestration |
| `work_order.status_changed` | Work-order service | `workOrderId`, `fromStatus`, `toStatus`, `actorId` | Read models, audit |
| `work_order.transition.rejected` | Work-order service | `workOrderId`, `attemptedStatus`, `reasonCode` | Ops diagnostics |

Event policy:
- Event names remain aligned with existing catalog conventions (no version suffix in name).
- At-least-once delivery via outbox; consumers must be idempotent.
- All events include `correlationId`, `occurredAt`, and `version`/`schemaVersion` in envelope payload.

## 7) UI needs (technician + manager)

### Technician UI requirements

- **My Assigned Steps queue**
  - Columns: cart/build identifier, step, dependency readiness, material readiness, due window.
  - Actions: start, block (reason required), complete, attach QC evidence.
- **Step execution workspace**
  - SOP/routing instructions, required parts, timers, dependency status, blocker ownership.
  - Draft persistence for notes/checklist evidence to survive interruptions.
- **QC + rework panel**
  - Pass/fail gate outcomes with mandatory evidence/reason capture.
  - Rework tasks appear inline with clear “return to QC” CTA.

### Manager UI requirements

- **Work order board**
  - Swimlanes by status (`MATERIAL_PENDING`, `READY`, `IN_PROGRESS`, `BLOCKED`, `QC_PENDING`, `REWORK_REQUIRED`).
  - Aging and SLA chips for blocked/rework items.
- **Assignment console**
  - Step-level assignment/reassignment with conflict feedback and skill-match validation.
  - Bulk reassignment for shift handoff.
- **Material readiness + dependency view**
  - Critical part shortages, dependency graph, and projected release risk.
- **QC/rework oversight**
  - Failed gate heatmap and loop count trend to identify process drift.

## 8) Concurrency and reassignment risks

| Risk | Example | Mitigation | Observability signal |
|---|---|---|---|
| Double assignment race | Two managers reassign the same step simultaneously | Optimistic lock + unique active-assignment constraint + idempotency key | `assignment.conflict` counter, `409` rate |
| Stale status transition | Technician completes step after manager already blocked WO | `If-Match`/`version` checks on transition APIs | `work_order.transition.rejected` events |
| Dependency graph corruption | Circular dependency introduced during template edit | Validate DAG before release; reject cycle at write time | `routing.dependency_cycle_detected` alerts |
| Material readiness thrash | Inventory updates rapidly flip readiness state | Debounced projection updates + minimum stability window | readiness flapping metric |
| Reassignment mid-execution | Step reassigned while timer is active | Require pause/hand-off protocol and explicit reason code | reassignment-with-active-timer alert |
| QC/rework race | QC pass and fail submitted concurrently | Gate-level optimistic lock + terminal outcome rule | `qc.outcome_conflict` metric |
| Duplicate orchestration actions | Step Functions retry emits duplicate assign events | Outbox idempotency token + consumer inbox table | duplicate-dropped metric |

## Test and failure matrix (required before rollout)

- **Domain unit tests (TypeScript):**
  - transition legality, dependency readiness guards, rework loop cap.
- **Repository integration tests:**
  - concurrent assignment conflict (`409`), stale write rejection, DAG integrity.
- **API contract tests:**
  - required headers (`X-Correlation-Id`, `If-Match`, `Idempotency-Key`), error payload shape.
- **Workflow tests:**
  - Step Functions happy path, material short path, QC fail -> rework -> QC pass path.
- **Failure-path tests:**
  - outbox publish failure sets `FAILED`, rejected transitions do not mutate state, missing evidence blocks QC pass.

All test failures must emit observable signals and should include correlation IDs for support traceability.
