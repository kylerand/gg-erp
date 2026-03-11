# Employee Web Information Architecture

## Scope and operating assumptions

This IA defines the authenticated employee app shell for MVP, with explicit growth paths to phase 2.

Assumptions applied:
- Navigation is role-conditional but task-oriented; users should reach primary actions in 1 click from global nav.
- `Customer & Dealer Ops` is a first-class operational area (not nested under reporting/admin).
- MVP route depth is intentionally shallow (max 2 levels under a top-level section).

## Global navigation tree (MVP)

```text
Employee App
├── Dashboard (/)
├── Work Orders (/work-orders)
│   ├── My Queue (/work-orders/my-queue)
│   ├── Dispatch Board (/work-orders/dispatch)
│   └── Open/Blocked (/work-orders/open)
├── Inventory (/inventory)
│   ├── Part Lookup (/inventory/parts)
│   ├── Reservations (/inventory/reservations)
│   └── Receiving & Counts (/inventory/receiving)
├── Customer & Dealer Ops (/customer-dealers)
│   ├── Customers (/customer-dealers/customers)
│   ├── Dealers (/customer-dealers/dealers)
│   └── Customer-Dealer Relationships (/customer-dealers/relationships)
├── Training (/training)
│   ├── My OJT (/training/my-ojt)
│   ├── Team Assignments (/training/assignments)
│   └── SOP Library (/training/sop)
├── Planning (/planning)
│   └── Build Slot Planner (/planning/slots)
├── Accounting (/accounting)
│   ├── Sync Monitor (/accounting/sync)
│   └── Reconciliation (/accounting/reconciliation)
├── Reporting (/reporting)
└── Admin (/admin)
    ├── User Access (/admin/access)
    ├── Audit Trail (/admin/audit)
    └── Integration Health (/admin/integrations)
```

### Top-level route contract (implementation-oriented)

| Section | Route prefix | Core MVP jobs-to-be-done | Base permission gate (MVP) |
|---|---|---|---|
| Dashboard | `/` | Resume interrupted work, view queue counts, alerts | Authenticated user |
| Work Orders | `/work-orders` | Execute and dispatch service/build tickets | `work_orders:read` (`work_orders:write` for mutations) |
| Inventory | `/inventory` | Find/reserve/receive parts | `inventory:read` (`inventory:write` for mutations) |
| Customer & Dealer Ops | `/customer-dealers` | Manage customer records and dealer relationships for operations + billing | `customers:read` (`customers:write` for mutations) |
| Training | `/training` | Execute/assign OJT and SOP progression | Training permission group (add in nav config) |
| Planning | `/planning` | Run and review build-slot plans | Planner permission group |
| Accounting | `/accounting` | Monitor QuickBooks sync + resolve reconciliation issues | Accounting permission group |
| Reporting | `/reporting` | Role-specific operational and financial KPIs | `reports:read` |
| Admin | `/admin` | Access controls, audit, integration health | Admin-only gate |

## Role-conditional navigation

### Access legend
- `RW` = read/write
- `R` = read-only
- `S` = scoped (limited views/actions)
- `-` = hidden

| Section | Technician | Shop manager | Parts manager | Trainer | Accounting/admin |
|---|---:|---:|---:|---:|---:|
| Dashboard | R | R | R | R | R |
| Work Orders | RW (assigned work) | RW | R | R | R |
| Inventory | R | R | RW | R | R |
| Customer & Dealer Ops | R | RW | RW (dealer/availability focus) | R | RW |
| Training | RW (my OJT) | RW (assign/track) | R | RW | R |
| Planning | R | RW | R (demand visibility) | - | R |
| Accounting | - | S (status only) | - | - | RW |
| Reporting | S (personal) | R | R | R | RW |
| Admin | - | S (team setup if delegated) | - | - | RW |

### Default landing by role

| Role | Default post-login landing | Why |
|---|---|---|
| Technician | `/work-orders/my-queue` | Fast path to active tickets and next actionable step |
| Shop manager | `/work-orders/dispatch` | Dispatch and bottleneck management is the primary loop |
| Parts manager | `/inventory/reservations` | Reservation/shortage handling drives throughput |
| Trainer | `/training/assignments` | Assignment status and overdue steps are primary tasks |
| Accounting/admin | `/accounting/reconciliation` | Exception resolution and sync health are first priority |

## Customer & Dealer Ops as a first-class area

`Customer & Dealer Ops` remains top-level in MVP because it is operationally shared across ticketing, planning, and accounting.

### MVP minimum sub-sections

| Sub-section | Operational use |
|---|---|
| Customers | Create/update lifecycle state; contact and billing references for work orders |
| Dealers | Dealer master profile, service relationship metadata, assignment ownership |
| Customer-Dealer Relationships | Link customer assets to dealer context for support/escalation and downstream billing/reconciliation |

### Practical implementation notes
- Keep `/customer-dealers` in global nav for any role with `customers:read`.
- Use tabbed in-page navigation for sub-sections instead of deeper route nesting.
- Add explicit breadcrumb context (`Customer > Dealer Relationship`) only within page content, not global nav.

## IA rationale and guardrails

### 1) Task-first
- Global sections mirror operational workflows (work, parts, customer/dealer, training, accounting), not org chart teams.
- Each role lands on a queue-driven page with clear next actions.
- Cross-module dependencies (e.g., ticket blocked by part shortage) are surfaced as links between top-level sections.

### 2) Shallow depth
- Max depth: top-level section + one child level.
- Deeper complexity should be handled via tabs/filters inside the page, not extra sidebar levels.
- Keep global nav stable so users do not relearn structure by role.

### 3) Interruption-resilience
- Persist per-section working context (`last route`, filters, selected record) to support rapid resume after interruptions.
- Provide a consistent “Return to my queue” affordance from all operational sections.
- Ensure in-progress forms (customer updates, reconciliation notes) auto-save draft state and recover on refresh.

## MVP -> Phase 2 extension points

| Extension point | MVP implementation | Phase 2 expansion path |
|---|---|---|
| Navigation registry | Static nav config with `requiredPermissions`, `featureFlag`, `defaultLandingByRole` | Server-driven nav payload per tenant/site (`GET /workspace/nav`) |
| Permission model | Coarse permissions (`work_orders`, `inventory`, `customers`, `reports`) + role mapping | Add granular scopes (`dealers:*`, `training:*`, site-level scope, delegated admin windows) |
| Customer & Dealer Ops | Combined top-level area for shared operations | Split into dedicated subdomains (Dealer Performance, Warranty/Claims, Account Health) without changing top-level label |
| Interruption handling | Local persisted context + resume links | Cross-device resume + centralized worklist/notification handoff |
| Reporting IA | Single reporting hub with role-filtered cards | Dedicated analytics sections per domain with saved views and subscriptions |

## Delivery checklist for implementation

1. Add nav metadata source (single file/module) used by router + sidebar renderer.
2. Filter nodes by permissions/role before render; hide inaccessible sections entirely.
3. Enforce depth guardrail in route definitions and PR review checklist.
4. Implement default role landing redirects during auth callback.
5. Track navigation telemetry by `section`, `role`, and `resume_path_used` to validate interruption-resilience.
