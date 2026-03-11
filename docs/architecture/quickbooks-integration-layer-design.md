# QuickBooks Integration Layer Design (MVP)

This document defines an MVP-ready QuickBooks integration layer for ERP finance flows. It is TypeScript-first, explicitly idempotent, and designed for reconciliation visibility from day one.

## Explicit assumptions

1. QuickBooks Online (QBO) is the only provider in MVP; provider abstraction remains in place for future adapters.
2. ERP remains source-of-truth for customer profile, invoice intent, and item/account assignment policy.
3. QuickBooks remains source-of-truth for payment settlement events and authoritative posting status.
4. Sync operations are at-least-once; correctness is guaranteed through idempotency keys and mapping tables (not by exactly-once delivery).
5. Existing integration backbone tables in `integrations.*`, `ops.idempotency_keys`, and `ops.dead_letter_records` remain the base and are extended additively.
6. Every mutation includes `correlationId`; external-facing mutation endpoints also require `Idempotency-Key`.
7. MVP prioritizes deterministic sync and reconciliation over “real-time everywhere” behavior.
8. This architecture todo is documentation-only; implementation is deferred.

## Exact files to create or modify (implementation contract)

> This todo only delivers architecture design. No migrations, services, or tests are implemented in this change.

### Create (new)

- `apps/api/src/migrations/<next_sequence>_quickbooks_integration_layer.sql`
  - additive QuickBooks integration tables/indexes (mapping + reconciliation + queue support).
- `apps/api/src/migrations/<next_sequence_plus_one>_quickbooks_reconciliation_views.sql`
  - reconciliation views/materialized views and reporting indexes.
- `packages/db/prisma/migrations/0002_quickbooks_integration_layer/migration.sql`
  - Prisma-side migration parity for quick local workflows.
- `packages/domain/src/model/accountingIntegration.ts`
  - TypeScript contracts for customer/invoice/payment sync and mapping entities.
- `apps/api/src/contexts/accounting/quickbooks.adapter.ts`
  - provider-specific transport/auth/signature verification + QBO request/response translation.
- `apps/api/src/contexts/accounting/quickbooks.client.ts`
  - HTTP client + retry/backoff/rate-limit behavior.
- `apps/api/src/contexts/accounting/customerSync.service.ts`
  - outbound customer upsert orchestration.
- `apps/api/src/contexts/accounting/invoiceExport.service.ts`
  - outbound invoice export/update orchestration.
- `apps/api/src/contexts/accounting/paymentStatusSync.service.ts`
  - inbound payment status processing.
- `apps/api/src/contexts/accounting/mapping.service.ts`
  - item/account/tax mapping resolution.
- `apps/api/src/contexts/accounting/reconciliation.service.ts`
  - report generation + variance classification.
- `apps/api/src/contexts/accounting/quickbooksWebhook.routes.ts`
  - webhook intake route contract.
- `apps/api/src/contexts/accounting/failureQueue.routes.ts`
  - dead-letter inspection and replay routes.
- `packages/db/src/repositories/integration-sync.repository.ts`
  - DB access for `integrations.sync_jobs`, `sync_job_items`, mappings.
- `packages/db/src/repositories/reconciliation.repository.ts`
  - DB access for reconciliation report entities.
- `apps/workers/src/jobs/quickbooks-sync-dispatch.job.ts`
- `apps/workers/src/jobs/quickbooks-webhook-consumer.job.ts`
- `apps/workers/src/jobs/quickbooks-reconciliation.job.ts`
- `apps/api/src/tests/quickbooks-customer-sync-failure-cases.test.ts`
- `apps/api/src/tests/quickbooks-invoice-sync-failure-cases.test.ts`
- `apps/api/src/tests/quickbooks-payment-status-sync.test.ts`
- `apps/api/src/tests/quickbooks-webhook-idempotency.test.ts`
- `apps/api/src/tests/quickbooks-reconciliation-reporting.test.ts`

### Modify (existing)

- `packages/domain/src/model/accounting.ts` (align existing invoice sync contract to DB-backed workflow)
- `packages/domain/src/model/index.ts` (export new accounting integration contracts)
- `packages/domain/src/events.ts` (add payment/reconciliation/failure-queue domain events)
- `packages/domain/src/observability.ts` (add metrics for reconciliation + queue outcomes)
- `apps/api/src/contexts/accounting/invoiceSync.service.ts` (convert from in-memory state to repository-backed state)
- `apps/api/src/contexts/accounting/invoiceSync.routes.ts` (align route contract with expanded sync workflows)
- `apps/api/src/audit/auditPoints.ts` (add QuickBooks-specific audit points)
- `apps/api/src/config/env.ts` (QBO realm/client/webhook configuration)
- `apps/api/src/index.ts` (wire accounting sync, webhook, failure queue routes)
- `apps/workers/src/index.ts` (register QBO sync/replay/reconciliation jobs)
- `packages/db/prisma/schema.prisma` (include integration schemas/models)
- `packages/db/src/index.ts` (export new repositories)

### Migration sequencing (do not skip)

1. `apps/api/src/migrations/<next_sequence>_quickbooks_integration_layer.sql`
2. `apps/api/src/migrations/<next_sequence_plus_one>_quickbooks_reconciliation_views.sql`
3. `packages/db/prisma/migrations/0002_quickbooks_integration_layer/migration.sql`

This keeps migration lineage explicit and additive after `0004_inventory_module_scaffold.sql`.

## Standards alignment snapshot (explicit)

- **TypeScript-first contracts:** Section 2 defines canonical interfaces/enums and contract ownership.
- **Clear modular architecture + justified adapters/services:** Section 1 separates adapter/client/service/repository responsibilities with explicit rationale.
- **Tests + failure cases:** Section 8 includes unit/contract/integration/failure/replay/reconciliation tests.
- **Audit/event/observability hooks:** Sections 5 and 6 define mandatory hooks for every sync path.
- **Migrations not skipped:** migration file targets and sequence are explicit above.
- **MVP-simple + extension points:** MVP defaults and expansion hooks are called out in each section.
- **Explicit assumptions:** listed in the assumptions section.
- **Exact file targets:** included above as implementation contract.

## MVP simplicity with extension points

| MVP choice | Why simple for MVP | Extension point |
|---|---|---|
| Single provider adapter (`QuickBooksAdapter`) | Fastest path to value | Add provider adapters behind the same `AccountingProviderAdapter` interface |
| Batch-oriented sync jobs (`sync_jobs` + `sync_job_items`) | Operationally visible + retryable | Priority queues and dependency graph between job types |
| Daily reconciliation report | Detects drift early with low runtime complexity | Near-real-time reconciliation triggers per mutation |
| One failure queue (`ops.dead_letter_records`) | Unified operator workflow | Split queues by severity/domain with automatic policy routing |
| Deterministic idempotency key policy | Eliminates duplicate creates and replay ambiguity | Sliding dedupe windows + semantic diff idempotency |

---

## 1) Integration boundary

### Boundary definition

- **Inside ERP canonical boundary:** customer profile, invoice composition, mapping policy, sync orchestration state, reconciliation evidence.
- **Outside boundary (provider boundary):** QuickBooks API contract details, provider IDs, webhook payload semantics, provider rate limits.
- **Boundary rule:** only adapter modules understand QuickBooks payload shape; all internal services use canonical contracts.

### Module decomposition (with justification)

| Module | Responsibility | Why this boundary is justified |
|---|---|---|
| `quickbooks.client.ts` | Auth token handling, HTTP transport, retryable transport errors | Keeps protocol concerns out of business logic |
| `quickbooks.adapter.ts` | Canonical-to-QBO and QBO-to-canonical translation | Isolates provider-specific schema drift |
| `customerSync.service.ts` | Customer upsert orchestration | Customer-specific invariants differ from invoice/payment |
| `invoiceExport.service.ts` | Invoice export/update orchestration | Handles invoice lifecycle and accounting controls |
| `paymentStatusSync.service.ts` | Payment webhook/poll processing | Inbound flow has separate consistency/failure semantics |
| `mapping.service.ts` | Item/account/tax mapping resolution and validation | Prevents duplicated mapping logic across workflows |
| `reconciliation.service.ts` | Drift detection + operator reporting | Keeps reporting logic independent from write paths |
| Repository layer (`packages/db/...`) | Persistence for jobs, mappings, queue, reports | Guarantees transactionally safe state transitions |

### Data ownership rule

- `integrations.*` owns provider sync state and mapping state.
- `ops.dead_letter_records` owns terminal failure queue records.
- Core domains (customer/work-order/inventory) publish events; accounting integration consumes them but does not write into non-owned schemas directly.

---

## 2) Canonical internal financial objects (TypeScript-first)

```ts
export type AccountingProvider = 'QUICKBOOKS';

export interface FinancialCustomer {
  customerId: string;
  displayName: string;
  email?: string;
  phone?: string;
  billingAddress?: string;
  state: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  version: number;
}

export interface FinancialInvoice {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  currency: string;
  issueDate: string;
  dueDate?: string;
  lines: FinancialInvoiceLine[];
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  status: 'DRAFT' | 'READY_TO_EXPORT' | 'EXPORTED' | 'VOID';
  version: number;
}

export interface FinancialInvoiceLine {
  lineId: string;
  itemCode: string;
  description: string;
  quantity: string;
  unitPrice: string;
  incomeAccountCode: string;
  taxCode: string;
}

export interface PaymentStatusUpdate {
  paymentId: string;
  invoiceId: string;
  providerPaymentId: string;
  amount: string;
  currency: string;
  status: 'POSTED' | 'SETTLED' | 'REVERSED';
  paidAt?: string;
}

export interface FinancialMapping {
  mappingType:
    | 'CUSTOMER'
    | 'INVOICE'
    | 'ITEM'
    | 'INCOME_ACCOUNT'
    | 'AR_ACCOUNT'
    | 'TAX_CODE'
    | 'PAYMENT_METHOD';
  internalKey: string;
  externalKey: string;
  namespace: string;
  isActive: boolean;
}

export interface SyncCommand {
  integrationAccountId: string;
  jobType:
    | 'CUSTOMER_SYNC'
    | 'INVOICE_EXPORT'
    | 'PAYMENT_STATUS_SYNC'
    | 'RECONCILIATION_RUN';
  correlationId: string;
  idempotencyKey: string;
}
```

Canonical contracts are maintained in `packages/domain/src/model/accountingIntegration.ts`; adapters translate to/from QBO API DTOs.

---

## 3) Mapping tables needed

### Existing tables reused

| Table | Usage in QuickBooks integration |
|---|---|
| `integrations.integration_accounts` | Provider account configuration (`provider='QUICKBOOKS'`, realm metadata in `configuration`) |
| `integrations.sync_jobs` | Batch/workflow state for customer/invoice/payment/reconciliation jobs |
| `integrations.sync_job_items` | Per-record success/failure, retry counters, payload snapshot |
| `integrations.external_id_mappings` | Internal↔external identity mapping for customer/invoice/payment entities |
| `integrations.webhook_inbox_events` | Idempotent inbound webhook storage |
| `integrations.integration_error_events` | Structured integration exceptions |
| `ops.idempotency_keys` | API replay protection for unsafe integration commands |
| `ops.dead_letter_records` | Failure queue for terminal job item failures |

### New tables (additive in `<next_sequence>`)

| Table | Purpose | Required indexes |
|---|---|---|
| `integrations.financial_dimension_mappings` | Item/account/payment-method mappings (`mapping_type`, `internal_code`, `external_id`) | unique `(integration_account_id, mapping_type, internal_code, namespace)` |
| `integrations.tax_code_mappings` | Internal tax category/jurisdiction to QBO tax code/rate mapping | unique `(integration_account_id, tax_region_code, internal_tax_code, namespace)` |
| `integrations.invoice_sync_snapshots` | Immutable snapshot of exported invoice payload/hash used for reconciliation | index `(integration_account_id, invoice_id, exported_at)` |
| `integrations.reconciliation_reports` | Report header (`report_date`, `status`, totals, generated_by`) | unique `(integration_account_id, report_date)` |
| `integrations.reconciliation_report_items` | Variance rows with classification and resolution state | index `(reconciliation_report_id, variance_type, resolution_status)` |

### Mapping strategy decisions

- Use `external_id_mappings` for entity-level links (customer/invoice/payment).
- Use `financial_dimension_mappings` for item/account/payment method dimensions.
- Use `tax_code_mappings` for tax strategy and deterministic replay.
- All mapping lookups are namespace-aware (`qbo:<realmId>:v1`) to support future multi-account/multi-provider operation.

---

## 4) Sync workflows

### 4.1 Customer sync strategy

1. Triggered by `customer.created`, `customer.updated`, `customer.state_changed` events.
2. `customerSync.service.ts` resolves existing mapping via `external_id_mappings`.
3. If mapped: update QBO Customer; if unmapped: create QBO Customer then persist mapping.
4. Store item-level result in `sync_job_items` and write snapshot hash.
5. On non-retryable validation error (e.g., missing legal name), route item to failure queue.

### 4.2 Invoice export/sync

1. Triggered when ERP invoice reaches `READY_TO_EXPORT`.
2. Validate required mappings: customer, item, income account, AR account, tax code.
3. Build canonical `FinancialInvoice` and persist `invoice_sync_snapshots` payload hash.
4. Export/upsert via adapter and store external invoice ID in `external_id_mappings`.
5. Transition invoice sync state (`PENDING -> IN_PROGRESS -> SYNCED/FAILED`) and emit events.

### 4.3 Payment status sync

1. Intake QBO webhook to `webhook_inbox_events` (dedupe on `provider_event_id`).
2. For payment-related events, fetch authoritative payment/invoice details via adapter.
3. Transform to `PaymentStatusUpdate` and apply to internal accounting projection.
4. Emit `invoice_sync.payment_status_updated` event for downstream consumers.

### 4.4 Item/account mapping flow

1. Accounting admin defines mapping rows in `financial_dimension_mappings`.
2. Sync services perform strict preflight mapping checks before outbound export.
3. Missing/inactive mapping is **non-retryable** until configuration changes; item enters failure queue with reason `MAPPING_MISSING`.

### 4.5 Tax handling strategy

- ERP computes canonical line-level tax intent and selects internal tax codes.
- Adapter resolves internal tax code to QBO tax code via `tax_code_mappings`.
- Export payload includes explicit tax references per line to avoid implicit provider defaults.
- Persist tax mapping version + tax payload hash in `invoice_sync_snapshots` for reconciliation traceability.
- If no mapping exists for jurisdiction/code, block export and queue failure (no silent fallback tax code in MVP).

### 4.6 Retries and idempotency

- Retryable classes: network timeout, 429, 5xx, transient auth refresh failure.
- Backoff: exponential with jitter, bounded by `sync_jobs.max_attempts`.
- Outbound idempotency key:
  - `<integrationAccountId>:<jobType>:<entityType>:<entityId>:<entityVersion>`
- Inbound idempotency key:
  - `<integrationAccountId>:<providerEventId>`
- Create operations always check `external_id_mappings` before provider create calls.

### 4.7 Reconciliation reporting workflow

1. Daily job (`quickbooks-reconciliation.job.ts`) generates report header row.
2. Compare ERP invoice snapshots and payment projections to provider state.
3. Persist variances by type (`MISSING_IN_PROVIDER`, `AMOUNT_MISMATCH`, `TAX_MISMATCH`, `PAYMENT_STATUS_MISMATCH`, `ORPHAN_PROVIDER_RECORD`).
4. Emit reconciliation summary event and metrics; unresolved variances remain open until resolved/replayed.

---

## 5) Error handling model

| Error class | Example | Handling | Queue behavior |
|---|---|---|---|
| `RETRYABLE_TRANSIENT` | QBO timeout, 429, 503 | Retry with backoff; increment attempts | Move to failure queue only after max attempts |
| `RETRYABLE_CONFLICT` | stale sync token/version conflict | Refresh latest provider entity; retry once in same attempt window | Queue after repeated conflict threshold |
| `NON_RETRYABLE_VALIDATION` | missing mapping, invalid tax code | Mark failed immediately with actionable code | Immediate queue insert |
| `NON_RETRYABLE_AUTH` | revoked realm consent | Pause integration account, alert operators | Queue all dependent pending items |
| `POISON_WEBHOOK` | malformed payload/signature mismatch | Mark webhook event failed, no business mutation | Queue event payload reference |

### Failure queue model

- Terminal failures are written to `ops.dead_letter_records` with:
  - `record_type='INTEGRATION_SYNC_ITEM'`
  - `record_key=<sync_job_item_id>`
  - `failure_code`, `failure_reason`, `latest_failed_at`, `payload_ref`.
- Replay endpoint requeues by creating a new `sync_job_item` attempt linked to original item.
- Queue entries are not deleted; they transition to resolved states for auditability.

---

## 6) Audit model

### Required audit actions

- `accounting.customer_sync_start`
- `accounting.customer_sync_success`
- `accounting.customer_sync_fail`
- `accounting.invoice_export_start`
- `accounting.invoice_export_success`
- `accounting.invoice_export_fail`
- `accounting.payment_status_sync`
- `accounting.mapping_updated`
- `accounting.reconciliation_generated`
- `accounting.failure_queue_replayed`

### Audit/event/observability hooks

| Mutation point | Audit | Event | Observability |
|---|---|---|---|
| Customer upsert | start/success/fail action | `invoice_sync.customer_synced` / `invoice_sync.customer_sync_failed` | metric `accounting.customer_sync.*`, trace `accounting.customer_sync` |
| Invoice export | start/success/fail action | `invoice_sync.started/succeeded/failed/retried` | metric `invoice_sync.transition`, export latency histogram |
| Payment status apply | payment sync action | `invoice_sync.payment_status_updated` | metric `accounting.payment_sync.*`, webhook lag gauge |
| Mapping change | mapping updated action | `accounting.mapping.changed` | config-change counter + actor correlation |
| Reconciliation run | report generated action | `accounting.reconciliation.generated` | mismatch counters by type + SLO alert hooks |
| Failure replay | replay action | `accounting.failure_queue.replayed` | replay success/failure metrics |

All records include actor, correlation ID, and request/trace metadata.

---

## 7) API and webhook design

### API surface (MVP)

| Method | Path | Purpose | Idempotency |
|---|---|---|---|
| POST | `/accounting/quickbooks/sync/customers` | enqueue customer sync batch | required (`Idempotency-Key`) |
| POST | `/accounting/quickbooks/sync/invoices` | enqueue invoice export batch | required |
| POST | `/accounting/quickbooks/sync/payments/pull` | pull payment statuses for date/window | required |
| POST | `/accounting/quickbooks/reconciliation/run` | generate reconciliation report | required |
| GET | `/accounting/quickbooks/reconciliation/reports/:id` | fetch report summary + variances | n/a |
| GET | `/accounting/quickbooks/failure-queue` | list dead-letter entries | n/a |
| POST | `/accounting/quickbooks/failure-queue/:recordId/replay` | replay failed sync item | required |
| PUT | `/accounting/quickbooks/mappings/dimensions` | upsert item/account/payment mappings | required |
| PUT | `/accounting/quickbooks/mappings/tax` | upsert tax mappings | required |

### Webhook contract

- `POST /accounting/quickbooks/webhooks`
  1. Verify signature/token before parsing payload.
  2. Persist raw payload in `integrations.webhook_inbox_events`.
  3. Enforce dedupe by `(integration_account_id, provider_event_id)`.
  4. Enqueue async processing job (`quickbooks-webhook-consumer.job.ts`).
  5. Return 202 for accepted processing; 401 on signature failure.

### Security notes

- Store OAuth credentials and webhook verification secrets in env/secret manager; never in DB plaintext.
- Keep webhook handler side-effect free except inbox write + enqueue.

---

## 8) Test strategy

### Coverage layers

1. **Domain contract tests** (`packages/domain`)  
   - compile-time + runtime validation of `FinancialCustomer`, `FinancialInvoice`, `PaymentStatusUpdate`, mapping contracts.
2. **Adapter contract tests** (`apps/api/src/contexts/accounting`)  
   - QBO payload translation, signature verification, tax mapping behavior.
3. **Service tests**  
   - customer sync, invoice export, payment sync workflows including retries and idempotency.
4. **Persistence/repository tests**  
   - mapping uniqueness, sync state transitions, reconciliation report writes, dead-letter behavior.
5. **Worker/job tests**  
   - retry policy, failure queue insertion, replay path.
6. **End-to-end failure-case tests** (`apps/api/src/tests/*quickbooks*`)  
   - duplicate webhook deliveries, partial batch failures, max-attempt exhaustion, mapping missing, tax mismatch, reconciliation mismatch.

### Required failure cases (minimum)

- Duplicate `Idempotency-Key` returns prior result without duplicate provider call.
- Duplicate webhook event does not create duplicate payment updates.
- Missing item/account/tax mapping fails fast and enters failure queue.
- Invoice export retries on transient provider failure, then dead-letters after max attempts.
- Reconciliation run detects amount/tax/payment mismatches and persists report items.
- Replay from failure queue succeeds without duplicate QuickBooks object creation.

### Migration verification tests

- Validate `<next_sequence>` and `<next_sequence_plus_one>` apply cleanly after `0004_inventory_module_scaffold.sql`.
- Validate rollback notes/queries for new mapping and reconciliation entities.
- Validate Prisma migration parity against SQL migration targets.

---

## Decision summary (idempotency + reconciliation)

- **Idempotency decision:** outbound and inbound flows both use deterministic, persisted idempotency keys plus external ID mappings; duplicate delivery is expected and safe.
- **Reconciliation decision:** daily first-class reconciliation reporting is mandatory in MVP, with persistent variance items and replay hooks; accounting correctness is measured through explicit drift reporting, not assumed from sync success alone.
