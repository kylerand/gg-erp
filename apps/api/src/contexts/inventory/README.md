# inventory context

This context is intentionally isolated as a module boundary.

## Responsibilities
- Owns business rules for inventory.
- Emits domain events for cross-context communication.
- Writes only to its owned schema/tables.

## Service scaffolding boundaries
- `inventory.catalog.service.ts`: part catalog, substitutions, UOM, and location/bin master data.
- `inventory.stock-movement.service.ts`: receipt/reserve/allocate/release/consume/adjust/transfer, PO linkage, and append-only ledger intents.
- `inventory.cycle-count.service.ts`: cycle count session lifecycle and reconciliation orchestration.
- `inventory.query.service.ts`: read-model access for balances, ledger retrieval, work-order material status, and PO receipt status.
- `inventory.service.ts`: compatibility facade preserving existing callers while delegating to modular services.

## Repository boundary
- `inventory.repository.ts` remains the persistence contract between services and storage.
- Services coordinate business rules and side effects (audit/events/observability) while repository implementations stay focused on data access and append/list primitives.

## Non-goals in MVP
- No direct writes into other context schemas.
- No silent error handling; failures are explicit and observable.
