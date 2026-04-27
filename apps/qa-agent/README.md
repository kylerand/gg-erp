# @gg-erp/qa-agent — AI exploration agent

Claude drives Playwright through one of the three Golfin Garage apps using the operator manual as ground truth, and produces a markdown findings report (works / broken / missing / divergent).

## What it is

Phase 4 of the QA system (see `apps/qa/README.md` for Phases 1–3). Where the deterministic suite catches **regressions on things we already know to test**, this catches **drift between what the docs claim and what the app actually does** — bugs the test suite never thought to write.

## Setup

You need an Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-…
```

Get one at <https://console.anthropic.com/>. The agent runs **Sonnet 4.6 by default** — about **$1–$2 per app run** at the default 40-iteration cap. Sonnet was empirically 3× cheaper and produced 2× the findings vs Opus on the same exploration; override with `QA_AGENT_MODEL=claude-opus-4-7` if you want depth at higher cost.

Boot the dev servers in mock-auth mode (separate terminals or backgrounded — same as the other QA tiers):

```bash
(cd apps/web && NEXT_PUBLIC_AUTH_MODE=mock npx next dev --port 3010) &
(cd apps/floor-tech && NEXT_PUBLIC_AUTH_MODE=mock npx next dev --port 3012) &
(cd apps/training && NEXT_PUBLIC_AUTH_MODE=mock npx next dev --port 3013) &
```

## Run

```bash
cd apps/qa-agent

npm run agent:erp          # web, signed in as admin
npm run agent:floor-tech   # floor-tech, signed in as technician
npm run agent:training     # training, signed in as technician

# Or pick role explicitly
npx tsx src/agent.ts --app web --role shop_manager
```

Output: `reports/findings-<app>-YYYY-MM-DD.md`.

## Caps (env-tunable)

| Var | Default | Purpose |
|---|---|---|
| `QA_AGENT_MAX_ITERATIONS` | 40 | Hard cap on Claude API turns |
| `QA_AGENT_MAX_WALL_MS` | 1800000 (30 min) | Wall-clock timeout |
| `QA_AGENT_MAX_BUDGET_USD` | 5 | Estimated cost ceiling |
| `QA_AGENT_MODEL` | `claude-sonnet-4-6` | Model alias (override for Opus or Haiku) |

When any cap fires the run finishes and writes whatever findings it had so far. Hitting a cap is logged in the report header as `stoppedReason`.

## What the agent sees

- **System prompt** (`src/prompts/system.md`) — its job, the four finding types, mock-mode caveats.
- **Operator manual** for the chosen app (`docs/operations/<app>-manual.md`) as the first user message.
- **Tools** (`src/tools.ts`) — navigate, read_page, click, type_text, wait, record_finding, done.

It does NOT see arbitrary HTML. `read_page` returns a structured snapshot (URL, title, headings, buttons, links, inputs, 1500-char visible text) — small enough to keep iterations cheap.

## What the agent doesn't do

- Submit destructive mutations (the system prompt forbids it).
- Run forever (every cap is enforced server-side, not by the model).
- Touch production (defaults to localhost; override with `QA_WEB_URL` etc.).

## File map

```
apps/qa-agent/
  package.json
  src/
    agent.ts                  main loop
    config.ts                 env + flag parsing, fail-fast on missing ANTHROPIC_API_KEY
    playwright-driver.ts      thin wrapper exposing only the actions the agent can take
    tools.ts                  Anthropic tool schemas + dispatchers
    report.ts                 FindingsCollector + markdown emitter
    prompts/
      system.md               agent's role + judgment criteria + mock-mode caveats
  reports/                    findings markdown lands here (gitignored)
```

## CI

`.github/workflows/qa.yml` has an `agent` job triggered only by `workflow_dispatch`. Set `ANTHROPIC_API_KEY` as a repo secret first. The job uploads the findings markdown as the `qa-agent-findings` artifact.

## Iterating on the prompt

The system prompt is the highest-leverage tuning surface. If the agent produces noisy findings (false positives, vague descriptions), edit `src/prompts/system.md` first before changing tools or code. Re-run; iterate.
