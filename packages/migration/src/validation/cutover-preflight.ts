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
  sourceCoverage: SourceCoverageReview;
  warningReview: WarningReview;
  nextActions: string[];
}

export interface SourceCoverageReview {
  items: SourceCoverageItem[];
}

export interface SourceCoverageItem {
  entityKey: string;
  entityLabel: string;
  source: string;
  status: CutoverPreflightStatus;
  collected: number;
  reportedTotal?: number;
  missingFromReportedTotal?: number;
  detail: string;
}

export interface WarningReview {
  totalRowsWithWarnings: number;
  totalWarningReasons: number;
  items: WarningReviewItem[];
}

export interface WarningReviewItem {
  entityKey: string;
  entityLabel: string;
  warning: string;
  count: number;
  sampleRowKeys: string[];
}

interface EntityRule {
  key: string;
  label: string;
  required: boolean;
  minTotal?: number;
  minValidRatio?: number;
}

const SOURCE_KEY_ALIASES: Record<string, readonly string[]> = {
  parts: ['parts', 'inventoryParts'],
};

const ENTITY_RULES: readonly EntityRule[] = [
  { key: 'customers', label: 'Customers', required: true, minTotal: 400, minValidRatio: 0.95 },
  { key: 'vehicles', label: 'Vehicles', required: true, minTotal: 50, minValidRatio: 0.9 },
  { key: 'orders', label: 'Work Orders', required: true, minTotal: 350, minValidRatio: 0.85 },
  { key: 'users', label: 'Employees', required: true, minTotal: 1, minValidRatio: 0.9 },
  { key: 'vendors', label: 'Vendors', required: true, minTotal: 1, minValidRatio: 0.9 },
  { key: 'parts', label: 'Parts', required: true, minTotal: 1, minValidRatio: 0.9 },
  {
    key: 'purchaseOrders',
    label: 'Purchase Orders',
    required: true,
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

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.trunc(value));
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
  if (typeof value === 'number' && Number.isFinite(value)) {
    const total = Math.max(0, Math.trunc(value));
    return {
      total,
      valid: total,
      warned: 0,
      skipped: 0,
    };
  }

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
  const aliases = SOURCE_KEY_ALIASES[key] ?? [key];
  const candidates: EntityCount[] = [];

  for (const alias of aliases) {
    const candidate = countFromSummary(counts[alias]);
    if (candidate && candidate.total > 0) return candidate;
    if (candidate) candidates.push(candidate);
  }

  for (const alias of aliases) {
    const candidate = countFromArray(source[alias]);
    if (candidate && candidate.total > 0) return candidate;
    if (candidate) candidates.push(candidate);
  }

  return candidates[0];
}

function getEntityArray(source: Record<string, unknown>, key: string): unknown[] {
  const aliases = SOURCE_KEY_ALIASES[key] ?? [key];
  for (const alias of aliases) {
    const candidate = source[alias];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function warningsFromItem(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.validationWarnings)) return [];
  return value.validationWarnings.filter((warning): warning is string => typeof warning === 'string' && warning.length > 0);
}

function rowReviewKey(entityKey: string, value: unknown, index: number): string {
  const rawId =
    isRecord(value) && typeof value.smId === 'string'
      ? value.smId
      : isRecord(value) && typeof value.id === 'string'
        ? value.id
        : `row-${index + 1}`;
  return createHash('sha256').update(`${entityKey}:${rawId}`).digest('hex').slice(0, 12);
}

function buildWarningReview(source: Record<string, unknown>): WarningReview {
  const groups = new Map<string, WarningReviewItem>();
  const warnedRows = new Set<string>();
  let totalWarningReasons = 0;

  ENTITY_RULES.forEach((rule) => {
    getEntityArray(source, rule.key).forEach((item, index) => {
      const warnings = warningsFromItem(item);
      if (warnings.length === 0) return;

      const rowKey = rowReviewKey(rule.key, item, index);
      warnedRows.add(`${rule.key}:${rowKey}`);

      warnings.forEach((warning) => {
        totalWarningReasons += 1;
        const groupKey = `${rule.key}\0${warning}`;
        const existing =
          groups.get(groupKey) ??
          ({
            entityKey: rule.key,
            entityLabel: rule.label,
            warning,
            count: 0,
            sampleRowKeys: [],
          } satisfies WarningReviewItem);
        existing.count += 1;
        if (existing.sampleRowKeys.length < 5 && !existing.sampleRowKeys.includes(rowKey)) {
          existing.sampleRowKeys.push(rowKey);
        }
        groups.set(groupKey, existing);
      });
    });
  });

  const entityOrder = new Map(ENTITY_RULES.map((rule, index) => [rule.key, index]));
  const items = Array.from(groups.values()).sort((a, b) => {
    const entityCompare = (entityOrder.get(a.entityKey) ?? 999) - (entityOrder.get(b.entityKey) ?? 999);
    if (entityCompare !== 0) return entityCompare;
    if (a.count !== b.count) return b.count - a.count;
    return a.warning.localeCompare(b.warning);
  });

  return {
    totalRowsWithWarnings: warnedRows.size,
    totalWarningReasons,
    items,
  };
}

function toCoverageStatus(value: unknown): CutoverPreflightStatus {
  if (value === 'PASS' || value === 'FAIL' || value === 'WARN') return value;
  if (value === 'UNKNOWN') return 'WARN';
  return 'WARN';
}

function buildSourceCoverage(source: Record<string, unknown>): SourceCoverageReview {
  const coverage = isRecord(source.sourceCoverage) ? source.sourceCoverage : {};
  const items = Object.entries(coverage)
    .filter(([, value]) => isRecord(value))
    .map(([fallbackKey, value]) => {
      const record = value as Record<string, unknown>;
      const collected = toNumber(record.collected);
      const reportedTotal = toOptionalNumber(record.reportedTotal);
      const missingFromReportedTotal =
        toOptionalNumber(record.missingFromReportedTotal) ??
        (reportedTotal !== undefined ? Math.max(0, reportedTotal - collected) : undefined);
      const entityKey = typeof record.entityKey === 'string' ? record.entityKey : fallbackKey;
      const entityLabel = typeof record.label === 'string' ? record.label : entityKey;
      const sourceName = typeof record.source === 'string' ? record.source : 'Unknown source';
      const status = toCoverageStatus(record.status);

      return {
        entityKey,
        entityLabel,
        source: sourceName,
        status,
        collected,
        reportedTotal,
        missingFromReportedTotal,
        detail:
          typeof record.detail === 'string'
            ? record.detail
            : reportedTotal !== undefined
              ? `${entityLabel} collected ${collected.toLocaleString()} of ${reportedTotal.toLocaleString()} reported rows.`
              : `${entityLabel} collected ${collected.toLocaleString()} rows; no reported total was available.`,
      } satisfies SourceCoverageItem;
    })
    .sort((a, b) => {
      if (a.status !== b.status) return statusRank(a.status) - statusRank(b.status);
      return a.entityLabel.localeCompare(b.entityLabel);
    });

  return { items };
}

function statusRank(status: CutoverPreflightStatus): number {
  if (status === 'FAIL') return 0;
  if (status === 'WARN') return 1;
  return 2;
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

function overallStatus(
  gates: readonly EntityGate[],
  sourceCoverage: SourceCoverageReview,
): CutoverPreflightStatus {
  if (gates.some((gate) => gate.status === 'FAIL')) return 'FAIL';
  if (sourceCoverage.items.some((item) => item.status === 'FAIL')) return 'FAIL';
  if (gates.some((gate) => gate.status === 'WARN')) return 'WARN';
  if (sourceCoverage.items.some((item) => item.status === 'WARN')) return 'WARN';
  return 'PASS';
}

function buildNextActions(
  gates: readonly EntityGate[],
  warningReview: WarningReview,
  sourceCoverage: SourceCoverageReview,
): string[] {
  const actions: string[] = [];
  const failed = gates.filter((gate) => gate.status === 'FAIL');
  const warned = gates.filter((gate) => gate.status === 'WARN');
  const missingSource = failed.filter(
    (gate) => ['parts', 'purchaseOrders'].includes(gate.key) && gate.total === 0,
  );

  if (failed.length > 0) {
    actions.push(`Repair failed gates: ${failed.map((gate) => gate.label).join(', ')}.`);
  }
  if (missingSource.length > 0) {
    actions.push(
      `Capture ShopMonkey source rows for ${missingSource.map((gate) => gate.label).join(', ')} before any shared staging or production cutover.`,
    );
  }
  if (warned.length > 0) {
    actions.push(`Review warning gates: ${warned.map((gate) => gate.label).join(', ')}.`);
  }
  if (warningReview.totalRowsWithWarnings > 0) {
    actions.push(
      `Review ${warningReview.totalRowsWithWarnings.toLocaleString()} warned source rows in the Warning Review section and sign off or repair each warning reason before staging cutover.`,
    );
  }
  const sourceCoverageWarnings = sourceCoverage.items.filter((item) => item.status !== 'PASS');
  if (sourceCoverageWarnings.length > 0) {
    actions.push(
      `Review source coverage gaps: ${sourceCoverageWarnings.map((item) => {
        const gap =
          item.missingFromReportedTotal !== undefined && item.reportedTotal !== undefined
            ? `${item.entityLabel} missing ${item.missingFromReportedTotal.toLocaleString()} of ${item.reportedTotal.toLocaleString()} reported rows`
            : `${item.entityLabel} reported-total coverage unknown`;
        return gap;
      }).join('; ')}.`,
    );
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
  const sourceCoverage = buildSourceCoverage(source);
  const warningReview = buildWarningReview(source);
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
    overallStatus: overallStatus(gates, sourceCoverage),
    totals,
    gates,
    sourceCoverage,
    warningReview,
    nextActions: buildNextActions(gates, warningReview, sourceCoverage),
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

  const sourceCoverageRows =
    report.sourceCoverage.items.length > 0
      ? report.sourceCoverage.items
          .map(
            (item) => `
        <tr>
          <td>${escapeHtml(item.entityLabel)}</td>
          <td><span class="pill ${statusClass(item.status)}">${item.status}</span></td>
          <td>${escapeHtml(item.source)}</td>
          <td>${item.collected.toLocaleString()}</td>
          <td>${item.reportedTotal === undefined ? 'n/a' : item.reportedTotal.toLocaleString()}</td>
          <td>${item.missingFromReportedTotal === undefined ? 'n/a' : item.missingFromReportedTotal.toLocaleString()}</td>
          <td>${escapeHtml(item.detail)}</td>
        </tr>`,
          )
          .join('')
      : `
        <tr>
          <td colspan="7" class="muted">No source coverage metadata was found in this source.</td>
        </tr>`;

  const warningRows =
    report.warningReview.items.length > 0
      ? report.warningReview.items
          .map(
            (item) => `
        <tr>
          <td>${escapeHtml(item.entityLabel)}</td>
          <td>${escapeHtml(item.warning)}</td>
          <td>${item.count.toLocaleString()}</td>
          <td class="sample-keys">${item.sampleRowKeys.map((key) => `<code>${escapeHtml(key)}</code>`).join(' ')}</td>
        </tr>`,
          )
          .join('')
      : `
        <tr>
          <td colspan="4" class="muted">No row-level warning details were found in this source.</td>
        </tr>`;

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
      code {
        display: inline-block;
        border: 1px solid var(--line);
        border-radius: 4px;
        background: #f7f4ed;
        padding: 2px 5px;
        color: var(--ink);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 12px;
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
      .sample-keys {
        white-space: normal;
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
        <h2>Source Coverage</h2>
        <table>
          <thead>
            <tr>
              <th>Entity</th>
              <th>Status</th>
              <th>Source</th>
              <th>Collected</th>
              <th>Reported</th>
              <th>Gap</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>${sourceCoverageRows}</tbody>
        </table>
      </section>

      <section>
        <h2>Warning Review</h2>
        <p class="muted">${report.warningReview.totalRowsWithWarnings.toLocaleString()} warned rows, ${report.warningReview.totalWarningReasons.toLocaleString()} warning reasons. Sample row keys are hashed source identifiers for review without exposing raw customer or work-order IDs.</p>
        <table>
          <thead>
            <tr>
              <th>Entity</th>
              <th>Warning reason</th>
              <th>Rows</th>
              <th>Sample row keys</th>
            </tr>
          </thead>
          <tbody>${warningRows}</tbody>
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
