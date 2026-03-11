# Inventory Database Schema (Aurora PostgreSQL Serverless v2)

This document summarizes the additive inventory schema scaffolding delivered in `apps/api/src/migrations/0004_inventory_module_scaffold.sql`.

## Migration ordering

Inventory schema objects must be applied in this sequence:

1. `0001_initial_schema.sql` (bootstrap schemas)
2. `0002_canonical_erp_domain.sql` (canonical ERP tables + append-only trigger function)
3. `0003_identity_authn_authz_rbac.sql` (identity scope extensions referenced by actor FKs)
4. `0004_inventory_module_scaffold.sql` (inventory module additions in this document)

`0004` is additive-only: no prior migration files are rewritten.

## Inventory table inventory

### Extended existing tables

| Table | Additions in `0004` | Why |
|---|---|---|
| `inventory.parts` | catalog metadata (`manufacturer_*`, `part_category`, `is_stocked`), UOM FK columns (`stock_uom_id`, `purchase_uom_id`), `default_vendor_id` | Strengthens parts catalog and introduces canonical UOM + vendor linkages |
| `inventory.stock_lots` | `stock_bin_id`, `origin_purchase_order_line_id`, `received_uom_id` | Adds bin-level traceability and PO/receipt provenance |
| `inventory.inventory_reservations` | `stock_bin_id`, `work_order_operation_id`, `allocated_quantity` | Adds bin-aware allocation and work-operation reservation linkage |
| `inventory.inventory_balances` | `quantity_allocated`, `quantity_consumed` | Supports on-hand/reserved/allocated/consumed quantity model |
| `inventory.inventory_ledger_entries` | `stock_bin_id`, work-order linkage columns, purchase-order linkage columns, `ledger_metadata`, `effective_at` | Expands immutable ledger context without changing append-only behavior |

### New reference/master tables

| Table | Purpose |
|---|---|
| `inventory.units_of_measure` | Canonical UOM dictionary with soft-delete + versioning |
| `inventory.unit_of_measure_conversions` | Global and part-specific UOM conversion factors |
| `inventory.part_substitutions` | Alternate/substitute/supersession relationships between parts |
| `inventory.stock_bins` | Bin/sub-location layer beneath `stock_locations` |
| `inventory.vendors` | Supplier catalog for procurement linkage |

### New transactional/operational tables

| Table | Purpose |
|---|---|
| `inventory.purchase_orders` | PO header lifecycle (`DRAFT` → `RECEIVED`/`CANCELLED`) |
| `inventory.purchase_order_lines` | PO line-level ordered/received/rejected tracking |
| `inventory.receiving_transactions` | Inbound receiving documents linked to PO/location/bin |
| `inventory.receiving_transaction_lines` | Received quantities, quality outcomes, and linked ledger entry |
| `inventory.inventory_adjustments` | Inventory adjustment document header |
| `inventory.inventory_adjustment_lines` | Per-line quantity deltas with ledger linkage |
| `inventory.inventory_transfers` | Transfer document for source/destination location/bin movement |
| `inventory.inventory_transfer_lines` | Per-line transfer shipment/receipt + transfer-in/out ledger linkage |
| `inventory.cycle_counts` | Cycle count header and status workflow |
| `inventory.cycle_count_lines` | Expected vs counted variance lines, optionally tied to adjustment lines |
| `inventory.inventory_bin_balances` | Bin-level projected balance snapshot (on-hand/reserved/allocated/consumed) |
| `inventory.work_order_consumptions` | Append-only work order consumption records tied to immutable ledger entries |

## FK strategy rationale

- **Strict inventory integrity (default RESTRICT/NO ACTION):** core relationships (`part`, `location`, `bin`, `lot`, `uom`) use direct FKs so inventory rows cannot drift from master data.
- **Historical survivability (`ON DELETE SET NULL`) for contextual links:** optional links from transactional rows to work-order operations, PO lines, and lots are nullable to preserve records when upstream entities are retired/purged.
- **Cascade on local child rows only:** header/line table pairs (`purchase_orders`→`purchase_order_lines`, `receiving_transactions`→`receiving_transaction_lines`, etc.) cascade delete only inside the same bounded document aggregate.

## Index strategy rationale

- **Soft-delete-safe uniqueness:** partial unique indexes on active reference tables (UOM code, vendor code, bin code per location, approved active substitutions) preserve business-key reuse after archival.
- **Operational queue access:** composite status/time indexes on receiving, transfers, adjustments, cycle counts, and POs support list/poll endpoints and workflow processing.
- **Dimensional stock reads:** indexes on `(part, location, bin, status)` style dimensions support availability/reservation queries without replaying entire ledgers.
- **Ledger timeline + source lookups:** new ledger indexes for work-order/PO/bin/source-document/effective-time allow practical API reads and audit traces while keeping the ledger append-only.

## Immutability + concurrency controls

- `inventory.inventory_ledger_entries` immutability is explicitly re-enforced via `trg_inventory_ledger_entries_immutable`.
- `inventory.work_order_consumptions` is append-only via `trg_work_order_consumptions_immutable`.
- Mutable tables introduced in `0004` include `version` columns for optimistic locking where concurrent updates are expected.
- Soft deletes are used on mutable reference data (`units_of_measure`, `stock_bins`, `vendors`, `part_substitutions`) and avoided on transactional/event-like tables.
