# Copilot Instructions — gg-erp

## Build, Test, and Lint

```bash
# Full validation (CI equivalent)
npm run ci:validate

# Individual commands
npm run lint                # ESLint (flat config, strict TS rules)
npm run typecheck           # tsc --noEmit
npm run format:check        # Prettier check
npm test                    # All test suites sequentially

# Run tests for a specific workspace
npm run test:api            # tsx --test "apps/api/src/tests/**/*.test.ts"
npm run test:web
npm run test:workers
npm run test:floor-tech
npm run test:migration
npm run test:architecture   # Cross-project contract checks

# Run a single test file
npx tsx --test apps/api/src/tests/work-order-create-list.integration.test.ts

# Watch mode (API + workers tests)
npm run test:watch

# Dev servers
npm run dev:stack           # DB + migrations + all apps in parallel
npm run dev:api             # API only
npm run dev:web             # Web only
npm run dev:floor-tech      # Floor tech only
```

## Database (Prisma + PostgreSQL)

```bash
npm run db:up               # Start PostgreSQL 16 via Docker (port 5432, db: gg_erp)
npm run db:migrate          # Apply Prisma migrations
npm run db:generate         # Regenerate Prisma client after schema changes
npm run db:seed             # Seed development data
npm run db:reset            # Drop volumes + recreate container
npm run db:schema:check     # Verify schema is in sync
npm run db:migrations:check # Validate migration files
```

The Prisma schema lives at `packages/db/prisma/schema.prisma`. After editing it:
1. Run `npm run db:migrate` to create a migration
2. Run `npm run db:generate` to update the Prisma client
3. Both checks are enforced in CI

## Architecture

This is a TypeScript npm-workspaces monorepo for an AWS-hosted ERP system (migrating from Shopmonkey).

### Apps

| App | Framework | Purpose |
|-----|-----------|---------|
| `apps/api` | Express | API composition layer with bounded-context routes + Lambda handlers |
| `apps/web` | Next.js (App Router) | Employee web dashboard |
| `apps/floor-tech` | Next.js (App Router) | Floor technician mobile-responsive interface |
| `apps/workers` | Custom | Async event consumers and job processors |

### Shared Packages

| Package | Purpose |
|---------|---------|
| `@gg-erp/db` | Prisma client, schema, migrations, and repository adapters |
| `@gg-erp/auth` | JWT, RBAC, permissions, roles, row-level access, session management |
| `@gg-erp/domain` | Canonical domain types, event contracts, audit definitions |
| `@gg-erp/events` | Event bus abstraction, outbox pattern helpers |
| `@gg-erp/ai` | AI provider ports (AWS Bedrock) |
| `@gg-erp/scheduling` | Deterministic slot-planning engine for work orders |
| `@gg-erp/migration` | ETL pipeline: parse → transform → deduplicate → load from Shopmonkey |
| `@gg-erp/test-utils` | Cross-project contract and architecture test helpers |
| `@gg-erp/ui` | Shared components (FormField, Button, DataTable), design tokens |

### Key Architectural Patterns

- **Bounded contexts**: The API is organized by domain context (`apps/api/src/contexts/`), each owning its routes, logic, and data access. Cross-context communication goes through domain events, not direct imports.
- **Repository pattern**: Data access is abstracted through repository files in `packages/db/src/` (e.g., `work-order.repository.ts`, `customer.repository.ts`).
- **Event-driven async**: Domain events flow through an EventBridge-based bus with an outbox pattern for guaranteed delivery. Workers consume events via `apps/workers/`.
- **Lambda-ready**: API handlers in `apps/api/src/lambda/` wrap Express routes for AWS Lambda execution behind API Gateway.
- **Auth model**: AWS Cognito for identity, with RBAC + row-level security enforced via `@gg-erp/auth` middleware.

### AWS Infrastructure

Terraform modules in `infra/terraform/modules/` define: Aurora PostgreSQL Serverless v2, API Gateway + Lambda, EventBridge, Cognito, S3, Secrets Manager, Step Functions, VPC, and observability (CloudWatch/X-Ray).

## Conventions

### Code Style (enforced)

- **No `any`**: `@typescript-eslint/no-explicit-any` is set to `error`
- **Unused vars**: Prefix with `_` to indicate intentionally unused (pattern: `^_`)
- **Prettier**: single quotes, semicolons, trailing commas, 100 char line width
- **Imports**: Use workspace package names (`@gg-erp/db`, `@gg-erp/auth`, etc.) — never relative paths across package boundaries

### Testing

- Test runner: `tsx --test` (Node.js built-in test runner with TypeScript)
- Vitest workspace configured at root for additional tooling
- Test files go in `src/tests/` or `__tests__/` directories, named `*.test.ts`
- Failure-case tests are emphasized (e.g., `inventory-failure-cases.test.ts`, `ai-failure-cases.test.ts`)
- Integration tests use the suffix `.integration.test.ts`

### API Layer

- Express middleware stack in `apps/api/src/middleware/`
- Routes organized under `apps/api/src/contexts/` by bounded context
- Audit logging is a first-class concern (`apps/api/src/audit/`)
- Observability hooks in `apps/api/src/observability/`

### Frontend (Web + Floor Tech)

- Next.js App Router with file-based routing in `src/app/`
- Tailwind CSS for styling
- Shared components from `@gg-erp/ui`
- Auth via `aws-amplify` (Cognito integration)

### Documentation

Extensive architecture docs live in `docs/architecture/` (33 documents covering bounded contexts, data ownership, event models, module designs, and decision records). Consult these before making architectural changes.
