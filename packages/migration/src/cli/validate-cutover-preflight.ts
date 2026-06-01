#!/usr/bin/env tsx
/**
 * No-database ShopMonkey cutover preflight.
 *
 * Reads a ShopMonkey export or sanitized export JSON and writes a sanitized
 * counts-only JSON/HTML report. This never opens Prisma and never writes ERP
 * rows, so it is safe to run before a staging load rehearsal.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  buildCutoverPreflightReport,
  renderCutoverPreflightHtml,
} from '../validation/cutover-preflight.js';

interface CliConfig {
  sourceFile: string;
  jsonOut?: string;
  htmlOut?: string;
}

function parseArgs(): CliConfig {
  const args = process.argv.slice(2);
  const sourceFile = args.find((arg) => !arg.startsWith('--'));
  const jsonOut = args.find((arg) => arg.startsWith('--json='))?.replace('--json=', '');
  const htmlOut = args.find((arg) => arg.startsWith('--html='))?.replace('--html=', '');

  if (!sourceFile) {
    console.error(
      'Usage: validate-cutover-preflight.ts <export.json> [--json=report.json] [--html=report.html]',
    );
    process.exit(1);
  }

  return { sourceFile, jsonOut, htmlOut };
}

async function writeText(path: string, text: string): Promise<void> {
  const resolved = resolve(path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, text, 'utf8');
}

async function main(): Promise<void> {
  const config = parseArgs();
  const sourcePath = resolve(config.sourceFile);
  const source = JSON.parse(await readFile(sourcePath, 'utf8')) as Record<string, unknown>;
  const report = buildCutoverPreflightReport(source, { sourceFile: sourcePath });

  if (config.jsonOut) {
    await writeText(config.jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (config.htmlOut) {
    await writeText(config.htmlOut, renderCutoverPreflightHtml(report));
  }

  console.log(`ShopMonkey cutover preflight: ${report.overallStatus}`);
  console.log(`Source: ${report.sourceFile}`);
  console.log(
    `Rows: ${report.totals.validRows}/${report.totals.totalRows} valid, ${report.totals.warnedRows} warned, ${report.totals.skippedRows} skipped`,
  );
  for (const gate of report.gates) {
    console.log(
      `${gate.status.padEnd(4)} ${gate.label.padEnd(24)} ${gate.valid}/${gate.total} valid - ${gate.detail}`,
    );
  }

  process.exit(report.overallStatus === 'FAIL' ? 1 : 0);
}

main().catch((error) => {
  console.error('[validate-cutover-preflight] Fatal error:', error);
  process.exit(1);
});
