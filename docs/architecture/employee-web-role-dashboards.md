# Employee Web Role Dashboards

## Scope and IA alignment

This dashboard specification extends the approved MVP IA in `employee-web-information-architecture.md` and stays aligned to existing bounded contexts (`Employee Workspace`, `Tickets`, `Inventory`, `SOP/OJT`, `Build Planning`, `Accounting Integration`, `Platform Controls`).

Applied assumptions:
- Navigation stays role-conditional but task-oriented, with one-click paths to primary work.
- Dashboard cards are queue-first and interruption-resilient (resume links + saved context).
- Route depth remains shallow (top-level + one child level).
- `Customer & Dealer Ops` remains first-class for operational and billing escalation paths.

## Shared dashboard composition contract (all roles)

- **Primary shell:** Dashboard route (`/` in IA contract; current `/dashboard` implementation can remain an alias).
- **Card source:** `GET /workspace/summary` composes role-filtered cards from domain read models.
- **Card minimum payload:** status, owner, age, reason code (if blocked/failed), and one primary CTA.
- **Cross-card affordance:** consistent "Return to my queue" action to preserve interruption-resilience.
- **Alert rendering:** critical states must use icon + text + shape, never color-only (`employee-web-ux-risks.md`).

### Alert priority ladder and escalation cues

| Priority | Expected response window | Typical triggers | Escalation cue |
|---|---|---|---|
| **P1 - Immediate** | 0-5 minutes | BLOCKED work on active jobs, compliance/safety failures, failed accounting sync with aging impact | Persistent banner + owner missing/overdue; escalate to role owner and manager immediately |
| **P2 - This shift** | 5-30 minutes | Queue bottlenecks, shortage risk, overdue training steps, reconciliation exceptions not yet customer-facing | Card aging crosses threshold and no assignee update; escalate cross-functionally |
| **P3 - Monitor** | Same day | Forecast pressure, low stock trend, stale reporting projections, informational drift | Trend deterioration without current blocker; convert to P2 if aging threshold breached |

## Technician dashboard

### Primary goals in first 15 minutes of shift
- Confirm assigned ticket/work-order queue and choose next executable job.
- Validate required part readiness before starting labor.
- Clear any BLOCKED reasons or request help quickly.
- Resume in-progress SOP/QC/time logging context from previous interruption.

### Recommended dashboard modules/cards
- **My Queue Snapshot** (`Tickets`): in-progress, ready, blocked counts with deep link to `/work-orders/my-queue`.
- **Part Readiness for Assigned Work** (`Inventory`): reservation/shortage status for current assignments.
- **SOP/OJT Next Required Step** (`SOP/OJT`): next mandatory step tied to active work order.
- **Time + QC Readiness** (`Tickets` + `SOP/OJT`): active timer state, pending QC checklist gates.
- **Customer/Dealer Flags** (`Customer & Dealer Ops`): high-priority context needed before customer-facing actions.

### Alert priorities and escalation cues
- **P1:** Active task becomes `BLOCKED` with no workaround, safety/QC critical failure, or irreversible step blocked by dependency.
- **P2:** Missing part ETA risk, overdue step on active ticket, repeated task transition conflicts.
- **P3:** Upcoming task readiness warnings for later in shift.
- **Escalation cues:** blocker age > 10 minutes, blocker owner empty, or repeated failure on same task action.

### Quick actions
- Start/pause/complete assigned task.
- Mark blocked with reason code and request parts/manager assist.
- Open SOP runner at current step.
- Start or resume time log.
- Jump to linked reservation or customer/dealer record.

### Failure/empty states and observability cues
- **Empty:** "No assigned work" card with CTA to dispatch queue; preserve quick refresh.
- **Failure:** stale task transition, reservation mismatch, or SOP load failure must show actionable retry + owner path.
- **Observability cues:** emit `workspace.viewed`, `ticket.status_changed`, `inventory.shortage_detected` correlation chain; track blocked reason age and retry outcomes.

## Shop manager dashboard

### Primary goals in first 15 minutes of shift
- Assess dispatch health and rebalance assignments for current capacity.
- Identify blockers that threaten SLA or delivery commitments.
- Verify build-slot pressure and labor availability for the day.
- Triage escalations involving customer/dealer impact.

### Recommended dashboard modules/cards
- **Dispatch Health Board** (`Tickets`): unassigned, overdue, blocked, and aging queue distribution with link to `/work-orders/dispatch`.
- **Blocker Heatmap** (`Tickets` + `Inventory`): blockers by reason code, owner, and age.
- **Capacity vs Plan** (`Build Planning`): slot utilization, over-capacity warnings, and near-term load.
- **QC Risk Queue** (`Tickets` + `SOP/OJT`): unresolved critical checklist items before closeout.
- **Customer/Dealer Escalations** (`Customer & Dealer Ops`): active high-priority relationship cases affecting delivery.

### Alert priorities and escalation cues
- **P1:** Critical blocker with customer deadline risk, safety/compliance hold, or unresolved owner for active dispatch item.
- **P2:** Capacity overload forecast, repeated part shortages across multiple tickets, overdue dispatch actions.
- **P3:** Trend-level queue growth without immediate SLA breach.
- **Escalation cues:** blocker age breaches policy, queue aging slope increases, or no acknowledgment by assigned owner.

### Quick actions
- Reassign ticket owner/technician.
- Reprioritize dispatch order.
- Escalate part shortage to parts manager with linked ticket set.
- Open build slot planner for immediate capacity adjustment.
- Trigger cross-team escalation note for customer/dealer stakeholders.

### Failure/empty states and observability cues
- **Empty:** "No open dispatch items" with confirmation of filtered state and quick reset.
- **Failure:** planner data unavailable, dispatch mutation conflict, or stale queue projections require explicit stale-data banner.
- **Observability cues:** monitor `planning.slot_plan_published`, `inventory.shortage_detected`, queue aging metrics, and escalation acknowledgment latency.

## Parts manager dashboard

### Primary goals in first 15 minutes of shift
- Triage shortages affecting active work orders first.
- Validate reservations due this shift and confirm pick readiness.
- Review receiving/PO exceptions that can unblock same-day work.
- Surface dealer/vendor delays that require operational communication.

### Recommended dashboard modules/cards
- **Reservation Priority Queue** (`Inventory`): due-now reservations, shortages, and at-risk picks from `/inventory/reservations`.
- **Critical Part ETA Risk** (`Inventory` + `Customer & Dealer Ops`): late inbound items tied to active tickets.
- **Receiving/PO Exceptions** (`Inventory`): mismatched receipt, over/under-receipt, and PO transition failures.
- **Substitution Opportunities** (`Inventory`): approved alternates for blocked jobs.
- **Downstream Impact View** (`Tickets`): count of tickets blocked by each shortage.

### Alert priorities and escalation cues
- **P1:** Line-down shortage on in-progress work, critical receiving discrepancy with no substitute, or reservation integrity conflict.
- **P2:** ETA slips that impact same-day dispatch, rising shortage trend in high-use parts.
- **P3:** Low-stock warnings not yet tied to active jobs.
- **Escalation cues:** shortage affects multiple tickets, supplier ETA passes threshold, or no owner on PO exception.

### Quick actions
- Reserve/release/adjust reservation quantities.
- Create or expedite PO.
- Record receiving variance and assign owner.
- Notify affected dispatch owner(s) from shortage card.
- Approve substitution and link to impacted work order.

### Failure/empty states and observability cues
- **Empty:** "No reservations due" and "No open receiving exceptions" with date/window context.
- **Failure:** inventory write conflict, stale stock snapshot, or PO transition rejection must include deterministic retry path.
- **Observability cues:** watch `inventory.part_reserved`, `inventory.shortage_detected`, PO exception counts, and shortage-to-resolution time.

## Trainer dashboard

### Primary goals in first 15 minutes of shift
- Identify overdue and due-today OJT assignments.
- Verify technicians on today’s work have required SOP/OJT readiness.
- Prioritize coaching interventions that unblock production.
- Confirm evidence/approval backlog is under control.

### Recommended dashboard modules/cards
- **Team Assignment Status** (`SOP/OJT`): due, overdue, and blocked assignment counts with link to `/training/assignments`.
- **Production Readiness by Technician** (`SOP/OJT` + `Tickets`): readiness map for currently assigned work.
- **Evidence Approval Queue** (`SOP/OJT`): pending step validations requiring trainer action.
- **Certification/Recertification Risk** (`SOP/OJT`): expiring credentials that affect scheduling.
- **Exception Escalations** (`SOP/OJT` + `Shop floor ops`): unresolved blocked learning steps tied to active jobs.

### Alert priorities and escalation cues
- **P1:** Compliance-critical step incomplete for active assignment, expired certification on scheduled technician.
- **P2:** Overdue assignments likely to impact near-term dispatch quality.
- **P3:** Upcoming recertification and low-risk backlog growth.
- **Escalation cues:** overdue age crosses policy window, repeat failures by same assignee, or blocked step without owner.

### Quick actions
- Assign/reassign training module.
- Open SOP revision and approve/reject evidence.
- Create coaching action linked to ticket/work order.
- Escalate exception to shop manager when production risk is immediate.
- Message assignee with due-time expectation.

### Failure/empty states and observability cues
- **Empty:** "No due assignments" with upcoming window preview to avoid false idle signal.
- **Failure:** missing SOP content, evidence save conflict, or assignment update failure should expose clear retry + escalation option.
- **Observability cues:** monitor `ojt.assignment_created`, `ojt.step_completed`, overdue-assignment age, and evidence approval latency.

## Accounting/admin dashboard

### Primary goals in first 15 minutes of shift
- Triage failed/stale accounting sync jobs and protect financial close integrity.
- Work reconciliation exceptions that affect customer/dealer billing confidence.
- Confirm integration health and high-risk admin/audit signals.
- Validate privileged access changes and operational controls.

### Recommended dashboard modules/cards
- **Sync Failure Queue** (`Accounting Integration`): failed/pending jobs from `/accounting/sync` with aging + retry state.
- **Reconciliation Exceptions** (`Accounting Integration`): unmatched invoices/payments and variance buckets from `/accounting/reconciliation`.
- **Customer/Dealer Billing Impact** (`Customer & Dealer Ops` + `Accounting Integration`): account-level issues needing outreach or correction.
- **Integration Health** (`Admin` + `Platform Controls`): connector status, last-success timestamp, and stale-data indicators.
- **Audit & Access Alerts** (`Admin` + `Identity & Access`): role changes, suspicious access, and policy exceptions.

### Alert priorities and escalation cues
- **P1:** `accounting.sync_failed` aging beyond policy, high-value reconciliation mismatch, or unauthorized privileged-role mutation.
- **P2:** repeated retry failures, rising reconciliation backlog, delayed integration jobs approaching close window.
- **P3:** informational drift and low-severity audit notices.
- **Escalation cues:** failure age threshold exceeded, retries exhausted, or audit alert without assigned owner.

### Quick actions
- Retry failed sync job with preserved correlation context.
- Open reconciliation item and post resolution note.
- Assign owner for financial exception.
- Lock/suspend user access for urgent admin control action.
- Open incident handoff with linked audit/integration evidence.

### Failure/empty states and observability cues
- **Empty:** explicit "No sync failures" / "No reconciliation exceptions" states with last refresh timestamp.
- **Failure:** partial sync timeline, retry rejection, or audit feed read failure must show stale-data banner and escalation CTA.
- **Observability cues:** track `accounting.sync_started`, `accounting.sync_failed`, retry success rate, failure age p95, and admin alert acknowledgment times.
