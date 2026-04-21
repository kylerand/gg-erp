# QuickBooks Integration — Completion Plan

Branch: `feat/quickbooks-integration-finish`

The service layer, state machines, and database schema are all implemented.
The blockers are mechanical: routes not wired, two missing service files,
and a handful of audit/domain gaps. This document is the task board for
finishing the integration.

---

## Quick commands

```bash
# Fast check while you work
npm run hackathon:check

# QB-specific tests only
npx tsx --test apps/api/src/tests/invoice-sync-failure-cases.test.ts \
                apps/api/src/tests/customer-sync.test.ts \
                apps/api/src/tests/payment-sync.test.ts \
                apps/api/src/tests/reconciliation.test.ts

# Full gate before pushing
npm run ci:validate
```

---

## What is already production-ready

Do not re-implement these — they are complete and tested.

| File | What it does |
|------|-------------|
| `quickbooks.client.ts` | OAuth flow, token exchange, API transport |
| `quickbooks.tokenManager.ts` | Token storage + auto-refresh (Secrets Manager) |
| `invoiceSync.service.ts` + `invoiceSyncProcessor.service.ts` | Invoice sync state machine + QB payload builder |
| `customerSync.service.ts` | Customer sync state machine |
| `paymentSync.service.ts` | Inbound payment webhook processing |
| `reconciliation.service.ts` | Daily reconciliation, variance tracking, resolution |
| `entityMapping.service.ts` | Idempotent external ID mapping across providers |
| `failureQueue.service.ts` | Unified failure queue + batch retry |
| `integrationAccount.service.ts` | QB account CRUD + status management |
| `webhook.handler.ts` | HMAC-verified webhook intake, idempotent inbox |
| `handlers.ts` (22 handlers) | All request handlers implemented |

---

## Completion tasks

Tasks are ordered: each one unblocks the next group.

---

### 1. Wire all routes in `server.ts`  ← start here

**File:** `apps/api/src/server.ts`

Only `listInvoiceSyncHandler` is currently wired (line 216-217). Every other
handler exists but is unreachable. Add route blocks for:

| Method + Path | Handler to wire | Auth role |
|---------------|-----------------|-----------|
| `GET /accounting/quickbooks/connect` | `oauthConnectHandler` | `admin` |
| `GET /accounting/quickbooks/callback` | `oauthCallbackHandler` | `admin` |
| `GET /accounting/quickbooks/status` | `qbStatusHandler` | `admin` |
| `GET /accounting/invoices` | `listInvoiceSyncsHandler` | `admin` |
| `POST /accounting/invoices/:id/trigger` | `triggerInvoiceSyncHandler` | `admin` |
| `POST /accounting/invoices/:id/retry` | `retryInvoiceSyncHandler` | `admin` |
| `GET /accounting/customers` | `listCustomerSyncsHandler` | `admin` |
| `POST /accounting/customers/:id/trigger` | `triggerCustomerSyncHandler` | `admin` |
| `GET /accounting/reconciliation/runs` | `listReconciliationRunsHandler` | `admin` |
| `POST /accounting/reconciliation/runs` | `triggerReconciliationHandler` | `admin` |
| `GET /accounting/reconciliation/runs/:id` | `getReconciliationRunHandler` | `admin` |
| `GET /accounting/reconciliation/runs/:id/mismatches` | `listMismatchesHandler` | `admin` |
| `POST /accounting/reconciliation/records/:id/resolve` | `resolveReconciliationHandler` | `admin` |
| `GET /accounting/integration-accounts` | `listAccountsHandler` | `admin` |
| `PUT /accounting/integration-accounts/:id/status` | `updateAccountStatusHandler` | `admin` |
| `GET /accounting/failures` | (add handler — see task 3) | `admin` |
| `POST /accounting/failures/retry` | `retryFailedHandler` | `admin` |

**Test file to create:** `apps/api/src/tests/accounting-routes.test.ts`
- Happy path for each route (correct status code + shape)
- Auth guard: 401 when token missing, 403 when role insufficient

---

### 2. Fix the customer sync audit points

**File:** `apps/api/src/contexts/accounting/customerSync.service.ts`, line ~309

```typescript
// Replace this:
action: AUDIT_POINTS.invoiceSyncStart, // TODO: add customer_sync audit points

// With the correct customer sync audit points (add to AUDIT_POINTS in shared/audit):
action: AUDIT_POINTS.customerSyncStart  // or .customerSyncSucceeded / .customerSyncFailed
```

1. Add `customerSyncStart`, `customerSyncSucceeded`, `customerSyncFailed`,
   `customerSyncSkipped` to `AUDIT_POINTS` (find the file with
   `grep -r "AUDIT_POINTS" apps/api/src/shared/`).
2. Replace the four TODO callsites in `customerSync.service.ts` with the
   correct constant for each event name.
3. Existing `customer-sync.test.ts` should still pass — run it to confirm.

---

### 3. Add `getFailureSummaryHandler` to route table

**File:** `apps/api/src/lambda/accounting/handlers.ts`

`getFailureSummaryHandler` (line ~802) exists but there is no `GET
/accounting/failures/summary` route. Add it in the same pass as task 1.

---

### 4. Add `mapping.service.ts` — item/account/tax dimension mapping

**File to create:** `apps/api/src/contexts/accounting/mapping.service.ts`

The invoice sync processor currently skips mapping validation. Before an
invoice can be pushed to QB it needs resolved item codes, account refs, and
tax codes. This service is the preflight gate.

Minimum viable interface:

```typescript
export interface MappingService {
  // Validate all required mappings exist before attempting a sync.
  // Returns null if valid, or a string describing the first missing mapping.
  validateInvoiceMappings(workOrderId: string): Promise<string | null>;

  // CRUD for dimension mappings (item code → QB Item ref).
  upsertDimensionMapping(input: UpsertDimensionMappingInput): Promise<void>;

  // CRUD for tax code mappings (internal tax code → QB TaxCode ref).
  upsertTaxMapping(input: UpsertTaxMappingInput): Promise<void>;

  // Read
  listDimensionMappings(): Promise<DimensionMapping[]>;
  listTaxMappings(): Promise<TaxMapping[]>;
}
```

Routes to wire after:

| Method + Path | Role |
|---------------|------|
| `GET /accounting/mappings/dimensions` | `admin` |
| `PUT /accounting/mappings/dimensions` | `admin` |
| `GET /accounting/mappings/tax` | `admin` |
| `PUT /accounting/mappings/tax` | `admin` |

**Test file:** `apps/api/src/tests/accounting-mapping.test.ts`
- Missing mapping → `validateInvoiceMappings` returns an error string
- Present mapping → returns null
- Upsert is idempotent

---

### 5. Plug mapping validation into invoice sync processor

**File:** `apps/api/src/contexts/accounting/invoiceSyncProcessor.service.ts`

After task 4 lands, add a preflight call at the start of the processor:

```typescript
const mappingError = await this.deps.mapping.validateInvoiceMappings(workOrderId);
if (mappingError) {
  await this.invoiceSync.transitionToFailed(recordId, mappingError, context);
  return;
}
```

Update `invoice-sync-failure-cases.test.ts` to cover the "missing mapping →
FAILED transition" case.

---

### 6. Add explicit Prisma migration for QB tables

**Directory:** `packages/db/prisma/migrations/`

The Prisma schema already has all QB tables, but there is no explicit numbered
SQL migration file. Run:

```bash
npm run db:migrate -- --name quickbooks_integration_layer
```

Verify the generated SQL includes:
- `financial_dimension_mappings` table (if adding in task 4)
- `tax_code_mappings` table (if adding in task 4)
- Any index additions needed for the mapping tables

---

### 7. Register QB worker jobs

**Directory:** `apps/workers/src/jobs/`

Two worker jobs exist as loose handlers but are not registered as named jobs:

| Handler file | Job to create |
|---|---|
| `apps/workers/src/jobs/qb-invoice-sync.job.ts` (already exists) | Verify it's in the job registry |
| `apps/workers/src/payment-sync.handler.ts` | Move/wrap as `qb-payment-sync.job.ts` |

Check `apps/workers/src/index.ts` to see how the job registry works and add
any missing registrations there.

---

## Testing checklist before marking done

- [ ] `npm run hackathon:check` passes clean
- [ ] All 17 route blocks from task 1 have at least one test assertion
- [ ] `customer-sync.test.ts` still passes after audit point fix (task 2)
- [ ] `invoice-sync-failure-cases.test.ts` covers the mapping-missing case (task 5)
- [ ] New `accounting-mapping.test.ts` covers validate + upsert
- [ ] `npm run ci:validate` passes end-to-end

---

## Files to create / edit — summary

| Action | File |
|--------|------|
| Edit (route wiring) | `apps/api/src/server.ts` |
| Edit (audit points) | `apps/api/src/contexts/accounting/customerSync.service.ts` |
| Edit (audit constants) | `apps/api/src/shared/audit/audit-points.ts` (or equivalent) |
| Edit (preflight gate) | `apps/api/src/contexts/accounting/invoiceSyncProcessor.service.ts` |
| Create | `apps/api/src/contexts/accounting/mapping.service.ts` |
| Create | `apps/api/src/tests/accounting-routes.test.ts` |
| Create | `apps/api/src/tests/accounting-mapping.test.ts` |
| Run | `npm run db:migrate -- --name quickbooks_integration_layer` |
| Edit | `apps/workers/src/index.ts` (job registry) |
| Update | `docs/architecture/IMPLEMENTATION_STATUS.md` (accounting rows) |
