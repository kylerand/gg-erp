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
 *
 * Deterministic packaging: all files inside the zip are touched to a fixed
 * mtime and added in sorted order. `.js.map` files are excluded (runtime
 * doesn't need them; dropping them keeps zips 2-3× smaller and stops sourcemap
 * byte churn from invalidating terraform `source_code_hash`). The result: if
 * the bundled JS hasn't changed, the zip byte-hash stays identical across CI
 * runs, so terraform skips `UpdateFunctionCode` for unchanged Lambdas and CD
 * runs drop from ~15 min to 3-5 min for typical deploys.
 */

import { execSync } from 'child_process';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist', 'lambdas');
const outputDir = join(root, 'apps', 'api', 'dist');

// Fixed epoch for every file in the zip. Chosen to match DOS zip epoch + 1h so
// we don't hit pre-1980 clamping that some zip tools do.
const FIXED_MTIME = new Date('1980-01-01T12:00:00Z');

function getBuiltContexts(): string[] {
  if (!existsSync(distDir)) {
    throw new Error(`dist/lambdas directory not found. Run 'npm run build:lambdas' first.`);
  }
  return readdirSync(distDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

function collectZipFiles(sourceDir: string): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        // Exclude sourcemaps: Lambda runtime doesn't use them, they're the bulk of
        // zip size, and they change every build even when JS output is identical.
        if (full.endsWith('.js.map')) {
          try { unlinkSync(full); } catch { /* fine */ }
          continue;
        }
        results.push(relative(sourceDir, full));
      }
    }
  };
  walk(sourceDir);
  return results.sort();
}

function stabilizeMtimes(sourceDir: string, files: string[]): void {
  for (const rel of files) {
    const full = join(sourceDir, rel);
    try {
      utimesSync(full, FIXED_MTIME, FIXED_MTIME);
    } catch {
      // Non-fatal: some filesystems refuse utimes; zip will still work, hash
      // just may differ across hosts.
    }
  }
}

function zipContext(context: string): void {
  const sourceDir = join(distDir, context);
  const zipPath = join(outputDir, `${context}-lambda.zip`);

  const jsFiles = readdirSync(sourceDir).filter(f => f.endsWith('.js'));
  if (jsFiles.length === 0) {
    throw new Error(`No .js handler files found for context '${context}'. Run 'npm run build:lambdas' first.`);
  }

  // Remove any stale zip so we don't accumulate entries from a previous run.
  if (existsSync(zipPath)) {
    try { unlinkSync(zipPath); } catch { /* fine */ }
  }

  const files = collectZipFiles(sourceDir);
  stabilizeMtimes(sourceDir, files);

  // Feed sorted filenames into `zip -@` so entries are added in a stable order,
  // and use `-X` to drop extra file attributes that vary by host.
  const listFile = join(outputDir, `.${context}-filelist`);
  writeFileSync(listFile, files.join('\n') + '\n');

  try {
    execSync(`cd "${sourceDir}" && zip -X -@ "${zipPath}" < "${listFile}"`, {
      stdio: 'inherit',
    });
  } finally {
    try { unlinkSync(listFile); } catch { /* fine */ }
  }

  const sizeKb = Math.round(statSync(zipPath).size / 1024);
  console.log(`✓ Packaged ${context} (${files.length} files, ${sizeKb} KB) → apps/api/dist/${context}-lambda.zip`);
}

async function main(): Promise<void> {
  mkdirSync(outputDir, { recursive: true });

  const contexts = getBuiltContexts();
  console.log(`Packaging ${contexts.length} Lambda contexts (deterministic)...\n`);

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
