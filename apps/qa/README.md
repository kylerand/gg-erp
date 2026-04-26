# @gg-erp/qa — automated QA harness

End-to-end QA for the three Golfin Garage Next.js apps + the dev API Gateway.

## Tiers (in build order)

| Tier | Status | What it does | When |
|---|---|---|---|
| **Smoke** | ✅ Phase 1 | Each app loads, sidebar/nav links work, every wired API route returns 2xx/4xx (not 404 from API GW or 5xx) | every PR |
| **Coverage** | ✅ Phase 2 | Walks every `page.tsx` (~63 routes); network spy records every request/response; Zod schemas validate known API shapes; aggregator emits `violations.md` | every push to main |
| **Roles + a11y + visual** | ⏳ Phase 3 | One spec per Cognito role + axe-core + screenshot diffs | nightly |
| **AI exploration agent** | ⏳ Phase 4 | Claude walks the apps using the operator manuals as ground truth, reports drift | weekly / on-demand |

## Run locally

Boot the three dev servers in mock-auth mode (separate terminal):

```bash
# from repo root
(cd apps/web && NEXT_PUBLIC_AUTH_MODE=mock npx next dev --port 3010) &
(cd apps/floor-tech && NEXT_PUBLIC_AUTH_MODE=mock npx next dev --port 3012) &
(cd apps/training && NEXT_PUBLIC_AUTH_MODE=mock npx next dev --port 3013) &
```

Then run smoke from this workspace:

```bash
cd apps/qa
npx playwright install chromium  # one-time
npm run qa:smoke                  # all four projects: web, floor-tech, training, api
npm run qa:report                 # opens HTML report in browser
```

Run a single project:

```bash
npm run qa:smoke:web
npm run qa:smoke:floor-tech
npm run qa:smoke:training
npm run qa:smoke:api

# coverage tier (Phase 2): walks every page.tsx, captures network traffic
npm run qa:discover-web   # rebuild routes-web.json
npm run qa:coverage       # ~15s, 63 specs (10 dynamic-param routes skipped — see comment)
npm run qa:violations     # produces reports/network/violations.md
```

## Auth in tests

Every spec uses the `signInAs(role)` fixture from `fixtures/auth.ts`. It calls `addInitScript` on the browser context to set `localStorage.gg_erp_mock_role` *before* any app script runs — so the app's `getAuthUser` returns a mock user immediately on first paint.

Mock roles: `admin | manager | technician | parts | trainer | accounting`.

For real-Cognito tests (Phase 5), see the `cognitoFixture` design in the plan.

## Adding a new test

1. Pick the right tier (`tests/{smoke,coverage,roles,…}`).
2. Import from `../../fixtures/auth`:
   ```ts
   import { test, expect, expectNoConsoleErrors, waitForAppReady } from '../../fixtures/auth';
   ```
3. Use `signInAs` in `beforeEach`. Use `expectNoConsoleErrors(consoleErrors)` to assert clean console (it filters known dev noise — see `IGNORED_CONSOLE_NOISE`).
4. Use `aside a[href="..."]` selectors for sidebar links — the icon span confuses `getByRole('link', {name})`.

## Known broken (API smoke allowlist)

`scripts/known-broken.json` lists routes that currently return 5xx instead of a clean 4xx. The smoke spec **fails when this list drifts in EITHER direction**:

- A new bug appears → smoke fails until you add the route here OR fix the bug.
- A bug gets fixed → smoke fails until you remove the entry. The error message says ✅ celebrate.

This makes regression detection AND fix detection automatic.

## Reports

After every run, artifacts land in `reports/`:

```
reports/
  html/                Playwright's interactive HTML report (open with `npm run qa:report`)
  results.json         Machine-readable test outcomes
```

CI uploads the whole `reports/` directory as the `qa-smoke-report` GitHub Actions artifact (14-day retention).

## File map

```
apps/qa/
  playwright.config.ts          5 projects (smoke-{web,floor-tech,training,api}, coverage)
  fixtures/
    auth.ts                     signInAs, consoleErrors, failedRequests, networkSpy, waitForAppReady
    network-spy.ts              per-test request/response capture + Zod validation; ndjson per spec
    schemas.ts                  Zod schemas for top API response shapes
  scripts/
    discover-api-routes.ts      parses terraform → routes.json
    discover-web-routes.ts      walks app/ dirs → routes-web.json
    routes.json / routes-web.json  generated, gitignored
    known-broken.json           tracked — current API smoke allowlist
    aggregate-violations.ts     ndjson → reports/network/violations.md
  tests/
    smoke/web.spec.ts           sidebar walk + copilot button
    smoke/floor-tech.spec.ts    bottom nav cycle
    smoke/training.spec.ts      catalog + my-progress + assignments
    api/smoke.spec.ts           every wired API route → not 404 from API GW, not 5xx
    coverage/walk.spec.ts       parameterized over routes-web.json — every page.tsx renders
  reports/network/              spy ndjson + violations.md (gitignored)
```

## Why Chromium-only at first

Smoke runs against Chromium with iPhone-14-class viewport for floor-tech (desktop Chrome with a mobile viewport, no WebKit). Cross-engine testing belongs in the visual-regression tier (Phase 3+).
