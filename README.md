# Golfin Garage ERP (AWS)

TypeScript monorepo foundation for a custom AWS-hosted ERP. This repository is intentionally MVP-first while preserving extension points for phased growth.

## Why this layout

- **Clear modularity**: domain boundaries are explicit and map to bounded contexts.
- **AWS-first**: infrastructure contracts are represented in Terraform module folders.
- **Operational safety**: audit, events, observability, and migrations are first-class artifacts.
- **Low early-stage cost**: serverless-first runtime with Aurora PostgreSQL Serverless v2.

## Repository structure

```text
erp/
  apps/
    api/                 # API composition layer and bounded-context services
    web/                 # Employee web shell and feature scaffolds
    workers/             # Async event consumers and job handlers
  packages/
    domain/              # Canonical domain contracts (types/events/audit/obs)
    db/                  # Prisma schema/migrations and repository adapters
    auth/                # Shared auth primitives (JWT/RBAC/password/session)
    events/              # Event contracts, bus abstractions, outbox helpers
    ui/                  # Shared UI models/tokens/components
    scheduling/          # Deterministic slot-planning engine primitives
    ai/                  # AI provider ports and service handlers
    test-utils/          # Cross-project contract and architecture checks
  infra/
    terraform/
      envs/dev/          # Environment composition
      envs/prod/         # Production environment composition
      modules/           # Reusable AWS modules
      versions.tf        # Terraform + provider version pinning
  docs/architecture/     # Principal architecture deliverables
  .github/workflows/     # CI/CD automation scaffolding
```

## Standards enforced in architecture

- TypeScript throughout implementation artifacts.
- Prefer modular code over abstraction-heavy patterns.
- Repository/service patterns only where they improve maintainability.
- Every design choice includes rationale and tradeoffs.
- Tests and explicit failure cases included in architecture and contracts.
- Audit logging points, event emission points, and observability hooks included by default.
- Migrations are mandatory and versioned.

## Key architecture documents

- `docs/architecture/erp-system-context.md`
- `docs/architecture/bounded-contexts.md`
- `docs/architecture/data-ownership.md`
- `docs/architecture/flows-sync-vs-async.md`
- `docs/architecture/aws-service-mapping.md`
- `docs/architecture/risks-and-tradeoffs.md`
- `docs/architecture/mvp-vs-phase2.md`
- `docs/architecture/migration-from-shopmonkey.md`
- `docs/architecture/decision-log.md`
- `docs/architecture/authn-authz-implementation-plan.md`

## Validation commands

```bash
npm install
npm run setup:dev
npm run db:up
npm run db:migrate
npm run dev:stack
```

For day-to-day quality checks:

```bash
npm run lint
npm test
npm run typecheck
npm run db:schema:check
npm run db:migrations:check
npm run bootstrap:check
```

## Plan progress dashboard (terminal)

Visualize implementation progress from plan docs directly in the terminal:

```bash
npm run progress:plans
```

Optional: scope to a specific plan file/folder or emit JSON for automation.

```bash
npm run progress:plans -- --path docs/architecture/employee-web-api-dependency-map.md
npm run progress:plans -- --path docs/architecture --json
```

## Local PostgreSQL (Docker)

- `docker-compose.yml` defines a local PostgreSQL 16 instance on `localhost:5432`.
- Primary DB: `gg_erp`, plus test DB bootstrap script: `infra/docker/postgres/init/01-create-test-db.sql`.
- Useful commands:
  - `npm run db:up`
  - `npm run db:down`
  - `npm run db:logs`
  - `npm run db:reset`

## CI pipeline outline

`/.github/workflows/ci.yml` runs:
1. dependency install (`npm ci`)
2. lint
3. typecheck
4. tests
5. Prisma schema integrity
6. migration integrity
7. monorepo bootstrap structure verification
