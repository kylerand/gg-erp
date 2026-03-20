#!/usr/bin/env tsx
/**
 * Lambda packaging pipeline.
 * Zips each built Lambda context from dist/lambdas/{context}/ to apps/api/dist/{context}-lambda.zip
 * The zip name matches the Terraform variable convention: {context}-lambda.zip
 *
 * Usage:
 *   npm run package:lambdas
 *
 * Prerequisites: npm run build:lambdas must run first.
 */

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist', 'lambdas');
const outputDir = join(root, 'apps', 'api', 'dist');

function getBuiltContexts(): string[] {
  if (!existsSync(distDir)) {
    throw new Error(`dist/lambdas directory not found. Run 'npm run build:lambdas' first.`);
  }
  return readdirSync(distDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

function zipContext(context: string): void {
  const sourceDir = join(distDir, context);
  const zipPath = join(outputDir, `${context}-lambda.zip`);

  const jsFiles = readdirSync(sourceDir).filter(f => f.endsWith('.js'));
  if (jsFiles.length === 0) {
    throw new Error(`No .js handler files found for context '${context}'. Run 'npm run build:lambdas' first.`);
  }

  execSync(`cd "${sourceDir}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });
  console.log(`✓ Packaged ${context} (${jsFiles.length} handlers) → apps/api/dist/${context}-lambda.zip`);
}

async function main(): Promise<void> {
  mkdirSync(outputDir, { recursive: true });

  const contexts = getBuiltContexts();
  console.log(`Packaging ${contexts.length} Lambda contexts...\n`);

  for (const ctx of contexts) {
    zipContext(ctx);
  }

  console.log('\n✅ All Lambda contexts packaged');
  console.log('\nZip files created in apps/api/dist/:');
  for (const ctx of contexts) {
    console.log(`  ${ctx}-lambda.zip`);
  }
}

main().catch(err => {
  console.error('❌ Packaging failed:', err);
  process.exit(1);
});
