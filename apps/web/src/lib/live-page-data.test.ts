import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC_DIR = path.resolve(__dirname, '..');

const truthCriticalPages = [
  'app/customer-dealers/page.tsx',
  'app/inventory/page.tsx',
  'app/inventory/receiving/page.tsx',
  'app/inventory/reservations/page.tsx',
  'app/reporting/page.tsx',
  'app/training/page.tsx',
  'app/training/admin/page.tsx',
  'app/work-orders/[id]/page.tsx',
] as const;

function readSource(relativePath: string): string {
  return readFileSync(path.join(WEB_SRC_DIR, relativePath), 'utf8');
}

test('truth-critical pages opt out of local mock fallback data', () => {
  const missingStrictMode = truthCriticalPages.filter((relativePath) => {
    const source = readSource(relativePath);
    return !source.includes('allowMockFallback: false');
  });

  assert.deepEqual(missingStrictMode, []);
});

test('truth-critical pages do not render placeholder stat values', () => {
  const placeholderPatterns = [
    /value:\s*['"`]\u2014['"`]/,
    /value:\s*['"`]TBD['"`]/i,
    /value:\s*['"`]N\/A['"`]/i,
    /not connected/i,
    /placeholder\s+(data|values?|content|screen)/i,
  ];

  const placeholderUses = truthCriticalPages.flatMap((relativePath) => {
    const source = readSource(relativePath);
    return placeholderPatterns
      .filter((pattern) => pattern.test(source))
      .map((pattern) => ({ page: relativePath, pattern: pattern.source }));
  });

  assert.deepEqual(placeholderUses, []);
});

test('apiFetch can reject local mock fallback data for truth-critical calls', async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001';
  const { apiFetch } = await import('./api-client.js');
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];

  globalThis.fetch = async () => {
    throw new TypeError('offline');
  };
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    await assert.rejects(
      apiFetch('/missing-route', undefined, { ok: true }, { allowMockFallback: false }),
      /offline/,
    );
    assert.deepEqual(warnings, []);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});
