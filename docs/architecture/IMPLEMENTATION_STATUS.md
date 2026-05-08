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

Last reviewed: 2026-03-20

| Feature / contract slice | Domain | Status | Owner | Evidence | Blockers | Next action |
|---|---|---|---|---|---|---|
| Auth session bootstrap contract (`GET /auth/me`) | Identity | ❌ Not Started | Team | Web client exists in `apps/web/src/features/auth/api.ts`; gap called out in `employee-web-api-dependency-map.md` | No API runtime auth route | Implement `apps/api` auth read contract and add handler tests |
| Customer create + lifecycle transition mutations | Identity | ✅ Done | Team | Covered in `employee-web-api-dependency-map.md`; runtime handlers in `apps/api/src/lambda/customers/handlers.ts` | None | Keep aligned with customer list/profile work |
| Customer list + profile update contracts | Identity | ⚠️ In Progress | Team | `GET /identity/customers` exists in `apps/api/src/server.ts`; dependency map still flags list/update closure gaps | Update contract and profile mutation route are incomplete | Add profile update route and direct contract tests |
| Technician task + rework mutation flows | Tickets | ⚠️ In Progress | Team | Mutation surfaces tracked in `employee-web-api-dependency-map.md`; partial failure coverage exists | No dedicated technician-task contract tests | Add task transition and conflict tests |
| Time entry contract for work-order execution | Tickets | ❌ Not Started | Team | Web UI exists in `apps/web/src/app/work-orders/time-logging/page.tsx` with mock fallback | No confirmed API runtime contract | Implement time-entry read/write endpoints and tests |
| SOP and OJT route/service contracts | SOP/OJT | ❌ Not Started | Team | Dependency map identifies `sop-ojt` as README-only | No runtime contracts wired | Implement route/service contracts used by SOP runner and QC flows |
| Reservation and shortage mutation path | Inventory | ✅ Done | Team | `apps/api/src/tests/inventory-failure-cases.test.ts`; `apps/api/src/tests/inventory-scaffold-coverage.test.ts` | None | Close the remaining read-model loop |
| Inventory lot and reservation read contracts (`GET /inventory/lots`) | Inventory | ❌ Not Started | Team | Web client exists in `apps/web/src/features/inventory/api.ts`; repository `listLots()` exists in `apps/api/src/contexts/inventory/inventory.repository.ts` | API read endpoint missing | Add lot list handler, route wiring, and read contract tests |
| Receiving and PO progression reads | Inventory | ✅ Done | Team | `apps/api/src/tests/inventory-reads.test.ts`; `apps/web/src/app/inventory/purchase-orders/page.tsx`; `apps/web/src/app/inventory/purchase-orders/[id]/page.tsx`; `apps/web/src/app/inventory/receiving/page.tsx` | None | Add PO create/edit/state mutations and receive-by-line hardening |
| Work-order list query contract (`GET /planning/work-orders`) | Planning | ✅ Done | Team | Route wiring in `apps/api/src/server.ts`; handler coverage in `apps/api/src/tests/work-order-lambda-handlers.test.ts` | None | Expand planner-facing read coverage |
| Build-slot planner board reads | Planning | ❌ Not Started | Team | Dependency map flags planner board queries as missing | Planner read/query APIs are missing | Add build-slot, labor-capacity, and demand projection query routes |
| Workspace summary and reporting snapshot reads | Reporting | ❌ Not Started | Team | Gap documented in `employee-web-api-dependency-map.md` and `erp-build-update-march-2026.html` | No read-model context yet | Define projection contract and freshness payload |
| Invoice sync mutation and detail flow | Accounting | ✅ Done | Team | Covered in dependency map; failure coverage referenced in `invoice-sync-failure-cases.test.ts` | None | Add list/filter monitor APIs |
| Invoice sync list/filter monitor reads | Accounting | ❌ Not Started | Team | Dependency map flags monitor workflow as partial because list/filter read is missing | No list/filter endpoint contract | Add list/filter/retry monitor APIs |
| Audit log and observability mutation baseline | Platform | ✅ Done | Team | Present across architecture docs and current mutation tests | None | Keep new mutation routes aligned with audit and observability hooks |
| ShopMonkey migration pipeline and historical backfill framework | Migration | ⚠️ In Progress | Team | Root scripts include `migrate:shopmonkey` and `extract:shopmonkey-csvs`; sprint update says pipeline is nearly ready | Final validation and rollout proving still open | Run migration validation and document cutover readiness |
| Reference data seed migration (`0003_seed_reference_data.sql`) | Database | ❌ Not Started | Team | Recommended next migration in `postgresql-rollout-and-seeding.md` | Migration not created yet | Create idempotent seed migration and validate schema/migrations |

## Working agreement

- If a detailed doc disagrees with this file, update this file first and then reconcile the supporting doc.
- If work is too large for one row, split it into contract-level slices.
- If ownership is unknown, keep `Team` temporarily instead of leaving the row out.
