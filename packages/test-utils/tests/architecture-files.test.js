import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';

const requiredFiles = [
  'docs/architecture/erp-system-context.md',
  'docs/architecture/bounded-contexts.md',
  'docs/architecture/data-ownership.md',
  'docs/architecture/flows-sync-vs-async.md',
  'docs/architecture/aws-service-mapping.md',
  'docs/architecture/risks-and-tradeoffs.md',
  'docs/architecture/mvp-vs-phase2.md',
  'docs/architecture/migration-from-shopmonkey.md',
  'docs/architecture/decision-log.md',
  'docs/architecture/work-order-module-design.md',
  'docs/architecture/ticketing-rework-subsystem-design.md',
  'docs/architecture/sop-ojt-knowledge-module-design.md',
  'docs/architecture/build-slot-planning-engine-design.md',
  'docs/architecture/quickbooks-integration-layer-design.md',
  'docs/architecture/shopmonkey-migration-export-plan.md',
  'docs/architecture/domain-event-model-eventbridge-outbox.md',
  'docs/architecture/ai-layer-bedrock-knowledge-bases-design.md',
  'docs/architecture/README.md',
  'docs/architecture/employee-web-information-architecture.md',
  'docs/architecture/employee-web-screen-map.md',
  'docs/architecture/employee-web-role-dashboards.md',
  'docs/architecture/employee-web-user-journeys.md',
  'docs/architecture/employee-web-component-library.md',
  'docs/architecture/employee-web-state-strategy.md',
  'docs/architecture/employee-web-api-dependency-map.md',
  'docs/architecture/employee-web-ux-risks.md',
  'docs/architecture/authn-authz-implementation-plan.md',
  '.env.example',
  '.env.test.example',
  'vitest.workspace.ts',
  '.github/workflows/ci.yml',
  '.github/workflows/cd.yml',
  'infra/terraform/versions.tf',
  'infra/terraform/providers.tf',
  'infra/terraform/variables.tf',
  'infra/terraform/outputs.tf',
  'apps/api/src/migrations/0001_initial_schema.sql',
  'apps/api/src/migrations/0002_canonical_erp_domain.sql',
  'apps/api/src/migrations/0003_identity_authn_authz_rbac.sql',
  'apps/api/src/tests/authenticate-cognito.test.ts',
  'apps/api/src/tests/authz-middleware-guards.test.ts',
  'apps/api/src/tests/row-level-access.test.ts',
  'apps/api/src/tests/scope-evaluation.test.ts',
  'apps/api/src/tests/authz-denial-reporter.test.ts',
  'apps/workers/src/index.ts',
  'apps/workers/src/worker.ts',
  'packages/db/src/index.ts',
  'packages/db/prisma/schema.prisma',
  'packages/auth/src/index.ts',
  'packages/events/src/index.ts',
  'packages/ui/src/index.ts',
  'packages/ai/src/index.ts'
];

test('architecture deliverables exist', async () => {
  for (const filePath of requiredFiles) {
    await access(new URL(`../../../${filePath}`, import.meta.url));
  }
  assert.ok(requiredFiles.length > 0);
});
