import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFilePath), '../../../');

test('AWS state reconcile parses declared Lambda resources and excludes stale functions', () => {
  const script = `
import importlib.util
from pathlib import Path

path = Path('scripts/reconcile-aws-state.py').resolve()
spec = importlib.util.spec_from_file_location('reconcile_aws_state', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
routes, integrations, lambdas = module.parse_tf_config()
assert len(routes) >= 200, len(routes)
assert len(integrations) >= 180, len(integrations)
assert len(lambdas) >= 190, len(lambdas)
assert 'admin_create_user' in lambdas
assert 'auth_pre_signup' not in lambdas
assert 'sop_answer_question' not in lambdas
`;

  const result = spawnSync('python3', ['-c', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NAME_PREFIX: 'gg-erp-dev',
      TF_MODULE_PATH: path.join(repoRoot, 'infra/terraform/modules/api-gateway-lambda/main.tf'),
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
