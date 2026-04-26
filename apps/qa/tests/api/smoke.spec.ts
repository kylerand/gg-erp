import { test, expect, type APIRequestContext } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * API Gateway smoke. For every wired route, send the most basic possible
 * request with NO auth and assert the response is healthy:
 *   200 / 204 / 400 / 401 / 403 / 405  → healthy (route exists, handler ran)
 *   404                                → BUG: route not wired (or path mismatch)
 *   500-503                            → BUG: handler crashed
 *
 * This is the test we never wrote during ship week — it would have caught
 * every "handler built but route not wired in terraform" bug PR #11
 * eventually fixed.
 *
 * Run discover-api-routes.ts first if routes.json is missing/stale:
 *   npm run qa:discover-api
 */

const API_BASE =
  process.env.QA_API_BASE_URL ??
  'https://xvkc7v8hue.execute-api.us-east-2.amazonaws.com';

const ROUTES_FILE = resolve(import.meta.dirname, '..', '..', 'scripts', 'routes.json');
const KNOWN_BROKEN_FILE = resolve(import.meta.dirname, '..', '..', 'scripts', 'known-broken.json');

interface ApiRoute {
  method: string;
  path: string;
  authed: boolean;
  name: string;
  tfLine: number;
}

interface KnownBroken {
  method: string;
  path: string;
  expectStatus: number;
  note: string;
}

// 404 is HEALTHY when it's the Lambda saying "record not found" (handler ran).
// We discriminate via response body — see ProbeResult.isApiGatewayRouteMiss.
const HEALTHY_STATUSES = new Set([200, 201, 204, 400, 401, 403, 404, 405, 422]);
const BAD_STATUSES = new Set([500, 501, 502, 503, 504]);

function loadRoutes(): ApiRoute[] {
  if (!existsSync(ROUTES_FILE)) {
    throw new Error(
      `Missing ${ROUTES_FILE}. Run \`npm run qa:discover-api\` first.`,
    );
  }
  return JSON.parse(readFileSync(ROUTES_FILE, 'utf8')) as ApiRoute[];
}

function loadKnownBroken(): Map<string, KnownBroken> {
  const raw = JSON.parse(readFileSync(KNOWN_BROKEN_FILE, 'utf8'));
  const m = new Map<string, KnownBroken>();
  for (const k of raw.broken as KnownBroken[]) {
    m.set(`${k.method} ${k.path}`, k);
  }
  return m;
}

/**
 * Substitute path placeholders with values that should pass basic
 * validation but never match real records. UUID format for {id}-style
 * params lets handlers run their lookup logic and return a clean 404
 * instead of throwing on Prisma's UUID parse.
 */
function substitutePath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, (_, name) => {
    const lower = name.toLowerCase();
    if (lower.endsWith('id') || lower === 'employeeid') {
      return '00000000-0000-4000-8000-000000000000';
    }
    return 'qa-smoke-probe';
  });
}

/**
 * Build a minimal valid body for write methods. We aren't testing handler
 * logic here — just want the request to reach the handler so we can
 * observe a non-5xx response.
 */
function smokeBody(method: string): string | undefined {
  if (method === 'GET' || method === 'DELETE') return undefined;
  return JSON.stringify({});
}

interface ProbeResult {
  status: number;
  body: string;
  /**
   * True when the 404 came from API Gateway's "no route matched" response
   * rather than from a Lambda handler returning 404 for a missing record.
   * API GW route-miss has body exactly `{"message":"Not Found"}` (length 23).
   */
  isApiGatewayRouteMiss: boolean;
}

async function probeRoute(
  request: APIRequestContext,
  route: ApiRoute,
): Promise<ProbeResult> {
  const url = `${API_BASE}${substitutePath(route.path)}`;
  const init = {
    headers: { 'Content-Type': 'application/json' },
    data: smokeBody(route.method),
    failOnStatusCode: false,
  };
  let res;
  switch (route.method) {
    case 'GET':
      res = await request.get(url, init);
      break;
    case 'POST':
      res = await request.post(url, init);
      break;
    case 'PUT':
      res = await request.put(url, init);
      break;
    case 'PATCH':
      res = await request.patch(url, init);
      break;
    case 'DELETE':
      res = await request.delete(url, init);
      break;
    default:
      throw new Error(`unsupported method ${route.method} on ${route.path}`);
  }
  const body = await res.text();
  return {
    status: res.status(),
    body,
    isApiGatewayRouteMiss:
      res.status() === 404 && body.trim() === '{"message":"Not Found"}',
  };
}

const routes = loadRoutes();
const knownBroken = loadKnownBroken();

test.describe('API smoke — every route returns a healthy status', () => {
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    const known = knownBroken.get(key);

    test(`${route.method.padEnd(6)} ${route.path}`, async ({ request }) => {
      const { status, body, isApiGatewayRouteMiss } = await probeRoute(
        request,
        route,
      );

      if (known) {
        expect(
          status,
          `${key} previously returned ${known.expectStatus} (${known.note}). ` +
            `Now returns ${status}. ` +
            (HEALTHY_STATUSES.has(status) && !isApiGatewayRouteMiss
              ? '✅ Looks fixed — remove this entry from known-broken.json.'
              : '❌ Different status; update known-broken.json'),
        ).toBe(known.expectStatus);
        return;
      }

      // The cardinal sin: 404 with API Gateway's "Not Found" body — that
      // means the route is wired in terraform but the integration is
      // pointing at nothing (or the path doesn't match). This is the
      // "handler built, route not wired" bug class.
      expect(
        isApiGatewayRouteMiss,
        `API Gateway route-miss on ${key} — terraform claims this route ` +
          `exists but no integration handled the request. body=${body.slice(0, 200)}`,
      ).toBe(false);

      expect(
        HEALTHY_STATUSES.has(status),
        `expected 2xx/4xx (route exists, handler ran), got ${status}` +
          ` for ${key} (${route.name}). body=${body.slice(0, 200)}. ` +
          'If this is a known dev-time bug, add to apps/qa/scripts/known-broken.json.',
      ).toBe(true);
    });
  }
});
