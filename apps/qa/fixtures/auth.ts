import { test as base, expect, type ConsoleMessage, type Page } from '@playwright/test';
import { attachNetworkSpy, type NetworkSpy } from './network-spy.js';

/**
 * Mock-mode roles accepted by all three apps' auth modules. The set is
 * intentionally constrained to what the apps' `lib/auth.ts` knows how to
 * extract — adding a new value here that the app doesn't recognize falls
 * back to "technician" (see `extractRole` in apps/web/src/lib/auth.ts).
 */
export type MockRole =
  | 'admin'
  | 'manager'
  | 'technician'
  | 'parts'
  | 'trainer'
  | 'accounting';

export interface ConsoleErrorRecord {
  text: string;
  url: string;
  location: ReturnType<ConsoleMessage['location']>;
}

export interface QaFixtures {
  /**
   * Sets `localStorage.gg_erp_mock_role` BEFORE any page script runs, so the
   * app's `getAuthUser` returns the mock user immediately on first paint.
   * Pattern proven in scripts/demo/record.js:80.
   */
  signInAs: (role: MockRole) => Promise<void>;

  /**
   * Console errors observed since the last `clearConsoleErrors()` call.
   * Smoke specs assert this stays empty.
   */
  consoleErrors: ConsoleErrorRecord[];
  clearConsoleErrors: () => void;

  /**
   * Failed network responses (status >= 400) since the last clear. Useful
   * for spotting silent 4xx/5xx that don't surface as console errors.
   */
  failedRequests: Array<{ url: string; status: number; method: string }>;
  clearFailedRequests: () => void;

  /**
   * Per-test network spy. Records every request/response, validates known
   * routes against Zod schemas, dumps ndjson on flush. Coverage-tier specs
   * use this to assert on schema cleanliness; smoke specs ignore it.
   */
  networkSpy: NetworkSpy;
}

export const test = base.extend<QaFixtures>({
  signInAs: async ({ context }, use) => {
    let activeRole: MockRole | null = null;
    await use(async (role: MockRole) => {
      // addInitScript fires for EVERY new page in the context, before any
      // app script runs. Re-registering with a fresh role overrides the
      // previous one for subsequent navigations.
      if (activeRole) {
        await context.clearCookies();
      }
      activeRole = role;
      await context.addInitScript((r) => {
        try {
          window.localStorage.setItem('gg_erp_mock_role', r);
        } catch {
          // Some pages (auth/callback) load before storage is writable; the
          // re-attempt on next nav is fine.
        }
      }, role);
    });
  },

  consoleErrors: async ({ page }, use) => {
    const errors: ConsoleErrorRecord[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push({
          text: msg.text(),
          url: page.url(),
          location: msg.location(),
        });
      }
    });
    page.on('pageerror', (err) => {
      errors.push({
        text: err.message,
        url: page.url(),
        location: { url: page.url(), lineNumber: 0, columnNumber: 0 },
      });
    });
    await use(errors);
  },

  clearConsoleErrors: async ({ consoleErrors }, use) => {
    await use(() => {
      consoleErrors.length = 0;
    });
  },

  failedRequests: async ({ page }, use) => {
    const failures: Array<{ url: string; status: number; method: string }> = [];
    page.on('response', (response) => {
      const status = response.status();
      // Treat anything >= 400 as a failure; smoke specs decide which to allow.
      // 401 from the dev API in mock mode is normal (no real Cognito JWT).
      if (status >= 400 && status !== 401) {
        failures.push({
          url: response.url(),
          status,
          method: response.request().method(),
        });
      }
    });
    await use(failures);
  },

  clearFailedRequests: async ({ failedRequests }, use) => {
    await use(() => {
      failedRequests.length = 0;
    });
  },

  networkSpy: async ({ page }, use, testInfo) => {
    const spy = attachNetworkSpy(page);
    await use(spy);
    spy.flush(testInfo);
  },
});

export { expect };

/**
 * Console errors that are noisy but harmless in dev. Smoke specs filter on
 * these so a clean run is actually clean.
 */
export const IGNORED_CONSOLE_NOISE = [
  /favicon\.ico.*404/i,
  // Cognito emits a 400 on its first probe when no session exists; expected
  // any time we land unauthenticated.
  /cognito-idp\.[a-z0-9-]+\.amazonaws\.com.*400/i,
  // When NEXT_PUBLIC_API_BASE_URL is unset, the apps fall back to
  // localhost:3001 for the API. We don't run that in QA — mock-mode auth
  // means most pages don't need it. apiFetch's MOCK_* fallback handles it
  // silently, but the failed fetch still logs a console error.
  /Failed to load resource:.*ERR_CONNECTION_REFUSED/i,
  /Failed to fetch/i,
  // Node's undici fetch impl emits "fetch failed" when the API base is
  // unreachable; mock-mode apiFetch swallows it and falls back to MOCK_*
  // data, but the underlying fetch error still hits console.
  /^fetch failed$/i,
  /^Error: fetch failed/i,
  /TypeError: fetch failed/i,
  // Next.js dev mode hot-reload chatter
  /\[HMR\]/i,
  /Fast Refresh/i,
];

export function isIgnoredConsoleError(record: ConsoleErrorRecord): boolean {
  return IGNORED_CONSOLE_NOISE.some((re) => re.test(record.text));
}

/**
 * Helper for smoke specs: assert no unexpected console errors after a
 * navigation step. Filters known noise. Pretty-prints any real failures.
 */
export function expectNoConsoleErrors(records: ConsoleErrorRecord[]): void {
  const real = records.filter((r) => !isIgnoredConsoleError(r));
  if (real.length > 0) {
    const lines = real
      .slice(0, 5)
      .map((r) => `  • [${r.url}] ${r.text}`)
      .join('\n');
    throw new Error(
      `Expected no console errors but found ${real.length}:\n${lines}` +
        (real.length > 5 ? `\n  …and ${real.length - 5} more` : ''),
    );
  }
}

/** Wait for the app shell to be past its initial loading spinner. */
export async function waitForAppReady(page: Page): Promise<void> {
  // The web AppShell + floor-tech TechShell + training default layouts all
  // show a "Checking authentication…" / "Loading…" spinner while
  // RoleProvider.loadUser runs. The role-context useEffect calls setLoading
  // (false) within ~100-300ms in mock mode (no network round-trip).
  await page.waitForFunction(
    () => {
      const txt = document.body.innerText.toLowerCase();
      return (
        !txt.includes('checking authentication') &&
        !txt.includes('finishing sign-in') &&
        !(txt.trim() === 'loading…' || txt.trim() === 'loading')
      );
    },
    { timeout: 10_000 },
  );
}
