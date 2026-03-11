# Employee Web Screen Map

## Scope and assumptions

- Canonical routes align to `employee-web-information-architecture.md`; temporary aliases in the current scaffold are allowed as redirects.
- Route depth stays shallow (top-level section + one child level) to support rapid navigation on shop-floor devices.
- Each screen definition includes failure/empty/error behavior and observability expectations for production support.

## Naming alignment

| Canonical route | Temporary alias (if currently implemented) | Notes |
|---|---|---|
| `/` | `/dashboard` | Dashboard remains role-conditional home surface. |
| `/work-orders/my-queue` | `/work-orders/assigned` | Technician default landing path. |
| `/work-orders/dispatch` | `/work-orders/ticket-queue` | Manager/dispatcher dispatch board. |
| `/inventory/reservations` | `/inventory/picks` | Reservation + pick execution workflow. |
| `/inventory/receiving` | `/inventory/receiving-po` | PO receiving and variance handling. |
| `/planning/slots` | `/work-orders/build-slot-planner` | Planning owns canonical planner route. |
| `/accounting/sync` | `/reporting/invoice-sync` | Accounting top-level route is canonical for sync monitor. |

## Screen map hierarchy (parent → child)

| Parent screen | Child screen | Route | Context alignment |
|---|---|---|---|
| Employee App Shell | Auth | `/auth` | Identity & Access |
| Employee App Shell | Dashboard | `/` | Employee Workspace read models |
| Employee App Shell | Work Orders | `/work-orders` | Tickets + execution hub |
| `/work-orders` | My Queue | `/work-orders/my-queue` | Technician task flow |
| `/work-orders` | Dispatch Board | `/work-orders/dispatch` | Dispatch + reassignment |
| `/work-orders` | Open / Blocked | `/work-orders/open` | Blocked triage handoff |
| `/work-orders` | SOP Runner | `/work-orders/sop-runner` | SOP/OJT execution |
| `/work-orders` | QC Checklists | `/work-orders/qc-checklists` | Quality gate |
| `/work-orders` | Time Logging | `/work-orders/time-logging` | Labor capture |
| Employee App Shell | Inventory | `/inventory` | Inventory + procurement hub |
| `/inventory` | Part Lookup | `/inventory/parts` | Part/location lookup |
| `/inventory` | Reservations | `/inventory/reservations` | Pick/shortage workflow |
| `/inventory` | Receiving & Counts | `/inventory/receiving` | PO receiving + cycle count |
| Employee App Shell | Customer & Dealer Ops | `/customer-dealers` | Shared customer/dealer operations |
| `/customer-dealers` | Customers | `/customer-dealers/customers` | Customer lifecycle |
| `/customer-dealers` | Dealers | `/customer-dealers/dealers` | Dealer profile + service metadata |
| `/customer-dealers` | Customer-Dealer Relationships | `/customer-dealers/relationships` | Relationship mapping for support/billing |
| Employee App Shell | Training | `/training` | SOP/OJT management |
| `/training` | My OJT | `/training/my-ojt` | Technician training progression |
| `/training` | Team Assignments | `/training/assignments` | Trainer/manager assignment oversight |
| `/training` | SOP Library | `/training/sop` | SOP content + revision visibility |
| Employee App Shell | Planning | `/planning` | Build planning hub |
| `/planning` | Build Slot Planner | `/planning/slots` | Slot and labor capacity planning |
| Employee App Shell | Accounting | `/accounting` | Accounting operations hub |
| `/accounting` | Sync Monitor | `/accounting/sync` | Invoice sync monitoring + retry |
| `/accounting` | Reconciliation | `/accounting/reconciliation` | Financial exception handling |
| Employee App Shell | Reporting | `/reporting` | Cross-context visibility |
| `/reporting` | Blocked Alerts | `/reporting/blocked-alerts` | Operational escalation feed |
| Employee App Shell | Admin | `/admin` | Platform controls |
| `/admin` | User Access | `/admin/access` | Privileged access management |
| `/admin` | Audit Trail | `/admin/audit` | Audit event visibility |
| `/admin` | Integration Health | `/admin/integrations` | Connector status + freshness |

## Screen inventory (required capabilities)

| Screen | Purpose | Primary roles | Key actions | Critical states (empty/loading/error/failure) |
|---|---|---|---|---|
| Dashboard | Role-based home surface for queue, blocker, and sync visibility. | All employee roles | Open priority card, jump to queue/planner/inventory/accounting. | Empty: no cards configured; Loading: workspace summary in flight; Error: read-model fetch failed; Failure: partial card timeout with stale timestamp + retry. |
| My Queue | Show actor-assigned work and next executable task. | Technician | Claim/start/pause/complete task; open SOP/QC/time panels. | Empty: no assigned work; Loading: queue fetch running; Error: queue read failed; Failure: stale/conflict transition rejection with inline reapply. |
| Dispatch Board | Balance assignments and clear queue bottlenecks. | Shop manager, Dispatcher | Reassign owner, reprioritize, escalate blockers. | Empty: no dispatch items; Loading: dispatch projection refresh; Error: dispatch feed unavailable; Failure: write conflict on reassignment/escalation. |
| Open / Blocked | Triage blocked work with SLA and ownership clarity. | Shop manager, Inventory lead | Acknowledge blocker, assign owner, escalate path. | Empty: no blockers; Loading: blocked feed loading; Error: blocked feed fetch failed; Failure: owner update conflict or escalation save failure. |
| Reservations | Execute reserve/pick flow and handle shortages. | Parts manager, Technician | Scan/confirm picks, mark shortage, request substitution. | Empty: no due reservations; Loading: reservation list loading; Error: reservation/lot read failed; Failure: insufficient stock/reservation mismatch on confirm. |
| Receiving & Counts | Receive PO lines and reconcile variances. | Parts manager, Purchasing | Record receipt, transition PO state, resolve variance. | Empty: no open receipts; Loading: PO/line data loading; Error: procurement read failed; Failure: invalid transition, over-receipt, or partial post rejection. |
| Customers | Manage customer profile/lifecycle needed for operations and billing. | Shop manager, Accounting/admin | Create/update customer, transition lifecycle state. | Empty: no customer results; Loading: search/list query; Error: customer read failed; Failure: duplicate/invalid transition with draft preserved. |
| Dealers | Maintain dealer metadata and assignment ownership. | Parts manager, Accounting/admin | Edit dealer profile, update service relationship fields. | Empty: no dealers in scope; Loading: dealer query; Error: dealer read failed; Failure: update conflict with explicit reload/reapply path. |
| Customer-Dealer Relationships | Bind customer assets to dealer context for support/escalation. | Shop manager, Parts manager, Accounting/admin | Link/unlink relationship, update escalation owner. | Empty: no relationships; Loading: relationship graph fetch; Error: relation read failed; Failure: invalid link rule or write conflict. |
| Team Assignments | Track due/overdue OJT assignments and evidence backlog. | Trainer, Shop manager | Assign/reassign modules, open approvals, escalate risk. | Empty: no due assignments; Loading: assignment status query; Error: assignment feed failed; Failure: assignment update/evidence save conflict. |
| SOP Runner + QC + Time Logging | Complete SOP/QC/time requirements for work completion. | Technician, QC Tech, Trainer | Complete steps, attach evidence, run QC, submit labor time. | Empty: no SOP/QC/time required; Loading: revision/checklist/time read; Error: content unavailable; Failure: evidence upload, QC critical fail, or time validation conflict. |
| Build Slot Planner | Publish slot/labor allocation plan for near-term work. | Planner, Shop manager | Adjust slot hours, assign work, publish/revert plan. | Empty: no plan horizon; Loading: planner model run; Error: planning inputs unavailable; Failure: capacity conflict or publish rejection. |
| Sync Monitor | Monitor invoice sync states and recover failures. | Accounting/admin, Shop manager (read-only) | Filter failed records, retry sync, escalate aging failures. | Empty: no sync exceptions; Loading: sync feed loading; Error: sync feed fetch failed; Failure: retry rejected or repeated failure threshold reached. |
| Reconciliation | Resolve accounting variances and document outcomes. | Accounting/admin | Open exception, post resolution note, assign owner. | Empty: no reconciliation exceptions; Loading: reconciliation list loading; Error: reconciliation read failed; Failure: resolution mutation conflict or external-ref mismatch. |
| Audit Trail + Integration Health | Expose privileged changes and connector status. | Accounting/admin | Review audit events, inspect integration status, initiate incident handoff. | Empty: no current alerts; Loading: feed/status loading; Error: audit/integration read failed; Failure: stale feed beyond threshold or failed privileged mutation follow-up. |
