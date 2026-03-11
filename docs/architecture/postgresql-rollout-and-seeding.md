# PostgreSQL Rollout and Seeding Plan (Aurora PostgreSQL Serverless v2)

This document defines an MVP-simple rollout sequence for the existing migration chain (`0001_initial_schema.sql` → `0002_canonical_erp_domain.sql`), recommended seed data, and growth-management guidance for high-write tables.

## Goals

1. Keep production cutovers predictable and recoverable.
2. Seed only the minimum reference data required for safe operations.
3. Delay heavy data-engineering mechanics (broad partitioning, complex archival pipelines) until objective thresholds are met.

## Assumptions

1. Aurora PostgreSQL Serverless v2 is the system of record (single writer, one tenant in MVP).
2. `0002_canonical_erp_domain.sql` is authoritative and currently replaces `0001` placeholder tables.
3. Seed logic must be idempotent (`INSERT ... ON CONFLICT DO NOTHING/UPDATE`) and rerunnable.
4. Production rollback priority is data safety over fast in-place reversal.
5. Most high-volume tables are append-only or status-append patterns (ledger, outbox, audit, event inbox).

---

## 1) Migration sequencing plan (bootstrap → canonical → onward)

### Recommended sequence

| Stage | Artifact(s) | Execution intent | Engineering rationale |
|---|---|---|---|
| Stage 0: preflight | release checklist + DB snapshot | Validate ownership, migration lock strategy, backup readiness | Prevents ambiguous ownership/race conditions during DDL rollout |
| Stage 1: bootstrap | `0001_initial_schema.sql` | Create baseline schemas/tables for first environment bootstrap only | Keeps migration history complete and reproducible from an empty cluster |
| Stage 2: canonical | `0002_canonical_erp_domain.sql` | Install canonical domain model and append-only controls | Aligns runtime schema with architecture docs and domain boundaries |
| Stage 3: seed reference data | `0003_seed_reference_data.sql` (recommended next migration) | Insert minimal roles, permissions, locations, and planning defaults | Enables immediate operability without leaking environment-specific fixtures |
| Stage 4+: additive evolution | `0004_*.sql` onward | Expand/migrate/contract changes only | Enables safer zero/low-downtime schema evolution as live data volume grows |

### Important note on `0002`

`0002_canonical_erp_domain.sql` drops placeholder tables from `0001` before creating canonical tables.  
That is acceptable for:
- fresh environments, or
- controlled cutovers where placeholder data is intentionally disposable.

For any environment carrying meaningful data in `0001` tables, do **not** run `0002` as-is during business hours. Use a cutover window with export/transform/import (or introduce bridging migrations) before promoting traffic.

### Onward migration pattern (post-canonical)

Use **expand → migrate → contract** for every non-trivial change:

1. **Expand**: add nullable columns/new tables/indexes, no destructive actions.
2. **Migrate**: backfill in batches with checkpoints and idempotent writes.
3. **Contract**: drop old columns/tables only after application cutover and verification.

This pattern minimizes lock risk and keeps Aurora Serverless v2 ACU scaling behavior predictable.

---

## 2) Safe deployment order, rollback notes, and failure handling

### Safe deployment order

1. **Scale for change window**: temporarily raise Aurora Serverless v2 minimum ACU to reduce cold scaling during migration.
2. **Quiesce writers**: disable worker consumers and put API writes into maintenance/read-only mode.
3. **Take a cluster snapshot** (or confirm PITR window and restore runbook).
4. **Run migrations through a single migrator** with lock/statement timeouts configured.
5. **Run verification queries** (table existence, constraints, critical index existence, seed cardinality).
6. **Run idempotent seed script** after schema success.
7. **Re-enable workers first**, then API writes, then full traffic.
8. **Observe for one release window** (error rate, lock waits, queue depth, publish retry growth).

### Rollback approach

| Failure point | Rollback action | Why |
|---|---|---|
| Migration fails before commit | Let transaction roll back; fix and rerun | PostgreSQL transactional DDL protects consistency |
| Migration committed but app fails | Roll back app first; if schema incompatibility is severe, restore from snapshot/PITR | Safer than hand-written destructive down migrations |
| Seed failure after schema success | Fix seed script and rerun idempotently | Seed data should be additive and conflict-safe |

**Policy recommendation:** treat snapshot/PITR restore as the primary rollback mechanism for destructive schema steps.  
For post-`0002` additive migrations, prefer forward-fix migrations over emergency down scripts.

### Failure-case handling matrix

| Failure case | Detection signal | Immediate handling |
|---|---|---|
| Concurrent migrator execution | lock wait timeout / duplicate migration attempt | enforce single migrator + advisory lock |
| Long DDL lock contention | elevated `lock_timeout` errors | abort, quiesce additional writers, rerun in tighter window |
| Seed FK dependency violation | seed statement failure on FK | enforce seed order (roles → permissions → mappings → locations → planning defaults) |
| Partial data backfill after schema cutover | row-count mismatches or checksum mismatch | pause traffic promotion; rerun idempotent batch from checkpoint |
| App/schema version skew | startup query failures / missing relation errors | gate rollout on schema version check before serving writes |
| Event backlog spike post-deploy | rapid growth in `events.outbox_events` + retries | throttle producers, scale workers, inspect publish errors before reopening full traffic |

---

## 3) Seed data suggestions (MVP)

### Seeding principles

1. Seed **reference data only**, not demo transactions.
2. Use deterministic natural keys (`role_code`, `permission_code`, `location_code`, `publication_key`) for idempotency.
3. Keep one seed migration for baseline data; environment-specific records belong in separate operational runbooks.

### A. Roles and permissions

Suggested baseline roles (`identity.roles`):
- `ERP_ADMIN`
- `SHOP_MANAGER`
- `DISPATCH_PLANNER`
- `TECHNICIAN`
- `PARTS_COORDINATOR`
- `TRAINING_COORDINATOR`
- `ACCOUNTING_OPERATOR`
- `INTEGRATION_OPERATOR`

Suggested baseline permissions (`identity.permissions`), grouped by bounded context:
- Identity: `identity.users.read`, `identity.users.manage_roles`
- Work orders: `work_orders.read`, `work_orders.write`, `work_orders.assign`
- Inventory: `inventory.read`, `inventory.reserve`, `inventory.adjust`
- Planning: `planning.read`, `planning.run`, `planning.publish`
- SOP/OJT: `sop_ojt.read`, `sop_ojt.assign_training`, `sop_ojt.manage_content`
- Integrations: `integrations.read`, `integrations.manage`
- Audit/Ops: `audit.read`, `ops.retry_dead_letter`

Map these through `identity.role_permissions` with least privilege defaults, then grant emergency breadth only to `ERP_ADMIN`.

### B. Status seeds

Most statuses in the canonical schema are enforced via `CHECK` constraints (not lookup tables).  
For MVP, keep this model and avoid introducing status catalog tables yet.

Recommended approach:
1. Treat DDL constraints as the canonical status list.
2. Seed only **workflow defaults** where rows must exist at startup (for example initial planning scenario/publication records).
3. Keep transition logic in application/domain policy, not in mutable DB seed rows.

Tradeoff: this is simpler and safer now, but less configurable for non-engineering operators until a phase-2 policy model is added.

### C. Location seeds (`inventory.stock_locations`)

Minimum viable location topology:

| location_code | location_type | Purpose |
|---|---|---|
| `HQ-WH` | `WAREHOUSE` | primary pick/stock location |
| `HQ-STAGE` | `STAGING` | receiving/inspection staging |
| `HQ-BAY-01` | `BAY` | execution bay 1 |
| `HQ-BAY-02` | `BAY` | execution bay 2 |

Seed at least one pickable warehouse and one bay so work orders, reservations, and planning FKs have valid targets on day one.

### D. Planning defaults (`planning.*`)

Seed set:
1. `planning.planning_scenarios` with `scenario_name='MVP_BASELINE'`, `scenario_status='ACTIVE'`.
2. `planning.planning_constraints` for core rules (example keys: `SKILL_REQUIRED`, `DUE_DATE_WEIGHT`, `MAX_SHIFT_MINUTES`).
3. Optional `planning.plan_publications` bootstrap row with `publication_key='ACTIVE_MVP_SCHEDULE'`, `publication_status='DRAFT'`.

Do **not** pre-seed large `capacity_slots` horizons in SQL migrations; generate rolling slots operationally (e.g., 14-day horizon job) to keep seeds fast and environment-aware.

---

## 4) Fastest-growth tables and archive/partition guidance

### Likely fastest-growth tables

| Table | Why it grows quickly | MVP archive/partition stance |
|---|---|---|
| `events.outbox_events` | one row per publishable domain mutation | retain hot recent data; archive published rows by age |
| `events.outbox_publish_attempts` | one-to-many retry amplification per outbox event | first candidate for monthly partitioning by `attempted_at` |
| `audit.audit_events` + `audit.entity_change_sets` + `audit.access_audit_events` | every write (and some reads/exports) produces audit records | keep append-only; archive by compliance policy, consider range partition by `created_at` |
| `inventory.inventory_ledger_entries` | every stock movement/reservation/issue/reversal is immutable | high-value history; archive cautiously, partition by `created_at` once volume justifies |
| `events.event_consumer_inbox` + `integrations.webhook_inbox_events` + `integrations.sync_job_items` | external event traffic + retries + partial failures | keep only operationally relevant horizon in primary, archive old payload-heavy rows |
| `work_orders.work_order_status_history` + `sop_ojt.training_progress_events` | lifecycle transitions and training event streams | append-only; lower growth than outbox/audit but still steady |

### Partitioning and archival thresholds (MVP-simple)

Start without partitioning unless there is measurable pain. Introduce partitioning when one or more are true:
- single table exceeds ~10M rows,
- table/index size causes sustained p95 read/write regression,
- vacuum/maintenance windows become operationally noisy.

When thresholds are crossed:
1. Use **native range partitioning by time** (`created_at`/`occurred_at`/`attempted_at`) with monthly partitions.
2. Keep active partition count limited (for example 12–24) to avoid planner overhead on Serverless v2.
3. Archive aged partitions/rows to S3 (Parquet/JSON) before purge if audit/compliance requires long retention.

This preserves MVP simplicity while giving a clear path to scale.

---

## 5) Explicit tradeoffs

1. **Keep `0002` destructive behavior for MVP speed** vs. requiring stricter cutover discipline in any data-bearing environment.
2. **Use DDL-enforced statuses only** vs. having admin-editable status catalogs.
3. **Delay broad partitioning** vs. accepting a future migration project once growth thresholds are reached.
4. **Prefer snapshot/PITR rollback** vs. maintaining complex down-migration scripts for every release.
5. **Seed minimal operational references** vs. richer out-of-the-box demo data.

These tradeoffs are intentional to optimize early delivery while preserving a safe, explicit hardening path.
