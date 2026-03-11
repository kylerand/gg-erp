import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const testFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFilePath), '../../../');
const dashboardScriptPath = path.join(repoRoot, 'scripts/plan-progress.mjs');

test('plan progress dashboard aggregates checklist, status tables, and decisions', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'plan-progress-'));

  try {
    const samplePlan = `# Sample plan

- [x] Contract tests for customer mutations
- [ ] Add workspace summary read model

| Item | Existing coverage |
|---|---|
| API mutation contracts | ✅ covered by tests |
| Dashboard read models | ⚠️ Partial: read endpoint missing |
| Blocked alerts workflow | ❌ Gap: no projection route |

1. **P0:** Deliver dashboard summary read model
2. **P1:** Expand blocked-alert triage support
`;

    const sampleDecisionLog = `# ADR log

## ADR-001
- **Status:** Accepted

## ADR-002
- **Status:** Proposed
`;

    await Promise.all([
      writeFile(path.join(tempDir, 'sample-plan.md'), samplePlan, 'utf8'),
      writeFile(path.join(tempDir, 'decision-log.md'), sampleDecisionLog, 'utf8'),
    ]);

    const runResult = spawnSync(
      'node',
      [dashboardScriptPath, '--path', tempDir, '--json'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    );

    assert.equal(runResult.status, 0, runResult.stderr);
    const dashboardReport = JSON.parse(runResult.stdout);

    assert.equal(dashboardReport.scannedFiles, 2);
    assert.equal(dashboardReport.overall.totalItems, 7);
    assert.equal(dashboardReport.overall.completeItems, 3);
    assert.equal(dashboardReport.overall.partialItems, 1);
    assert.equal(dashboardReport.overall.gapItems, 3);
    assert.equal(dashboardReport.overall.completionPercent, 50);

    const samplePlanReport = dashboardReport.plans.find((plan) =>
      plan.path.endsWith('sample-plan.md'),
    );
    assert.ok(samplePlanReport);
    assert.equal(samplePlanReport.totals.totalItems, 5);
    assert.equal(samplePlanReport.totals.completeItems, 2);
    assert.equal(samplePlanReport.totals.partialItems, 1);
    assert.equal(samplePlanReport.totals.gapItems, 2);
    assert.equal(samplePlanReport.priorityItems.length, 2);
    assert.deepEqual(
      samplePlanReport.openItems.map((item) => item.label),
      ['Dashboard read models', 'Blocked alerts workflow'],
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('plan progress dashboard exits with failure on invalid path', () => {
  const runResult = spawnSync(
    'node',
    [dashboardScriptPath, '--path', 'docs/architecture/does-not-exist'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );

  assert.notEqual(runResult.status, 0);
  assert.match(runResult.stderr, /Path not found/);
});
