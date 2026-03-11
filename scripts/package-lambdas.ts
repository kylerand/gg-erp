#!/usr/bin/env tsx
/**
 * Lambda packaging pipeline.
 * Zips each built Lambda bundle from dist/lambdas/{name}/ to dist/lambdas/{name}.zip
 *
 * Usage:
 *   npm run package:lambdas
 *
 * Prerequisites: npm run build:lambdas must run first.
 */

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist', 'lambdas');

function getBuiltFunctions(): string[] {
  if (!existsSync(distDir)) {
    throw new Error(`dist/lambdas directory not found. Run 'npm run build:lambdas' first.`);
  }
  return readdirSync(distDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

function zipFunction(name: string): void {
  const sourceDir = join(distDir, name);
  const zipPath = join(distDir, `${name}.zip`);

  if (!existsSync(join(sourceDir, 'index.js'))) {
    throw new Error(`No index.js found for ${name}. Run 'npm run build:lambdas' first.`);
  }

  execSync(`cd "${sourceDir}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });
  console.log(`✓ Packaged ${name} → dist/lambdas/${name}.zip`);
}

async function main(): Promise<void> {
  const functions = getBuiltFunctions();
  console.log(`Packaging ${functions.length} Lambda functions...`);

  for (const fn of functions) {
    zipFunction(fn);
  }

  console.log('\n✅ All Lambda functions packaged');
  console.log('\nZip files created:');
  for (const fn of functions) {
    console.log(`  dist/lambdas/${fn}.zip`);
  }
}

main().catch(err => {
  console.error('❌ Packaging failed:', err);
  process.exit(1);
});
