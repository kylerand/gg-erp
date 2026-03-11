# identity context

This context is intentionally isolated as a module boundary.

## Responsibilities
- Owns business rules for identity.
- Emits domain events for cross-context communication.
- Writes only to its owned schema/tables.
- Defines authz lookup/evaluation boundaries (`authz.repository.ts`, `authz.service.ts`) for scoped role grants.

## Non-goals in MVP
- No direct writes into other context schemas.
- No silent error handling; failures are explicit and observable.
