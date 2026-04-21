# GG-ERP Hackathon Guide

We are in the same room. The goal is to ship the remaining MVP contracts,
keep the test suite green, and update `IMPLEMENTATION_STATUS.md` as things
land. This file is the coordination layer for the day.

---

## Quick commands

```bash
# Validate your changes before committing
npm run hackathon:check

# Full CI gate (run before pushing a track to done)
npm run ci:validate

# Watch mode while you work
npm run test:watch

# See where every track stands
npm run progress:plans
```

---

## Iteration loop

Each cycle should take 20–40 minutes:

1. **Pick a track** from the board below. Shout it out so no one doubles up.
2. **Write the test first.** Every new route gets a test in `apps/api/src/tests/`.
   Failure cases go in a `*-failure-cases.test.ts` file.
3. **Implement** the handler, route wiring, and any repository methods needed.
4. **Run the check** — `npm run hackathon:check`. Fix until green.
5. **Update** `docs/architecture/IMPLEMENTATION_STATUS.md` — flip the row to
   `✅ Done` and add your evidence column entry.
6. **Commit and push** with a message that names the contract:
   `feat(identity): add GET /auth/me session bootstrap contract`
7. **Tell the room.** Say which row you just closed.

---

## Track board

Tracks are ordered by dependency — upstream tracks unblock downstream ones.
Within a track, rows are ordered by priority.

### Track A — Identity & Auth
**Unblocks:** every protected route, the web dashboard session check

| Row | Contract | File to create/edit |
|-----|----------|---------------------|
| A1 | `GET /auth/me` session bootstrap | `apps/api/src/contexts/identity/` + route in `server.ts` |
| A2 | `PUT /identity/customers/:id` profile update | `apps/api/src/lambda/customers/handlers.ts` |
| A3 | Contract tests for A1 + A2 | `apps/api/src/tests/identity-contracts.test.ts` |

---

### Track B — Tickets & Time
**Unblocks:** floor-tech app, SLA visibility

| Row | Contract | File to create/edit |
|-----|----------|---------------------|
| B1 | Technician task transition tests (conflict + failure) | `apps/api/src/tests/tickets-failure-cases.test.ts` |
| B2 | `POST /tickets/:id/tasks/:taskId/transition` | `apps/api/src/contexts/tickets/` |
| B3 | `POST /planning/work-orders/:id/time-entries` | `apps/api/src/contexts/tickets/` |
| B4 | `GET /planning/work-orders/:id/time-entries` | same context |

---

### Track C — Inventory Reads
**Unblocks:** inventory dashboard, receiving workflow

| Row | Contract | File to create/edit |
|-----|----------|---------------------|
| C1 | `GET /inventory/lots` (list with filters) | `apps/api/src/contexts/inventory/` |
| C2 | `GET /inventory/lots/:id/reservations` | same context |
| C3 | `GET /inventory/purchase-orders` list + detail | same context |
| C4 | `PUT /inventory/purchase-orders/:id/receive` partial-receive | same context |
| C5 | Contract tests for C1–C4 | `apps/api/src/tests/inventory-reads.test.ts` |

---

### Track D — Planning & SOP
**Unblocks:** planner board, QC gates, technician training flows

| Row | Contract | File to create/edit |
|-----|----------|---------------------|
| D1 | `GET /planning/build-slots` query (date range, bay) | `apps/api/src/contexts/build-planning/` |
| D2 | `GET /planning/labor-capacity` | same context |
| D3 | `GET /sop/:id` + `GET /ojt/:id/progress` | `apps/api/src/contexts/sop-ojt/` |
| D4 | Contract tests for D1–D3 | `apps/api/src/tests/planning-sop-contracts.test.ts` |

---

### Track E — Accounting Monitor & Reporting
**Unblocks:** operations dashboard, finance view

| Row | Contract | File to create/edit |
|-----|----------|---------------------|
| E1 | `GET /accounting/invoices` list + filter | `apps/api/src/contexts/accounting/` |
| E2 | `POST /accounting/invoices/:id/retry-sync` | same context |
| E3 | `GET /reporting/workspace-summary` | `apps/api/src/contexts/reporting/` |
| E4 | Contract tests for E1–E3 | `apps/api/src/tests/accounting-monitor.test.ts` |

---

### Track F — Data & Migration
**Unblocks:** production cutover, reference data in all other tests

| Row | Contract | File to create/edit |
|-----|----------|---------------------|
| F1 | `0003_seed_reference_data.sql` idempotent seed migration | `packages/db/prisma/migrations/` |
| F2 | ShopMonkey migration final validation run | `npm run migrate:shopmonkey` + doc update |
| F3 | Migration contract tests | `packages/migration/src/__tests__/` |

---

## Adding a new route — checklist

- [ ] Handler function in `apps/api/src/contexts/<context>/`
- [ ] Route wired in `apps/api/src/server.ts`
- [ ] Auth guard applied (`requireAuth`, correct role)
- [ ] Audit log call included (match existing handler patterns)
- [ ] At least one happy-path test
- [ ] At least one failure/guard test
- [ ] `IMPLEMENTATION_STATUS.md` row updated

---

## Coordination rules

- **No force-pushes.** Pull before you push if you've been on a track for more
  than 30 minutes: `git pull origin claude/hackathon-testing-structure-QuJB7`
- **Tests stay green.** If you break a passing test, fix it before moving on —
  don't leave it for someone else.
- **One track per person at a time.** Announce in the room before starting.
- **Commit often.** Small commits are easier to revert and easier to review.
- **Update the status file in the same commit** that closes a row.

---

## Definition of done (per row)

A row is `✅ Done` when:
1. The endpoint returns the correct shape (validated by a test assertion).
2. Auth/RBAC guard is present and tested.
3. At least one failure case is covered.
4. `npm run hackathon:check` passes clean.
5. `IMPLEMENTATION_STATUS.md` is updated with evidence.
