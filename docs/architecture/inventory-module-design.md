# Inventory Module Design (MVP)

This document defines the inventory module architecture for ERP MVP with explicit extension points for manufacturing-grade control (custom builds, partial kits, and traceable stock movement).

## Scope, assumptions, and guardrails

### Scope

- Domain design for parts, stock, reservations/allocations/consumption, receipts, adjustments, transfers, cycle counts, and full ledger traceability.
- API contract design (command + query surfaces).
- Event, validation, and operational telemetry/audit model.

### Explicit assumptions

1. Single-tenant ERP in MVP, multiple physical stock locations.
2. Quantity precision uses decimal math (`numeric(14,3)` in DB model) and all quantities are normalized to a base UOM per part.
3. `inventory.inventory_ledger_entries` remains the immutable source of truth; `inventory.inventory_balances` is the mutable projection.
4. `allocated` is modeled as a stricter subset of `reserved` (reserved quantity physically staged/picked to a work order or kit), tracked explicitly in API/read model even if persisted initially via reservation status metadata.
5. Substitutions are explicit and approved (no automatic replacement without policy check).
6. Custom build and partial-kit handling must never silently over-consume stock.

### MVP simplicity and abstraction policy

- Keep one inventory bounded context with focused services by behavior (catalog, stock movement, counting) only where invariants differ.
- Use repository pattern because inventory operations require transactional writes across balances + ledger + reservations.
- Avoid speculative layers; add adapters/services only when they enforce real business boundaries.

---

## 1) Bounded context and aggregates

### Bounded context map

- **Inventory (owner):** parts, substitutions, UOM normalization, locations/bins, balances, reservations/allocations, movements, cycle counts.
- **Procurement (upstream to inventory):** purchase-order lifecycle and receiving intent.
- **Work Orders (downstream consumer):** demand signal and material consumption.
- **Planning/Reporting (read-side consumers):** availability, shortages, and throughput.

### Inventory aggregates

| Aggregate                          | Core entities/tables                                                                                       | Responsibilities                                                                | Key invariants                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Part Catalog Aggregate             | `inventory.parts` (+ new `inventory.part_substitutions`, `inventory.part_uom_conversions`)                 | Part master data, alternate/substitute policy, UOM conversion metadata          | SKU unique; base UOM required; discontinued parts cannot be newly reserved/ordered  |
| Location Aggregate                 | `inventory.stock_locations`, bins (`inventory_bin` domain model now; align to DB stock-location hierarchy) | Physical layout ownership (warehouse/bay/van/staging), pickability, bin state   | Inactive/closed locations cannot receive/reserve                                    |
| Stock Position Aggregate           | `inventory.stock_lots`, `inventory.inventory_balances`                                                     | Current on-hand and reserved/allocated quantity projection by part/location/lot | `reserved + allocated <= on_hand`; lot state must allow mutation                    |
| Reservation & Allocation Aggregate | `inventory.inventory_reservations`, `work_orders.work_order_parts` linkage                                 | Hold and stage stock for demand (work order, custom build kit)                  | No over-reservation; allocation must reference active reservation and target demand |
| Movement Ledger Aggregate          | `inventory.inventory_ledger_entries`                                                                       | Immutable record for receipt/reserve/release/issue/transfer/adjust/reversal     | Append-only only; every mutable balance change must map to one ledger entry         |
| Receiving Aggregate                | PO linkage (`purchase_order_id`, `line_id` in source doc fields) + lot creation/balance updates            | Transform PO line receipts to inventory movements and lot updates               | Cannot receive against invalid PO state; cannot over-receive line                   |
| Cycle Count Aggregate              | new `inventory.cycle_count_sessions`, `inventory.cycle_count_lines`                                        | Reconcile physical count vs system count with controlled adjustments            | Reconcile once per line per session; adjustments require reason code                |

---

## 2) Command/query responsibilities (CQRS-lite)

### Command responsibilities (mutations)

- Create/update part catalog, substitutions, UOM conversion rules.
- Receive stock (PO-linked or ad-hoc).
- Reserve, allocate, release, and consume inventory for work orders.
- Transfer stock between locations/bins.
- Post positive/negative adjustments with reason codes.
- Start/complete cycle counts and apply reconciliation adjustments.
- Write audit record + outbox event + observability metrics/traces for every successful mutation.

### Query responsibilities (reads)

- Available quantity by part/location/bin/lot.
- Reservation and allocation status by work order/custom build.
- Ledger history by part/location/date/correlation id.
- Open shortages, low-stock thresholds, and cycle count variance.
- PO receipt progress and inventory linkage visibility.

### Service/repository split (justified)

- **Services:** enforce invariants, orchestration, and side effects (audit/event/telemetry).
- **Repository:** transactional persistence and query composition across balances/reservations/ledger.
- **Query projections:** separate read models when query volume/shape diverges from write model.

---

## 3) Inventory state model (on-hand, reserved, allocated, consumed)

### Canonical quantity definitions

- **On-hand:** physical quantity currently in inventory scope (location/bin/lot).
- **Reserved:** held for demand, not generally available to new reservations.
- **Allocated:** reserved quantity that has been picked/staged to a specific job/kit.
- **Consumed:** quantity issued to work order operation (leaves available inventory and is reflected in work-order actuals).

### Derived availability

- If `reserved` includes allocated quantities (recommended MVP posture):  
  `available = on_hand - reserved`.
- If `reserved` and `allocated` are stored independently in read models:  
  `available = on_hand - reserved - allocated`.

MVP implementation detail: allocation may be persisted via reservation status metadata initially, but API contracts must expose `allocated` explicitly so custom-build kit workflows remain deterministic.

### State transition matrix

| Operation               | On-hand delta | Reserved delta | Allocated delta | Consumed delta | Ledger movement_type                     |
| ----------------------- | ------------: | -------------: | --------------: | -------------: | ---------------------------------------- |
| Receive lot             |            +Q |              0 |               0 |              0 | `RECEIPT`                                |
| Reserve                 |             0 |             +Q |               0 |              0 | `RESERVATION`                            |
| Allocate (pick/stage)   |             0 |             -Q |              +Q |              0 | `RESERVATION` (with allocation metadata) |
| Release reservation     |             0 |             -Q |               0 |              0 | `RELEASE`                                |
| De-allocate             |             0 |             +Q |              -Q |              0 | `RELEASE` (with deallocation reason)     |
| Consume from allocation |            -Q |              0 |              -Q |             +Q | `ISSUE`                                  |
| Transfer out            |   -Q (source) |              0 |               0 |              0 | `TRANSFER_OUT`                           |
| Transfer in             |     +Q (dest) |              0 |               0 |              0 | `TRANSFER_IN`                            |
| Adjustment up/down      |          +/-Q |              0 |               0 |              0 | `ADJUSTMENT`                             |
| Cycle count reconcile   |          +/-Q |              0 |               0 |              0 | `ADJUSTMENT` (reason: cycle_count)       |

---

## 4) REST endpoint catalog (MVP contract)

All mutating endpoints require `correlationId` and actor context, and should accept idempotency keys for retry-safe operations.

| Method | Path                                                         | Request (summary)                                               | Response (summary)                            | Failure cases                                                                             |
| ------ | ------------------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| POST   | `/inventory/parts`                                           | `sku,name,baseUom,reorderPoint`                                 | Part record                                   | duplicate SKU; invalid UOM; reorderPoint < 0                                              |
| PATCH  | `/inventory/parts/:id`                                       | mutable part fields                                             | Updated part                                  | part not found; discontinued update violation                                             |
| POST   | `/inventory/parts/:id/substitutes`                           | `substitutePartId,priority,effectiveFrom`                       | Substitute link                               | self-substitution; inactive substitute; duplicate active rule                             |
| GET    | `/inventory/parts/:id/substitutes`                           | filter optional                                                 | list of substitutes                           | part not found                                                                            |
| POST   | `/inventory/parts/:id/uom-conversions`                       | `fromUom,toUom,factor,roundingMode`                             | conversion rule                               | duplicate conversion pair; invalid factor (`<= 0`); unsupported UOM                       |
| GET    | `/inventory/parts/:id/uom-conversions`                       | optional status filter                                          | conversion rules                              | part not found                                                                            |
| POST   | `/inventory/locations`                                       | `locationCode,type,parentId,isPickable`                         | Location                                      | duplicate code; invalid parent; invalid type                                              |
| POST   | `/inventory/bins`                                            | `locationId,binCode,state`                                      | Bin                                           | location inactive; duplicate bin code in location                                         |
| GET    | `/inventory/balances`                                        | filters (`partId,locationId,binId`)                             | quantity state rows                           | invalid filter combination                                                                |
| GET    | `/inventory/ledger`                                          | filters (`partId,locationId,from,to,correlationId`)             | paged ledger entries                          | invalid date range; page cursor invalid                                                   |
| POST   | `/inventory/receipts`                                        | `partId,locationId,binId,qty,uom,sourceDocument`                | receipt result + created lot/balance          | qty <= 0; UOM conversion missing; PO line over-receipt; closed bin                        |
| POST   | `/inventory/reservations`                                    | `partId,workOrderId,qty,lotId?`                                 | reservation record                            | insufficient available; invalid work order state; lot not reservable                      |
| POST   | `/inventory/allocations`                                     | `reservationId,qty,targetType,targetId`                         | allocation result                             | reservation inactive; over-allocation; target mismatch                                    |
| POST   | `/inventory/consumptions`                                    | `allocationId or reservationId, qty, workOrderId, operationId?` | consumption posting + updated balances        | qty <= 0; exceeds alloc/reserved; work order not in consumable state                      |
| POST   | `/inventory/releases`                                        | `reservationId,qty,reasonCode`                                  | release result                                | release exceeds held qty; reservation already consumed/expired                            |
| POST   | `/inventory/transfers`                                       | `partId,fromLocation/bin,toLocation/bin,qty,lotId?`             | transfer transaction id                       | source shortage; non-pickable destination; cross-site rule violation                      |
| POST   | `/inventory/adjustments`                                     | `partId,location/bin,qtyDelta,reasonCode,note`                  | adjustment transaction id                     | missing reason; negative resulting on-hand; protected stock state                         |
| POST   | `/inventory/cycle-count-sessions`                            | `locationId,scope`                                              | session id/status                             | active open session exists for same scope                                                 |
| POST   | `/inventory/cycle-count-sessions/:id/reconcile`              | counted lines and discrepancy reasons                           | reconciliation summary                        | line already reconciled; unauthorized override; mismatch above threshold without approval |
| GET    | `/inventory/work-orders/:workOrderId/material-status`        | none                                                            | requested/reserved/allocated/consumed by line | work order missing                                                                        |
| GET    | `/inventory/purchase-orders/:purchaseOrderId/receipt-status` | none                                                            | ordered/received/remaining + inventory links  | PO missing; unauthorized visibility                                                       |

---

## 5) Event catalog

| Event name                               | Producer                       | Payload contract summary                                   | Typical consumers                              |
| ---------------------------------------- | ------------------------------ | ---------------------------------------------------------- | ---------------------------------------------- |
| `part.sku.created`                       | Inventory catalog service      | `partId,sku,uom,state`                                     | Procurement, planning, reporting               |
| `part.sku.updated`                       | Inventory catalog service      | `partId,changedFields`                                     | Procurement, planning                          |
| `inventory.part_substitution_configured` | Inventory catalog service      | `partId,substitutePartId,priority,effectiveWindow`         | Reservation/allocation policy engine, planning |
| `inventory.part_substitution_used`       | Allocation/consumption service | `partId,substitutePartId,workOrderId,qty`                  | Work-order traceability, planning analytics    |
| `inventory.lot.received`                 | Receiving service              | `lotId,partId,locationId,binId,qty,sourceDocument`         | Availability projection, quality workflows     |
| `inventory.lot.reserved`                 | Reservation service            | `reservationId,partId,workOrderId,qty`                     | Work-order readiness, blocked-alert projection |
| `inventory.reservation_allocated`        | Allocation service             | `reservationId,targetType,targetId,qty`                    | Picking UI, work-order material status         |
| `inventory.lot.released`                 | Reservation service            | `reservationId,qty,reasonCode`                             | Readiness projections                          |
| `inventory.lot.consumed`                 | Consumption service            | `workOrderId,operationId,partId,qty`                       | Work-order costing, accounting integration     |
| `inventory.shortage_detected`            | Reservation/allocation service | `partId,locationId,requested,available,demandRef`          | Planning, manager alerts, procurement          |
| `inventory.transfer_completed`           | Transfer service               | `partId,from,to,qty,lotId?`                                | Location dashboards, variance analytics        |
| `inventory.adjustment_recorded`          | Adjustment service             | `partId,locationId,qtyDelta,reasonCode`                    | Finance controls, audit reporting              |
| `inventory.cycle_count_completed`        | Cycle count service            | `sessionId,locationId,varianceCount,netQtyDelta`           | Controls dashboard, ops leadership             |
| `purchase_order.partially_received`      | Procurement service            | `purchaseOrderId,lineSummaries`                            | Inventory receiving queue                      |
| `purchase_order.received`                | Procurement service            | `purchaseOrderId,lineSummaries`                            | Inventory receipt closure, AP workflow         |
| `inventory.ledger_entry_recorded`        | Ledger writer (outbox)         | `ledgerEntryId,movementType,partId,qtyDelta,correlationId` | Observability/audit pipeline                   |
| `inventory.uom_conversion_applied`       | Receipt/reserve/consume flows  | `partId,fromUom,toUom,inputQty,normalizedQty`              | Audit analytics, reconciliation                |

---

## 6) Validation rules matrix

| Rule ID     | Rule                                                                                  | Enforced in                      | Failure code/message expectation                          |
| ----------- | ------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------- |
| INV-VAL-001 | SKU must be unique and non-empty                                                      | Part catalog command service     | `INVARIANT_VIOLATION` (`SKU is required` / duplicate SKU) |
| INV-VAL-002 | Substitution cannot reference inactive/discontinued part                              | Part substitution command        | `INVARIANT_VIOLATION`                                     |
| INV-VAL-003 | UOM conversion must exist when request UOM != base UOM                                | Receipt/reserve/consume commands | `INVARIANT_VIOLATION` (`UOM conversion missing`)          |
| INV-VAL-004 | Bin must belong to active location and support picking/receiving mode                 | Receipt/transfer commands        | `INVARIANT_VIOLATION`                                     |
| INV-VAL-005 | `reserved + allocated` cannot exceed on-hand                                          | Reserve/allocate commands        | `INVARIANT_VIOLATION` (`Insufficient inventory`)          |
| INV-VAL-006 | Consumption cannot exceed allocated (or reserved for MVP fallback)                    | Consume command                  | `INVARIANT_VIOLATION`                                     |
| INV-VAL-007 | Transfers require source availability and valid destination                           | Transfer command                 | `INVARIANT_VIOLATION`                                     |
| INV-VAL-008 | Adjustment must include reason code and authorization for high-impact deltas          | Adjustment command               | `INVARIANT_VIOLATION` / authorization failure             |
| INV-VAL-009 | Cycle count reconciliation above tolerance requires supervisor override               | Cycle count reconcile            | domain + auth failure                                     |
| INV-VAL-010 | PO-linked receipt cannot exceed ordered quantity                                      | Receiving command (PO-linked)    | `INVARIANT_VIOLATION`                                     |
| INV-VAL-011 | Work-order consumption allowed only for active/released/in-progress work order states | Consumption command              | `INVARIANT_VIOLATION`                                     |
| INV-VAL-012 | Ledger reversals must reference prior entry and cannot mutate original                | Ledger writer                    | DB check + domain error                                   |

---

## 7) Custom-build and partial-kit edge case matrix

| Scenario                                                  | Risk                                     | Required system behavior                                                              | Audit/Event requirement                                                                   |
| --------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Custom BOM revision released after parts already reserved | wrong material issued                    | keep reservation tied to BOM revision; force revalidation/reallocation before consume | audit `inventory.reservation.revalidated`; emit `inventory.shortage_detected` if mismatch |
| Partial kit available (only subset of required lines)     | work starts with hidden shortages        | allow `PARTIAL` kit state; block operation start unless policy allows partial start   | emit `inventory.shortage_detected`; audit policy override actor                           |
| Alternate part used for custom build                      | unauthorized substitution                | require explicit substitute mapping + approval role                                   | emit `inventory.part_substitution_used`; audit substitution rationale                     |
| Mixed-UOM kit lines (EA vs BOX)                           | over/under issue due conversion          | convert to base UOM before reserve/consume; persist source UOM in ledger metadata     | emit `inventory.uom_conversion_applied` (extension event)                                 |
| Kit deallocation after work-order cancellation            | stranded staged parts                    | move allocated -> reserved or available based on policy; maintain full ledger trail   | emit `inventory.lot.released` and audit cancellation linkage                              |
| Split lot fulfillment across multiple partial kits        | hidden lot traceability loss             | keep lot-level allocation references per kit line                                     | emit per-allocation event with lot id                                                     |
| Over-consumption due scrap/rework                         | negative available or unplanned variance | require adjustment/extra consumption reason with supervisor gate above threshold      | emit `inventory.adjustment_recorded`; audit high-impact delta                             |
| PO partial receipt for kit-critical part                  | schedule churn                           | keep expected remainder and expose ETA in material-status query                       | emit `purchase_order.partially_received`; optionally `inventory.shortage_detected`        |
| Cycle count discovers staged-kit variance                 | accounting + production mismatch         | freeze new allocations for affected part/location until variance resolved             | emit `inventory.cycle_count_completed`; audit freeze/unfreeze actions                     |
| Return unused custom-build components                     | inventory drift if ignored               | support return movement (`RETURN`) to bin/lot with condition code                     | ledger entry + `inventory.adjustment_recorded`/return event                               |

---

## 8) Explicit audit / event / observability mapping

| Command                           | Audit point (existing/new)                                              | Events                                                                                                               | Observability hooks                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Create/update part & substitution | existing `inventory.reserve` (MVP), add `inventory.part_catalog_change` | `part.sku.created/updated`, `inventory.part_substitution_configured`                                                 | metric `inventory.part_catalog.mutation`, trace `inventory.part_catalog.command`, logInfo on success    |
| Receive inventory                 | add `inventory.receipt.record`                                          | `inventory.lot.received`, `inventory.ledger_entry_recorded`                                                          | metric `inventory.receipt.success/fail`, trace `inventory.receipt.command`                              |
| Reserve/allocate/release          | existing `inventory.reserve`, add `inventory.allocate`                  | `inventory.lot.reserved`, `inventory.reservation_allocated`, `inventory.lot.released`, `inventory.shortage_detected` | metric `inventory.reserve.success`, `inventory.reserve.shortage`, trace `inventory.reservation.command` |
| Consume to work order             | add `inventory.consume`                                                 | `inventory.lot.consumed`, `inventory.ledger_entry_recorded`                                                          | metric `inventory.consume.success/fail`, trace `inventory.consume.command`                              |
| Transfer                          | add `inventory.transfer`                                                | `inventory.transfer_completed`, `inventory.ledger_entry_recorded`                                                    | metric `inventory.transfer.success/fail`, trace `inventory.transfer.command`                            |
| Adjustment                        | add `inventory.adjustment`                                              | `inventory.adjustment_recorded`, `inventory.ledger_entry_recorded`                                                   | metric `inventory.adjustment.count`, alert on absolute delta threshold                                  |
| Cycle count reconcile             | add `inventory.cycle_count.reconcile`                                   | `inventory.cycle_count_completed`, `inventory.adjustment_recorded`                                                   | metric `inventory.cycle_count.variance_rate`, trace `inventory.cycle_count.reconcile`                   |
| PO-linked receipt closure         | existing `purchase_order.state_change` + `inventory.receipt.record`     | `purchase_order.partially_received/received`, `inventory.lot.received`                                               | metric `procurement.receipt.latency`, trace correlation from PO -> receipt                              |

---

## 9) Exact files to create/modify for implementation

> This todo only delivers architecture design. No migrations or service implementation are performed here.

### Modify (existing)

- `packages/domain/src/model/inventory.ts`
  - add part substitution + UOM conversion domain contracts, explicit allocation state semantics.
- `packages/domain/src/model/procurement.ts`
  - add explicit PO-to-inventory receipt linkage contract metadata.
- `packages/domain/src/events.ts`
  - add inventory transfer/adjustment/cycle-count/allocation event names.
- `packages/domain/src/model/apiOperations.ts`
  - register new inventory API operations for query and mutation coverage.
- `apps/api/src/contexts/inventory/inventory.repository.ts`
  - add query/mutation methods for balances, reservations, ledger, transfers, counts.
- `apps/api/src/contexts/inventory/inventory.service.ts`
  - enforce state/invariant logic for reserve/allocate/consume/release/adjust/transfer.
- `apps/api/src/contexts/inventory/inventory.routes.ts`
  - expose command/query route interface additions.
- `apps/api/src/contexts/inventory/procurement.service.ts`
  - ensure PO receipt flow emits inventory-facing linkage metadata.
- `apps/api/src/contexts/inventory/procurement.routes.ts`
  - expose PO receipt-status queries needed by inventory users.
- `apps/api/src/audit/auditPoints.ts`
  - add specific audit actions (`inventory.transfer`, `inventory.adjustment`, etc.).
- `apps/api/src/index.ts`
  - wire new inventory query and cycle-count route modules into runtime.
- `apps/api/src/tests/inventory-failure-cases.test.ts`
  - expand coverage for adjustment/transfer/allocation/cycle-count failures.
- `apps/api/src/tests/context-failure-cases.test.ts`
  - cross-context failure coverage (PO linkage, outbox failure, shortage branch).

### Create (new)

- `packages/domain/src/model/inventoryMovements.ts`
  - movement contract types for transfer/adjustment/cycle-count/consumption input validation.
- `apps/api/src/contexts/inventory/inventory.query.ts`
  - dedicated query service for balances, ledger, material status, PO receipt-status.
- `apps/api/src/contexts/inventory/cycleCount.service.ts`
  - cycle-count session/reconcile command logic.
- `apps/api/src/contexts/inventory/cycleCount.routes.ts`
  - route contract for cycle-count flows.
- `apps/api/src/tests/inventory-cycle-count-failure-cases.test.ts`
  - reconciliation threshold and authorization failure tests.
- `apps/api/src/tests/inventory-ledger-contract.test.ts`
  - append-only and movement-to-balance consistency tests.

### Migration planning note (deferred, not part of this todo)

- Future additive migration likely required for substitutions/UOM conversion and cycle-count tables under `apps/api/src/migrations/`.

---

## 10) MVP rollout sequencing (implementation guidance)

1. Inventory query surface (`inventory.query.ts`) + ledger/balance reads.
2. Reservation/allocation/consumption semantics with explicit allocation state.
3. Transfers and adjustments with full audit/event mapping.
4. Cycle count sessions and reconciliation controls.
5. Substitutions + custom-build partial-kit policy enforcement.

This sequence keeps MVP small while leaving clear extension points for richer manufacturing workflows.
