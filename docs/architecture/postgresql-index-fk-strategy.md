# PostgreSQL Index + Foreign-Key Strategy (Canonical ERP DDL)

This strategy is derived from the canonical migration DDL in `apps/api/src/migrations/0002_canonical_erp_domain.sql` (with `0001` treated as replaced bootstrap).  
Current baseline from that migration:

- **73 explicit secondary indexes**
- **152 foreign keys**
  - **122 default `NO ACTION`** (use as RESTRICT-like integrity guardrails)
  - **20 `ON DELETE CASCADE`**
  - **10 `ON DELETE SET NULL`**

## 1) Index strategy by domain and access pattern

## Cross-cutting index rules

1. **Point lookups:** rely on PK indexes (`id` UUID) plus natural-key unique indexes where business identity exists.
2. **Status queues:** use composite indexes anchored on status + scheduling/created time for polling workers.
3. **Time-range scans:** use `(entity_id, created_at)` or `(status, created_at)` patterns for timeline/history reads.
4. **Soft-delete safety:** use **partial unique indexes** (`WHERE deleted_at IS NULL`) so archived rows do not block reuse.
5. **Hot-path restraint:** avoid indexing every FK; only index keys used by known read/write paths to reduce write amplification.
6. **Idempotency/dedupe first:** preserve explicit unique indexes on dedupe keys in integration/events/ops flows.

### Domain matrix (indexes + justification/tradeoffs)

| Domain | Point lookup / uniqueness | Status queues + time scans | Partial/soft-delete indexes | Hot path + tradeoff |
|---|---|---|---|---|
| `identity` | `users_email_active_uk`, unique `cognito_subject`, `roles_code_active_uk`, `permissions_code_active_uk` | `users_status_idx`, `user_role_history_user_created_idx` | Active-only uniques on users/roles/permissions; `user_roles_active_uk` for one active assignment per user-role | Fast auth checks and role resolution; tradeoff is more index maintenance on frequently-updated assignment rows. |
| `hr` | `employees_number_active_uk`, `employee_skills_active_uk`, `employee_certifications_active_uk` | `employees_state_idx`, `employee_availability_employee_start_idx` | `employee_locations_primary_uk` (`is_primary and deleted_at is null`) | Keeps scheduling reads cheap for active employees; tradeoff is partial predicate complexity for planners. |
| `inventory` | `parts_sku_active_uk`, `stock_locations_code_active_uk`, lot/serial unique indexes, `inventory_balances_dimension_uk` | `inventory_reservations_status_idx`, `inventory_ledger_part_location_created_idx` | Active-only uniques for parts/locations; nullable-identity unique partials on lot/serial | Inventory reserve/consume is a core write path; index set is intentionally minimal on mutable balances to limit write amplification. |
| `work_orders` | `work_orders_number_uk`, `work_order_operations_sequence_uk` | `work_orders_status_due_idx`, `work_order_status_history_work_order_idx`, assignment/part status indexes | None (work-order tables are lifecycle-driven, not soft-deleted) | Prioritizes dispatch queues (`status`, `due_at`) and operation assignment lookups; tradeoff is potential sorting pressure if query order diverges from index order. |
| `planning` | `planning_constraints_scenario_key_uk`, `capacity_slots_dimension_uk`, `plan_publications_key_uk` | `planner_runs_scenario_status_idx`, `schedule_overrides_status_idx`, `plan_assignments_run_state_idx` | `planning_scenarios_name_active_uk`, `plan_publications_active_published_uk` | Supports planner-run queueing + single active publication invariant; tradeoff is extra write cost on publication status flips. |
| `sop_ojt` | `sop_documents_code_active_uk`, `sop_document_versions_unique_uk`, `training_modules_code_active_uk`, `operation_training_requirements_uk` | `training_assignments_employee_status_idx`, `training_progress_events_assignment_idx` | Active-only uniques on SOP documents/modules | Keeps training assignment and progress feeds responsive; tradeoff is extra maintenance on high event volume tables. |
| `integrations` | `integration_accounts_provider_key_active_uk`, dual uniques on `external_id_mappings`, dedupe unique on webhook provider event | `sync_jobs_account_status_idx`, `sync_job_items_job_status_idx`, `webhook_inbox_events_status_idx`, `integration_error_events_severity_idx` | Active-only unique for integration accounts | Designed for retry loops and dedupe correctness; tradeoff is high churn on status indexes during outage/retry storms. |
| `audit` + `ops` + `obs` | unique `idempotency_key`, unique `async_job_executions_job_key_uk`, unique `correlation_context.correlation_id` | `audit_events_entity_idx`, `access_audit_events_actor_created_idx`, async/dead-letter/idempotency status-time indexes | None (mostly append-only or operational state) | Optimized for forensic reads and worker polling; tradeoff is sustained btree growth on append-only streams. |
| `events` | `event_consumer_inbox_dedupe_uk`, `outbox_publish_attempts_unique_uk` | `outbox_events_status_available_idx`, `event_consumer_inbox_status_idx`, `event_replay_requests_status_idx` | None | Outbox/inbox reliability path depends on status+time polling; tradeoff is potential hotspot on `PENDING` pages under bursts. |

### Major index choices and tradeoffs

| Choice | Why | Tradeoff accepted | Mitigation |
|---|---|---|---|
| Partial active uniques for soft-deleted master data | Preserve business-key uniqueness only for live rows | Planner must evaluate predicates, and index cannot serve queries that ignore `deleted_at` filter | Require service queries on soft-delete tables to include active-row predicate; add full index only when proven necessary. |
| Status + timestamp queue indexes | Worker pull patterns are status-first with age ordering | Frequent status updates touch index pages heavily | Keep status vocabularies constrained and batch updates in small transactions. |
| Dedupe uniques for idempotency/inbox/webhooks | Prevent duplicate side effects during retries/replays | Conflicts can rise during burst retries | Handle conflicts as expected control flow (`ON CONFLICT DO NOTHING/UPDATE` in ingestion services). |
| Sparse FK indexing (not every FK column indexed) | Reduces write overhead on high-churn tables | Some rare join/debug queries may degrade | Add targeted indexes from observed plans, not pre-emptively. |
| Composite dimension uniques (`inventory_balances`, `capacity_slots`) | Enforces one logical state row per operational dimension | Wider keys increase index size | Keep columns narrow and avoid adding low-selectivity fields to these composites. |

## 2) Foreign-key strategy by domain

## FK action policy

| Action | Use when | Canonical examples | Why / tradeoff |
|---|---|---|---|
| `NO ACTION` (RESTRICT-like default) | Parent row is authoritative and should not be hard-deleted while referenced | Most references to `identity.users`, `inventory.parts`, `work_orders.work_orders` | Maximizes integrity; tradeoff is delete friction, intentionally pushing domains toward soft-delete and archival workflows. |
| `ON DELETE CASCADE` | Child rows are pure composition and have no standalone meaning | `work_order_operations -> work_orders`, `hr.employee_skills -> hr.employees`, `sync_job_items -> sync_jobs`, `entity_change_sets -> audit_events` | Prevents orphans and simplifies cleanup; tradeoff is potentially large delete fanout and lock scope during parent deletes. |
| `ON DELETE SET NULL` | Reference is contextual/history-oriented and record should survive parent removal | `inventory_reservations.work_order_id`, `inventory_ledger_entries.reservation_id`, `training_modules.sop_document_id`, `integration_error_events.sync_job_id` | Preserves forensic history; tradeoff is nullable foreign context requiring null-safe joins in reporting queries. |

### Domain FK strategy map

| Domain | Strategy | Rationale |
|---|---|---|
| Identity | Default `NO ACTION`; self-references retained | Security/audit lineage should not be silently deleted; account lifecycle should be deactivation-first, not hard-delete-first. |
| HR | Cascade on employee-owned children (`locations`, `skills`, `availability`, `certifications`) + `SET NULL` for optional user-account link | Operational employee profile cleanup should remove dependent rows, while identity-link detachment must preserve HR record continuity. |
| Work orders | Cascade from aggregate root (`work_orders`) to strict children, `SET NULL` on optional operation linkage in parts | Ensures aggregate consistency and prevents stranded operational rows; optional part-operation relationship can survive operation removal. |
| Inventory | Mostly `NO ACTION`; `SET NULL` where links are optional context (reservation/work-order traces) | Inventory truth should remain strict, but historical ledger/reservation entries should remain readable even when upstream work-order artifacts are removed. |
| Planning | Cascade for scenario/run-owned children; `SET NULL` for optional override back-link | Planner internals are compositional, while manual override history is valuable even if plan assignment is superseded/deleted. |
| SOP/OJT | Cascade on version/progress children; `SET NULL` on optional document relation in modules | Keeps revision/progress consistency while allowing module continuity across SOP retirement/restructure. |
| Integrations | Cascade on per-job child items; `SET NULL` on error-event references | Error history must survive account/job cleanup for post-mortems and SLA reporting. |
| Audit + Events + Ops | Cascade only where row is tightly bound to parent event (`entity_change_sets`, `outbox_publish_attempts`); otherwise `NO ACTION` | Forensic streams stay durable and relationally valid without over-coupling to mutable business objects. |

### Optional FK strategy for ingest resilience

Use optional/nullable FK relationships (or deliberate non-FK references) when ingestion must not fail due to timing gaps:

- `integrations.sync_job_items.entity_id` is nullable and not FK-constrained, allowing item tracking before canonical entity hydration.
- `integrations.external_id_mappings.entity_id` is intentionally generic (no FK) to support multi-entity mapping and phased backfills.
- `events.outbox_events.aggregate_id` and audit `entity_id` are text references (not FK) to avoid cross-context hard coupling.
- `SET NULL` relationships in reservations/ledger/errors preserve event history when upstream entities are rotated, archived, or purged.

Tradeoff: reduced strictness at write-time. Mitigate with reconciliation jobs and periodic orphan/context-gap reports.

## 3) Failure cases and mitigation

| Failure case | Why it happens | Mitigation |
|---|---|---|
| FK deadlocks during parent/child deletes or status transitions | Concurrent sessions touch the same parent/child sets in different order | Enforce consistent delete/update order in services, keep transactions short, favor soft deletes for high-fanout parents, batch hard deletes by key range. |
| Long-running index builds on large tables | Non-concurrent index builds take strong locks and can block writes | For future production migrations, use `CREATE INDEX CONCURRENTLY` in dedicated migrations; schedule heavy builds off-peak; monitor build progress before cutover. |
| Write amplification on high-churn tables | Each status/updated_at change rewrites multiple indexes | Keep queue-table indexes minimal and aligned to real query predicates; avoid duplicate/overlapping indexes; review index utility by `idx_scan`. |
| Lock contention on queue hot spots | Pollers and workers repeatedly touch same status pages/rows | Use deterministic ordering (`status`, `available_at`/`scheduled_at`), small batch claims, and application-level lease patterns to reduce row lock thrash. |
| Fanout cascade delete stalls | Cascading through many child rows can hold locks too long | Use archival + async cleanup jobs, delete in bounded batches, and prefer `SET NULL` where audit/history must be retained. |

## 4) Observability hooks

## Index health (usage + bloat candidates)

```sql
-- low-usage/high-size indexes: candidates for review
select
  schemaname,
  relname as table_name,
  indexrelname as index_name,
  idx_scan,
  pg_relation_size(indexrelid) as index_bytes
from pg_stat_user_indexes
where schemaname in ('identity','hr','inventory','work_orders','planning','sop_ojt','integrations','audit','ops','obs','events')
order by index_bytes desc, idx_scan asc;
```

```sql
-- optional deeper bloat inspection (if pgstattuple is enabled)
select * from pgstattuple('events.outbox_events_status_available_idx');
```

Operational threshold suggestion: alert when very large indexes have near-zero `idx_scan` over sustained windows.

## Slow-query pattern tracking

```sql
-- queue-pattern queries that should use status+time indexes
select
  calls,
  mean_exec_time,
  rows,
  query
from pg_stat_statements
where query ilike '%publish_status%'
   or query ilike '%job_status%'
   or query ilike '%processing_status%'
order by mean_exec_time desc
limit 50;
```

```sql
-- detect sequential scans on queue and history tables
select
  schemaname,
  relname,
  seq_scan,
  idx_scan
from pg_stat_user_tables
where schemaname in ('events','ops','integrations','work_orders','inventory')
order by seq_scan desc
limit 50;
```

## Deadlocks + lock contention metrics

```sql
select datname, deadlocks
from pg_stat_database
order by deadlocks desc;
```

```sql
select
  a.pid,
  a.usename,
  a.state,
  a.wait_event_type,
  a.wait_event,
  left(a.query, 200) as query
from pg_stat_activity a
where a.wait_event_type = 'Lock';
```

Also enable lock-wait/deadlock logging (`log_lock_waits`, `deadlock_timeout`) and tie alerts to queue throughput drops.

## 5) Practical migration guidance (forward-looking)

1. Keep default FK policy **RESTRICT/NO ACTION unless there is a clear lifecycle reason** for `CASCADE` or `SET NULL`.
2. Add indexes only for proven access paths (point lookup, queue poll, timeline scan, uniqueness/integrity).
3. Prefer partial indexes on soft-delete tables over full-table duplicates.
4. For large-table index additions, split migration and use concurrent build patterns.
5. Validate every new index/FK with:
   - expected query plan (`EXPLAIN (ANALYZE, BUFFERS)`)
   - write-path impact in load test
   - operational telemetry hooks above.
