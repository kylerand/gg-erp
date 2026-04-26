#!/usr/bin/env tsx
/**
 * Walk apps/{web,floor-tech,training}/src/app for every page.tsx and emit
 * a JSON manifest of routes — ready to be fed into gen-coverage-tests.ts.
 *
 *   node scripts/discover-web-routes.ts          # prints summary, writes routes-web.json
 *   node scripts/discover-web-routes.ts --out X  # writes to X
 *
 * Output:
 *   [
 *     { "app": "web", "route": "/work-orders/dispatch", "params": [], "file": "..." },
 *     { "app": "training", "route": "/modules/{moduleId}", "params": ["moduleId"], "file": "..." }
 *   ]
 *
 * Dynamic segments `[name]` become `{name}` to match API Gateway syntax
 * used elsewhere in the QA harness.
 */

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, relative, basename } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const APPS = [
  { name: 'web', dir: resolve(REPO, 'apps/web/src/app') },
  { name: 'floor-tech', dir: resolve(REPO, 'apps/floor-tech/src/app') },
  { name: 'training', dir: resolve(REPO, 'apps/training/src/app') },
] as const;

interface DiscoveredRoute {
  app: string;
  route: string;
  params: string[];
  file: string;
}

/**
 * Convert an `app/` directory path to its route. e.g.
 *   apps/web/src/app/(authed)/work-orders/dispatch/page.tsx
 *     → /work-orders/dispatch
 *   apps/training/src/app/modules/[moduleId]/page.tsx
 *     → /modules/{moduleId}
 */
function pathToRoute(appDir: string, pageFile: string): { route: string; params: string[] } {
  const rel = relative(appDir, pageFile);
  const segments = rel.split('/').slice(0, -1); // drop the trailing `page.tsx`
  const params: string[] = [];
  const cleaned = segments
    .filter((seg) => !(seg.startsWith('(') && seg.endsWith(')'))) // drop route-groups
    .map((seg) => {
      const m = seg.match(/^\[(\.\.\.)?(.+)\]$/);
      if (m) {
        const name = m[2]!;
        params.push(name);
        return `{${name}}`;
      }
      return seg;
    });
  const route = cleaned.length === 0 ? '/' : '/' + cleaned.join('/');
  return { route, params };
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (basename(full) === 'page.tsx') {
      out.push(full);
    }
  }
}

function discover(): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  for (const app of APPS) {
    const pages: string[] = [];
    walk(app.dir, pages);
    for (const file of pages) {
      const { route, params } = pathToRoute(app.dir, file);
      routes.push({ app: app.name, route, params, file: relative(REPO, file) });
    }
  }
  return routes;
}

function main(): void {
  const routes = discover();
  const outArg = process.argv.indexOf('--out');
  const out =
    outArg >= 0
      ? process.argv[outArg + 1]
      : resolve(import.meta.dirname, 'routes-web.json');
  writeFileSync(out!, JSON.stringify(routes, null, 2));
  const byApp: Record<string, number> = {};
  for (const r of routes) byApp[r.app] = (byApp[r.app] ?? 0) + 1;
  console.log(`discovered ${routes.length} pages → ${out}`);
  for (const [a, n] of Object.entries(byApp)) {
    console.log(`  ${n.toString().padStart(3)}  ${a}`);
  }
}

main();
