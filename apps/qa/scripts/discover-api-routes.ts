#!/usr/bin/env tsx
/**
 * Parse infra/terraform/modules/api-gateway-lambda/main.tf for every
 * `aws_apigatewayv2_route` block and emit a JSON manifest the QA suite
 * uses to enumerate routes.
 *
 * Output schema (stdout if no --out, else written to apps/qa/scripts/routes.json):
 *   [
 *     { "method": "GET", "path": "/work-orders/{id}", "authed": true,
 *       "name": "work_orders_get", "tfBlock": 1234 },
 *     ...
 *   ]
 *
 * `authed` reflects whether the terraform route block sets `authorizer_id`.
 * Path placeholders are kept as `{name}` (API GW v2 syntax).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const TF_FILE = resolve(REPO, 'infra/terraform/modules/api-gateway-lambda/main.tf');

interface ApiRoute {
  method: string;
  path: string;
  authed: boolean;
  name: string;
  tfLine: number;
}

function discover(): ApiRoute[] {
  const tf = readFileSync(TF_FILE, 'utf8');
  const lines = tf.split('\n');

  // Match: resource "aws_apigatewayv2_route" "<name>" {
  // Followed within ~10 lines by route_key = "METHOD /path" and possibly authorizer_id = ...
  const routes: ApiRoute[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(
      /resource\s+"aws_apigatewayv2_route"\s+"([a-z0-9_]+)"\s*\{/,
    );
    if (!m) continue;
    const name = m[1]!;
    const block = lines.slice(i, Math.min(i + 15, lines.length)).join('\n');

    const routeKeyMatch = block.match(
      /route_key\s+=\s+"([A-Z]+)\s+([^"]+)"/,
    );
    if (!routeKeyMatch) continue;
    const method = routeKeyMatch[1]!;
    const path = routeKeyMatch[2]!;

    // Authed if the block sets authorizer_id to anything non-null
    // (either local.authorizer_id or an explicit ID).
    const authed = /authorizer_id\s*=\s*[^n]/.test(block);

    routes.push({ method, path, authed, name, tfLine: i + 1 });
  }
  return routes;
}

function main(): void {
  const routes = discover();
  const outArg = process.argv.indexOf('--out');
  const out =
    outArg >= 0
      ? process.argv[outArg + 1]
      : resolve(import.meta.dirname, 'routes.json');

  writeFileSync(out!, JSON.stringify(routes, null, 2));
  // Stdout summary
  const authed = routes.filter((r) => r.authed).length;
  console.log(
    `discovered ${routes.length} routes (${authed} authed, ${routes.length - authed} unauthed) → ${out}`,
  );
  // Group counts by domain (first path segment)
  const byDomain: Record<string, number> = {};
  for (const r of routes) {
    const seg = r.path.split('/').filter(Boolean)[0] ?? '_root';
    byDomain[seg] = (byDomain[seg] ?? 0) + 1;
  }
  for (const [d, n] of Object.entries(byDomain).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)}  /${d}`);
  }
}

main();
