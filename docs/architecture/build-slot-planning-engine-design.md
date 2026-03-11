# Build Slot Planning Engine Design

This document defines an MVP-first scheduling engine for build-slot planning.

Current state is a spreadsheet estimate of builds/week. Desired state is a deterministic algorithmic scheduler that uses labor capacity, technician skills, SOP labor estimates, part availability, blockers, and job priority to produce previewable and committable plans.

## Explicit assumptions

1. Planning horizon for MVP is 1-14 days; intra-day slot granularity is 60 minutes.
2. All times are stored and evaluated in UTC; UI can localize for display.
3. One work-order operation is assigned to at most one slot in MVP (no operation splitting across multiple slots).
4. Skill eligibility is derived from `hr.employee_skills` plus SOP/OJT requirements.
5. Material readiness is derived from `work_orders.work_order_parts` + `inventory.inventory_reservations` (+ inventory balances as fallback).
6. Operations with unresolved blockers (`operation_status = BLOCKED` or unresolved dependency) are not schedulable.
7. Priority `1` and jobs explicitly flagged urgent are allowed to preempt lower-priority draft assignments in preview.
8. Planner runs are deterministic for the same input snapshot + algorithm version + seed.
9. All mutations require `X-Correlation-Id`; commit mutations are idempotent via `Idempotency-Key`.
10. Migration strategy remains additive; no destructive scheduling-table rewrites in MVP.

## Current -> desired state framing

| Dimension | Current | Desired |
|---|---|---|
| Capacity planning | Manual spreadsheet estimates | Slot-level capacity model in `planning.capacity_slots` |
| Skill matching | Human memory/manual lookup | Explicit skill + SOP/OJT eligibility checks |
| Parts readiness | Manual status checks | Constraint from inventory reservations and shortages |
| Prioritization | Ad hoc sequencing | Deterministic priority/urgency objective with explainable score |
| Auditability | Spreadsheet history only | Planner run history + schedule publication + events/audit trail |
| Change management | Manual edits | Preview/commit API with idempotency and optimistic conflict checks |

## Exact files to create or modify (implementation contract)

Implementation phase should be constrained to these files:

- `apps/api/src/migrations/<next_sequence>_build_slot_planning_engine.sql` (create)
- `apps/api/src/migrations/<next_sequence_plus_one>_build_slot_planning_engine_backfill.sql` (create)
- `packages/domain/src/model/buildSlotPlanningEngine.ts` (create)
- `packages/domain/src/model/index.ts` (modify export)
- `packages/domain/src/events.ts` (modify event catalog)
- `apps/api/src/audit/auditPoints.ts` (modify planner audit points)
- `apps/api/src/contexts/build-planning/buildSlotPlanning.read-repository.ts` (create)
- `apps/api/src/contexts/build-planning/buildSlotPlanning.write-repository.ts` (create)
- `apps/api/src/contexts/build-planning/buildSlotPlanning.heuristic.ts` (create)
- `apps/api/src/contexts/build-planning/buildSlotPlanning.confidence.ts` (create)
- `apps/api/src/contexts/build-planning/buildSlotPlanning.service.ts` (create)
- `apps/api/src/contexts/build-planning/buildSlotPlanning.routes.ts` (create)
- `apps/api/src/contexts/build-planning/workOrder.routes.ts` (modify planner route wiring)
- `apps/api/src/index.ts` (modify runtime wiring)
- `apps/api/src/workflows/buildSlotPlanning.workflow.ts` (modify placeholder workflow)
- `apps/api/src/tests/build-slot-planning-preview.test.ts` (create)
- `apps/api/src/tests/build-slot-planning-commit.test.ts` (create)
- `apps/api/src/tests/build-slot-planning-failure-cases.test.ts` (create)

This architecture task only defines the design and file contract; implementation is a separate execution step.

## Standards alignment snapshot (explicit)

- **TypeScript-first model + code skeleton:** section `9) Example TypeScript implementation skeleton`.
- **Modularity over cleverness:** pure heuristic module + confidence module + repository interfaces, no hidden side effects.
- **Repository/service boundaries justified:** read repository composes planning inputs; write repository owns transactional persistence; service orchestrates policy and invariants.
- **Tests + failure cases included:** section `Test and failure matrix`.
- **Audit/event/observability hooks included:** sections `7) Exception handling`, `8) APIs`, `10) Metrics`.
- **Explicit migration path for scheduling tables:** section `3) Data model needed to support scheduling`.
- **MVP-simple with extension path:** section `4) Heuristic MVP algorithm` + `5) Future optimization algorithm options`.
- **Explicit assumptions:** section `Explicit assumptions`.
- **Exact files to create/modify:** section `Exact files to create or modify (implementation contract)`.

### MVP simplicity with extension points

| MVP decision | Why simple now | Extension path |
|---|---|---|
| Deterministic weighted greedy assignment | Fast, explainable, testable | Replace planner core with CP-SAT/MILP while reusing API/data contracts |
| Single best candidate persisted per operation | Clear operator UX | Persist top-N alternatives for interactive replanning |
| Slot-level capacity in minutes | Easy capacity arithmetic | Add machine/tool resources and setup-change penalties |
| Confidence as weighted factors | Human-readable confidence rationale | Learn calibrated model from historical schedule outcomes |

## 1) Formal problem framing

Let:

- `O` = set of schedulable work-order operations in the planning horizon.
- `S` = set of available capacity slots.
- `T` = set of technicians available for eligible slots.

Decision variable:

- `x(o,s,t) ∈ {0,1}` where `1` means operation `o` is assigned to slot `s` with technician `t`.

Auxiliary variable:

- `u(o) ∈ {0,1}` where `1` means operation `o` is unassigned in this run.

MVP objective (maximize):

`Σ x(o,s,t) * [W_priority(o) + W_due(o,s) + W_skill(o,t) + W_parts(o) + W_blocker(o)] - penalties`

Penalties include:

- tardiness penalty for assignments after due-at target,
- overload penalty when residual slot slack approaches zero,
- instability penalty when plan churn exceeds threshold versus latest published plan.

Hard constraints:

1. **Uniqueness:** `Σs,t x(o,s,t) + u(o) = 1` for each operation `o`.
2. **Slot capacity:** assigned operation minutes in slot `s` must not exceed `capacity_minutes(s)`.
3. **Technician availability:** technician `t` must be available for slot window.
4. **Skill/SOP eligibility:** technician must satisfy required skill/training gates.
5. **Dependency precedence:** predecessors of `o` must be completed or planned before `o`.
6. **Material readiness:** operations requiring critical parts can only be assigned when ready (or explicit shortage override policy allows defer bucket).
7. **Blocker gating:** blocked operations remain unassigned unless blocker resolved in run snapshot.

This is a constrained combinatorial optimization problem (NP-hard variant). MVP intentionally uses deterministic heuristics for speed, explainability, and operational trust.

## 2) Inputs, outputs, and constraints

### Inputs

| Input domain | Primary sources | Notes |
|---|---|---|
| Demand operations | `work_orders.work_orders`, `work_orders.work_order_operations`, `work_orders.work_order_operation_dependencies` | Includes priority, due date, status, and precedence graph |
| Labor/slot capacity | `planning.capacity_slots`, `hr.employee_availability_windows` | Capacity in minutes; availability windows mapped to slot windows |
| Skill eligibility | `hr.employee_skills`, `sop_ojt.operation_training_requirements` | Skill + certification guardrails |
| SOP labor estimate | `work_orders.work_order_operations.estimated_minutes` (+ SOP metadata when available) | Baseline operation effort |
| Material readiness | `work_orders.work_order_parts`, `inventory.inventory_reservations`, `inventory.inventory_balances` | Detect ready/partial/shortage status |
| Blockers | `work_orders.work_order_operations.operation_status`, `blocking_reason` | Filters blocked operations |
| Policy constraints | `planning.planning_constraints`, request-level options | Hard/soft constraints and objective weights |

### Outputs

| Output artifact | Destination | Purpose |
|---|---|---|
| Planner run | `planning.planner_runs` | Deterministic execution metadata and outcome |
| Proposed assignments | `planning.plan_assignments` | Operation -> slot -> technician proposals |
| Exceptions | `planning.plan_exceptions` (new) | Structured shortage/urgent/unassigned reasons |
| Confidence factors | `planning.plan_confidence_factors` (new) | Explainability and calibration data |
| Publication pointer | `planning.plan_publications` | Active committed schedule |

### Constraints (explicit)

- Capacity cannot be exceeded.
- Skill/training mismatches are rejected.
- Blocked and dependency-ineligible operations are not assignable.
- Critical part shortages produce exceptions, not silent assignment.
- Urgent jobs may preempt lower-priority draft assignments but only within configured preemption budget.

## 3) Data model needed to support scheduling

### Existing tables reused

- `planning.planning_scenarios`
- `planning.planning_constraints`
- `planning.planner_runs`
- `planning.capacity_slots`
- `planning.plan_assignments`
- `planning.schedule_overrides`
- `planning.plan_publications`
- `work_orders.work_orders`
- `work_orders.work_order_operations`
- `work_orders.work_order_operation_dependencies`
- `work_orders.work_order_parts`
- `inventory.inventory_reservations`
- `hr.employee_skills`
- `hr.employee_availability_windows`

### Additive migration path for scheduling tables (explicit)

Migration file (do not skip): `apps/api/src/migrations/<next_sequence>_build_slot_planning_engine.sql`

Key additive changes:

1. **Run input reproducibility**
   - add `input_snapshot jsonb not null default '{}'::jsonb` to `planning.planner_runs`
   - add `objective_snapshot jsonb not null default '{}'::jsonb` to `planning.planner_runs`
2. **Assignment explainability**
   - add `confidence_score numeric(5,4)` to `planning.plan_assignments`
   - add `confidence_band text check (confidence_band in ('HIGH','MEDIUM','LOW'))`
   - add `constraint_flags jsonb not null default '[]'::jsonb`
3. **New exception table**
   - create `planning.plan_exceptions` for shortages, unassigned ops, urgent preemption actions
4. **New confidence factor table**
   - create `planning.plan_confidence_factors` for factor-level scoring per assignment
5. **Indexes**
   - run-level exception index
   - run-level confidence index
   - assignment confidence index for diagnostics queries

Migration file: `apps/api/src/migrations/<next_sequence_plus_one>_build_slot_planning_engine_backfill.sql`

Backfill + hardening steps:

1. Backfill confidence fields for historical assignments (`LOW` default where unknown).
2. Populate `input_snapshot`/`objective_snapshot` for most recent retained runs where possible.
3. Validate JSON shape checks and add `not null`/check constraints after backfill.
4. Add partial indexes for active preview/commit query paths.

No destructive schema changes are required for MVP rollout.

## 4) Heuristic MVP algorithm

### Algorithm choice and rationale

Use a **deterministic weighted greedy heuristic with local repair**.

Why this MVP algorithm:

- fast enough for interactive preview,
- easy to explain to planners,
- straightforward to unit test and debug,
- fits current repository/service architecture without solver infrastructure.

### Heuristic steps

1. **Snapshot inputs**
   - load all demand, capacity, skills, parts, blockers for horizon into immutable snapshot.
2. **Filter unschedulable operations**
   - remove completed/cancelled, keep blocked ops as exception candidates.
3. **Build candidate list per operation**
   - candidate tuple: `(operation, slot, technician)` only if hard constraints pass.
4. **Score candidates**
   - weighted score using priority, due pressure, skill fit, parts readiness, blocker/dependency stability.
5. **Greedy assignment**
   - process operations ordered by urgency key: `urgent desc, priority asc, due_at asc, estimated_minutes desc`.
   - assign highest-scoring feasible candidate and decrement residual capacity.
6. **Local repair (bounded)**
   - for unassigned high-priority ops, attempt one-hop swap with lower-priority assignments.
7. **Persist preview artifacts**
   - write planner run, assignments, confidence factors, and exceptions.
8. **Return schedule preview payload**
   - include assignment list, unassigned reasons, confidence summary, quality metrics.

### Determinism rules

- stable sort keys (no random tie-breakers unless deterministic seed is explicitly set),
- immutable snapshot hash persisted in `planner_runs.input_snapshot`,
- algorithm version stored in `planner_runs.algorithm_version`.

## 5) Future optimization algorithm options

| Option | Strengths | Tradeoffs | Best trigger to adopt |
|---|---|---|---|
| CP-SAT (constraint programming) | Handles rich constraints + discrete decisions well | Higher complexity, solver tuning required | Frequent infeasible previews or many manual overrides |
| MILP (mixed-integer linear programming) | Clear objective optimization and sensitivity analysis | Modeling complexity for nonlinear effects | Need stronger global optimality and KPI targets |
| Large Neighborhood Search | Good for incremental replanning with urgencies | More algorithm engineering effort | High schedule churn and late urgent inserts |
| Min-cost max-flow variants | Efficient for specific assignment structures | Harder to model all real constraints | If model simplifies to bipartite assignment windows |
| Learning-assisted ranking + solver | Better confidence/quality over time | Requires history and MLOps discipline | After enough historical data exists for calibration |

## 6) Confidence scoring model

Confidence is computed per assignment and aggregated per run.

### Assignment confidence formula (MVP)

`confidence = 0.30*skillFit + 0.25*partsReady + 0.20*dependencyStability + 0.15*slotSlack + 0.10*dataFreshness`

Each factor is normalized `[0,1]`:

- `skillFit`: proficiency/certification match quality.
- `partsReady`: critical parts reservation readiness.
- `dependencyStability`: predecessor completion certainty.
- `slotSlack`: residual slot capacity after assignment.
- `dataFreshness`: staleness penalty for snapshot inputs.

Banding:

- `HIGH`: `>= 0.80`
- `MEDIUM`: `0.60 - 0.79`
- `LOW`: `< 0.60`

### Run confidence

- weighted average by operation criticality and estimated minutes,
- plus calibration metric tracked against actual execution outcomes (section `10`).

## 7) Exception handling for shortages and urgent jobs

### Part shortage handling

When critical part readiness fails:

1. do not force assignment,
2. create `plan_exceptions` row with `exception_type = 'PART_SHORTAGE'`,
3. include shortage detail payload (part, quantity short, affected operations),
4. emit `inventory.shortage_detected` (existing) + `planner.exception_detected` (new),
5. metric increments: `planner.exceptions.shortage`.

Optional policy flag may allow assignment to a deferred queue bucket (not to an executable slot).

### Urgent job handling

Urgent criteria (MVP): explicit urgent flag or priority `1` + due date within urgent threshold.

Flow:

1. urgent operations are evaluated first,
2. planner tries free capacity placement,
3. if none found, bounded preemption attempts against lowest-value draft assignments,
4. preempted operations become exceptions (`exception_type = 'PREEMPTED_BY_URGENT'`),
5. emit `planner.urgent_job_inserted` and audit action for override reason.

Guardrails:

- max preemptions per run,
- no preemption of already committed publication without explicit commit-time override.

## 8) APIs for schedule preview and commit

### Required headers (mutating planner endpoints)

- `X-Correlation-Id` (required)
- `Idempotency-Key` (required for commit)
- `If-Match` (required for stale-write-sensitive commit updates)

### Endpoint contract

| Endpoint | Purpose | Success response shape | Failure cases | Audit/event/observability hooks |
|---|---|---|---|---|
| `POST /planning/schedules/preview` | Compute deterministic draft schedule without publication | `{ runId, status, algorithmVersion, assignments[], exceptions[], confidenceSummary, qualityMetrics }` | invalid horizon (`422`), stale scenario version (`409`), run timeout (`503`) | audit `planner.schedule_preview`, events `planner.run.started` + `planner.run.succeeded/failed`, metrics `planner.preview.duration_ms` |
| `POST /planning/schedules/:runId/commit` | Publish a successful preview run as active schedule | `{ publicationId, publicationKey, status, effectiveAt, committedAssignments }` | run not successful (`409`), idempotency conflict (`409`), low-confidence forced commit denied (`422`) | audit `planner.schedule_commit`, events `planner.schedule.committed`, metrics `planner.commit.duration_ms` |
| `GET /planning/schedules/:runId` | Retrieve run preview details and diagnostics | `{ runId, assignments, exceptions, confidenceFactors }` | unknown run (`404`) | metric `planner.run.read` |
| `GET /planning/schedules/publications/active` | Read current committed schedule pointer | `{ publicationId, publicationKey, plannerRunId, effectiveAt }` | none active (`404`) | metric `planner.publication.read` |

### Preview request (example)

```json
{
  "scenarioId": "f3f9d8d9-6c95-4c1e-a48e-8ea6f9f3f2c9",
  "horizonStart": "2026-04-01T00:00:00Z",
  "horizonEnd": "2026-04-07T23:59:59Z",
  "locationId": "a80f8fc0-cdfb-4d41-8f9c-5f9f10cb69cb",
  "objectiveWeights": {
    "priority": 0.4,
    "dueDate": 0.2,
    "skillFit": 0.2,
    "partsReady": 0.2
  },
  "urgentWorkOrderIds": ["2a7f2f86-f145-4c45-8fd6-b712f8bc52d2"]
}
```

### Commit request (example)

```json
{
  "publicationKey": "daily-plan-2026-04-01-shop-a",
  "effectiveAt": "2026-04-01T05:00:00Z",
  "notes": "Morning schedule publish after parts receipt update"
}
```

## 9) Example TypeScript implementation skeleton

```ts
// packages/domain/src/model/buildSlotPlanningEngine.ts
export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';

export interface PlanningHorizon {
  start: string;
  end: string;
  locationId: string;
}

export interface PlanningDemandOperation {
  operationId: string;
  workOrderId: string;
  workOrderPriority: number;
  dueAt?: string;
  estimatedMinutes: number;
  requiredSkillCode?: string;
  dependencyOperationIds: string[];
  blockerCode?: string;
  partReadiness: 'READY' | 'PARTIAL' | 'SHORT';
  isUrgent: boolean;
}

export interface CapacitySlotCandidate {
  slotId: string;
  slotStart: string;
  slotEnd: string;
  residualMinutes: number;
  technicianId: string;
  technicianSkillCodes: string[];
}

export interface PlannerAssignment {
  operationId: string;
  slotId: string;
  technicianId: string;
  score: number;
  confidenceScore: number;
  confidenceBand: ConfidenceBand;
  rationale: Record<string, unknown>;
}

export interface PlannerException {
  operationId?: string;
  exceptionType:
    | 'PART_SHORTAGE'
    | 'BLOCKED_OPERATION'
    | 'NO_CAPACITY'
    | 'NO_SKILL_MATCH'
    | 'PREEMPTED_BY_URGENT';
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  message: string;
  metadata: Record<string, unknown>;
}

export interface PlannerRunResult {
  runId: string;
  assignments: PlannerAssignment[];
  exceptions: PlannerException[];
  qualityMetrics: Record<string, number>;
}

// apps/api/src/contexts/build-planning/buildSlotPlanning.read-repository.ts
export interface BuildSlotPlanningReadRepository {
  loadSnapshot(horizon: PlanningHorizon, scenarioId: string): Promise<{
    operations: PlanningDemandOperation[];
    candidates: CapacitySlotCandidate[];
    objectiveWeights: Record<string, number>;
    inputSnapshot: Record<string, unknown>;
  }>;
}

// apps/api/src/contexts/build-planning/buildSlotPlanning.write-repository.ts
export interface BuildSlotPlanningWriteRepository {
  createPlannerRun(input: {
    scenarioId: string;
    algorithmVersion: string;
    inputSnapshot: Record<string, unknown>;
    objectiveSnapshot: Record<string, unknown>;
    correlationId: string;
  }): Promise<{ runId: string }>;
  saveAssignments(runId: string, assignments: PlannerAssignment[]): Promise<void>;
  saveExceptions(runId: string, exceptions: PlannerException[]): Promise<void>;
  markRunSucceeded(runId: string, runtimeMs: number): Promise<void>;
  markRunFailed(runId: string, failureCode: string, failureMessage: string): Promise<void>;
  commitPublication(input: {
    runId: string;
    publicationKey: string;
    effectiveAt: string;
    actorId?: string;
    correlationId: string;
    idempotencyKey: string;
  }): Promise<{ publicationId: string }>;
}

// apps/api/src/contexts/build-planning/buildSlotPlanning.heuristic.ts
export class HeuristicMvpPlanner {
  plan(input: {
    operations: PlanningDemandOperation[];
    candidates: CapacitySlotCandidate[];
    objectiveWeights: Record<string, number>;
  }): { assignments: PlannerAssignment[]; exceptions: PlannerException[] } {
    // deterministic weighted greedy + bounded local repair
    return { assignments: [], exceptions: [] };
  }
}

// apps/api/src/contexts/build-planning/buildSlotPlanning.confidence.ts
export class ConfidenceScorer {
  scoreAssignment(assignment: PlannerAssignment): {
    confidenceScore: number;
    confidenceBand: ConfidenceBand;
    factors: Record<string, number>;
  } {
    return { confidenceScore: 0.0, confidenceBand: 'LOW', factors: {} };
  }
}

// apps/api/src/contexts/build-planning/buildSlotPlanning.service.ts
export class BuildSlotPlanningService {
  constructor(
    private readonly readRepo: BuildSlotPlanningReadRepository,
    private readonly writeRepo: BuildSlotPlanningWriteRepository,
    private readonly planner: HeuristicMvpPlanner,
    private readonly confidence: ConfidenceScorer
  ) {}

  async previewSchedule(input: {
    scenarioId: string;
    horizon: PlanningHorizon;
    actorId?: string;
    correlationId: string;
  }): Promise<PlannerRunResult> {
    const snapshot = await this.readRepo.loadSnapshot(input.horizon, input.scenarioId);
    const { runId } = await this.writeRepo.createPlannerRun({
      scenarioId: input.scenarioId,
      algorithmVersion: 'heuristic-v1',
      inputSnapshot: snapshot.inputSnapshot,
      objectiveSnapshot: snapshot.objectiveWeights,
      correlationId: input.correlationId
    });

    const draft = this.planner.plan({
      operations: snapshot.operations,
      candidates: snapshot.candidates,
      objectiveWeights: snapshot.objectiveWeights
    });

    const withConfidence = draft.assignments.map((assignment) => {
      const result = this.confidence.scoreAssignment(assignment);
      return { ...assignment, ...result };
    });

    await this.writeRepo.saveAssignments(runId, withConfidence);
    await this.writeRepo.saveExceptions(runId, draft.exceptions);
    await this.writeRepo.markRunSucceeded(runId, 0);

    return {
      runId,
      assignments: withConfidence,
      exceptions: draft.exceptions,
      qualityMetrics: {}
    };
  }

  async commitSchedule(input: {
    runId: string;
    publicationKey: string;
    effectiveAt: string;
    correlationId: string;
    actorId?: string;
    idempotencyKey: string;
  }): Promise<{ publicationId: string }> {
    return this.writeRepo.commitPublication(input);
  }
}
```

Repository/service boundary justification:

- **Read repository:** isolates complex joins/snapshots across planning/work_orders/inventory/hr.
- **Write repository:** isolates transactional writes and optimistic-lock/idempotency concerns.
- **Service:** enforces workflow rules, error mapping, and audit/event/metric hooks.
- **Heuristic + confidence modules:** pure, deterministic, and unit-test-friendly.

## 10) Metrics to track schedule quality

| Metric | Definition | Why it matters | MVP target |
|---|---|---|---|
| `planner.preview.duration_ms` | End-to-end preview runtime | Planner usability for interactive use | p95 < 2s (typical horizon) |
| `planner.assignment.coverage_pct` | assigned operations / schedulable operations | Indicates scheduler effectiveness | > 90% without shortages |
| `planner.capacity.utilization_pct` | allocated slot minutes / capacity minutes | Measures capacity usage quality | 75-90% normal range |
| `planner.skill.match_pct` | assignments with full skill fit / total assignments | Protects execution quality/safety | > 95% |
| `planner.shortage.exception_rate` | shortage exceptions / operations | Tracks inventory planning pressure | trend down week-over-week |
| `planner.urgent.preemption_count` | operations displaced by urgent insertion | Signals schedule volatility | bounded by policy threshold |
| `planner.plan_churn_pct` | changed assignments vs last publication | Captures operational disruption risk | < 15% daily |
| `planner.confidence.avg` | mean assignment confidence score | Summary trust signal | > 0.75 |
| `planner.confidence.calibration_error` | absolute difference between predicted confidence and actual execution success rate | Validates confidence model quality | decreasing trend |
| `planner.commit.conflict_rate` | commit conflicts / commit attempts | Detects stale-write/concurrency stress | < 2% |

## Test and failure matrix (required before rollout)

- **Domain unit tests (TypeScript):**
  - candidate feasibility, score ordering determinism, urgent preemption bounds.
- **Repository integration tests:**
  - snapshot consistency, optimistic lock conflicts, idempotent commit behavior.
- **API contract tests:**
  - preview/commit payload shape, required headers, deterministic error codes.
- **Failure-path tests:**
  - shortage detection emits exception/event, timeout marks run failed, stale commit rejected, low-confidence forced commit blocked.
- **Observability/audit tests:**
  - every preview/commit emits expected audit point, event(s), and metrics with correlation IDs.

All planner failures must be explicit, persisted on the run record, and observable via metrics + structured logs.
