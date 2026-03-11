#!/usr/bin/env tsx
/**
 * Lambda build pipeline using esbuild.
 * Bundles each Lambda handler to dist/lambdas/{name}/index.js
 *
 * Usage:
 *   npm run build:lambdas
 *   npm run build:lambdas -- --watch
 */

import { build } from 'esbuild';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync, copyFileSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

interface LambdaEntry {
  name: string;
  entry: string;
}

const lambdas: LambdaEntry[] = [
  {
    name: 'work-orders-create',
    entry: 'apps/api/src/lambda/work-orders/create.handler.ts',
  },
  {
    name: 'work-orders-list',
    entry: 'apps/api/src/lambda/work-orders/list.handler.ts',
  },
  // Add new Lambda handlers here as contexts are implemented
];

function copyPrismaEngine(outDir: string): void {
  const enginePattern = /libquery_engine.*\.so\.node/;
  const searchPaths = [
    join(root, 'node_modules/.prisma/client'),
    join(root, 'node_modules/@prisma/client'),
    join(root, 'packages/db/node_modules/.prisma/client'),
  ];

  for (const searchPath of searchPaths) {
    if (!existsSync(searchPath)) continue;
    const files = readdirSync(searchPath).filter(f => enginePattern.test(f));
    for (const file of files) {
      const src = join(searchPath, file);
      const dest = join(outDir, file);
      copyFileSync(src, dest);
      console.log(`  ↳ Copied Prisma engine: ${file}`);
      return;
    }
  }
  // Not found is OK during local dev (native binary used instead)
  console.log('  ↳ Prisma engine binary not found (OK for local dev, required for Lambda deploy)');
}

async function buildLambda(lambda: LambdaEntry): Promise<void> {
  const outDir = join(root, 'dist', 'lambdas', lambda.name);
  mkdirSync(outDir, { recursive: true });

  const outfile = join(outDir, 'index.js');

  await build({
    entryPoints: [join(root, lambda.entry)],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile,
    // aws-sdk v3 is available in Lambda runtime; prisma client must be bundled
    external: [
      '@aws-sdk/*',
    ],
    minify: false,
    sourcemap: true,
    metafile: true,
    logLevel: 'info',
  });

  console.log(`✓ Built ${lambda.name} → dist/lambdas/${lambda.name}/index.js`);
  copyPrismaEngine(outDir);
}

async function main(): Promise<void> {
  console.log(`Building ${lambdas.length} Lambda functions...`);

  try {
    await Promise.all(lambdas.map(buildLambda));
    console.log('\n✅ All Lambda functions built successfully');
  } catch (err) {
    console.error('❌ Build failed:', err);
    process.exit(1);
  }
}

main();
