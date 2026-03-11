# Migration from ShopMonkey

## Strategy (confirmed)

1. Import **master/open records first** (active customers, open tickets/orders, active parts).
2. Run ERP in production workflows for new activity.
3. Backfill historical data in controlled batches.

## Migration phases

1. **Discovery and mapping**
   - Field mapping from ShopMonkey to ERP schemas.
   - Quality rules and reject conditions are documented up front.
2. **Staging import**
   - Load raw records into `migration` schema staging tables.
   - Validate required fields, references, and dedupe keys.
3. **Canonical transform**
   - Map staging records into context-owned schemas.
   - Emit migration events for projections and observability.
4. **Cutover and replay**
   - Freeze legacy write windows as required.
   - Reconcile totals and emit cutover audit evidence.
5. **Historical backfill**
   - Replay historical batches with throttling and checkpoints.

## Required migration artifacts

- `apps/api/src/migrations/0001_initial_schema.sql` (initial baseline)
- Future migration files must follow incremental naming (`0002_...`, `0003_...`).
- Each migration includes rollback notes and verification queries.

## Failure handling

- Record-level rejects go to `migration.migration_errors` with reason code.
- Batch-level failure emits `migration.record_failed` and triggers alerting.
- Resume support uses batch checkpoints and idempotent import keys.

## Audit requirements

- Log who started each migration batch and source file hashes.
- Log transform counts (accepted/rejected/updated) per entity type.
- Keep immutable cutover evidence for compliance and post-mortems.
