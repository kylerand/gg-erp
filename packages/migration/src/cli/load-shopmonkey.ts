#!/usr/bin/env tsx
/**
 * load-shopmonkey.ts
 *
 * Full ShopMonkey → ERP migration orchestrator.
 *
 * Runs all waves in dependency order against a ShopMonkey export JSON file:
 *   A  → Seed location, integration account, migration system user
 *   B  → Users → identity.users + hr.employees
 *   D  → Customers + Vehicles → customers.customers + planning.cart_vehicles
 *   C  → Inventory Parts → inventory.parts
 *   F  → Vendors + Purchase Orders → inventory.vendors / purchase_orders
 *   G  → Work Orders + Operations + Parts → work_orders.*
 *   H  → Inspection Templates (optional, from SM API)
 *
 * Usage:
 *   npx tsx --env-file=../../.env packages/migration/src/cli/load-shopmonkey.ts <export.json> [options]
 *
 * Options:
 *   --dry-run       Simulate without writing to DB
 *   --skip=B,E      Skip specific waves (comma-separated)
 *   --only=A,D      Run only these waves (comma-separated)
 *   --with-h        Include Wave H (inspection templates from SM API, requires SM_EMAIL + SM_PASSWORD)
 *
 * Requires:
 *   DB_DATABASE_URL in environment (or loaded via --env-file)
 */

import { PrismaClient } from '@prisma/client';
import { runWaveA } from '../loaders/wave-a.loader.js';
import { runWaveB } from '../loaders/wave-b.loader.js';
import { runWaveC } from '../loaders/wave-c.loader.js';
import { runWaveD } from '../loaders/wave-d.loader.js';
import { runWaveF } from '../loaders/wave-f.loader.js';
import { runWaveG } from '../loaders/wave-g.loader.js';
import { runWaveH } from '../loaders/wave-h.loader.js';
import type { LoadResult } from '../loaders/loader.js';

// ─── Config ──────────────────────────────────────────────────────────────────

interface RunConfig {
  exportFile: string;
  dryRun: boolean;
  skipWaves: Set<string>;
  onlyWaves: Set<string> | null;
  withH: boolean;
}

function parseArgs(): RunConfig {
  const args = process.argv.slice(2);
  const exportFile = args.find(a => !a.startsWith('-'));
  const dryRun = args.includes('--dry-run');
  const withH = args.includes('--with-h');

  const skipArg = args.find(a => a.startsWith('--skip='));
  const skipWaves = new Set(skipArg ? skipArg.replace('--skip=', '').split(',').map(s => s.trim().toUpperCase()) : []);

  const onlyArg = args.find(a => a.startsWith('--only='));
  const onlyWaves = onlyArg
    ? new Set(onlyArg.replace('--only=', '').split(',').map(s => s.trim().toUpperCase()))
    : null;

  if (!exportFile) {
    console.error('Usage: load-shopmonkey.ts <shopmonkey-export.json> [--dry-run] [--skip=B,E] [--only=A,D] [--with-h]');
    process.exit(1);
  }

  return { exportFile, dryRun, skipWaves, onlyWaves, withH };
}

function shouldRun(wave: string, config: RunConfig): boolean {
  if (config.onlyWaves) return config.onlyWaves.has(wave);
  return !config.skipWaves.has(wave);
}

// ─── Pretty printing ─────────────────────────────────────────────────────────

interface WaveReport {
  wave: string;
  label: string;
  results: Array<{ entity: string } & LoadResult>;
  durationMs: number;
  status: 'ok' | 'error' | 'skipped';
  error?: string;
}

function printResult(label: string, r: LoadResult): void {
  const status = r.errors === 0 ? '✅' : '⚠️ ';
  console.log(`  ${status} ${label}: ${r.inserted} inserted, ${r.skipped} skipped, ${r.errors} errors (batch: ${r.batchId})`);
}

function printSummary(reports: WaveReport[]): void {
  console.log('\n' + '═'.repeat(72));
  console.log('  MIGRATION SUMMARY');
  console.log('═'.repeat(72));

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const rpt of reports) {
    if (rpt.status === 'skipped') {
      console.log(`  ⏭️  Wave ${rpt.wave} (${rpt.label}): SKIPPED`);
      continue;
    }

    const icon = rpt.status === 'ok' ? '✅' : '❌';
    const durationSec = (rpt.durationMs / 1000).toFixed(1);

    for (const r of rpt.results) {
      console.log(`  ${icon} Wave ${rpt.wave} – ${r.entity}: ${r.inserted} inserted, ${r.skipped} skipped, ${r.errors} errors  (${durationSec}s)`);
      totalInserted += r.inserted;
      totalSkipped += r.skipped;
      totalErrors += r.errors;
    }

    if (rpt.error) {
      console.log(`     Error: ${rpt.error}`);
    }
  }

  console.log('─'.repeat(72));
  console.log(`  TOTAL: ${totalInserted} inserted, ${totalSkipped} skipped, ${totalErrors} errors`);
  console.log('═'.repeat(72) + '\n');
}

// ─── Wave runners ─────────────────────────────────────────────────────────────

async function runTracked(
  wave: string,
  label: string,
  fn: () => Promise<LoadResult | Record<string, LoadResult>>,
): Promise<WaveReport> {
  console.log(`\n🚀 Wave ${wave} — ${label}`);
  const start = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - start;

    // Normalize to array of results
    let results: Array<{ entity: string } & LoadResult>;
    if ('batchId' in result) {
      results = [{ entity: label, ...(result as LoadResult) }];
    } else {
      results = Object.entries(result as Record<string, LoadResult>).map(([entity, r]) => ({
        entity, ...r,
      }));
    }

    for (const r of results) {
      printResult(r.entity, r);
    }

    const hasErrors = results.some(r => r.errors > 0);
    return { wave, label, results, durationMs, status: hasErrors ? 'error' : 'ok' };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ ${label}: FAILED — ${message}`);
    return { wave, label, results: [], durationMs, status: 'error', error: message };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();
  const prisma = new PrismaClient();
  const reports: WaveReport[] = [];

  console.log('╔' + '═'.repeat(70) + '╗');
  console.log('║  ShopMonkey → Golfin Garage ERP Migration                            ║');
  console.log('╚' + '═'.repeat(70) + '╝');
  console.log(`\n  Export file: ${config.exportFile}`);
  console.log(`  Dry run:    ${config.dryRun}`);
  if (config.skipWaves.size) console.log(`  Skipping:   ${[...config.skipWaves].join(', ')}`);
  if (config.onlyWaves) console.log(`  Only:       ${[...config.onlyWaves].join(', ')}`);

  try {
    // Wave A — Seeds
    if (shouldRun('A', config)) {
      reports.push(await runTracked('A', 'Seeds (location, integration, system user)', () =>
        runWaveA(prisma, config.dryRun),
      ));
    } else {
      reports.push({ wave: 'A', label: 'Seeds', results: [], durationMs: 0, status: 'skipped' });
    }

    // Wave B — Users / Employees
    if (shouldRun('B', config)) {
      reports.push(await runTracked('B', 'Users / Employees', () =>
        runWaveB(prisma, config.exportFile, config.dryRun),
      ));
    } else {
      reports.push({ wave: 'B', label: 'Users / Employees', results: [], durationMs: 0, status: 'skipped' });
    }

    // Wave D — Customers + Vehicles
    if (shouldRun('D', config)) {
      reports.push(await runTracked('D', 'Customers + Vehicles', () =>
        runWaveD(prisma, config.exportFile, undefined, config.dryRun),
      ));
    } else {
      reports.push({ wave: 'D', label: 'Customers + Vehicles', results: [], durationMs: 0, status: 'skipped' });
    }

    // Wave C — Inventory Parts
    if (shouldRun('C', config)) {
      reports.push(await runTracked('C', 'Inventory Parts', () =>
        runWaveC(prisma, config.exportFile, config.dryRun),
      ));
    } else {
      reports.push({ wave: 'C', label: 'Inventory Parts', results: [], durationMs: 0, status: 'skipped' });
    }

    // Wave F — Vendors + Purchase Orders
    if (shouldRun('F', config)) {
      reports.push(await runTracked('F', 'Vendors + Purchase Orders', () =>
        runWaveF(prisma, config.exportFile, config.dryRun),
      ));
    } else {
      reports.push({ wave: 'F', label: 'Vendors + POs', results: [], durationMs: 0, status: 'skipped' });
    }

    // Wave G — Work Orders (all)
    if (shouldRun('G', config)) {
      reports.push(await runTracked('G', 'Work Orders', () =>
        runWaveG(prisma, config.exportFile, config.dryRun),
      ));
    } else {
      reports.push({ wave: 'G', label: 'Work Orders', results: [], durationMs: 0, status: 'skipped' });
    }

    // Wave H — Inspection Templates (optional, from API)
    if (config.withH && shouldRun('H', config)) {
      reports.push(await runTracked('H', 'Inspection Templates', () =>
        runWaveH(`load-all-${Date.now()}`, config.dryRun).then(r => ({
          batchId: r.batchId,
          wave: r.wave,
          inserted: r.inserted,
          skipped: r.skipped,
          errors: r.errors,
        })),
      ));
    } else if (config.withH) {
      reports.push({ wave: 'H', label: 'Inspection Templates', results: [], durationMs: 0, status: 'skipped' });
    }

    // ── Reconciliation ────────────────────────────────────────────────────
    console.log('\n📊 Running reconciliation...');

    const entityCounts = [
      { entity: 'EMPLOYEE', label: 'Users/Employees' },
      { entity: 'CUSTOMER', label: 'Customers' },
      { entity: 'ASSET', label: 'Vehicles' },
      { entity: 'INVENTORY_PART', label: 'Parts' },
      { entity: 'VENDOR', label: 'Vendors' },
      { entity: 'PURCHASE_ORDER', label: 'Purchase Orders' },
      { entity: 'WORK_ORDER', label: 'Work Orders' },
    ];

    console.log('\n  Entity             Imported    In DB');
    console.log('  ' + '─'.repeat(45));

    for (const { entity, label } of entityCounts) {
      const mapped = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM integrations.external_id_mappings
        WHERE namespace = 'shopmonkey:v1' AND entity_type = ${entity}
      `;
      console.log(`  ${label.padEnd(20)} ${String(Number(mapped[0]?.count ?? 0)).padStart(8)}`);
    }

    // Print final summary
    printSummary(reports);

    const hasFailures = reports.some(r => r.status === 'error');
    process.exit(hasFailures ? 1 : 0);
  } catch (err) {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
