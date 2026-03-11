# ShopMonkey Migration Export Plan (MVP-first)

This document defines an implementation-ready migration/export plan for importing ShopMonkey data into ERP with low cutover risk, strong traceability, and a simple modular TypeScript pipeline.

It extends (not replaces) `docs/architecture/migration-from-shopmonkey.md` with concrete schema, contracts, and rollout discipline.

## Explicit assumptions

1. ShopMonkey export provides stable record IDs for core entities (customers, assets, work orders, parts, employees, vendors).
2. One ShopMonkey tenant/account is in scope for MVP cutover.
3. ERP environments already run through `apps/api/src/migrations/0004_inventory_module_scaffold.sql`.
4. Cutover includes a controlled ShopMonkey write freeze window (target <= 4 hours).
5. Attachments are metadata-only in MVP; binary asset migration is deferred.
6. Historical backfill happens only after active/open data is live in ERP.
7. `integrations.integration_accounts` includes an active `SHOPMONKEY` integration account.
8. All migration runs are operator-initiated, correlated, and auditable.
9. No hidden cross-schema writes: migration writes are routed through explicit migration/integration boundaries.

## Exact files to create or modify (implementation contract)

These are the concrete implementation files for the plan below:

- `apps/api/src/migrations/<next_sequence>_migration_staging_schema.sql` (create)
- `apps/api/src/migrations/<next_sequence_plus_one>_shopmonkey_cutover_controls.sql` (create)
- `packages/domain/src/migration/shopmonkey.ts` (create)
- `packages/domain/src/model/index.ts` (modify export)
- `packages/domain/src/events.ts` (modify event catalog for migration events)
- `apps/api/src/contexts/migration/shopmonkey/contracts.ts` (create)
- `apps/api/src/contexts/migration/shopmonkey/parse.ts` (create)
- `apps/api/src/contexts/migration/shopmonkey/dedupe.ts` (create)
- `apps/api/src/contexts/migration/shopmonkey/mapper.ts` (create)
- `apps/api/src/contexts/migration/shopmonkey/migration.repository.ts` (create; justified for transactional persistence/idempotency)
- `apps/api/src/contexts/migration/shopmonkey/migration.service.ts` (create)
- `apps/api/src/contexts/migration/shopmonkey/migration.routes.ts` (create)
- `apps/workers/src/jobs/shopmonkey-migration-batch.job.ts` (create)
- `scripts/migration/shopmonkey/run-active-cutover.ts` (create)
- `scripts/migration/shopmonkey/run-historical-backfill.ts` (create)
- `scripts/migration/shopmonkey/reconcile.ts` (create)
- `apps/api/src/tests/shopmonkey-migration-contracts.test.ts` (create)
- `apps/api/src/tests/shopmonkey-migration-failure-cases.test.ts` (create)
- `docs/runbooks/shopmonkey-cutover-runbook.md` (create)
- `docs/runbooks/shopmonkey-rollback-runbook.md` (create)

This task adds architecture documentation only; implementation is intentionally deferred.

## Standards alignment snapshot (explicit)

- **TypeScript-first script contracts:** all extractor/mapper/loader interfaces are typed and validated at boundaries.
- **Simple, modular pipeline design:** parse -> stage -> dedupe -> map -> load -> reconcile, each step isolated and idempotent.
- **Repository/service usage only where justified:** repository only for transactional DB writes + mapping upserts; transformation/dedupe modules remain pure functions.
- **Tests + failure cases:** contract, idempotency, duplicate, and retry/failure-path tests are required before cutover.
- **Audit/event/observability hooks:** every batch emits auditable records, domain/integration events, and metrics/traces with correlation IDs.
- **Migration discipline:** additive, sequential SQL migrations (`<next_sequence>`, `<next_sequence_plus_one>`, ...), plus operator runbooks and verification queries.
- **MVP-simple with extension points:** start with CSV batch imports and deterministic rules; extend later with APIs/CDC, confidence scoring, and richer matching.
- **Explicit assumptions:** captured in the assumptions section and treated as rollout gates.
- **Exact files to create/modify:** enumerated above for implementation handoff.

## 1) Data domains to extract first

Import order is based on dependency safety and cutover value.

| Wave | Domain | Why first | Primary ERP targets |
|---|---|---|---|
| A | Organizations/shops + integration account binding | Needed to namespace all mappings and scope imports | `identity.organizations`, `identity.shops`, `integrations.integration_accounts` |
| B | Employees/technicians (active only) | Required for assignment integrity and audit actor mapping | `identity.users`, `hr.employees`, `hr.employee_skills` |
| C | Parts, locations, on-hand inventory | Blocks work-order execution if absent | `inventory.parts`, `inventory.stock_locations`, `inventory.stock_lots`, `inventory.inventory_balances` |
| D | Customers/assets (active + recently updated) | Required references for active work orders | `work_orders.work_orders.customer_reference`, `work_orders.work_orders.asset_reference` (future extension to dedicated customer/asset tables) |
| E | Open/in-flight work orders + operations + part requirements | Core operations cutover scope | `work_orders.work_orders`, `work_orders.work_order_operations`, `work_orders.work_order_parts`, `work_orders.work_order_assignments` |
| F | Open purchasing/vendor obligations | Needed for inventory continuity and receiving | `inventory.vendors`/procurement extensions, `inventory.purchase_orders` extensions (or staged references until extension exists) |
| G | Historical completed/cancelled records | Deferred to reduce go-live risk | Same targets, imported in throttled backfill batches |

## 2) Proposed staging schema

Create additive migration schema in `<next_sequence>_migration_staging_schema.sql`.

```sql
create schema if not exists migration;

create table if not exists migration.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_system text not null check (source_system in ('SHOPMONKEY')),
  batch_type text not null check (batch_type in ('ACTIVE_CUTOVER', 'HISTORICAL_BACKFILL', 'DELTA')),
  source_file_name text not null,
  source_file_sha256 text not null,
  started_by_user_id uuid references identity.users(id),
  status text not null check (status in ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'ROLLED_BACK')),
  total_records integer not null default 0,
  accepted_records integer not null default 0,
  rejected_records integer not null default 0,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists migration.raw_records (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references migration.import_batches(id) on delete cascade,
  entity_type text not null,
  external_id text not null,
  payload jsonb not null,
  payload_sha256 text not null,
  row_number integer,
  created_at timestamptz not null default now(),
  unique (batch_id, entity_type, external_id)
);

create table if not exists migration.stage_records (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references migration.import_batches(id) on delete cascade,
  entity_type text not null,
  external_id text not null,
  normalized_payload jsonb not null,
  dedupe_key text,
  validation_status text not null check (validation_status in ('VALID', 'INVALID', 'REVIEW_REQUIRED')),
  validation_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (batch_id, entity_type, external_id)
);

create table if not exists migration.duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references migration.import_batches(id) on delete cascade,
  entity_type text not null,
  external_id text not null,
  matched_entity_id uuid,
  match_strategy text not null,
  confidence_score numeric(5,4) not null,
  resolution_status text not null check (resolution_status in ('AUTO_ACCEPTED', 'AUTO_MERGED', 'MANUAL_REQUIRED', 'MANUAL_RESOLVED')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists migration.reconciliation_results (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references migration.import_batches(id) on delete cascade,
  check_name text not null,
  check_scope text not null,
  expected_value numeric,
  actual_value numeric,
  check_status text not null check (check_status in ('PASS', 'WARN', 'FAIL')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists migration.migration_errors (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references migration.import_batches(id) on delete cascade,
  entity_type text not null,
  external_id text,
  error_code text not null,
  error_message text not null,
  error_context jsonb not null default '{}'::jsonb,
  retryable boolean not null default false,
  created_at timestamptz not null default now()
);
```

Design notes:

- `migration.raw_records` preserves source truth for replay/debug.
- `migration.stage_records` enforces normalized shape before canonical writes.
- Canonical external mapping remains in `integrations.external_id_mappings` to avoid duplicate mapping systems.

## 3) ID mapping strategy

1. Register ShopMonkey account in `integrations.integration_accounts` (`provider='SHOPMONKEY'`).
2. For each canonical write, upsert `integrations.external_id_mappings` with:
   - `integration_account_id`
   - `entity_type` (e.g., `CUSTOMER`, `ASSET`, `WORK_ORDER`, `PART`, `EMPLOYEE`)
   - `entity_id` (ERP UUID)
   - `external_id` (ShopMonkey ID)
   - `namespace='shopmonkey:v1'`
3. Treat `external_id_mappings_external_uk` as idempotency guard (same source record cannot create multiple ERP entities).
4. When no stable source ID exists, derive deterministic external IDs (e.g., hash of normalized natural key) and mark source in payload metadata.
5. Never hard-delete mappings during migration; if remapped, mark old row `is_active=false` and insert successor row.
6. All loads must resolve dependencies via mappings first (e.g., work order customer/asset references).

## 4) Duplicate resolution rules

| Entity | Primary dedupe key | Secondary key(s) | Auto resolution | Manual review trigger |
|---|---|---|---|---|
| Customer | `lower(trim(email))` | normalized phone + full name | Keep most recently updated non-archived profile | Conflicting active profiles with different contact identity |
| Asset/Vehicle | VIN/serial | customer reference + make/model/year | Merge if VIN equal and owner-compatible | Same serial, different owner with overlapping active dates |
| Part | SKU | manufacturer part number | Keep existing active part, merge aliases into metadata | Same SKU with materially different UOM/category |
| Employee | `lower(trim(email))` | employee number | Prefer ACTIVE employment_state record | Same email mapped to multiple active employees |
| Work order | external work-order ID | work order number + opened_at | Idempotent upsert into existing mapped work order | Same number/date with divergent status progression |
| Vendor | normalized vendor code | normalized vendor name + phone | Keep ACTIVE vendor, add alternate identifiers | Payment/contact conflicts across active records |

Rule precedence:

1. Trust explicit external ID mapping.
2. Else use deterministic natural-key matching.
3. Else create `MANUAL_REQUIRED` duplicate candidate and block canonical write for that record.

## 5) Historical vs active data migration rules

### Active cutover scope (go-live blocking)

- All **open/in-progress** work orders and dependent operations/parts/assignments.
- Inventory with `quantity_on_hand > 0` or active reservations.
- Active employees/technicians and required identity/user relationships.
- Customers/assets referenced by active work orders.
- Open vendor commitments (open PO or expected receipts).

### Historical backfill scope (post-go-live)

- Completed/cancelled work orders older than cutover window.
- Fully consumed/closed inventory lots and reservations.
- Inactive employees/customers/vendors not required for active workflows.
- Legacy audit-style notes/comments as read-only references.

### Rules

1. Preserve source timestamps (`created_at`, `updated_at`, lifecycle transition times) where possible.
2. Active import uses strict validation (no silent coercion); historical import may allow scoped waivers with explicit `WARN` reconciliation flags.
3. Historical runs are chunked by date (e.g., month/quarter) and are resumable by batch checkpoint.

## 6) Validation and reconciliation steps

### Pre-load checks

- File integrity: checksum, schema version, header validation.
- Referential coverage in staging (e.g., every work order part references known work order + part).
- Duplicate candidate volume within threshold.

### In-load checks

- Per-entity accepted/rejected counts.
- Idempotency behavior under re-run (same input => no net new rows).
- Required mapping availability for dependent entities.

### Post-load reconciliation

- Record counts by domain:
  - source count
  - staged valid count
  - canonical inserted/updated count
  - rejected count
- Status distribution parity (e.g., open/blocked/in-progress work orders).
- Quantity parity for inventory by part/location.
- Sampled deep checks (at least 20 records/domain) for semantic parity.
- Store reconciliation results in `migration.reconciliation_results`.

Suggested reconciliation query categories:

- Missing mapping detector (`staged valid` minus `external_id_mappings`).
- Mismatch detector (source status vs canonical status mapping).
- Orphan detector (operations/parts with no parent work order).

## 7) Cutover strategy

1. **T-7 to T-2 days:** dry runs in non-prod with production-like exports; fix mapping and validation defects.
2. **T-1 day:** final rehearsal + approved go/no-go checklist.
3. **T0 freeze window:**
   - Freeze ShopMonkey writes for in-scope modules.
   - Generate final active export + checksum manifest.
   - Run active import pipeline sequentially by dependency wave (A -> F).
4. **Go-live gate:**
   - All critical reconciliation checks pass.
   - No unresolved `MANUAL_REQUIRED` duplicates for active scope.
   - Error rate below agreed threshold and retry queue drained.
5. **Traffic switch:**
   - Route operational writes to ERP.
   - Keep ShopMonkey read-only for reference during stabilization window.
6. **T+1 onward:** begin historical backfill in throttled batches.

Cutover approach is freeze-and-import (not dual-write) for MVP simplicity and deterministic integrity.

## 8) Rollback strategy

Rollback trigger examples:

- Critical reconciliation failure in active scope.
- High-severity data integrity defect (incorrect assignments/quantities/status transitions).
- Sustained migration job failure beyond retry policy.

Rollback actions:

1. Stop migration jobs/workers and block new migration batches.
2. Disable ERP write cutover flag and restore operational writes to ShopMonkey.
3. Revert imported active data by batch scope:
   - preferred: restore pre-cutover DB snapshot for full rollback window;
   - fallback: batch-targeted compensating deletes/soft-reverts in reverse dependency order.
4. Keep `audit.audit_events`, `migration.*`, and integration error records immutable for incident evidence.
5. Publish rollback incident event and run reconciliation to confirm legacy system authority restored.

Policy:

- Use **forward-fix** for non-critical defects after go-live.
- Use **full rollback** only within the defined cutover rollback window and when data integrity risk is high.

## 9) Example scripts structure in TypeScript

```text
apps/api/src/contexts/migration/shopmonkey/
  contracts.ts
  parse.ts
  dedupe.ts
  mapper.ts
  migration.repository.ts
  migration.service.ts
  migration.routes.ts
scripts/migration/shopmonkey/
  run-active-cutover.ts
  run-historical-backfill.ts
  reconcile.ts
```

```ts
// contracts.ts
export type MigrationEntityType =
  | 'CUSTOMER'
  | 'ASSET'
  | 'EMPLOYEE'
  | 'PART'
  | 'WORK_ORDER'
  | 'WORK_ORDER_OPERATION'
  | 'WORK_ORDER_PART'
  | 'VENDOR';

export interface ImportBatchContext {
  batchId: string;
  correlationId: string;
  integrationAccountId: string;
  startedByUserId: string;
}

export interface ExtractedRecord<TPayload> {
  entityType: MigrationEntityType;
  externalId: string;
  payload: TPayload;
  rowNumber: number;
}

export interface PipelineStep<TInput, TOutput> {
  run(input: AsyncIterable<TInput>, ctx: ImportBatchContext): AsyncIterable<TOutput>;
}
```

```ts
// run-active-cutover.ts
await pipeline
  .extract(csvFiles)
  .pipe(parseAndValidate)
  .pipe(dedupeAndResolve)
  .pipe(mapToCanonical)
  .pipe(loadCanonical)
  .pipe(reconcileAndReport)
  .execute(context);
```

Design intent:

- Keep each step small and testable.
- Keep parsers/mappers pure.
- Use repository only at stage/load/reconciliation persistence boundaries.

## 10) Suggested CSV/import contract formats

Global CSV contract:

- UTF-8, comma delimiter, RFC4180 quoting.
- Header row required.
- Timestamps in ISO-8601 UTC.
- Empty string = `null` for optional fields only.
- Every file includes `external_id` and `updated_at`.

| File | Required columns | Notes |
|---|---|---|
| `customers.csv` | `external_id`, `full_name`, `email`, `phone`, `status`, `updated_at` | `email` normalized lower-case before dedupe |
| `assets.csv` | `external_id`, `customer_external_id`, `vin_or_serial`, `asset_label`, `status`, `updated_at` | `vin_or_serial` required for auto-merge |
| `employees.csv` | `external_id`, `email`, `employee_number`, `first_name`, `last_name`, `employment_state`, `updated_at` | required before assignments import |
| `parts.csv` | `external_id`, `sku`, `name`, `unit_of_measure`, `part_state`, `reorder_point`, `updated_at` | `sku` required and unique in canonical form |
| `inventory_lots.csv` | `external_id`, `part_external_id`, `location_code`, `lot_number`, `serial_number`, `quantity_on_hand`, `lot_state`, `updated_at` | at least one of `lot_number` or `serial_number` |
| `work_orders.csv` | `external_id`, `work_order_number`, `customer_external_id`, `asset_external_id`, `status`, `title`, `opened_at`, `due_at`, `completed_at`, `priority`, `updated_at` | active scope filters by status |
| `work_order_operations.csv` | `external_id`, `work_order_external_id`, `sequence_no`, `operation_code`, `operation_status`, `estimated_minutes`, `updated_at` | parent work order mapping must exist |
| `work_order_parts.csv` | `external_id`, `work_order_external_id`, `part_external_id`, `requested_quantity`, `reserved_quantity`, `consumed_quantity`, `part_status`, `updated_at` | quantity invariants validated pre-load |
| `vendors.csv` | `external_id`, `vendor_code`, `name`, `email`, `phone`, `vendor_state`, `updated_at` | code normalization required |

## Test and failure matrix (required before production cutover)

- **Contract tests:** CSV header/type validation, enum mapping, timestamp parsing.
- **Dedupe tests:** deterministic winner selection, manual-review branching.
- **Idempotency tests:** re-running same batch yields no duplicate canonical writes.
- **Dependency tests:** child imports fail closed when parent mappings are missing.
- **Failure-path tests:** partial batch failure, retry exhaustion, dead-letter recording.
- **Reconciliation tests:** mismatch detection and fail-fast go/no-go behavior.
- **Rollback drill:** dry-run snapshot restore + compensating flow verification.

## Audit/event/observability hooks (required)

Audit:

- Record batch lifecycle actions in `audit.audit_events` (start, pause, complete, rollback).
- Include actor, source file hash, counts, correlation ID, and runbook reference.

Events:

- Emit migration events via outbox (examples):
  - `migration.batch.started`
  - `migration.batch.completed`
  - `migration.batch.failed`
  - `migration.record.rejected`
  - `migration.rollback.executed`

Observability:

- Metrics: batch duration, accept/reject counts, duplicate/manual-review counts, retry counts.
- Traces: one root trace per batch; span per entity wave.
- Logs: structured, correlation-bound, no silent drops.

## MVP simplicity with extension points

| MVP choice | Why simple now | Extension point |
|---|---|---|
| CSV batch import as system of intake | Operationally simple, debuggable, deterministic | Add API/CDC intake later |
| Deterministic dedupe rules | Predictable outcomes for cutover | Add confidence-scored matching service |
| Sequential domain waves | Easy rollback and dependency control | Add parallel lanes once stable |
| Freeze-and-import cutover | Lowest consistency risk for MVP | Move to near-zero-downtime delta sync |
| Single mapping namespace `shopmonkey:v1` | Easy governance | Multi-namespace for tenant/version evolution |
