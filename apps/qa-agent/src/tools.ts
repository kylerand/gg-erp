import type { Anthropic } from '@anthropic-ai/sdk';
import type { PlaywrightDriver } from './playwright-driver.js';
import type { Finding, FindingsCollector } from './report.js';

/**
 * Tool definitions exposed to Claude. Each entry pairs the JSON schema
 * the model sees with the implementation that runs server-side.
 *
 * The tool set is intentionally small. More tools = more tokens spent on
 * routing decisions = less productive exploration. The agent gets exactly
 * what it needs to: navigate, observe, interact, record, and stop.
 */

type ToolImpl = (
  args: Record<string, unknown>,
  driver: PlaywrightDriver,
  findings: FindingsCollector,
) => Promise<{ output: string; isImage?: boolean }>;

export interface QaTool {
  schema: Anthropic.Tool;
  impl: ToolImpl;
}

const TOOLS: QaTool[] = [
  {
    schema: {
      name: 'navigate',
      description:
        'Navigate to a path in the app (e.g. "/work-orders/dispatch") or a full URL. Returns the page status. Always navigate before reading or interacting.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path like "/admin/access" or full URL' },
        },
        required: ['path'],
      },
    },
    impl: async ({ path }, driver) => {
      const res = await driver.navigate(String(path));
      return { output: JSON.stringify(res) };
    },
  },
  {
    schema: {
      name: 'read_page',
      description:
        'Read the current page: URL, title, headings, visible buttons, links, form inputs, and a 1500-char text snapshot. Use this after every navigation to understand what is on screen before interacting.',
      input_schema: { type: 'object', properties: {} },
    },
    impl: async (_a, driver) => {
      const snap = await driver.readPage();
      return { output: JSON.stringify(snap, null, 2) };
    },
  },
  {
    schema: {
      name: 'click',
      description:
        'Click an element by CSS selector. Use specific selectors like `a[href="/admin"]` or `button:has-text("Save")`. Returns whether the click succeeded.',
      input_schema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for the target element' },
        },
        required: ['selector'],
      },
    },
    impl: async ({ selector }, driver) => {
      const res = await driver.click(String(selector));
      return { output: JSON.stringify(res) };
    },
  },
  {
    schema: {
      name: 'type_text',
      description:
        'Type text into a form input by CSS selector. Use this to fill forms when verifying workflows like "Invite User".',
      input_schema: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['selector', 'text'],
      },
    },
    impl: async ({ selector, text }, driver) => {
      const res = await driver.type(String(selector), String(text));
      return { output: JSON.stringify(res) };
    },
  },
  {
    schema: {
      name: 'wait',
      description:
        'Wait N milliseconds (max 10000) for the page to settle after async operations. Use sparingly; prefer read_page after a navigation/click.',
      input_schema: {
        type: 'object',
        properties: {
          ms: { type: 'integer', minimum: 100, maximum: 10000 },
        },
        required: ['ms'],
      },
    },
    impl: async ({ ms }, driver) => {
      await driver.wait(Number(ms));
      return { output: 'ok' };
    },
  },
  {
    schema: {
      name: 'record_finding',
      description:
        'Record a finding about the app. Use one of four statuses:\n' +
        '  • works     — feature behaves as the manual describes\n' +
        '  • broken    — feature is documented but is missing, errors, or behaves wrong\n' +
        '  • missing   — manual claims X exists but you cannot find it\n' +
        '  • divergent — feature exists but behavior differs from the manual in a notable way\n' +
        'Be concrete: cite the manual section, the URL, the action you took, and what you observed.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['works', 'broken', 'missing', 'divergent'] },
          area: { type: 'string', description: 'Functional area or page (e.g. "Admin → User Access")' },
          summary: { type: 'string', description: 'One-line summary' },
          expected: { type: 'string', description: 'What the manual says should happen' },
          observed: { type: 'string', description: 'What actually happened' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          url: { type: 'string', description: 'URL where you observed this' },
        },
        required: ['status', 'area', 'summary', 'expected', 'observed', 'severity'],
      },
    },
    impl: async (args, _driver, findings) => {
      const finding: Finding = {
        status: args.status as Finding['status'],
        area: String(args.area),
        summary: String(args.summary),
        expected: String(args.expected),
        observed: String(args.observed),
        severity: args.severity as Finding['severity'],
        url: args.url ? String(args.url) : '',
        recordedAt: new Date().toISOString(),
      };
      findings.add(finding);
      return { output: `recorded ${finding.status} finding for ${finding.area}` };
    },
  },
  {
    schema: {
      name: 'done',
      description:
        'End the exploration. Call this when you have walked the major workflows from the manual and recorded findings for each. Provide a one-paragraph executive summary.',
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
        },
        required: ['summary'],
      },
    },
    impl: async ({ summary }, _driver, findings) => {
      findings.setExecutiveSummary(String(summary));
      return { output: 'ok — exploration complete' };
    },
  },
];

export const TOOL_SCHEMAS: Anthropic.Tool[] = TOOLS.map((t) => t.schema);

export const TOOL_IMPLS = new Map<string, ToolImpl>(
  TOOLS.map((t) => [t.schema.name, t.impl] as const),
);
