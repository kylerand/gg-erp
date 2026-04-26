import type { Page, Response, TestInfo } from '@playwright/test';
import { z } from 'zod';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { schemaForRoute } from './schemas.js';

/**
 * Network spy. Attached per-test via the QA fixture; captures every
 * request/response pair on the page and writes them as ndjson to
 * `reports/network/<safe-test-id>.ndjson`. When a captured response
 * matches a route in `schemas.ts`, the body is validated against the Zod
 * schema and any violation gets recorded inline.
 *
 * Schema violations DO NOT fail the test by themselves — they're collected
 * and surfaced by `apply-network-spy.ts` after the run as a single
 * violations.md report. This avoids one bad endpoint cascading into "every
 * test that touches it" failures.
 */

export interface NetworkExchange {
  /** ISO timestamp at request start */
  ts: string;
  method: string;
  /** Full URL of the request */
  url: string;
  /** Path-and-query, normalized for matching against route templates */
  pathname: string;
  status: number;
  /** Time from request start to response received, in ms */
  durationMs: number;
  /** Truncated response body (max 4KB) — full body in trace.zip on failure */
  bodyExcerpt: string;
  /** Schema validation outcome, if a schema is registered for this route */
  schema?:
    | { matched: true; routeTemplate: string }
    | { matched: false; routeTemplate: string; issues: z.ZodIssue[] };
  /** True for non-2xx/3xx responses */
  failed: boolean;
}

export interface NetworkSpy {
  /** All captured exchanges so far */
  exchanges: NetworkExchange[];
  /** Subset where status >= 400 (excluding 401, which is normal in mock-mode) */
  failures: NetworkExchange[];
  /** Subset where the response body didn't validate against its registered schema */
  schemaViolations: NetworkExchange[];
}

/** Strip query/hash and keep only the pathname; used as the key for schema lookup. */
function pathnameOnly(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return rawUrl;
  }
}

/**
 * True for URLs that should be schema-validated. Excludes the Next.js dev
 * server hosts (where requests for `/inventory/parts` return HTML, not the
 * API JSON), keeping validation scoped to actual backend endpoints.
 *
 * The matching API host today is the dev API Gateway. Add additional
 * regexes here when prod or other backends are introduced.
 */
function isApiHost(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return /\.amazonaws\.com$/i.test(u.hostname) || /\.m4nos\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** Filename-safe id for the ndjson output. */
function safeTestId(testInfo: TestInfo): string {
  return [testInfo.project.name, testInfo.titlePath.join(' › ')]
    .join('--')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

/**
 * Attach the spy to a page. Returns the spy state (mutated in-place as
 * traffic flows). Call `flush(testInfo)` in afterEach to write ndjson.
 */
export function attachNetworkSpy(page: Page): NetworkSpy & { flush: (info: TestInfo) => void } {
  const exchanges: NetworkExchange[] = [];
  const failures: NetworkExchange[] = [];
  const schemaViolations: NetworkExchange[] = [];
  const startTimes = new Map<string, number>();

  page.on('request', (request) => {
    startTimes.set(request.url(), Date.now());
  });

  page.on('response', async (response: Response) => {
    const start = startTimes.get(response.url()) ?? Date.now();
    const durationMs = Date.now() - start;
    startTimes.delete(response.url());

    const url = response.url();
    const pathname = pathnameOnly(url);
    const method = response.request().method();
    const status = response.status();

    // Skip Next.js internals (HMR, _next/data, _next/static); they're noise.
    if (
      pathname.startsWith('/_next/') ||
      pathname.startsWith('/__nextjs') ||
      pathname.endsWith('.js') ||
      pathname.endsWith('.css') ||
      pathname.endsWith('.png') ||
      pathname.endsWith('.svg') ||
      pathname.endsWith('.ico')
    ) {
      return;
    }

    let bodyExcerpt = '';
    try {
      const text = await response.text();
      bodyExcerpt = text.slice(0, 4096);
    } catch {
      // Some redirects / OPTIONS won't have a readable body; that's fine.
    }

    // Only validate responses coming from actual API hosts — never from the
    // Next.js dev server itself. A request to `localhost:3010/inventory/parts`
    // returns the page HTML and will trip every schema in the registry.
    const schemaMatch = isApiHost(url) ? schemaForRoute(method, pathname) : undefined;
    let schemaResult: NetworkExchange['schema'];
    if (schemaMatch && status >= 200 && status < 300 && bodyExcerpt) {
      try {
        const parsed = JSON.parse(bodyExcerpt);
        const result = schemaMatch.schema.safeParse(parsed);
        schemaResult = result.success
          ? { matched: true, routeTemplate: schemaMatch.template }
          : {
              matched: false,
              routeTemplate: schemaMatch.template,
              issues: result.error.issues,
            };
      } catch {
        // Non-JSON body for an endpoint we expected to be JSON — also a violation.
        schemaResult = {
          matched: false,
          routeTemplate: schemaMatch.template,
          issues: [
            {
              code: 'custom',
              path: [],
              message: 'response body was not valid JSON',
            } as z.ZodIssue,
          ],
        };
      }
    }

    const exchange: NetworkExchange = {
      ts: new Date(start).toISOString(),
      method,
      url,
      pathname,
      status,
      durationMs,
      bodyExcerpt,
      schema: schemaResult,
      failed: status >= 400 && status !== 401,
    };
    exchanges.push(exchange);
    if (exchange.failed) failures.push(exchange);
    if (schemaResult && !schemaResult.matched) schemaViolations.push(exchange);
  });

  return {
    exchanges,
    failures,
    schemaViolations,
    flush(testInfo) {
      if (exchanges.length === 0) return;
      const outDir = resolve(import.meta.dirname, '..', 'reports', 'network');
      mkdirSync(outDir, { recursive: true });
      const outFile = resolve(outDir, `${safeTestId(testInfo)}.ndjson`);
      const lines = exchanges.map((e) => JSON.stringify(e)).join('\n') + '\n';
      try {
        mkdirSync(dirname(outFile), { recursive: true });
        writeFileSync(outFile, lines);
      } catch (err) {
        console.warn(`[network-spy] failed to write ${outFile}: ${err}`);
      }
    },
  };
}
