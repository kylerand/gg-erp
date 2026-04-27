/**
 * Agent runtime config. Reads env vars + CLI flags into a single typed
 * object. Fail-fast on missing required values so the agent doesn't burn
 * API credits on a misconfigured run.
 */

import { resolve } from 'node:path';

export interface AgentConfig {
  /** Anthropic API key, from ANTHROPIC_API_KEY env. */
  apiKey: string;
  /** Model alias to call. Default: claude-opus-4-7. */
  model: string;
  /** Which app to explore. */
  app: 'web' | 'floor-tech' | 'training';
  /** Mock-mode role to sign in as. */
  role: string;
  /** Hard cap on Anthropic API turns to prevent runaway loops. */
  maxIterations: number;
  /** Wall-clock timeout for the entire run, in ms. */
  maxWallTimeMs: number;
  /** Approximate USD cap; agent stops when estimated cost exceeds this. */
  maxBudgetUsd: number;
  /** Where the agent's findings markdown ends up. */
  reportPath: string;
  /** Base URL for the chosen app's dev server. */
  baseUrl: string;
  /** Path to the operator manual the agent treats as ground truth. */
  manualPath: string;
}

const APP_BASE_URLS: Record<AgentConfig['app'], string> = {
  web: process.env.QA_WEB_URL ?? 'http://localhost:3010',
  'floor-tech': process.env.QA_FLOOR_TECH_URL ?? 'http://localhost:3012',
  training: process.env.QA_TRAINING_URL ?? 'http://localhost:3013',
};

const APP_MANUAL: Record<AgentConfig['app'], string> = {
  web: 'docs/operations/erp-manual.md',
  'floor-tech': 'docs/operations/floor-tech-manual.md',
  training: 'docs/operations/training-manual.md',
};

function readFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0 || idx === process.argv.length - 1) return undefined;
  return process.argv[idx + 1];
}

export function loadConfig(): AgentConfig {
  const app = (readFlag('app') ?? 'web') as AgentConfig['app'];
  if (!['web', 'floor-tech', 'training'].includes(app)) {
    throw new Error(`Invalid --app: ${app}. Use web | floor-tech | training.`);
  }

  const role = readFlag('role') ?? (app === 'web' ? 'admin' : 'technician');

  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Export it before running:\n' +
        '  export ANTHROPIC_API_KEY=sk-ant-...\n' +
        'See apps/qa-agent/README.md for setup.',
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = resolve(
    import.meta.dirname,
    '..',
    'reports',
    `findings-${app}-${today}.md`,
  );

  const repoRoot = resolve(import.meta.dirname, '..', '..', '..');

  return {
    apiKey,
    // Sonnet 4.6 is the default after empirical comparison: 30 iterations
    // for $1.20 vs Opus's 19 for $4.03 on the same ERP exploration, with
    // ~2× the findings (8 vs 4) including a high-severity broken finding
    // Opus missed. Override with QA_AGENT_MODEL=claude-opus-4-7 for runs
    // where breadth-of-judgment matters more than cost.
    model: process.env.QA_AGENT_MODEL ?? 'claude-sonnet-4-6',
    app,
    role,
    maxIterations: parseInt(readFlag('max-iterations') ?? process.env.QA_AGENT_MAX_ITERATIONS ?? '40', 10),
    maxWallTimeMs: parseInt(process.env.QA_AGENT_MAX_WALL_MS ?? '1800000', 10), // 30 min
    maxBudgetUsd: parseFloat(process.env.QA_AGENT_MAX_BUDGET_USD ?? '5'),
    reportPath,
    baseUrl: APP_BASE_URLS[app],
    manualPath: resolve(repoRoot, APP_MANUAL[app]),
  };
}
