#!/usr/bin/env tsx
/**
 * QA exploration agent. Loops Claude tool-use against a Playwright browser,
 * with the operator manual as ground truth, until it has walked the major
 * workflows or hits a budget/iteration/wall-time cap.
 *
 * Usage:
 *   npm run agent:erp
 *   npm run agent:floor-tech
 *   npm run agent:training
 *
 * Required env: ANTHROPIC_API_KEY. See README.md for full setup.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { loadConfig } from './config.js';
import { PlaywrightDriver } from './playwright-driver.js';
import { TOOL_SCHEMAS, TOOL_IMPLS } from './tools.js';
import { FindingsCollector } from './report.js';

// Pricing approximation (USD per million tokens) — used purely for the
// budget cap and the report header. Updated when Anthropic publishes new
// rates; conservative estimates so we err on stopping early.
const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7': { input: 15, output: 75 },
  'claude-opus-4-7[1m]': { input: 15, output: 75 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 0.8, output: 4 },
};

function estimateUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING_PER_MTOK[model] ?? PRICING_PER_MTOK['claude-opus-4-7']!;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new Anthropic({ apiKey: config.apiKey });

  const systemPrompt = readFileSync(
    new URL('./prompts/system.md', import.meta.url),
    'utf8',
  );
  const manualText = readFileSync(config.manualPath, 'utf8');

  const driver = new PlaywrightDriver({
    baseUrl: config.baseUrl,
    isMobile: config.app === 'floor-tech',
    viewport:
      config.app === 'floor-tech' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  });
  await driver.start();
  driver.attachConsoleSpy();
  await driver.signIn(config.role);

  const findings = new FindingsCollector();

  const initialUserMessage = `# Manual: ${config.app}\n\n${manualText}\n\n---\n\nYou are signed in as **${config.role}** at the dev server **${config.baseUrl}**. Begin by navigating to \`/\` and reading the page. Then walk 4–6 workflows from the manual above. Call \`done()\` with an executive summary when finished.`;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: initialUserMessage },
  ];

  let iter = 0;
  let totalIn = 0;
  let totalOut = 0;
  const startMs = Date.now();
  let stoppedReason = 'completed';

  console.log(
    `[qa-agent] starting model=${config.model} app=${config.app} role=${config.role}\n` +
      `[qa-agent] caps: ${config.maxIterations} iter / ${(config.maxWallTimeMs / 60_000).toFixed(0)} min / $${config.maxBudgetUsd}\n`,
  );

  while (iter < config.maxIterations) {
    iter += 1;
    const elapsed = Date.now() - startMs;
    if (elapsed > config.maxWallTimeMs) {
      stoppedReason = 'wall-time cap';
      break;
    }
    const usd = estimateUsd(config.model, totalIn, totalOut);
    if (usd > config.maxBudgetUsd) {
      stoppedReason = 'budget cap';
      break;
    }

    const res = await client.messages.create({
      model: config.model,
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOL_SCHEMAS,
      messages,
    });
    totalIn += res.usage.input_tokens;
    totalOut += res.usage.output_tokens;
    const usdNow = estimateUsd(config.model, totalIn, totalOut);
    process.stdout.write(`[qa-agent] iter ${iter}: stop=${res.stop_reason} usd≈${usdNow.toFixed(3)}`);

    // Append assistant turn.
    messages.push({ role: 'assistant', content: res.content });

    if (res.stop_reason === 'end_turn') {
      console.log(' (model finished without calling done — exiting)');
      stoppedReason = 'model end_turn';
      break;
    }

    // Run tool calls; collect tool_result blocks for the next turn.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let didCallDone = false;
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue;
      const name = block.name;
      const id = block.id;
      const args = (block.input ?? {}) as Record<string, unknown>;
      const impl = TOOL_IMPLS.get(name);
      let toolOutput = '';
      if (!impl) {
        toolOutput = `unknown tool: ${name}`;
      } else {
        try {
          const r = await impl(args, driver, findings);
          toolOutput = r.output;
        } catch (err) {
          toolOutput = `tool error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      toolResults.push({ type: 'tool_result', tool_use_id: id, content: toolOutput });
      if (name === 'done') didCallDone = true;
    }

    if (toolResults.length > 0) {
      messages.push({ role: 'user', content: toolResults });
    }
    console.log(` tools=${toolResults.length} findings=${findings.count}`);

    if (didCallDone) {
      stoppedReason = 'agent called done';
      break;
    }
  }

  if (iter >= config.maxIterations && stoppedReason === 'completed') {
    stoppedReason = 'iteration cap';
  }

  await driver.stop();

  const usdFinal = estimateUsd(config.model, totalIn, totalOut);
  findings.write(config.reportPath, {
    app: config.app,
    role: config.role,
    iterations: iter,
    durationMs: Date.now() - startMs,
    usdSpent: usdFinal,
  });

  console.log(`\n[qa-agent] finished: ${stoppedReason}`);
  console.log(`[qa-agent] iterations=${iter}  findings=${findings.count}  cost≈$${usdFinal.toFixed(2)}`);
  console.log(`[qa-agent] report: ${config.reportPath}`);

  if (driver.consoleErrors.length > 0) {
    console.log(`[qa-agent] note: ${driver.consoleErrors.length} console errors observed during run`);
  }
}

main().catch((err) => {
  console.error('[qa-agent] FATAL:', err);
  process.exit(1);
});
