# Domain Event Model: EventBridge + Outbox/Inbox (MVP)

This document defines the canonical domain-event model for ERP asynchronous flows over EventBridge, aligned with current repository conventions and existing outbox/audit language:

- Event catalog conventions in `packages/domain/src/events.ts`
- API publish path in `packages/events/src/publishers.ts` and `apps/api/src/events/`
- Canonical SQL shape in `apps/api/src/migrations/0002_canonical_erp_domain.sql` (`events.outbox_events`, `events.outbox_publish_attempts`, `events.event_consumer_inbox`, `events.event_replay_requests`)
- Audit model in `audit.audit_events` + `audit.event.recorded`

## Explicit assumptions

1. Event delivery is **at-least-once**; consumers are required to be idempotent.
2. Event names use snake_case segments separated by dots; versioning lives in envelope/payload fields, not in event names.
3. Domain write + audit write + outbox append are one atomic unit when DB-backed implementation is enabled.
4. All mutating commands provide `correlationId`; retry-safe commands also provide `Idempotency-Key`.
5. Replay operations preserve original source identity (`source_event_id`) for consumer dedupe correctness.
6. Cross-context communication remains event-first; no direct cross-schema write shortcuts.

## Standards alignment snapshot (explicit)

- **TypeScript-first contracts:** use typed event-name-to-payload maps and compile-time-safe publisher/consumer signatures.
- **Tests/failure/audit/observability hooks:** every event path defines required tests, outbox/inbox failure behavior, audit action, and metrics/traces.
- **Migrations are not skipped:** outbox/inbox evolution is additive and versioned under `apps/api/src/migrations/`.
- **Assumptions + extension points are explicit:** this document calls out both baseline contracts and future-safe additions.
- **Exact implementation file list is explicit:** listed below.

## Exact files to create/modify for implementation

> This todo is documentation-only; implementation can follow in a separate execution phase.

### Modify (existing)

- `packages/domain/src/events.ts`
  - add new canonical names (`inventory.lot.changed`, `sop_ojt.document.updated`, `ticket.rework.escalated`) and keep existing names unchanged.
- `apps/api/src/events/catalog.ts`
  - re-export expanded domain catalog.
- `apps/api/src/contexts/inventory/inventory.service.ts`
  - emit canonical `inventory.lot.changed` for net inventory mutations.
- `apps/api/src/contexts/inventory/procurement.service.ts`
  - ensure part receipt emits `inventory.lot.received` with receipt metadata.
- `apps/api/src/contexts/build-planning/workOrder.service.ts`
  - keep `work_order.created` / `work_order.blocked` and document `build_slot.locked` as committed-slot semantic.
- `apps/api/src/contexts/tickets/ticketRework.service.ts`
  - add escalation transition/event (`ticket.rework.escalated`) where policy requires.
- `apps/api/src/contexts/accounting/invoiceSync.service.ts`
  - enforce canonical payload for `invoice_sync.succeeded`.
- `apps/api/src/contexts/tickets/technicianTask.service.ts`
  - enforce canonical payload for `technician_task.completed`.
- `apps/api/src/audit/auditPoints.ts`
  - add explicit audit actions for SOP update + ticket escalation paths.
- `apps/workers/src/index.ts`
  - register consumer handlers for newly introduced events.
- `apps/workers/src/worker.ts`
  - wire consumer-inbox idempotency + failure status transitions.

### Create (new)

- `packages/domain/src/event-contracts.ts`
  - typed `DomainEventPayloadMap` and shared envelope metadata contract.
- `apps/api/src/events/outbox-relay.eventbridge.ts`
  - DB-backed relay from `events.outbox_events` to EventBridge with attempt logging.
- `apps/workers/src/events/inbox.repository.ts`
  - helper for `events.event_consumer_inbox` claim/complete/fail transitions.
- `apps/api/src/contexts/sop-ojt/sopDocument.service.ts`
  - SOP document update command that emits `sop_ojt.document.updated`.

### Migration files for outbox/inbox evolution (if needed)

Baseline support already exists in `0002_canonical_erp_domain.sql`. If additional columns/indexes are required (for example, explicit dedupe key or replay metadata), use:

- `apps/api/src/migrations/<next_sequence>_eventbridge_outbox_inbox_evolution.sql` (create)
- `packages/db/prisma/migrations/0002_eventbridge_outbox_inbox_evolution/migration.sql` (create, if Prisma migration mirror is maintained)
- `packages/db/prisma/schema.prisma` (modify, if new columns are introduced)

## 1) Event naming conventions

### Naming rules

1. Use snake_case tokens with dot separators: `<aggregate>[.<subtopic>].<verb_or_state>`.
2. Use past-tense outcome verbs (`created`, `updated`, `blocked`, `succeeded`, `completed`) or explicit transition terms (`state_changed`, `capacity_exceeded`).
3. Keep version out of names (`invoice_sync.succeeded`, **not** `invoice_sync.succeeded.v1`).
4. Keep one canonical name per business meaning to avoid duplicate semantic events.

### Required event set (with repo alignment)

| Business meaning | Canonical event name | Alignment status | Notes |
|---|---|---|---|
| Inventory changed | `inventory.lot.changed` | **New** | Canonical net-change event for downstream consumers that do not need mutation-specific variants. |
| Part received | `inventory.lot.received` | Existing | Emitted on lot receipt; may include PO linkage metadata. |
| Work order created | `work_order.created` | Existing | Already in domain catalog and worker registration flow. |
| Work order blocked | `work_order.blocked` | Existing | Already emitted from transition mapping. |
| SOP updated | `sop_ojt.document.updated` | **New** | Aligns with `sop_ojt` bounded context naming. |
| Ticket opened | `ticket.rework.created` | Existing equivalent | Current ticket domain models “opened” as rework issue creation. |
| Ticket escalated | `ticket.rework.escalated` | **New** | Add explicit escalation semantic (severity/SLA/process trigger). |
| Build slot committed | `build_slot.locked` | Existing equivalent | `locked` is the current committed/frozen schedule semantic. |
| Invoice synced | `invoice_sync.succeeded` | Existing equivalent | Canonical successful sync outcome event. |
| Technician task completed | `technician_task.completed` | Existing | Already emitted from technician task transitions. |

## 2) Payload schema conventions (TypeScript-first)

### Envelope contract

```ts
export interface DomainEventEnvelope<TName extends keyof DomainEventPayloadMap> {
  id: string; // event UUID; maps to outbox identity and source_event_id
  name: TName;
  correlationId: string;
  emittedAt: string; // ISO timestamp
  payload: DomainEventPayloadMap[TName];
}

export interface EventMeta {
  schemaVersion: number; // payload schema version
  eventVersion: number; // logical event contract version
  actorUserId?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  dedupeKey: string; // deterministic producer-side key
  replay?: { requested: boolean; replayRequestId?: string; originalEventId?: string };
}
```

### Payload map contract (required events)

```ts
export interface DomainEventPayloadMap {
  'inventory.lot.changed': {
    lotId: string;
    partSkuId: string;
    locationId: string;
    before: { quantityOnHand: number; quantityReserved: number; state: string };
    after: { quantityOnHand: number; quantityReserved: number; state: string };
    reason: 'receive' | 'reserve' | 'release' | 'consume' | 'adjust';
    meta: EventMeta;
  };
  'inventory.lot.received': {
    lotId: string;
    partSkuId: string;
    quantityReceived: number;
    purchaseOrderId?: string;
    purchaseOrderLineId?: string;
    receivedAt: string;
    meta: EventMeta;
  };
  'work_order.created': {
    workOrderId: string;
    workOrderNumber: string;
    vehicleId: string;
    buildConfigurationId: string;
    bomId: string;
    meta: EventMeta;
  };
  'work_order.blocked': {
    workOrderId: string;
    beforeState: string;
    afterState: 'BLOCKED';
    reasonCode?: string;
    blockedAt: string;
    meta: EventMeta;
  };
  'sop_ojt.document.updated': {
    sopDocumentId: string;
    beforeVersion: number;
    afterVersion: number;
    changeSummary: string;
    meta: EventMeta;
  };
  'ticket.rework.created': {
    ticketId: string;
    workOrderId: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    openedAt: string;
    meta: EventMeta;
  };
  'ticket.rework.escalated': {
    ticketId: string;
    workOrderId: string;
    escalationLevel: 'TEAM_LEAD' | 'MANAGER' | 'DIRECTOR';
    reasonCode: string;
    escalatedAt: string;
    meta: EventMeta;
  };
  'build_slot.locked': {
    buildSlotId: string;
    slotDate: string;
    workstationCode: string;
    capacityHours: number;
    usedHours: number;
    committedAt: string;
    meta: EventMeta;
  };
  'invoice_sync.succeeded': {
    invoiceSyncRecordId: string;
    invoiceNumber: string;
    workOrderId: string;
    provider: 'QUICKBOOKS' | 'GENERIC';
    externalReference: string;
    syncedAt: string;
    meta: EventMeta;
  };
  'technician_task.completed': {
    technicianTaskId: string;
    workOrderId: string;
    routingStepId: string;
    technicianId?: string;
    completedAt: string;
    meta: EventMeta;
  };
}
```

## 3) Outbox design

Use existing canonical tables and states from `0002_canonical_erp_domain.sql`:

- `events.outbox_events` (`publish_status`, `attempt_count`, `available_at`, `next_attempt_at`, `last_error`, `event_version`)
- `events.outbox_publish_attempts` (append-only publish history)
- `events.event_consumer_inbox` (idempotent consumer ledger)

### Write flow (command side)

1. Validate command + idempotency request key.
2. Apply domain mutation.
3. Write audit (`audit.audit_events`) with correlation metadata.
4. Append `events.outbox_events` row in the same transaction.
5. Commit.

### Relay flow (publisher side)

1. Claim rows where `publish_status in ('PENDING','FAILED')` and `available_at <= now()`.
2. Publish to EventBridge.
3. Insert `events.outbox_publish_attempts` record.
4. On success: set `publish_status='PUBLISHED'`, `published_at`, increment `attempt_count`.
5. On failure: set `publish_status='FAILED'`, set `last_error`, set `next_attempt_at`, increment `attempt_count`.
6. After threshold: set `publish_status='DEAD_LETTERED'` and add `ops.dead_letter_records` row with `source_type='OUTBOX'`.

## 4) Idempotency strategy

### Producer idempotency

- Use `ops.idempotency_keys` keyed by `Idempotency-Key` + `request_hash` for retry-safe command APIs.
- Generate deterministic `dedupeKey` in event metadata (for example: `aggregate_type:aggregate_id:event_name:event_version`).
- Prefer unique producer guards when introducing new high-risk emitters (migration-additive unique index if needed).

### Consumer idempotency

- Insert into `events.event_consumer_inbox` before side effects.
- Use existing unique key: `(consumer_name, source_system, source_event_id)`.
- If conflict/no insert, treat as duplicate and short-circuit with success metric (no reprocessing).
- Track `payload_hash`; if same source event ID has different hash, mark `FAILED` and route to dead-letter triage.

## 5) Consumer design guidance

1. **Validate contract first** (strict parsing on event name + payload shape).
2. **Claim inbox row first**, then execute side effects.
3. **Keep side effects idempotent** (upsert semantics, version checks, or natural-key guards).
4. **Update inbox status explicitly**:
   - `RECEIVED` -> `PROCESSED` on success
   - `RECEIVED`/`FAILED` -> `FAILED` with `last_error` on retryable failure
   - `RECEIVED` -> `IGNORED` for unsupported-but-safe events
5. **Emit audit + metrics/traces**:
   - audit action on meaningful state transitions
   - metrics such as `worker.event.processed`, `worker.event.failed`, `worker.event.duplicate`
   - trace propagation via `correlationId` / `traceId`

## 6) Failure and replay strategy

### Failure handling

- Publish-side failures remain in outbox with `FAILED` status and retry metadata.
- Repeated failures move to `DEAD_LETTERED` and create `ops.dead_letter_records`.
- Consumer failures remain in inbox with `FAILED`, incremented `attempt_count`, and actionable `last_error`.
- No silent failures: all failures are auditable/observable.

### Replay handling

- Use `events.event_replay_requests` for managed replay requests.
- Replays must:
  - preserve or reference original `source_event_id`
  - set replay metadata (`replay.requested`, `replayRequestId`, `originalEventId`)
  - respect same consumer inbox dedupe policy
- Prefer bounded replay windows (`from_timestamp`/`to_timestamp`) and optional dry-run mode.

## 6.1) Required test/failure/audit/observability hooks

| Area | Minimum required coverage | Suggested file targets |
|---|---|---|
| Event contract tests | Compile-time + runtime checks that every required event has a payload contract and schemaVersion/eventVersion fields | `packages/domain/src/event-contracts.ts` + `packages/test-utils/tests/schema-contracts.test.js` |
| Publish failure tests | Verify outbox transitions to `FAILED` and persists error metadata when publish throws | `apps/api/src/tests/context-failure-cases.test.ts`, `apps/api/src/tests/invoice-sync-failure-cases.test.ts` |
| Duplicate-consume tests | Verify duplicate `source_event_id` does not execute side effects twice | `apps/workers/src/**/__tests__/` (new) + `events.event_consumer_inbox` fixtures |
| Replay tests | Verify replayed events still dedupe correctly and preserve traceability metadata | `apps/workers/src/**/__tests__/` (new), `events.event_replay_requests` integration tests |
| Audit hooks | Verify each command path writes `audit.audit_events` with action/entity/correlation metadata | context service tests under `apps/api/src/tests/` |
| Observability hooks | Verify `worker.event.processed/failed/duplicate` and context transition metrics emit with correlation context | `apps/workers/src/worker.ts` tests + API context tests |

## 7) Example TypeScript publisher and consumer code

### Publisher example (API command side, outbox-first)

```ts
import { randomUUID } from 'node:crypto';
import type { AuditSink } from '../audit/index.js';
import type { EventPublisher, EventEnvelope, OutboxWriter } from '../events/index.js';
import { publishWithOutbox } from '../events/index.js';
import type { DomainEventPayloadMap } from '../../../packages/domain/src/event-contracts.js';

type EventName = keyof DomainEventPayloadMap;

export async function publishDomainEvent<TName extends EventName>(
  deps: { audit: AuditSink; publisher: EventPublisher; outbox: OutboxWriter },
  input: {
    name: TName;
    correlationId: string;
    actorId?: string;
    entityType: string;
    entityId: string;
    action: string;
    payload: DomainEventPayloadMap[TName];
  }
): Promise<void> {
  await deps.audit.record({
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    correlationId: input.correlationId,
    metadata: input.payload,
    createdAt: new Date().toISOString()
  });

  const event: EventEnvelope<DomainEventPayloadMap[TName]> = {
    id: randomUUID(),
    name: input.name,
    correlationId: input.correlationId,
    emittedAt: new Date().toISOString(),
    payload: input.payload
  };

  await publishWithOutbox(deps.publisher, deps.outbox, event);
}
```

### Consumer example (worker side, inbox dedupe + replay-safe)

```ts
type InboxInsertResult = { inboxId?: string };

export async function handleWithInboxDedupe(
  event: { id: string; name: string; correlationId: string; payload: unknown },
  consumerName: string,
  sourceSystem: string,
  repo: {
    claimInbox(row: {
      consumerName: string;
      sourceSystem: string;
      sourceEventId: string;
      eventName: string;
      payload: unknown;
      correlationId: string;
    }): Promise<InboxInsertResult>;
    markProcessed(inboxId: string): Promise<void>;
    markFailed(inboxId: string, reason: string): Promise<void>;
  },
  process: () => Promise<void>
): Promise<'processed' | 'duplicate'> {
  const claim = await repo.claimInbox({
    consumerName,
    sourceSystem,
    sourceEventId: event.id,
    eventName: event.name,
    payload: event.payload,
    correlationId: event.correlationId
  });

  if (!claim.inboxId) return 'duplicate';

  try {
    await process();
    await repo.markProcessed(claim.inboxId);
    return 'processed';
  } catch (error) {
    await repo.markFailed(
      claim.inboxId,
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}
```

## Anti-duplication and replay guarantees

1. **No duplicate business effects:** consumer inbox unique key (`consumer_name`, `source_system`, `source_event_id`) is the hard dedupe barrier.
2. **No silent retries:** every publish/consume attempt is persisted (`attempt_count`, `last_error`, attempt logs).
3. **Safe replay:** replay requests are explicit (`events.event_replay_requests`) and still pass through inbox dedupe.
4. **Traceability:** `correlationId` + audit records + outbox/inbox status history give end-to-end forensic visibility.

## Extension points (intentionally deferred)

1. **Schema registry integration:** store schema reference in outbox metadata for strict contract evolution.
2. **Per-event ordering keys:** add partition/ordering hints for workloads that need stronger ordering guarantees than best-effort EventBridge fanout.
3. **Adaptive retry policy:** tune retry by event class (`invoice_sync.*` vs `work_order.*`) with policy metadata.
4. **Replay approval workflow:** require explicit approve/run states before replay execution for sensitive domains.
