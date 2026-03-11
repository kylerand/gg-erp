# Employee Web User Journeys

This document captures top employee-facing journeys and failure branches for the ERP employee web app.

## Scope assumptions and standards guardrails

- Canonical employee routes follow `employee-web-information-architecture.md` and `employee-web-screen-map.md`; legacy aliases may remain only as redirects.
- Journey steps and telemetry contracts are TypeScript-first (typed event names/payloads, typed failure reason codes).
- Keep modularity over cleverness: UI orchestration lives in feature modules, business rules stay in API services/repositories.
- Every journey must preserve failure recoverability, explicit audit/event emission, and operator-facing observability cues.

## 1) Start shift and work assigned queue

- **Actor(s):** Technician, Lead Technician
- **Entry screen:** `/auth` (sign-in) -> `/work-orders/my-queue`

### Happy path steps
1. Technician signs in on a shared or personal device.
2. App resolves role and site context, then routes to Assigned Work.
3. Technician starts shift and sees prioritized assigned tasks.
4. Technician claims the next task (if unclaimed), opens details, and starts work.
5. Queue and dashboard counters update to reflect active in-progress work.

### Failure paths
- Authentication failure or expired session blocks queue access; user is returned to `/auth` with recovery prompt.
- Assigned queue read fails (timeout/API error); cached last-known queue is shown with stale-data warning and retry.
- Claim/start action is rejected due to stale state (already claimed/completed by another actor); queue row refreshes with conflict reason.
- Device goes offline during shift start; shift start is queued locally with visible replay state.

### Key events / audit points
- `auth.session_started` (actor, device, site)
- `workspace.shift_started`
- `work.assigned_queue_viewed`
- `work.task_claimed` / `work.task_start_rejected`
- Correlation id linking shift start to first task transition

### UX safeguards
- Persistent active-user badge + quick lock/switch-user action on shared devices.
- Large tap targets for claim/start controls; destructive actions require confirm or undo window.
- Inline stale/conflict messaging (not toast-only) with one-click refresh.
- Visible online/offline indicator and queued-action count.

## 2) Inventory pick with shortage handling

- **Actor(s):** Inventory Clerk, Technician
- **Entry screen:** `/inventory/reservations`

### Happy path steps
1. User opens pick list scoped to assigned tickets/builds.
2. User scans bin/lot and confirms required quantity.
3. System validates reservation and decrements available quantity.
4. Pick is confirmed and linked to consuming ticket/work order.
5. Ticket readiness updates and downstream planning constraints are recalculated.

### Failure paths
- Scanned lot/bin does not match reservation; row is blocked until corrected or overridden by authorized role.
- Available quantity is below requested quantity; shortage branch requires partial pick + shortage reason.
- Suggested substitution is unavailable or unauthorized; escalation to parts manager is required.
- Confirm-pick mutation fails/retries; action remains in pending state with idempotent retry.

### Key events / audit points
- `inventory.pick_list_viewed`
- `inventory.part_picked`
- `inventory.shortage_detected`
- `inventory.substitution_requested` / `inventory.substitution_rejected`
- `ticket.blocked_reason_updated` (shortage reason code + owner)

### UX safeguards
- Mandatory shortage reason codes and owner assignment before leaving a shortage unresolved.
- Distinct icon + text states for READY, PARTIAL, SHORTAGE, FAILED (never color-only).
- Scan confirmation step shows part, lot, bin, and qty in high-contrast summary.
- Undo window for accidental pick confirmation when stock has not yet been consumed downstream.

## 3) Blocked work triage and escalation

- **Actor(s):** Manager, Dispatcher, Inventory Lead (with Technician as originating reporter)
- **Entry screen:** `/reporting/blocked-alerts` (or deep-link from `/work-orders/assigned`)

### Happy path steps
1. Manager opens active blocked alerts sorted by age/severity.
2. Manager reviews blocker reason, affected ticket(s), and current owner.
3. Manager acknowledges alert, assigns owner, and chooses next action (parts, approval, customer, vendor).
4. If needed, manager escalates with SLA due time and target team.
5. Once blocker is cleared, ticket transitions back to actionable queue.

### Failure paths
- Blocked alert arrives without structured reason; triage is halted until reason code and context are completed.
- Ownership update fails due to stale write conflict; record reloads and requires explicit reapply.
- Escalation target is unavailable/unresponsive; fallback escalation chain is triggered.
- Blocker remains unresolved past SLA; system auto-raises severity and manager notification.

### Key events / audit points
- `work.blocked_alert_viewed`
- `work.blocked_alert_acknowledged`
- `work.blocked_owner_assigned`
- `work.blocked_escalated`
- `ticket.status_changed` (`BLOCKED` -> `IN_PROGRESS`/`READY`) with elapsed blocked duration

### UX safeguards
- Every blocked card must show reason, owner, age, and next action CTA.
- Aging badges and SLA countdown are persistent until resolution.
- Escalation action requires rationale note and selected escalation tier.
- Prevent silent dismissal; acknowledgement and resolve actions are separately confirmed.

## 4) SOP runner + QC checklist + time logging completion

- **Actor(s):** Technician, QC Tech, Lead Tech
- **Entry screen:** `/work-orders/sop-runner` (with transitions to `/work-orders/qc-checklists` and `/work-orders/time-logging`)

### Happy path steps
1. Technician opens assigned work item and loads required SOP revision.
2. Technician completes SOP steps, capturing required evidence (photos/notes/measurements).
3. Work item moves to QC checklist; QC tech runs checklist and marks all critical checks passed.
4. Technician/QC finalizes labor time by stopping timer and submitting any manual adjustments.
5. Work item is marked complete and available for closeout/billing progression.

### Failure paths
- SOP revision cannot be loaded (missing/unpublished); execution pauses and alternate approved revision must be selected.
- Required evidence upload fails; step cannot be completed until retry succeeds or exception is approved.
- QC checklist has failed critical item; work loops back to rework with mandatory defect note.
- Time entry submission fails overlap/validation checks; user must reconcile conflicting entries before completion.

### Key events / audit points
- `sop.run_started` / `sop.step_completed`
- `sop.evidence_attached`
- `qc.checklist_started` / `qc.checklist_failed` / `qc.checklist_passed`
- `time.entry_started` / `time.entry_submitted` / `time.entry_validation_failed`
- `ticket.status_changed` to completion-ready state

### UX safeguards
- Step-level autosave with visible saved/queued state to protect against interruptions.
- Critical SOP/QC failures are pinned inline with explicit rework CTA.
- Time logging screen shows overlap warnings before submit, not only after failure.
- Completion button remains disabled until SOP required steps, QC critical checks, and time entries are valid.

## 5) Receiving + purchase order progression

- **Actor(s):** Inventory Clerk, Purchasing, Manager
- **Entry screen:** `/inventory/receiving-po`

### Happy path steps
1. Purchasing creates or opens PO and confirms vendor, lines, expected dates.
2. PO advances through approval and release states.
3. Receiving clerk records delivered quantities by line (full or partial receipt).
4. System updates on-hand/in-transit counts and marks line/PO progression state.
5. Variances are reconciled and PO is closed when all lines are resolved.

### Failure paths
- Invalid PO state transition attempted (for example, receive against unapproved PO); action is blocked with required corrective state.
- Over-receipt beyond allowed tolerance is detected; manager approval is required.
- Damaged/mismatched goods create variance hold; line remains open with supplier follow-up task.
- Receiving post succeeds partially; failed lines are retained in retry queue with per-line status.

### Key events / audit points
- `procurement.po_created` / `procurement.po_approved` / `procurement.po_released`
- `inventory.receipt_recorded` (line, qty, actor, lot/bin)
- `inventory.receipt_variance_detected`
- `procurement.po_line_closed` / `procurement.po_closed`
- Inventory valuation-impacting receipt adjustments with before/after quantities

### UX safeguards
- PO timeline panel shows current state, prior transitions, and who approved each step.
- Receiving UI enforces line-level validation before posting and highlights unresolved variances.
- Partial receipt workflow is first-class (no forced all-or-nothing posting).
- Confirmation summary requires review for high-impact quantity/cost changes.

## 6) Invoice sync visibility + retry escalation

- **Actor(s):** Finance, Manager, Admin
- **Entry screen:** `/accounting/sync`

### Happy path steps
1. User opens invoice sync monitor for recent billing records.
2. User filters for `FAILED` or delayed sync records and opens invoice detail.
3. User reviews external error payload/correlation id and performs retry.
4. Sync worker reprocesses outbox message and updates status to `SYNCED`.
5. User confirms external reference id and closes exception.

### Failure paths
- Retry attempt fails repeatedly; record transitions to escalation-required state.
- Duplicate external invoice/reference is detected; auto-retry is disabled pending manual reconciliation.
- Sync status feed is stale/unavailable; stale-data banner and fallback export are provided.
- Failure age exceeds threshold; automatic escalation creates accounting/admin action item.

### Key events / audit points
- `ticket.status_changed` (billing-trigger transition)
- `invoice.sync_queued` / `invoice.sync_started` / `invoice.sync_failed` / `invoice.sync_succeeded`
- `invoice.sync_retry_requested` / `invoice.sync_retry_failed`
- `invoice.sync_escalated`
- External reference id + correlation id captured on each attempt

### UX safeguards
- Per-record status badge with last-attempt timestamp and failure age.
- Retry action is role-gated and requires reason on repeated attempts.
- Error details are copyable and human-readable, with support-safe correlation id.
- Escalation CTA is persistent after retry threshold is exceeded; no silent background failure.
