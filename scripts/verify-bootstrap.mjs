import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

const requiredPaths = [
  'apps/web',
  'apps/api',
  'apps/workers',
  'packages/domain',
  'packages/db',
  'packages/auth',
  'packages/events',
  'packages/ui',
  'packages/scheduling',
  'packages/ai',
  'infra/terraform',
  'docker-compose.yml',
];

const requiredRootScripts = [
  'setup:dev',
  'dev',
  'dev:web',
  'dev:api',
  'dev:workers',
  'db:up',
  'db:migrate',
  'test',
  'lint',
  'typecheck',
];

const ensurePathExists = async (relativePath) => {
  const fullPath = path.join(root, relativePath);
  await access(fullPath);
};

async function main() {
  for (const requiredPath of requiredPaths) {
    await ensurePathExists(requiredPath);
  }

  const packageJsonPath = path.join(root, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));

  for (const scriptName of requiredRootScripts) {
    if (!packageJson.scripts?.[scriptName]) {
      throw new Error(`Missing root npm script: "${scriptName}"`);
    }
  }

  const composePath = path.join(root, 'docker-compose.yml');
  const composeContents = await readFile(composePath, 'utf8');
  if (!/services:\s*[\s\S]*postgres:/m.test(composeContents)) {
    throw new Error('docker-compose.yml must define a postgres service.');
  }

  console.log('Bootstrap verification passed.');
}

void main();
