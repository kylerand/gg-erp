# Synchronous API Flows vs Asynchronous Event Flows

## Synchronous flows (request/response)

These are used when the caller needs immediate confirmation.

1. **Create ticket**
   - `POST /tickets` -> validates actor and required fields -> writes `tickets.tickets` -> returns ticket id.
2. **Reserve inventory**
   - `POST /inventory/reservations` -> checks stock atomically -> returns reservation status.
3. **Compute draft build plan**
   - `POST /planning/slots/compute` -> enqueues workflow and returns run id with accepted status.
4. **Start migration batch**
   - `POST /migration/shopmonkey/start` -> validates source manifest -> returns batch id.

## Asynchronous flows (event-driven)

These are used for decoupling, retries, and long-running work.

- `ticket.created` -> inventory context checks part requirements -> emits `inventory.shortage_detected` if constrained.
- `inventory.part_reserved` + `ticket.created` -> planning workflow composes labor/parts constraints.
- `planning.slot_plan_published` -> workspace projections refresh.
- `ticket.status_changed` -> accounting sync outbox prepares QuickBooks updates.
- `migration.batch_imported` -> downstream contexts reconcile imported entities.

## Failure cases and handling

| Case | Strategy |
|---|---|
| Duplicate event delivery | Event idempotency key + processed-event table |
| QuickBooks API timeout | Exponential backoff + dead-letter event + reconciliation job |
| Planner run exceeds threshold | Step Functions timeout + `planning.run_failed` event + audit record |
| Partial migration batch failure | Record-level status + resumable rerun from failed offset |
| Missing inventory snapshot during planning | Fail run with explicit reason, do not silently continue |

## Audit logging points

- Ticket create/update/delete.
- Inventory reservation and release.
- Planner run start/finish/failure.
- QuickBooks sync start/success/failure.
- Migration batch start/progress/failure.
- AI request accepted/rejected and tool invocation summary.

## Observability hooks

- Correlation id propagated through API requests, events, and workflow executions.
- Metrics: request latency, planner duration, sync success rate, migration throughput.
- Traces: API Gateway -> Lambda -> Aurora/EventBridge/Step Functions path.
- Alerts: repeated sync failures, planner timeout spike, migration error-rate threshold.

## Event catalog contract source

- Canonical event names and payload contracts are defined under `apps/api/src/events/` and `packages/domain/src/events.ts`.
