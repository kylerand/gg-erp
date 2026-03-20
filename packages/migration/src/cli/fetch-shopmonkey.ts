#!/usr/bin/env node
/**
 * fetch-shopmonkey.ts
 *
 * CLI script to export all data from ShopMonkey API and save to a JSON file.
 *
 * Usage:
 *   SM_EMAIL=you@example.com SM_PASSWORD=secret npx tsx packages/migration/src/cli/fetch-shopmonkey.ts
 *
 * Optional:
 *   SM_OUTPUT_PATH=./sm-export.json  (default: ./shopmonkey-export-<timestamp>.json)
 *   SM_CUSTOMER_CSV=./customer-export.csv  (ShopMonkey dashboard CSV export for customers)
 *
 * Because the ShopMonkey API pagination is non-deterministic, the customer CSV
 * export is used to fill in any records the API misses.
 *
 * The output file is a ShopMonkeyExport JSON object with arrays for each entity type.
 * Feed it into the loader pipeline once you've reviewed the counts.
 */

import { writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { login, exportAll } from '../connectors/shopmonkey-api.connector.js';

/** Auto-detect a customer CSV export in packages/migration/ */
async function findCustomerCsv(): Promise<string | undefined> {
  // Look in the migration package directory
  const migrationDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  try {
    const files = await readdir(migrationDir);
    const csvFiles = files
      .filter(f => /^customer.*\.csv$/i.test(f))
      .sort()
      .reverse(); // newest first by name
    if (csvFiles.length > 0) {
      return resolve(migrationDir, csvFiles[0]);
    }
  } catch {
    // ignore
  }
  return undefined;
}

async function main() {
  const email = process.env.SM_EMAIL;
  const password = process.env.SM_PASSWORD;

  if (!email || !password) {
    console.error('Error: SM_EMAIL and SM_PASSWORD environment variables are required.');
    console.error('');
    console.error('Usage:');
    console.error('  SM_EMAIL=you@example.com SM_PASSWORD=secret npx tsx packages/migration/src/cli/fetch-shopmonkey.ts');
    process.exit(1);
  }

  const outputPath = process.env.SM_OUTPUT_PATH
    ?? `./shopmonkey-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

  console.log(`[fetch-shopmonkey] Logging in as ${email}...`);
  const session = await login(email, password);
  console.log(`[fetch-shopmonkey] Authenticated. companyId=${session.companyId} locationId=${session.locationId ?? 'n/a'}`);

  let customerCsvPath = process.env.SM_CUSTOMER_CSV;
  if (!customerCsvPath) {
    customerCsvPath = await findCustomerCsv();
  }
  if (customerCsvPath) {
    console.log(`[fetch-shopmonkey] Will merge customer CSV: ${customerCsvPath}`);
  } else {
    console.log(`[fetch-shopmonkey] No customer CSV found. Set SM_CUSTOMER_CSV or place a customer*.csv in packages/migration/`);
  }

  const data = await exportAll(session, { customerCsvPath });

  console.log('\n[fetch-shopmonkey] Export summary:');
  for (const [entity, count] of Object.entries(data.counts)) {
    console.log(`  ${entity.padEnd(12)}: ${count}`);
  }

  await writeFile(outputPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`\n[fetch-shopmonkey] Saved to ${outputPath}`);
  console.log('[fetch-shopmonkey] Review the file, then run the loader pipeline.');
}

main().catch((err) => {
  console.error('[fetch-shopmonkey] Fatal error:', err);
  process.exit(1);
});
