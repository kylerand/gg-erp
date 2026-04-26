#!/usr/bin/env tsx
/**
 * Read every ndjson file the network spy wrote in this run and produce a
 * single Markdown report:
 *   apps/qa/reports/network/violations.md
 *
 * Sections:
 *   1. Schema violations — endpoints whose response failed Zod validation,
 *      grouped by route template, with per-issue counts.
 *   2. Failed requests — non-2xx/3xx responses (excluding 401, expected in
 *      mock-mode), grouped by status code + route.
 *   3. Slow requests — p95 > 2000ms, sorted descending.
 *
 * Run after `npm run qa:coverage` to summarize. Designed to be uploaded as
 * a CI artifact so reviewers see a single human-readable diff.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPORTS = resolve(import.meta.dirname, '..', 'reports', 'network');

interface NetworkExchange {
  ts: string;
  method: string;
  url: string;
  pathname: string;
  status: number;
  durationMs: number;
  bodyExcerpt: string;
  schema?:
    | { matched: true; routeTemplate: string }
    | { matched: false; routeTemplate: string; issues: Array<{ code: string; path: (string | number)[]; message: string }> };
  failed: boolean;
}

function loadAll(): NetworkExchange[] {
  let files: string[];
  try {
    files = readdirSync(REPORTS).filter((f) => f.endsWith('.ndjson'));
  } catch {
    return [];
  }
  const out: NetworkExchange[] = [];
  for (const f of files) {
    const text = readFileSync(resolve(REPORTS, f), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // Skip malformed lines.
      }
    }
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

function main(): void {
  const all = loadAll();
  if (all.length === 0) {
    console.log('No network ndjson files found — did the coverage run produce any?');
    writeFileSync(resolve(REPORTS, 'violations.md'), '# Network violations\n\n*No data collected.*\n');
    return;
  }

  // ── Schema violations grouped by template ─────────────────────────────
  const byTemplate = new Map<string, NetworkExchange[]>();
  for (const e of all) {
    if (e.schema && !e.schema.matched) {
      const key = e.schema.routeTemplate;
      const arr = byTemplate.get(key) ?? [];
      arr.push(e);
      byTemplate.set(key, arr);
    }
  }

  // ── Failed requests by status × pathname ──────────────────────────────
  const byFailure = new Map<string, NetworkExchange[]>();
  for (const e of all) {
    if (e.failed) {
      const key = `${e.status} ${e.pathname.replace(/\/[0-9a-f-]{8,}/g, '/{id}')}`;
      const arr = byFailure.get(key) ?? [];
      arr.push(e);
      byFailure.set(key, arr);
    }
  }

  // ── Performance by template ───────────────────────────────────────────
  const byPerf = new Map<string, number[]>();
  for (const e of all) {
    if (!e.schema?.matched && !e.schema) continue; // only known templates have a stable key
    const key = e.schema?.routeTemplate ?? e.pathname;
    const arr = byPerf.get(key) ?? [];
    arr.push(e.durationMs);
    byPerf.set(key, arr);
  }

  // ── Render markdown ───────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push('# Network violations\n');
  lines.push(`Source: ${all.length} captured exchanges across ${new Set(all.map((e) => e.pathname)).size} unique paths.\n`);

  lines.push('## Schema violations\n');
  if (byTemplate.size === 0) {
    lines.push('✅ **None.** Every captured response matched its registered Zod schema.\n');
  } else {
    lines.push(`❌ **${byTemplate.size} route templates** had at least one response fail validation:\n`);
    for (const [tmpl, exs] of [...byTemplate.entries()].sort()) {
      lines.push(`### \`${tmpl}\` — ${exs.length} violations`);
      const issueCounts = new Map<string, number>();
      for (const ex of exs) {
        if (ex.schema && !ex.schema.matched) {
          for (const iss of ex.schema.issues) {
            const key = `${iss.path.join('.') || '(root)'}: ${iss.message}`;
            issueCounts.set(key, (issueCounts.get(key) ?? 0) + 1);
          }
        }
      }
      for (const [k, n] of [...issueCounts.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`- ${n}× \`${k}\``);
      }
      const sample = exs[0];
      if (sample) {
        lines.push(`\n<details><summary>Sample response body (${sample.status})</summary>\n\n\`\`\`json\n${sample.bodyExcerpt.slice(0, 500)}\n\`\`\`\n</details>\n`);
      }
    }
  }

  lines.push('\n## Failed requests (status >= 400, excluding 401)\n');
  if (byFailure.size === 0) {
    lines.push('✅ **None.**\n');
  } else {
    lines.push('| Count | Status | Path |');
    lines.push('|---:|---|---|');
    for (const [k, v] of [...byFailure.entries()].sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`| ${v.length} | ${k.split(' ')[0]} | ${k.split(' ').slice(1).join(' ')} |`);
    }
  }

  lines.push('\n## Slow endpoints (p95 > 2000ms)\n');
  const slow: Array<[string, number, number]> = [];
  for (const [k, durs] of byPerf.entries()) {
    if (durs.length === 0) continue;
    const sorted = [...durs].sort((a, b) => a - b);
    const p95 = percentile(sorted, 95);
    if (p95 > 2000) slow.push([k, p95, durs.length]);
  }
  if (slow.length === 0) {
    lines.push('✅ **None.**\n');
  } else {
    lines.push('| Template | p95 (ms) | Samples |');
    lines.push('|---|---:|---:|');
    for (const [k, p95, n] of slow.sort((a, b) => b[1] - a[1])) {
      lines.push(`| \`${k}\` | ${p95} | ${n} |`);
    }
  }

  const out = resolve(REPORTS, 'violations.md');
  writeFileSync(out, lines.join('\n') + '\n');
  console.log(`wrote ${out}`);
  console.log(`  schema-violation route templates: ${byTemplate.size}`);
  console.log(`  failed-request groups: ${byFailure.size}`);
  console.log(`  slow templates (p95 > 2s): ${slow.length}`);
}

main();
