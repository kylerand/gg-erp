#!/usr/bin/env tsx
/**
 * CLI: sanitize a ShopMonkey export JSON file.
 *
 * Usage:
 *   npx tsx packages/migration/src/cli/sanitize-shopmonkey.ts shopmonkey-export-<ts>.json
 *
 * Output:
 *   shopmonkey-sanitized-<timestamp>.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sanitizeExport } from '../sanitize/sanitize-export.js';
import type { ShopMonkeyExport } from '../connectors/shopmonkey-api.connector.js';

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: sanitize-shopmonkey.ts <shopmonkey-export-file.json>');
  process.exit(1);
}

const resolvedPath = resolve(inputFile);
console.log(`[sanitize] Reading export: ${resolvedPath}`);

let data: ShopMonkeyExport;
try {
  data = JSON.parse(readFileSync(resolvedPath, 'utf-8')) as ShopMonkeyExport;
} catch (err) {
  console.error(`[sanitize] Failed to read/parse input: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const report = sanitizeExport(data, resolvedPath);

// Print summary
console.log('\n=== Sanitization Summary ===');
for (const [entity, counts] of Object.entries(report.counts)) {
  console.log(
    `  ${entity.padEnd(12)}: ${counts.total} total  ` +
    `${counts.valid} valid  ` +
    `${counts.warned} warned  ` +
    `${counts.skipped} skipped`
  );
}

// Print warnings
const allWarnings: Array<{ entity: string; id: string; warnings: string[] }> = [
  ...report.customers.filter(r => r.validationWarnings.length).map(r => ({ entity: 'customer', id: r.smId, warnings: r.validationWarnings })),
  ...report.vehicles.filter(r => r.validationWarnings.length).map(r => ({ entity: 'vehicle', id: r.smId, warnings: r.validationWarnings })),
  ...report.orders.filter(r => r.validationWarnings.length).map(r => ({ entity: 'order', id: r.smId, warnings: r.validationWarnings })),
  ...report.lineItemAssignments.filter(r => r.validationWarnings.length).map(r => ({ entity: 'line_item', id: r.smId, warnings: r.validationWarnings })),
];

if (allWarnings.length > 0) {
  console.log(`\n=== Warnings (${allWarnings.length}) ===`);
  for (const w of allWarnings.slice(0, 50)) {
    console.log(`  [${w.entity}:${w.id}] ${w.warnings.join(' | ')}`);
  }
  if (allWarnings.length > 50) {
    console.log(`  ... and ${allWarnings.length - 50} more (see output file)`);
  }
}

const outputFile = `shopmonkey-sanitized-${Date.now()}.json`;
writeFileSync(outputFile, JSON.stringify(report, null, 2));
console.log(`\n[sanitize] Written: ${outputFile}`);
