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
 *
 * The output file is a ShopMonkeyExport JSON object with arrays for each entity type.
 * Feed it into the loader pipeline once you've reviewed the counts.
 */

import { writeFile } from 'node:fs/promises';
import { login, exportAll } from '../connectors/shopmonkey-api.connector.js';

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

  const data = await exportAll(session);

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
