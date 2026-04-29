import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ERP_OBJECTS,
  getErpCommandDestinations,
  getLiveErpQuickActions,
  getLiveErpWorkspaceLinks,
  getLiveErpWorkspaces,
  normalizeErpRoute,
  type ErpObjectDescriptor,
} from '@gg-erp/domain';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '../app');

interface RouteCase {
  source: string;
  route: string;
}

function routeToPagePath(route: string): string {
  const normalized = normalizeErpRoute(route);
  if (normalized === '/') return path.join(APP_DIR, 'page.tsx');

  const segments = normalized
    .replace(/^\//, '')
    .split('/')
    .map((segment) => (segment.startsWith(':') ? `[${segment.slice(1)}]` : segment));

  return path.join(APP_DIR, ...segments, 'page.tsx');
}

function uniqueRoutes(routes: readonly RouteCase[]): RouteCase[] {
  const seen = new Set<string>();
  return routes.filter((routeCase) => {
    const key = `${routeCase.source}:${routeCase.route}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectLiveRegistryRoutes(): RouteCase[] {
  const liveObjects: readonly ErpObjectDescriptor[] = ERP_OBJECTS.filter(
    (object) => object.status === 'live',
  );

  return uniqueRoutes([
    ...getLiveErpWorkspaces().map((workspace) => ({
      source: `workspace:${workspace.key}`,
      route: workspace.route,
    })),
    ...getLiveErpWorkspaceLinks().map((link) => ({
      source: `workspace-link:${link.key}`,
      route: link.route,
    })),
    ...liveObjects.map((object) => ({
      source: `object:${object.key}`,
      route: object.route,
    })),
    ...liveObjects
      .filter((object) => object.detailRoute)
      .map((object) => ({
        source: `object-detail:${object.key}`,
        route: object.detailRoute!,
      })),
    ...getLiveErpQuickActions().map((action) => ({
      source: `quick-action:${action.key}`,
      route: action.route,
    })),
    ...getErpCommandDestinations().map((destination) => ({
      source: `command:${destination.key}`,
      route: destination.route,
    })),
  ]);
}

test('every live ERP registry route resolves to a Next app page', () => {
  const missingPages = collectLiveRegistryRoutes()
    .map((routeCase) => ({
      ...routeCase,
      pagePath: routeToPagePath(routeCase.route),
    }))
    .filter((routeCase) => !existsSync(routeCase.pagePath));

  assert.deepEqual(
    missingPages.map((routeCase) => ({
      source: routeCase.source,
      route: routeCase.route,
      expectedPage: path.relative(process.cwd(), routeCase.pagePath),
    })),
    [],
  );
});
