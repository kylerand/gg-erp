# Implementation Status

This file is the single source of truth for MVP implementation completion.

Use it to answer:
- what is done
- what is in progress
- what is blocked
- what still has to ship before MVP

Update this file in the same PR that changes implementation status. Supporting documents such as the dependency map, decision log, and sprint updates remain evidence sources, not competing trackers.

## Status rules

- `✅ Done`: implemented and evidenced by code, tests, handlers, migrations, or shipped contracts
- `⚠️ In Progress`: active implementation exists, but required contracts, tests, or read paths are still incomplete
- `⚠️ In Review`: implementation is complete enough for review, but validation or sign-off is still pending
- `❌ Blocked`: known blocker is preventing completion
- `❌ Not Started`: identified and scoped, but no implementation has landed yet

## Update rules

- Track feature slices or contract slices, not tiny code tasks.
- Every `✅ Done` row must include evidence.
- Use `Next action` to make the next move obvious.
- Keep detailed technical rationale in the architecture docs and ADRs.
- Keep runtime business data out of this file.

## MVP tracker

Last reviewed: 2026-05-21

| Feature / contract slice | Domain | Status | Owner | Evidence | Blockers | Next action |
|---|---|---|---|---|---|---|
| Auth session bootstrap contract (`GET /auth/me`) | Identity | ✅ Done | Team | Runtime handler in `apps/api/src/lambda/identity/handlers.ts`; Lambda entry `apps/api/src/lambda/identity/me.handler.ts`; local route in `apps/api/src/server.ts`; API Gateway JWT route in `infra/terraform/modules/api-gateway-lambda/main.tf`; build entry in `scripts/build-lambdas.ts`; focused coverage in `apps/api/src/tests/auth-me.test.ts`; web client in `apps/web/src/features/auth/api.ts` | None for the `GET /auth/me` contract | Keep payload aligned with role/permission UI and track true floor-tech SSO handoff separately because the current app switch is a cross-origin link, not a session handoff |
| Customer create + lifecycle transition mutations | Identity | ✅ Done | Team | Covered in `employee-web-api-dependency-map.md`; runtime handlers in `apps/api/src/lambda/customers/handlers.ts` | None | Keep aligned with customer list/profile work |
| Customer list + profile update contracts | Identity | ✅ Done | Team | `GET /identity/customers` and `PATCH /identity/customers/{id}` route wiring in `apps/api/src/server.ts`; customer handlers in `apps/api/src/lambda/customers/handlers.ts`; work-order customer drawer save path in `apps/web/src/app/work-orders/[id]/page.tsx`; coverage in `apps/api/src/tests/customer-cart-profile-editing.test.ts` | None | Expand standalone customer/dealer CRM history and asset relationship views |
| Technician task + rework mutation flows | Tickets | ⚠️ In Progress | Team | Technician task and rework route wiring in `apps/api/src/server.ts`; dispatch and work-order execution screens call live routes; rework coverage exists in ticket/QC tests | Dedicated conflict coverage is still thinner than other workflow areas | Add focused technician-task assignment/start/complete conflict tests and stale-row UI recovery |
| Time entry contract for work-order execution | Tickets | ✅ Done | Team | `GET/POST/PATCH/DELETE /tickets/time-entries` route wiring in `apps/api/src/server.ts`; UI in `apps/web/src/app/work-orders/time-logging/page.tsx`; coverage in `apps/api/src/tests/time-entry.test.ts` | None | Add richer labor costing reports and payroll/accounting handoff later |
| SOP and OJT route/service contracts | SOP/OJT | ✅ Done | Team | Runtime route families in `apps/api/src/lambda/sop` and server wiring; training state coverage in `apps/api/src/tests/sop-training-state.test.ts`; repaired training UI, live API calls, manager assignment creation, and supervisor sign-off actions in the web app | None for current runtime contracts | Add content authoring/editing once those APIs are designed |
| Reservation and shortage mutation path | Inventory | ✅ Done | Team | `apps/api/src/tests/inventory-failure-cases.test.ts`; `apps/api/src/tests/inventory-scaffold-coverage.test.ts` | None | Close the remaining read-model loop |
| Inventory lot and reservation read contracts (`GET /inventory/lots`) | Inventory | ✅ Done | Team | `GET /inventory/lots` route wiring in `apps/api/src/server.ts`; handler coverage in `apps/api/src/tests/inventory-lambda-handlers.test.ts` and `apps/api/src/tests/inventory-reads.test.ts`; reservation UI in `apps/web/src/app/inventory/reservations/page.tsx` | None | Add stock movement history and item edit workflows |
| Receiving, PO progression, replenishment, default-vendor assignment, variance, payable handoff, import/export, and bulk row actions | Inventory/Accounting | ✅ Done | Team | `apps/api/src/tests/inventory-reads.test.ts`; `apps/api/src/tests/inventory-lambda-handlers.test.ts`; `apps/web/src/app/inventory/parts/page.tsx`; `apps/web/src/app/inventory/purchase-orders/page.tsx`; `apps/web/src/app/inventory/purchase-orders/[id]/page.tsx`; `apps/web/src/app/inventory/receiving/page.tsx`; `apps/web/src/app/inventory/planning/page.tsx`; `apps/web/src/app/accounting/page.tsx`; `apps/web/src/app/accounting/sync/page.tsx` | None | Expand broader item editing and BOM selectors when mutation APIs are stable |
| Work-order list query contract (`GET /planning/work-orders`) | Planning | ✅ Done | Team | Route wiring in `apps/api/src/server.ts`; build-package summary support in `apps/api/src/lambda/work-orders/handlers.ts`; handler coverage in `apps/api/src/tests/work-order-lambda-handlers.test.ts`; live selector wiring in `apps/web/src/app/work-orders/new/page.tsx` | None for derived package history | Replace derived build-package history with dedicated build configuration and BOM management once those catalogs are stable |
| Build-slot planner board reads | Planning | ⚠️ In Progress | Team | `GET /scheduling/slots` and `GET /scheduling/labor-capacity` route wiring in `apps/api/src/server.ts`; coverage in `apps/api/src/tests/build-planning-reads.test.ts`; UI in `apps/web/src/app/planning/slots/page.tsx` | Demand projection/read-model maturity remains incomplete | Add work-order demand projection query and conflict/freshness payloads |
| Workspace summary and reporting snapshot reads | Reporting | ⚠️ In Progress | Team | `GET /workspace/today` route wiring in `apps/api/src/server.ts`; coverage in `apps/api/src/tests/workspace-today.test.ts`; reporting registry and saved/export flows in `packages/domain/src/erp-reports.ts` and reporting pages | No single cross-module reporting snapshot/read-model contract yet | Define report freshness, subscription, and summary projection contracts |
| Invoice sync mutation and detail flow | Accounting | ✅ Done | Team | Covered in dependency map; failure coverage referenced in `invoice-sync-failure-cases.test.ts` | None | Add list/filter monitor APIs |
| Invoice sync list/filter monitor reads | Accounting | ✅ Done | Team | `GET /accounting/invoice-sync` and retry route wiring in `apps/api/src/server.ts`; web client in `apps/web/src/lib/api-client.ts`; monitor UI in `apps/web/src/app/accounting/sync/page.tsx` | None | Add escalation subscriptions and deeper financial report integration |
| Audit log and observability mutation baseline | Platform | ✅ Done | Team | Present across architecture docs and current mutation tests | None | Keep new mutation routes aligned with audit and observability hooks |
| ShopMonkey migration pipeline and historical backfill framework | Migration | ⚠️ In Progress | Team | Root scripts include `migrate:shopmonkey` and `extract:shopmonkey-csvs`; sprint update says pipeline is nearly ready | Final validation and rollout proving still open | Run migration validation and document cutover readiness |
| Reference data seed migration and production seed readiness | Database | ⚠️ In Progress | Team | Prisma seed and inventory master seed paths are active; canonical migrations and inventory scaffold migrations exist under `apps/api/src/migrations` | Dedicated idempotent production reference-data migration still needs final review | Create/verify idempotent seed migration and validate schema/migrations against staging data |

## Working agreement

- If a detailed doc disagrees with this file, update this file first and then reconcile the supporting doc.
- If work is too large for one row, split it into contract-level slices.
- If ownership is unknown, keep `Team` temporarily instead of leaving the row out.
