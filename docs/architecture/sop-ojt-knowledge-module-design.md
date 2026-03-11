# SOP/OJT Knowledge Module Design (MVP)

This document defines an MVP-ready SOP/OJT knowledge module for ERP operations.

It is explicitly TypeScript-first, additive to existing `sop_ojt` schema assets, and designed for auditable procedure execution, training progress tracking, and Bedrock-grounded assistant behavior.

## Explicit assumptions

1. Existing `sop_ojt` tables from `0002_canonical_erp_domain.sql` remain source-of-truth and are extended additively.
2. SOP execution must always pin to an immutable SOP version; published versions are never edited in place.
3. Work-order linkage uses `work_orders.work_order_operations` (`id`, `operation_code`), and ticket linkage uses `ticket_type_code` (string) until a dedicated ticket-type table exists.
4. Mutating APIs require `X-Correlation-Id`; stale-write-sensitive updates require `If-Match`; non-idempotent creates require `Idempotency-Key`.
5. Media binaries remain in S3; SOP tables store metadata and references only.
6. AI remains advisory: no direct mutation from assistant responses.
7. Existing outbox + audit patterns remain mandatory for publish/execute/progress/signoff actions.
8. Additive migration discipline is mandatory; no destructive schema rewrites in MVP.
9. Row/scope authorization patterns already used in API middleware are reused for SOP/OJT.
10. MVP prioritizes deterministic, auditable behavior over automation breadth.

## Exact files to create or modify (implementation contract)

This architecture task is documentation-only; implementation occurs in a separate todo.

### Modify (existing)

- `apps/api/src/index.ts`
  - wire SOP/OJT routes/services and worker-facing ingestion trigger.
- `apps/api/src/audit/auditPoints.ts`
  - add SOP/OJT-specific audit action constants.
- `apps/api/src/events/catalog.ts`
  - expose newly added SOP/OJT domain events.
- `packages/domain/src/events.ts`
  - add SOP/OJT and KB ingestion event names.
- `packages/domain/src/model/index.ts`
  - export SOP/OJT model contracts.
- `apps/api/src/contexts/ai/ai.service.ts`
  - add grounded SOP assistant query mode (read-only).
- `apps/api/src/contexts/ai/ai.routes.ts`
  - expose SOP-grounded assistant route contract.
- `apps/workers/src/worker.ts`
  - register SOP KB ingestion job handlers.
- `packages/db/prisma/schema.prisma`
  - mirror additive SOP/OJT schema changes for typed DB access.

### Create (new)

- `apps/api/src/migrations/<next_sequence>_sop_ojt_knowledge_module.sql`
  - canonical additive migration for SOP/OJT knowledge module.
- `packages/db/prisma/migrations/0002_sop_ojt_knowledge_module/migration.sql`
  - Prisma-side mirror migration (if Prisma migration workflow is used).
- `packages/domain/src/model/sopOjtKnowledge.ts`
  - TypeScript-first SOP/OJT contracts and lifecycle enums.
- `apps/api/src/contexts/sop-ojt/sopKnowledge.contracts.ts`
  - request/response DTO contracts for authoring, execution, and search APIs.
- `apps/api/src/contexts/sop-ojt/sopLifecycle.repository.ts`
  - repository for publish/signoff/execution transactional writes only.
- `apps/api/src/contexts/sop-ojt/sopAuthoring.service.ts`
  - authoring invariants, versioning rules, and publish gate checks.
- `apps/api/src/contexts/sop-ojt/sopExecution.service.ts`
  - execution state transitions, pass/fail enforcement, and signoff rules.
- `apps/api/src/contexts/sop-ojt/sopSearch.service.ts`
  - SOP query/search and filtered retrieval for execution contexts.
- `apps/api/src/contexts/sop-ojt/sop.routes.ts`
  - SOP authoring/search route surface.
- `apps/api/src/contexts/sop-ojt/ojt.routes.ts`
  - OJT assignment/execution/progress route surface.
- `apps/workers/src/jobs/sop-kb-ingestion.job.ts`
  - Bedrock Knowledge Base ingestion orchestrator.
- `packages/ai/src/services/sop-grounded-query.ts`
  - SOP citation-aware assistant orchestration helper.
- `apps/api/src/tests/sop-ojt-authoring.test.ts`
- `apps/api/src/tests/sop-ojt-execution-failure-cases.test.ts`
- `apps/api/src/tests/sop-ojt-search-contract.test.ts`
- `apps/api/src/tests/sop-ojt-kb-ingestion-failure-cases.test.ts`
- `apps/workers/tests/sop-kb-ingestion.job.test.ts`

## Standards alignment snapshot (explicit)

- **TypeScript-first interfaces/contracts:** Section `1) Domain model` provides canonical interfaces/enums and API search contracts.
- **Modularity with boundary justification:** SOP/OJT owns authoring/execution/training; AI consumes read-only projections; work-orders/tickets stay authoritative in their contexts.
- **Repository/service pattern only where justified:** repository is limited to cross-table transactional writes (`publish`, `step-complete`, `signoff`) and not used for simple reads.
- **Tests + failure cases:** Section `9) Tests and failure cases` defines mandatory test suites and explicit failure-path coverage.
- **Audit logging points:** Section `10)` defines required audit actions per critical operation.
- **Event emission points:** Section `10)` defines event names and producers/consumers.
- **Observability hooks:** Section `10)` defines trace names, metrics, and alert signals.
- **Migration files explicitly identified:** `<next_sequence>_sop_ojt_knowledge_module.sql` (+ Prisma mirror file) are named above.
- **MVP simplicity + extension points:** table below.
- **Explicit assumptions:** see `Explicit assumptions`.
- **Exact files to create/modify:** see implementation contract above.

### MVP simplicity with extension points

| MVP choice                                               | Why simple now                                       | Extension point                                           |
| -------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| Immutable published SOP versions                         | Keeps compliance + replay deterministic              | Add branch/merge workflow for concurrent authoring        |
| Step-centric execution model                             | Clear mapping to technician work and progress events | Add adaptive/conditional branching flows                  |
| Text + metadata search with optional vector augmentation | Fast to ship and auditable                           | Add hybrid reranking and confidence scoring               |
| Ticket linkage via `ticket_type_code`                    | Works before ticket-type master table exists         | Replace with FK to `tickets.ticket_types` when introduced |
| Single KB ingestion worker job                           | Operationally simple and debuggable                  | Add Step Functions fan-out for large corpus ingestion     |

## Required functional coverage map

| Required capability         | Design element(s)                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Versioned SOPs              | `sop_documents` + immutable `sop_document_versions` with version state + semantic version |
| Step-by-step procedures     | `sop_version_steps` ordered by `sequence_no`                                              |
| Media attachments           | `sop_step_media_attachments` + S3 metadata pointers                                       |
| Role applicability          | `sop_step_role_applicability` with role code + requirement level                          |
| Tool and part requirements  | `sop_step_tool_requirements`, `sop_step_part_requirements`                                |
| Pass/fail criteria          | `sop_step_pass_fail_criteria`                                                             |
| Signoff checkpoints         | `sop_step_signoff_checkpoints` + execution signoff records                                |
| Training progress tracking  | `training_assignments` + `training_progress_events` + `training_step_progress`            |
| Linkage to work-order steps | `sop_work_order_operation_links` referencing `work_orders.work_order_operations`          |
| Linkage to ticket types     | `sop_ticket_type_links` keyed by `ticket_type_code`                                       |

## 1) Domain model

### Bounded aggregates and boundary justification

- **Authoring aggregate root: `SopDocument`**
  - Owns SOP metadata, lifecycle, and published-version pointer.
- **Immutable version aggregate: `SopVersion`**
  - Owns ordered steps, requirements, pass/fail criteria, and signoff checkpoints.
- **Execution aggregate: `SopExecutionSession`**
  - Owns run-time step progression, pass/fail outcomes, and signoff completion.
- **Training aggregate: `TrainingAssignment`**
  - Owns trainee progression, score, due status, and completion state.
- **Cross-context linkage entities**
  - `WorkOrderOperationSopLink` and `TicketTypeSopLink` map SOP applicability without cross-schema writes.

Boundary rationale:

- SOP/OJT owns SOP semantics and training state.
- Work-orders own operation lifecycle; SOP only references operation identifiers.
- Tickets own ticket instances; SOP links by stable ticket type codes.
- AI consumes SOP search projections and cannot mutate SOP state directly.

### TypeScript-first contracts (proposed)

```ts
export enum SopVersionStatus {
  DRAFT = 'DRAFT',
  REVIEW = 'REVIEW',
  PUBLISHED = 'PUBLISHED',
  SUPERSEDED = 'SUPERSEDED',
  RETIRED = 'RETIRED',
}

export enum SopExecutionStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  BLOCKED = 'BLOCKED',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  ABANDONED = 'ABANDONED',
}

export interface SopDocument {
  id: string;
  documentCode: string;
  title: string;
  category?: string;
  ownerEmployeeId?: string;
  currentVersionId?: string;
  documentStatus: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  updatedAt: string;
  version: number;
}

export interface SopVersion {
  id: string;
  sopDocumentId: string;
  versionNumber: number;
  semanticVersion: string; // MAJOR.MINOR.PATCH
  versionStatus: SopVersionStatus;
  contentMarkdown: string;
  contentHash: string;
  changeSummary?: string;
  effectiveAt?: string;
  approvedByUserId?: string;
  createdAt: string;
}

export interface SopVersionStep {
  id: string;
  sopVersionId: string;
  stepCode: string;
  sequenceNo: number;
  instructionMarkdown: string;
  estimatedMinutes?: number;
  isCritical: boolean;
}

export interface SopStepRoleApplicability {
  id: string;
  sopVersionStepId: string;
  roleCode: string;
  applicability: 'REQUIRED' | 'OPTIONAL' | 'OBSERVER';
}

export interface SopStepToolRequirement {
  id: string;
  sopVersionStepId: string;
  toolCode: string;
  toolName: string;
  quantity: number;
  isMandatory: boolean;
}

export interface SopStepPartRequirement {
  id: string;
  sopVersionStepId: string;
  partId: string;
  quantityRequired: number;
  uom: string;
  isMandatory: boolean;
}

export interface SopStepPassFailCriterion {
  id: string;
  sopVersionStepId: string;
  criterionCode: string;
  criterionType: 'BOOLEAN_CHECK' | 'MEASUREMENT_RANGE' | 'PHOTO_EVIDENCE' | 'TEXT_ASSERTION';
  passRule: string;
  failRule: string;
}

export interface SopStepSignoffCheckpoint {
  id: string;
  sopVersionStepId: string;
  checkpointCode: string;
  requiredRoleCode: string;
  requiresComment: boolean;
  requiresMediaAttachment: boolean;
}

export interface SopExecutionSession {
  id: string;
  sopVersionId: string;
  trainingAssignmentId?: string;
  workOrderOperationId?: string;
  ticketTypeCode?: string;
  employeeId: string;
  status: SopExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  failureReason?: string;
}

export interface TrainingStepProgress {
  id: string;
  trainingAssignmentId: string;
  sopVersionStepId: string;
  attemptNo: number;
  status: 'PENDING' | 'PASSED' | 'FAILED' | 'SIGNED_OFF';
  evidenceAttachmentIds: string[];
  updatedAt: string;
}

export interface WorkOrderOperationSopLink {
  id: string;
  operationCode: string;
  workOrderOperationId?: string;
  sopVersionId: string;
  applicability: 'MANDATORY' | 'RECOMMENDED';
}

export interface TicketTypeSopLink {
  id: string;
  ticketTypeCode: string;
  sopVersionId: string;
  applicability: 'MANDATORY' | 'RECOMMENDED';
}
```

### Authoring/execution lifecycle rules

- **Authoring:** `DRAFT -> REVIEW -> PUBLISHED -> SUPERSEDED/RETIRED`
- **Execution:** `NOT_STARTED -> IN_PROGRESS -> PASSED/FAILED`, with side path `IN_PROGRESS -> BLOCKED -> IN_PROGRESS`
- **Critical guards:**
  - Cannot publish if any step is missing pass/fail criteria.
  - Cannot publish if required signoff checkpoints are missing for critical steps.
  - Execution completion requires all mandatory steps passed and required signoffs captured.

## 2) Database schema (additive migration design)

### Existing tables reused

- `sop_ojt.sop_documents`
- `sop_ojt.sop_document_versions`
- `sop_ojt.training_modules`
- `sop_ojt.training_assignments`
- `sop_ojt.training_progress_events`
- `sop_ojt.operation_training_requirements`
- `work_orders.work_order_operations` (read/reference only)

### Migration files (explicit)

- `apps/api/src/migrations/<next_sequence>_sop_ojt_knowledge_module.sql` (authoritative SQL migration)
- `packages/db/prisma/migrations/0002_sop_ojt_knowledge_module/migration.sql` (Prisma mirror, if Prisma flow is used)

### Proposed DDL (representative)

```sql
alter table sop_ojt.sop_document_versions
  add column if not exists version_status text not null default 'DRAFT'
    check (version_status in ('DRAFT', 'REVIEW', 'PUBLISHED', 'SUPERSEDED', 'RETIRED')),
  add column if not exists semantic_version text not null default '1.0.0',
  add column if not exists rendered_plaintext text;

create table if not exists sop_ojt.sop_version_steps (
  id uuid primary key default gen_random_uuid(),
  sop_version_id uuid not null references sop_ojt.sop_document_versions(id) on delete cascade,
  step_code text not null,
  sequence_no integer not null check (sequence_no > 0),
  instruction_markdown text not null,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),
  is_critical boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0),
  unique (sop_version_id, step_code),
  unique (sop_version_id, sequence_no)
);

create table if not exists sop_ojt.sop_step_media_attachments (
  id uuid primary key default gen_random_uuid(),
  sop_version_step_id uuid not null references sop_ojt.sop_version_steps(id) on delete cascade,
  media_type text not null check (media_type in ('IMAGE', 'VIDEO', 'PDF', 'URL')),
  storage_key text not null,
  display_name text not null,
  checksum_sha256 text,
  created_at timestamptz not null default now()
);

create table if not exists sop_ojt.sop_step_role_applicability (
  id uuid primary key default gen_random_uuid(),
  sop_version_step_id uuid not null references sop_ojt.sop_version_steps(id) on delete cascade,
  role_code text not null,
  applicability text not null check (applicability in ('REQUIRED', 'OPTIONAL', 'OBSERVER')),
  unique (sop_version_step_id, role_code)
);

create table if not exists sop_ojt.sop_step_tool_requirements (
  id uuid primary key default gen_random_uuid(),
  sop_version_step_id uuid not null references sop_ojt.sop_version_steps(id) on delete cascade,
  tool_code text not null,
  tool_name text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  is_mandatory boolean not null default true
);

create table if not exists sop_ojt.sop_step_part_requirements (
  id uuid primary key default gen_random_uuid(),
  sop_version_step_id uuid not null references sop_ojt.sop_version_steps(id) on delete cascade,
  part_id uuid not null references inventory.parts(id),
  quantity_required numeric(14,3) not null check (quantity_required > 0),
  uom text not null,
  is_mandatory boolean not null default true
);

create table if not exists sop_ojt.sop_step_pass_fail_criteria (
  id uuid primary key default gen_random_uuid(),
  sop_version_step_id uuid not null references sop_ojt.sop_version_steps(id) on delete cascade,
  criterion_code text not null,
  criterion_type text not null
    check (criterion_type in ('BOOLEAN_CHECK', 'MEASUREMENT_RANGE', 'PHOTO_EVIDENCE', 'TEXT_ASSERTION')),
  pass_rule text not null,
  fail_rule text not null,
  unique (sop_version_step_id, criterion_code)
);

create table if not exists sop_ojt.sop_step_signoff_checkpoints (
  id uuid primary key default gen_random_uuid(),
  sop_version_step_id uuid not null references sop_ojt.sop_version_steps(id) on delete cascade,
  checkpoint_code text not null,
  required_role_code text not null,
  requires_comment boolean not null default false,
  requires_media_attachment boolean not null default false,
  unique (sop_version_step_id, checkpoint_code)
);

create table if not exists sop_ojt.training_step_progress (
  id uuid primary key default gen_random_uuid(),
  training_assignment_id uuid not null references sop_ojt.training_assignments(id) on delete cascade,
  sop_version_step_id uuid not null references sop_ojt.sop_version_steps(id) on delete restrict,
  attempt_no integer not null default 1 check (attempt_no > 0),
  status text not null check (status in ('PENDING', 'PASSED', 'FAILED', 'SIGNED_OFF')),
  evidence_attachment_ids jsonb not null default '[]'::jsonb,
  signoff_user_id uuid references identity.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (training_assignment_id, sop_version_step_id, attempt_no)
);

create table if not exists sop_ojt.sop_work_order_operation_links (
  id uuid primary key default gen_random_uuid(),
  operation_code text not null,
  work_order_operation_id uuid references work_orders.work_order_operations(id) on delete cascade,
  sop_version_id uuid not null references sop_ojt.sop_document_versions(id) on delete cascade,
  applicability text not null check (applicability in ('MANDATORY', 'RECOMMENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sop_work_order_link_default_uk
  on sop_ojt.sop_work_order_operation_links (operation_code, sop_version_id)
  where work_order_operation_id is null;

create unique index if not exists sop_work_order_link_specific_uk
  on sop_ojt.sop_work_order_operation_links (work_order_operation_id, sop_version_id)
  where work_order_operation_id is not null;

create table if not exists sop_ojt.sop_ticket_type_links (
  id uuid primary key default gen_random_uuid(),
  ticket_type_code text not null,
  sop_version_id uuid not null references sop_ojt.sop_document_versions(id) on delete cascade,
  applicability text not null check (applicability in ('MANDATORY', 'RECOMMENDED')),
  created_at timestamptz not null default now(),
  unique (ticket_type_code, sop_version_id)
);

create table if not exists sop_ojt.sop_search_chunks (
  id uuid primary key default gen_random_uuid(),
  sop_version_id uuid not null references sop_ojt.sop_document_versions(id) on delete cascade,
  sop_version_step_id uuid references sop_ojt.sop_version_steps(id) on delete set null,
  chunk_order integer not null check (chunk_order > 0),
  chunk_text text not null,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists sop_search_chunks_text_idx
  on sop_ojt.sop_search_chunks using gin (to_tsvector('english', chunk_text));

create table if not exists sop_ojt.kb_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  sop_version_id uuid not null references sop_ojt.sop_document_versions(id) on delete cascade,
  run_status text not null check (run_status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  knowledge_base_id text not null,
  data_source_id text not null,
  ingestion_job_id text,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### Schema decisions and rationale

- Keep SOP/OJT structures in `sop_ojt.*` for ownership and audit isolation.
- Reference `work_orders.work_order_operations` by FK only; SOP/OJT never mutates work-order rows.
- Use additive tables over mutating existing append-only progress history.
- Keep ticket linkage string-based for MVP (`ticket_type_code`) to avoid blocking on ticket master-data rollout.

## 3) Authoring vs execution experience

| Dimension        | Authoring experience                                   | Execution experience                                        |
| ---------------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| Primary users    | Trainer/OJT lead, SME, manager reviewer                | Technician, trainer signoff role, QC reviewer               |
| Primary goal     | Create/revise/publish SOP versions                     | Follow required SOP version and complete checkpoints        |
| Data mutability  | Draft versions editable; published immutable           | Execution records append-only; state transitions controlled |
| Step handling    | Define ordered steps, tools/parts, pass/fail, signoffs | Complete steps in sequence with pass/fail evidence          |
| Role logic       | Define role applicability per step                     | Validate actor role against required applicability          |
| Linkage          | Map SOP versions to operation codes and ticket types   | Resolve effective SOP by work-order step/ticket type        |
| Failure behavior | Publish blocked if contracts incomplete                | Step completion blocked if criteria/signoff unmet           |
| Audit footprint  | `sop.document.*`, `sop.version.*`, linkage changes     | `ojt.execution.*`, `ojt.step.*`, `ojt.signoff.*`            |

Authoring/Execution separation rule:

- Execution always consumes an immutable published snapshot.
- Draft edits never alter in-flight execution packets.

## 4) API routes

### Required headers for mutating endpoints

- `X-Correlation-Id` (required)
- `Idempotency-Key` (required for create/publish/assignment/start actions)
- `If-Match` (required for stale-write-sensitive updates)

### Route catalog

| Endpoint                                          | Purpose                                                   | Failure cases                                                          | Audit/event/obs hooks                                                                             |
| ------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `POST /sop/documents`                             | Create SOP document shell                                 | duplicate `documentCode` (`409`)                                       | `audit: sop.document.create`, `event: sop.document.created`, metric `sop.authoring.create`        |
| `POST /sop/documents/:id/versions`                | Create draft version                                      | document retired (`422`)                                               | `audit: sop.version.create`, `event: sop.version.created`, metric `sop.authoring.version_created` |
| `PATCH /sop/versions/:versionId`                  | Update draft metadata/content                             | non-draft update (`409`), stale write (`409`)                          | `audit: sop.version.update`, `event: sop.version.updated`                                         |
| `POST /sop/versions/:versionId/steps`             | Add/update ordered steps and requirements                 | duplicate sequence (`409`), missing instruction (`422`)                | `audit: sop.step.update`, `event: sop.step.updated`, metric `sop.step.contract_write`             |
| `POST /sop/versions/:versionId/publish`           | Publish immutable version                                 | missing pass/fail/signoff (`422`), approval missing (`403`)            | `audit: sop.version.publish`, `event: sop.version.published`, trace `sop.publish`                 |
| `POST /ojt/assignments`                           | Assign training module/version to employee                | duplicate active assignment (`409`)                                    | `audit: ojt.assignment.create`, `event: ojt.assignment.created`, metric `ojt.assignment.created`  |
| `POST /ojt/executions`                            | Start SOP execution session                               | no valid linkage (`404`), role mismatch (`403`)                        | `audit: ojt.execution.start`, `event: ojt.execution.started`, trace `ojt.execution.start`         |
| `POST /ojt/executions/:id/steps/:stepId/pass`     | Pass a step with criteria/evidence                        | missing required evidence (`422`), out-of-order step (`409`)           | `audit: ojt.step.pass`, `event: ojt.step.passed`, metric `ojt.step.pass`                          |
| `POST /ojt/executions/:id/steps/:stepId/fail`     | Record failed step                                        | failure reason missing (`422`)                                         | `audit: ojt.step.fail`, `event: ojt.step.failed`, metric `ojt.step.fail`                          |
| `POST /ojt/executions/:id/signoffs/:checkpointId` | Record signoff checkpoint                                 | wrong role (`403`), duplicate signoff (`409`)                          | `audit: ojt.signoff.record`, `event: ojt.signoff.recorded`, metric `ojt.signoff.latency_ms`       |
| `GET /ojt/progress/:employeeId`                   | Retrieve assignment and step progress                     | scope denied (`403`)                                                   | `trace: ojt.progress.read`, metric `ojt.progress.read.latency_ms`                                 |
| `POST /sop/linkages/work-order-steps`             | Link SOP version to operation code / work-order operation | invalid operation link (`422`)                                         | `audit: sop.linkage.work_order.update`, `event: sop.linkage.work_order.updated`                   |
| `POST /sop/linkages/ticket-types`                 | Link SOP version to ticket type                           | unknown ticket type code (`422`)                                       | `audit: sop.linkage.ticket_type.update`, `event: sop.linkage.ticket_type.updated`                 |
| `POST /sop/search`                                | Filtered SOP retrieval for UI/assistant                   | empty query + no filters (`422`)                                       | `trace: sop.search`, metric `sop.search.latency_ms`                                               |
| `POST /ai/query` (`capability = SOP_ASSIST`)      | Grounded SOP assistance with citations                    | insufficient evidence (`200` with warning), unauthorized scope (`403`) | `audit: ai.request`, `event: ai.request_completed`, metric `ai.sop_assist.citation_count`         |

## 5) Search model

### Retrieval model (MVP)

1. **Primary index:** `sop_search_chunks` (text chunks + metadata).
2. **Filter dimensions:** `roleCode`, `toolCode`, `partId`, `operationCode`, `ticketTypeCode`, `versionStatus=PUBLISHED`.
3. **Ranking:** lexical rank first (`ts_rank`), then sequence proximity, then recency (`effectiveAt`).
4. **Citation payload:** every result includes `sopDocumentId`, `sopVersionId`, `stepCode`, `chunkId`.

### TypeScript search contract

```ts
export interface SopSearchQuery {
  query?: string;
  roleCode?: string;
  toolCode?: string;
  partId?: string;
  operationCode?: string;
  ticketTypeCode?: string;
  includeRetired?: boolean;
  limit?: number;
}

export interface SopSearchHit {
  sopDocumentId: string;
  sopVersionId: string;
  stepCode?: string;
  chunkId: string;
  score: number;
  excerpt: string;
  citations: Array<{ sourceId: string; locator?: string }>;
}
```

### Search behavior guardrails

- Only `PUBLISHED` SOP versions are searchable by default.
- Superseded versions remain retrievable only for audit/forensics paths.
- Execution retrieval must resolve a single effective SOP version deterministically (no ambiguity at runtime).

## 6) Bedrock Knowledge Base ingestion plan

### Trigger policy

Ingestion is requested when any of these occur:

- `sop.version.published`
- `sop.linkage.work_order.updated`
- `sop.linkage.ticket_type.updated`
- `sop.version.superseded` (to deactivate old active chunks)

### Ingestion flow

1. Publish/linkage event writes an outbox record.
2. Worker (`sop-kb-ingestion.job.ts`) consumes event and reads canonical SOP step + metadata rows.
3. Worker builds deterministic chunk manifests per SOP version:
   - one chunk per step plus optional subsection chunks for long instructions
   - metadata includes `documentCode`, `versionNumber`, `stepCode`, `roleCodes`, `toolCodes`, `partIds`, `operationCodes`, `ticketTypeCodes`
4. Worker writes manifest to S3:  
   `s3://<kb-source-bucket>/sop/<documentCode>/v<versionNumber>/chunks.jsonl`
5. Worker starts Bedrock KB ingestion job and stores run status in `sop_ojt.kb_ingestion_runs`.
6. On success:
   - mark run `SUCCEEDED`
   - keep chunk metadata active for local search
   - emit `sop.kb.ingestion.succeeded`
7. On failure:
   - mark run `FAILED` with `failure_code`/`failure_message`
   - emit `sop.kb.ingestion.failed`
   - alert on retries exhausted.

### Operational controls

- Max retry attempts: 3 (exponential backoff).
- Idempotency key: `{sopVersionId}:{contentHash}`.
- Superseded version ingestion remains retained for audit but marked inactive for default assistant retrieval.

## 7) Example AI assistant behaviors grounded in SOP data

| User prompt                                                                | Expected assistant behavior                                                                                                 | Must not do                                                    |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| “What are the required tools for axle alignment on this work-order step?”  | Resolve SOP via `workOrderOperationId`, return tool list + step citation(s) from published SOP version.                     | Guess tools without SOP evidence.                              |
| “Can I skip torque verification if I already did visual inspection?”       | Return explicit pass/fail criterion and signoff requirement from cited step checkpoint.                                     | Approve bypass when SOP says mandatory.                        |
| “Give me troubleshooting steps for ticket type `ELECTRICAL-INTERMITTENT`.” | Retrieve SOPs linked to `ticket_type_code`, return ordered steps with safety notes + citations.                             | Mix unrelated SOPs without citations.                          |
| “Am I qualified to perform this step?”                                     | Check training assignment/progress + role applicability and answer with readiness state and missing checkpoints.            | Claim qualification without checking assignment/progress data. |
| “Summarize why this trainee failed twice on step 30.”                      | Use progress events + fail reasons + criterion text, return concise summary with linked evidence and suggested remediation. | Invent remediation not grounded in SOP or progress history.    |

Assistant policy for SOP/OJT:

- cite SOP version + step locator for factual procedure claims;
- explicitly state uncertainty when evidence is missing;
- never claim a mutation occurred unless separate approved execution flow confirms it.

## 8) Governance and versioning model

### Version governance

- **Two-person rule for publish:** author + reviewer (trainer lead/quality lead).
- **Semantic versioning policy:**
  - `MAJOR`: safety-critical step/criteria/signoff changes (requires reassessment policy check).
  - `MINOR`: process improvements that preserve safety semantics.
  - `PATCH`: typo/media/clarity edits with no behavior change.
- **Immutability:** published versions are append-only records; supersession creates a new version.

### Approval and signoff governance

- Publish requires:
  1. role applicability on all critical steps,
  2. pass/fail criteria per mandatory step,
  3. signoff checkpoints where policy requires supervision.
- Execution signoff requires actor role match to `required_role_code`.

### Training and rollout governance

- Active assignment behavior on new version publish:
  - MAJOR: open assignments flagged for mandatory reassessment.
  - MINOR/PATCH: existing assignments continue unless operation policy marks strict refresh required.
- Retired SOP versions remain queryable for audit but excluded from default assignment/linkage.

### Change governance artifacts

- Every publish includes `change_summary`, `approved_by_user_id`, `effective_at`, and correlation metadata.
- Governance events are emitted for change-board dashboards and release traceability.

## 9) Tests and failure cases

### Required test suites

- `apps/api/src/tests/sop-ojt-authoring.test.ts`
  - version publish invariants and semantic-version bump policy.
- `apps/api/src/tests/sop-ojt-execution-failure-cases.test.ts`
  - out-of-order steps, missing evidence, signoff role mismatch, stale writes.
- `apps/api/src/tests/sop-ojt-search-contract.test.ts`
  - role/tool/part/linkage filter behavior and citation contract shape.
- `apps/api/src/tests/sop-ojt-kb-ingestion-failure-cases.test.ts`
  - ingestion retries, idempotency, and failure status persistence.
- `apps/workers/tests/sop-kb-ingestion.job.test.ts`
  - event-to-manifest transform and run-status transitions.

### Failure matrix (minimum)

| Failure case                                             | Expected behavior                                           |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| Attempt to publish without pass/fail criteria            | `422` + audit reject + `sop.version.publish_rejected` event |
| Step marked pass without mandatory evidence attachment   | `422`; no progress mutation                                 |
| Signoff by unauthorized role                             | `403` + deterministic authz reason + metric increment       |
| Execution against superseded/retired version             | `409` unless explicit historical replay mode                |
| Duplicate assignment create due to retry                 | idempotent response (same assignment id)                    |
| KB ingestion provider failure                            | run marked `FAILED`, retry scheduled, alert + failure event |
| Search request without query/filters                     | `422` validation error + no retrieval call                  |
| Assistant answer without citations where evidence exists | response flagged with warning/error policy, request audited |

## 10) Audit logging points, event emission points, and observability hooks

| Operation                         | Audit action                                                      | Event(s)                                                                              | Observability hooks                                                                         |
| --------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| SOP document create/update        | `sop.document.create` / `sop.document.update`                     | `sop.document.created` / `sop.document.updated`                                       | trace `sop.authoring.document`, metric `sop.authoring.document_mutation`                    |
| SOP version publish/supersede     | `sop.version.publish` / `sop.version.supersede`                   | `sop.version.published`, `sop.version.superseded`                                     | metric `sop.publish.duration_ms`, `sop.publish.reject_count`                                |
| Step requirement edits            | `sop.step.update`                                                 | `sop.step.updated`                                                                    | metric `sop.step.contract_write`                                                            |
| OJT assignment lifecycle          | `ojt.assignment.create`, `ojt.assignment.state_change`            | `ojt.assignment.created`, `ojt.assignment.completed`, `ojt.assignment.failed`         | metric `ojt.assignment.transition`, `ojt.assignment.overdue_count`                          |
| Execution step pass/fail          | `ojt.step.pass`, `ojt.step.fail`                                  | `ojt.step.passed`, `ojt.step.failed`                                                  | metric `ojt.step.pass_rate`, `ojt.step.failure_rate`; trace `ojt.execution.step_transition` |
| Signoff checkpoint record         | `ojt.signoff.record`                                              | `ojt.signoff.recorded`                                                                | metric `ojt.signoff.latency_ms`                                                             |
| Work-order/ticket linkage changes | `sop.linkage.work_order.update`, `sop.linkage.ticket_type.update` | `sop.linkage.work_order.updated`, `sop.linkage.ticket_type.updated`                   | metric `sop.linkage.change_count`                                                           |
| Search query execution            | `sop.search.query`                                                | `sop.search.executed`                                                                 | metric `sop.search.latency_ms`, `sop.search.zero_result_rate`                               |
| KB ingestion run                  | `sop.kb.ingestion.start`, `sop.kb.ingestion.fail`                 | `sop.kb.ingestion.requested`, `sop.kb.ingestion.succeeded`, `sop.kb.ingestion.failed` | metric `sop.kb.ingestion.duration_ms`, `sop.kb.ingestion.failure_rate`                      |
| AI SOP assist query               | `ai.request`                                                      | `ai.request_completed` / `ai.request_blocked`                                         | trace `ai.sop_assist`, metric `ai.sop_assist.citation_count`                                |

This model keeps SOP/OJT delivery auditable, modular, and implementation-ready while preserving MVP simplicity and clear extension points.
