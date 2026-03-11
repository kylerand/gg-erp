# Employee Web State Management Strategy (MVP)

## Scope and architecture fit

This strategy covers the employee web shell and feature scaffolds in:

- `apps/web/src/app/providers.ts`
- `apps/web/src/app/router.ts`
- `apps/web/src/features/*/api.ts`
- `apps/web/src/lib/http-client.ts`
- `apps/web/src/lib/telemetry.ts`

It maps directly to existing API bounded contexts in `apps/api/src/contexts/*` and to MVP guardrails in:

- `docs/architecture/bounded-contexts.md`
- `docs/architecture/data-ownership.md`
- `docs/architecture/mvp-vs-phase2.md`
- `docs/architecture/employee-web-information-architecture.md`
- `docs/architecture/employee-web-ux-risks.md`
- `docs/architecture/flows-sync-vs-async.md`

Applied assumptions and standards:

- TypeScript-first contracts for route state, telemetry payloads, and mutation responses (no untyped ad-hoc state blobs).
- Favor clear modular boundaries over clever shared state abstractions; keep ownership explicit per domain.
- Repository/service separation in API contexts remains authoritative for business rules and persistence concerns.
- Failure, audit, event, and observability semantics are first-class acceptance criteria for each stateful mutation flow.
- Read-model/state additions that require persistence changes must be introduced through additive migrations.

## State model (four layers)

| Layer | Owns what | Source of truth | MVP implementation stance |
|---|---|---|---|
| Server state | Domain records fetched/mutated via API | Owning API context schema + events | Query/mutation cache with domain-scoped keys |
| Local workflow state | In-progress form/checklist/timer inputs not committed yet | Browser memory + draft store | Screen-local reducer/state machine, isolated from query cache |
| App shell/session/role state | Current actor, roles, permissions, route gates, shell UI prefs | Auth/session response + role mapping | Small app-shell context (not a global business-data store) |
| Draft persistence state | Recoverable unsent user work after refresh/interruption | Local draft storage with TTL | Debounced autosave + restore/discard/merge flow |

MVP principle: keep state ownership explicit by context and avoid heavyweight global state abstractions.

## 1) Server-state boundaries by domain (queries, mutations, cache)

Use domain-keyed server-state caches (for example: `['domain', 'resource', params...]`) and never share cache entries across bounded contexts.

| Employee web domain | Current web API module | Owning API context(s) | Query boundary (read) | Mutation boundary (write) | Cache + invalidation strategy |
|---|---|---|---|---|---|
| Auth/session | `features/auth/api.ts` | `identity` | `GET /auth/me` for actor + roles | `POST /auth/login` + logout/session revoke (per architecture contracts) | Cache `auth.me` for short session windows; invalidate on login/logout/role change |
| Work orders + execution | `features/work-orders/api.ts` | `build-planning`, `tickets` | `GET /planning/work-orders` plus task/rework reads | work-order transitions, technician task transitions, rework create/transition | Queue/list queries refetch on interval; targeted invalidation after successful mutation |
| Inventory + procurement | `features/inventory/api.ts` | `inventory` | lot/reservation/PO reads (`/inventory/*`) | reserve/release/consume, receive lots, PO transitions | Aggressive revalidation for reservable quantities; invalidate lot + related queue/report keys |
| Customer & dealer operations | `features/customer-dealers/api.ts` | `identity` (customer lifecycle now; dealer expansion path later) | `GET /customers`, customer detail reads | customer create/state transition updates | Moderate cache window; invalidate list + detail on mutation |
| Reporting/workspace summaries | `features/reporting/api.ts` | read-models fed by `tickets`, `inventory`, `planning`, `accounting` events | `GET /reporting/snapshot`, workspace summary views | generally read-only from web in MVP | Eventual-consistency aware cache with freshness timestamp and stale banner |
| AI assistive actions | (future web task panels) | `ai` | prompt/session history reads (if added) | `POST /ai/query` / summarize actions | No long-lived optimistic cache; show per-request result state and retry |

### Boundary rules

1. **Only owning context mutations update its cache directly.**  
   Example: inventory mutations only write/invalidate inventory keys, then trigger dependent reporting refetch.
2. **Cross-context effects are event-driven, not synchronous fan-out writes.**  
   Web reflects this via projection freshness indicators instead of pretending immediate global consistency.
3. **Query cache is server-state only.**  
   Drafts, unsaved forms, checklist toggles, and timers stay outside the server-state cache.

## 2) Local workflow state for forms, checklists, and time logging

Use route-scoped local reducers/state machines for interruption-prone flows described in the screen map (`/work-orders/*`, `/inventory/*`, `/customer-dealers/*`).

| Workflow type | Typical screens | Local state shape | Commit trigger |
|---|---|---|---|
| In-progress forms | customer updates, rework issue creation, receiving/PO adjustments | field values, validation map, dirty flags, last-edited timestamp | explicit submit action |
| Checklists | SOP runner, QC checklist flows | step completion map, evidence attachments pending list, unresolved blockers | checklist submit/sign-off |
| Time logging | `/work-orders/time-logging` | active timer, elapsed milliseconds, pause segments, manual edits | stop/save/approve action |

### Local workflow rules

- Keep a **minimal patch model** (changed fields + metadata), not full duplicated server entities.
- Preserve explicit UI states required by screen-map docs: `empty`, `loading`, `error`, `failure`.
- Use per-action pending flags to prevent duplicate submissions in interruption-heavy usage.

## 3) App shell/session/role state

App-shell state is intentionally small and centralized, while business records remain in domain query caches.

Recommended app-shell/session payload:

- `actor`: `userId`, roles, derived permission set
- `session`: auth status, last activity, idle-lock metadata (shared-device risk)
- `navigation`: role-filtered routes, default landing, last visited work route
- `environment`: API base URL, telemetry enabled flag, connectivity status

### Behavior contracts

- Role/permission changes force route recompute and query-cache invalidation for unauthorized domains.
- Logout clears session state, server-state caches, and persisted drafts.
- Default post-login landing follows IA role matrix (technician -> queue, parts -> reservations, etc.).

## 4) Draft persistence strategy (interruption handling)

MVP uses browser-local persistence for unsent workflow data; this supports the interruption-resilience requirements without introducing a full offline mutation queue.

### Storage design

- **Medium:** `localStorage` for MVP; move large/attachment-heavy drafts to `IndexedDB` in phase 2.
- **Key format:** `gg.erp.web.draft.v1.{actorId}.{route}.{entityId|new}`
- **Payload fields:** `schemaVersion`, `updatedAt`, `workflowType`, `data`, `clientMutationNonce`
- **TTL:** 24 hours (or shorter policy by workflow risk)

### Save/restore flow

1. Debounced autosave on local changes.
2. On route load, detect draft for same actor + route scope.
3. Offer `Resume draft` / `Discard` / `Compare` when server data changed.
4. On successful submit, remove draft immediately.
5. On logout or actor switch, clear actor-scoped drafts.

### Security and reliability constraints

- Never persist auth tokens or sensitive secrets in draft payloads.
- Persist enough metadata to prevent duplicate submits (nonce/idempotency token reuse).
- Surface visible “Draft saved locally” status for operator confidence.

## 5) Optimistic updates vs strict consistency

Use optimistic updates selectively. For audit-critical or contention-heavy flows, prefer strict server confirmation.

| Operation class | Default mode | Why | UX pattern |
|---|---|---|---|
| Inventory reserve/release/consume | **Strict consistency** | Quantity contention + shortage rules are critical | Disable action while pending, confirm from server, then refresh dependent views |
| Work-order/task/rework state transitions | **Strict consistency** | Lifecycle constraints + audit/event emission required | Pending badge + deterministic success/failure message |
| Customer/dealer form edits before submit | **Optimistic local (draft only)** | Safe to stage locally before commit | Immediate local update, server mutation only on submit |
| Reporting/projection cards | **No optimistic writes** | Eventual consistency by design | Show freshness timestamp + stale banner + manual refresh |
| Non-critical shell prefs (filters, panel open state) | **Optimistic** | User-local and reversible | Instant update with silent persistence |

Guideline: optimistic server-cache writes are allowed only if action is idempotent, reversible, and has a defined rollback path.

## 6) Observability hooks and error-recovery UX

### Observability hooks (web -> API correlation)

Use `emitTelemetry` in web and keep correlation with API `request-context`/observability hooks.

| Hook point | Required fields | Outcome |
|---|---|---|
| Query lifecycle (`start/success/error`) | domain, route, actor role, correlation id, latency | Identify slow/failing reads by workflow |
| Mutation lifecycle (`attempt/success/failure`) | action name, entity id, idempotency nonce, error code | Detect retries, duplicates, and contention failures |
| Draft lifecycle (`saved/restored/discarded`) | workflow type, draft age, actor role | Measure interruption frequency and recovery effectiveness |
| Recovery actions (`retry`, `refresh`, `escalate`) | source error code, user action taken | Validate that failures are actionable, not dead ends |

### Error-recovery UX contracts

- **Validation/domain errors:** inline, field- or action-specific; never toast-only for critical workflows.
- **Conflict/stale data errors:** show “data changed” prompt with refresh + reapply draft option.
- **Network/transient errors:** retain local workflow state and expose one-click retry.
- **Projection lag:** show stale-data banner with last successful refresh timestamp.
- **Blocked/failed operational states:** always include reason, owner, and explicit next action CTA.

These UX rules align with `employee-web-ux-risks.md` (R3, R4, R5, R6, R7) and with MVP audit/observability acceptance requirements.

## Repository/service boundary justification (where applicable)

- `apps/web` feature modules own UI composition, local workflow state, and server-state orchestration only.
- `apps/api/src/contexts/*/*.service.ts` owns domain invariants, transition guards, audit/event emission, and idempotency handling.
- Repository/data-access modules own persistence queries and transaction scope; services coordinate repositories so schema changes remain migration-friendly and testable.
- This split keeps business correctness centralized while allowing web state logic to stay simple and interruption-resilient.

## MVP implementation notes (current scaffold)

1. Keep feature API modules (`features/*/api.ts`) as domain boundaries for query/mutation hooks.
2. Evolve `app/providers.ts` into composition root for:
   - HTTP client
   - server-state query client
   - app-shell/session context
3. Extend `http-client.ts` beyond `GET` to typed mutation methods that carry correlation/idempotency metadata.
4. Keep business mutation rules in API context services (`apps/api/src/contexts/*/*.service.ts`); web handles orchestration, drafts, and recovery UX only.
5. When new draft/read-model fields require DB changes, ship additive migrations first, then enable corresponding web state fields behind feature flags if needed.

This preserves MVP simplicity while allowing phase 2 enhancements (offline queueing, richer synchronization, server-driven navigation, and cross-device draft handoff).
