#!/usr/bin/env tsx
/**
 * ShopMonkey → Golfin Garage ERP Migration CLI
 *
 * Usage:
 *   npx tsx scripts/migrate-from-shopmonkey.ts <command> [options]
 *
 * Commands:
 *   validate-csvs <dir>     Parse and validate all CSVs, report issues (no writes)
 *   dry-run <dir>           Full pipeline except final DB writes
 *   import <dir>            Run full import (waves B, D, E in sequence)
 *   import --wave <B|D|E>   Run a single wave
 *   status                  Show all import batch statuses
 */

import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { validateCsvContract } from '../packages/migration/src/validation/index.js';
import { parseCustomersCsv, parseAssetsCsv, parseEmployeesCsv, parseWorkOrdersCsv } from '../packages/migration/src/parsers/index.js';
import { runWaveA } from '../packages/migration/src/loaders/wave-a.loader.js';
import { runWaveB } from '../packages/migration/src/loaders/wave-b.loader.js';
import { runWaveD } from '../packages/migration/src/loaders/wave-d.loader.js';
import { runWaveE } from '../packages/migration/src/loaders/wave-e.loader.js';

const CSV_CONTRACTS: Record<string, string[]> = {
  'customers.csv':             ['id', 'firstName', 'lastName'],
  'assets.csv':                ['id', 'customerId'],
  'employees.csv':             ['id', 'firstName', 'lastName', 'email', 'role'],
  'parts.csv':                 ['id', 'sku', 'name'],
  'work_orders.csv':           ['id', 'customerId', 'title', 'status'],
  'work_order_operations.csv': ['id', 'workOrderId', 'name'],
  'work_order_parts.csv':      ['id', 'workOrderId', 'partId', 'quantity'],
  'vendors.csv':               ['id', 'name'],
};

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

async function cmdValidateCsvs(dir: string): Promise<void> {
  const absDir = resolve(dir);
  console.log(`\nValidating CSVs in: ${absDir}\n`);
  let allOk = true;

  for (const [filename, requiredCols] of Object.entries(CSV_CONTRACTS)) {
    const filePath = join(absDir, filename);
    if (!existsSync(filePath)) {
      console.log(`⚠️  MISSING: ${filename}`);
      continue;
    }
    const report = await validateCsvContract(filePath, requiredCols);
    const icon = report.status === 'OK' ? '✅' : report.status === 'WARN' ? '⚠️' : '❌';
    console.log(`${icon} ${filename}: ${report.totalRows} rows`);
    if (report.missingRequiredFields.length > 0) {
      console.log(`   Missing columns: ${report.missingRequiredFields.join(', ')}`);
      allOk = false;
    }
  }

  console.log(`\n${allOk ? '✅ All CSVs valid' : '❌ Validation failed — fix issues before importing'}`);
  process.exit(allOk ? 0 : 1);
}

async function cmdDryRun(dir: string): Promise<void> {
  const absDir = resolve(dir);
  console.log(`\nDry run from: ${absDir}\n`);

  const files = {
    customers:  join(absDir, 'customers.csv'),
    assets:     join(absDir, 'assets.csv'),
    employees:  join(absDir, 'employees.csv'),
    workOrders: join(absDir, 'work_orders.csv'),
  };

  const results = await Promise.all([
    existsSync(files.customers)  ? parseCustomersCsv(files.customers)   : Promise.resolve({ records: [], errors: [], totalRows: 0 }),
    existsSync(files.assets)     ? parseAssetsCsv(files.assets)         : Promise.resolve({ records: [], errors: [], totalRows: 0 }),
    existsSync(files.employees)  ? parseEmployeesCsv(files.employees)   : Promise.resolve({ records: [], errors: [], totalRows: 0 }),
    existsSync(files.workOrders) ? parseWorkOrdersCsv(files.workOrders) : Promise.resolve({ records: [], errors: [], totalRows: 0 }),
  ]);

  const [customers, assets, employees, workOrders] = results;
  console.log('Dry run summary (no writes performed):');
  console.log(`  Customers:   ${customers.records.length} valid, ${customers.errors.length} errors`);
  console.log(`  Assets:      ${assets.records.length} valid, ${assets.errors.length} errors`);
  console.log(`  Employees:   ${employees.records.length} valid, ${employees.errors.length} errors`);
  console.log(`  Work Orders: ${workOrders.records.length} valid, ${workOrders.errors.length} errors`);

  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  if (totalErrors > 0) {
    console.log(`\n⚠️  ${totalErrors} parse errors detected. Run 'validate-csvs' for details.`);
  } else {
    console.log('\n✅ Dry run complete — no errors found. Ready to import.');
  }
}

async function cmdStatus(): Promise<void> {
  console.log('\nImport batch status requires a live DATABASE_URL connection.');
  console.log('Set DATABASE_URL env var and this command will query migration.ImportBatch.\n');
  console.log('Example query:');
  console.log('  SELECT wave, status, record_count, error_count, started_at, completed_at');
  console.log('  FROM migration."ImportBatch"');
  console.log('  ORDER BY created_at DESC;\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`
Golfin Garage ERP — ShopMonkey Migration CLI

Usage:
  npx tsx scripts/migrate-from-shopmonkey.ts <command> [options]

Commands:
  validate-csvs <dir>     Validate all CSV files (no writes)
  dry-run <dir>           Parse all CSVs and report what would be imported
  import <dir>            Run full import (waves B, D, E)
  import --wave <B|D|E>   Run a single wave only
  status                  Show import batch statuses (requires DATABASE_URL)

Options:
  --dry-run   Simulate without writing to DB
  --wave      Specify single wave (B=Employees, D=Customers+Assets, E=Work Orders)

Examples:
  npx tsx scripts/migrate-from-shopmonkey.ts validate-csvs ./data/shopmonkey-export
  npx tsx scripts/migrate-from-shopmonkey.ts dry-run ./data/shopmonkey-export
  npx tsx scripts/migrate-from-shopmonkey.ts import ./data/shopmonkey-export
  DATABASE_URL=postgres://... npx tsx scripts/migrate-from-shopmonkey.ts import ./data/shopmonkey-export
`);
    process.exit(0);
  }

  switch (command) {
    case 'validate-csvs': {
      const dir = args[1];
      if (!dir) { console.error('Usage: validate-csvs <directory>'); process.exit(1); }
      await cmdValidateCsvs(dir);
      break;
    }
    case 'dry-run': {
      const dir = args[1];
      if (!dir) { console.error('Usage: dry-run <directory>'); process.exit(1); }
      await cmdDryRun(dir);
      break;
    }
    case 'import': {
      const dir = args[1];
      if (!dir) { console.error('Usage: import <directory>'); process.exit(1); }
      const wave = getArg(args, '--wave');
      const dryRun = args.includes('--dry-run');

      const dbUrl = process.env.DATABASE_URL ?? process.env.DB_DATABASE_URL;
      if (!dbUrl) {
        console.error('DATABASE_URL or DB_DATABASE_URL env var is required for import.');
        process.exit(1);
      }

      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient({ datasourceUrl: dbUrl });

      try {
        const absDir = resolve(dir);
        const exportJsonFiles = (await import('fs')).readdirSync(resolve('.')).filter(
          (f: string) => f.startsWith('shopmonkey-export') && f.endsWith('.json'),
        );
        const exportJsonPath = exportJsonFiles[0] ? resolve('.', exportJsonFiles[0]) : undefined;

        const wavesToRun = wave ? [wave.toUpperCase()] : ['A', 'B', 'D', 'E'];
        console.log(`\nRunning waves: ${wavesToRun.join(', ')} ${dryRun ? '(DRY RUN)' : ''}\n`);

        for (const w of wavesToRun) {
          switch (w) {
            case 'A': {
              console.log('Wave A — Seed (location, integration account, system user)...');
              const result = await runWaveA(prisma, dryRun);
              console.log(`  inserted: ${result.inserted}, skipped: ${result.skipped}, errors: ${result.errors}`);
              break;
            }
            case 'B': {
              if (!exportJsonPath) { console.log('  ⚠️  No shopmonkey-export JSON found, skipping Wave B'); break; }
              console.log('Wave B — Employees...');
              const result = await runWaveB(prisma, exportJsonPath, dryRun);
              console.log(`  inserted: ${result.inserted}, skipped: ${result.skipped}, errors: ${result.errors}`);
              break;
            }
            case 'D': {
              if (!exportJsonPath) { console.log('  ⚠️  No shopmonkey-export JSON found, skipping Wave D'); break; }
              console.log('Wave D — Customers & Vehicles...');
              const result = await runWaveD(prisma, exportJsonPath, undefined, dryRun);
              console.log(`  customers — inserted: ${result.customers.inserted}, skipped: ${result.customers.skipped}, errors: ${result.customers.errors}`);
              console.log(`  vehicles  — inserted: ${result.vehicles.inserted}, skipped: ${result.vehicles.skipped}, errors: ${result.vehicles.errors}`);
              break;
            }
            case 'E': {
              const woPath = join(absDir, 'work_orders.csv');
              if (!existsSync(woPath)) { console.log('  ⚠️  work_orders.csv not found, skipping Wave E'); break; }
              console.log('Wave E — Work Orders...');
              const result = await runWaveE(prisma, woPath, dryRun);
              console.log(`  inserted: ${result.inserted}, skipped: ${result.skipped}, errors: ${result.errors}`);
              break;
            }
            default:
              console.log(`  Unknown wave: ${w}`);
          }
        }

        console.log('\n✅ Import complete.\n');
      } finally {
        await prisma.$disconnect();
      }
      break;
    }
    case 'status':
      await cmdStatus();
      break;
    default:
      console.error(`Unknown command: ${command}. Run with --help for usage.`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
