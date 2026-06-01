import { createHash } from 'node:crypto';
import { basename } from 'node:path';

export type CutoverPreflightStatus = 'PASS' | 'WARN' | 'FAIL';

export interface EntityCount {
  total: number;
  valid: number;
  warned: number;
  skipped: number;
}

export interface EntityGate {
  key: string;
  label: string;
  status: CutoverPreflightStatus;
  total: number;
  valid: number;
  warned: number;
  skipped: number;
  validRatio: number;
  detail: string;
}

export interface CutoverPreflightReport {
  generatedAt: string;
  sourceFile: string;
  sourceChecksum: string;
  overallStatus: CutoverPreflightStatus;
  totals: {
    entitiesPresent: number;
    totalRows: number;
    validRows: number;
    warnedRows: number;
    skippedRows: number;
  };
  gates: EntityGate[];
  nextActions: string[];
}

interface EntityRule {
  key: string;
  label: string;
  required: boolean;
  minTotal?: number;
  minValidRatio?: number;
}

const ENTITY_RULES: readonly EntityRule[] = [
  { key: 'customers', label: 'Customers', required: true, minTotal: 400, minValidRatio: 0.95 },
  { key: 'vehicles', label: 'Vehicles', required: true, minTotal: 50, minValidRatio: 0.9 },
  { key: 'orders', label: 'Work Orders', required: true, minTotal: 350, minValidRatio: 0.85 },
  { key: 'users', label: 'Employees', required: true, minTotal: 1, minValidRatio: 0.9 },
  { key: 'vendors', label: 'Vendors', required: true, minTotal: 1, minValidRatio: 0.9 },
  { key: 'parts', label: 'Parts', required: false, minTotal: 1, minValidRatio: 0.9 },
  {
    key: 'purchaseOrders',
    label: 'Purchase Orders',
    required: false,
    minTotal: 1,
    minValidRatio: 0.9,
  },
  {
    key: 'lineItemAssignments',
    label: 'Line Item Assignments',
    required: false,
    minTotal: 1,
    minValidRatio: 0.9,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function countFromArray(value: unknown): EntityCount | undefined {
  if (!Array.isArray(value)) return undefined;
  const skipped = value.filter((item) => isRecord(item) && item.skip === true).length;
  const warned = value.filter(
    (item) =>
      isRecord(item) &&
      Array.isArray(item.validationWarnings) &&
      item.validationWarnings.length > 0,
  ).length;
  return {
    total: value.length,
    valid: Math.max(0, value.length - skipped),
    warned,
    skipped,
  };
}

function countFromSummary(value: unknown): EntityCount | undefined {
  if (!isRecord(value)) return undefined;
  const total = toNumber(value.total);
  const skipped = toNumber(value.skipped);
  return {
    total,
    valid: toNumber(value.valid),
    warned: toNumber(value.warned),
    skipped,
  };
}

function getEntityCount(source: Record<string, unknown>, key: string): EntityCount | undefined {
  const counts = isRecord(source.counts) ? source.counts : {};
  return countFromSummary(counts[key]) ?? countFromArray(source[key]);
}

function evaluateGate(rule: EntityRule, count: EntityCount | undefined): EntityGate {
  if (!count) {
    return {
      key: rule.key,
      label: rule.label,
      status: rule.required ? 'FAIL' : 'WARN',
      total: 0,
      valid: 0,
      warned: 0,
      skipped: 0,
      validRatio: 0,
      detail: rule.required
        ? `${rule.label} data is missing from the export.`
        : `${rule.label} data is not present in this export.`,
    };
  }

  const validRatio = count.total > 0 ? count.valid / count.total : 0;
  const minimumTotalMissed = rule.minTotal !== undefined && count.total < rule.minTotal;
  const ratioMissed = rule.minValidRatio !== undefined && validRatio < rule.minValidRatio;

  if (rule.required && (count.total === 0 || minimumTotalMissed || ratioMissed)) {
    return {
      key: rule.key,
      label: rule.label,
      status: 'FAIL',
      ...count,
      validRatio,
      detail: `${rule.label} does not meet the minimum cutover coverage gate.`,
    };
  }

  if (!rule.required && count.total === 0) {
    return {
      key: rule.key,
      label: rule.label,
      status: 'WARN',
      ...count,
      validRatio,
      detail: `${rule.label} data was not included; confirm this is intentional for this rehearsal.`,
    };
  }

  if (count.warned > 0 || count.skipped > 0 || minimumTotalMissed || ratioMissed) {
    return {
      key: rule.key,
      label: rule.label,
      status: 'WARN',
      ...count,
      validRatio,
      detail: `${rule.label} is usable but needs review before cutover sign-off.`,
    };
  }

  return {
    key: rule.key,
    label: rule.label,
    status: 'PASS',
    ...count,
    validRatio,
    detail: `${rule.label} meets the preflight coverage gate.`,
  };
}

function overallStatus(gates: readonly EntityGate[]): CutoverPreflightStatus {
  if (gates.some((gate) => gate.status === 'FAIL')) return 'FAIL';
  if (gates.some((gate) => gate.status === 'WARN')) return 'WARN';
  return 'PASS';
}

function buildNextActions(gates: readonly EntityGate[]): string[] {
  const actions: string[] = [];
  const failed = gates.filter((gate) => gate.status === 'FAIL');
  const warned = gates.filter((gate) => gate.status === 'WARN');

  if (failed.length > 0) {
    actions.push(`Repair failed gates: ${failed.map((gate) => gate.label).join(', ')}.`);
  }
  if (warned.length > 0) {
    actions.push(`Review warning gates: ${warned.map((gate) => gate.label).join(', ')}.`);
  }
  actions.push('Run the loader against an isolated staging database and capture row-count reconciliation.');
  actions.push('Compare imported customers, carts, work orders, parts, vendors, and accounting sync queues in the ERP UI.');
  return actions;
}

export function buildCutoverPreflightReport(
  source: Record<string, unknown>,
  options: { sourceFile: string; generatedAt?: string },
): CutoverPreflightReport {
  const sourceText = JSON.stringify(source);
  const gates = ENTITY_RULES.map((rule) => evaluateGate(rule, getEntityCount(source, rule.key)));
  const totals = gates.reduce(
    (acc, gate) => ({
      entitiesPresent: acc.entitiesPresent + (gate.total > 0 ? 1 : 0),
      totalRows: acc.totalRows + gate.total,
      validRows: acc.validRows + gate.valid,
      warnedRows: acc.warnedRows + gate.warned,
      skippedRows: acc.skippedRows + gate.skipped,
    }),
    { entitiesPresent: 0, totalRows: 0, validRows: 0, warnedRows: 0, skippedRows: 0 },
  );

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    sourceFile: basename(options.sourceFile),
    sourceChecksum: createHash('sha256').update(sourceText).digest('hex'),
    overallStatus: overallStatus(gates),
    totals,
    gates,
    nextActions: buildNextActions(gates),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function statusClass(status: CutoverPreflightStatus): string {
  if (status === 'PASS') return 'pass';
  if (status === 'FAIL') return 'fail';
  return 'warn';
}

export function renderCutoverPreflightHtml(report: CutoverPreflightReport): string {
  const gateRows = report.gates
    .map(
      (gate) => `
        <tr>
          <td>${escapeHtml(gate.label)}</td>
          <td><span class="pill ${statusClass(gate.status)}">${gate.status}</span></td>
          <td>${gate.total.toLocaleString()}</td>
          <td>${gate.valid.toLocaleString()}</td>
          <td>${gate.warned.toLocaleString()}</td>
          <td>${gate.skipped.toLocaleString()}</td>
          <td>${(gate.validRatio * 100).toFixed(1)}%</td>
          <td>${escapeHtml(gate.detail)}</td>
        </tr>`,
    )
    .join('');

  const actions = report.nextActions
    .map((action) => `<li>${escapeHtml(action)}</li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ShopMonkey Cutover Preflight</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #1f2933;
        --muted: #697386;
        --line: #d8dee9;
        --brand: #b1581b;
        --brand-bg: #fff3e8;
        --pass: #11734b;
        --warn: #a15c00;
        --fail: #b42318;
      }
      body {
        margin: 0;
        background: #f7f4ed;
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        max-width: 1160px;
        margin: 0 auto;
        padding: 32px 20px 48px;
      }
      header {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        align-items: flex-start;
        margin-bottom: 24px;
      }
      h1 {
        margin: 0;
        font-size: clamp(28px, 4vw, 44px);
        line-height: 1.05;
      }
      h2 {
        margin: 0 0 12px;
        font-size: 18px;
      }
      .muted {
        color: var(--muted);
      }
      .stamp {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fff;
        padding: 10px 12px;
        color: var(--muted);
        font-size: 13px;
        white-space: nowrap;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 24px;
      }
      .metric,
      section {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fff;
      }
      .metric {
        padding: 16px;
      }
      .metric strong {
        display: block;
        font-size: 28px;
      }
      .metric span {
        display: block;
        margin-top: 4px;
        color: var(--muted);
        font-size: 13px;
      }
      section {
        padding: 20px;
        margin-bottom: 18px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      th,
      td {
        border-bottom: 1px solid var(--line);
        padding: 10px 8px;
        text-align: left;
        vertical-align: top;
      }
      th {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      tr:last-child td {
        border-bottom: 0;
      }
      .pill {
        display: inline-flex;
        border: 1px solid currentColor;
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 12px;
        font-weight: 700;
      }
      .pass {
        color: var(--pass);
      }
      .warn {
        color: var(--warn);
      }
      .fail {
        color: var(--fail);
      }
      ul {
        margin: 0;
        padding-left: 18px;
      }
      li + li {
        margin-top: 8px;
      }
      @media (max-width: 780px) {
        header,
        .summary {
          display: block;
        }
        .stamp,
        .metric {
          margin-top: 12px;
        }
        table {
          display: block;
          overflow-x: auto;
          white-space: nowrap;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <p class="muted">Sanitized readiness report</p>
          <h1>ShopMonkey Cutover Preflight</h1>
          <p class="muted">Source: ${escapeHtml(report.sourceFile)}</p>
        </div>
        <div class="stamp">Generated: ${escapeHtml(report.generatedAt)}</div>
      </header>

      <div class="summary">
        <div class="metric"><strong class="${statusClass(report.overallStatus)}">${report.overallStatus}</strong><span>Overall status</span></div>
        <div class="metric"><strong>${report.totals.entitiesPresent}</strong><span>Entity groups present</span></div>
        <div class="metric"><strong>${report.totals.totalRows.toLocaleString()}</strong><span>Total rows</span></div>
        <div class="metric"><strong>${report.totals.warnedRows.toLocaleString()}</strong><span>Warned rows</span></div>
        <div class="metric"><strong>${report.totals.skippedRows.toLocaleString()}</strong><span>Skipped rows</span></div>
      </div>

      <section>
        <h2>Entity Gates</h2>
        <table>
          <thead>
            <tr>
              <th>Entity</th>
              <th>Status</th>
              <th>Total</th>
              <th>Valid</th>
              <th>Warned</th>
              <th>Skipped</th>
              <th>Valid %</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>${gateRows}</tbody>
        </table>
      </section>

      <section>
        <h2>Next Actions</h2>
        <ul>${actions}</ul>
      </section>
    </main>
  </body>
</html>
`;
}
