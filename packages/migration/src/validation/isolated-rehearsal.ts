export type RehearsalStatus = 'PASS' | 'WARN' | 'FAIL';

export interface RehearsalCommandReport {
  name: string;
  command: string;
  status: RehearsalStatus;
  exitCode: number | null;
  durationMs: number;
}

export interface RehearsalEntityReport {
  key: string;
  label: string;
  required: boolean;
  sourceRows: number;
  sourceSkipped: number;
  expectedRows: number;
  importedRows: number;
  mappedRows: number;
  status: RehearsalStatus;
  detail: string;
}

export interface RehearsalSeedGateReport {
  key: string;
  label: string;
  expected: number;
  actual: number;
  status: RehearsalStatus;
  detail: string;
}

export interface IsolatedRehearsalReport {
  generatedAt: string;
  sourceFile: string;
  sourceKind: string;
  database: {
    mode: 'disposable-docker' | 'provided-local-url';
    image?: string;
    containerName?: string;
    keptContainer: boolean;
  };
  overallStatus: RehearsalStatus;
  commands: RehearsalCommandReport[];
  entities: RehearsalEntityReport[];
  referenceSeeds: RehearsalSeedGateReport[];
  supportingCounts: Record<string, number>;
  failureDetail?: string;
  nextActions: string[];
}

interface EntityInput {
  key: string;
  label: string;
  required: boolean;
  sourceRows: number;
  sourceSkipped: number;
  importedRows: number;
  mappedRows: number;
}

interface BuildReportInput {
  generatedAt?: string;
  sourceFile: string;
  sourceKind: string;
  database: IsolatedRehearsalReport['database'];
  commands: RehearsalCommandReport[];
  entities: EntityInput[];
  referenceSeeds?: Array<Pick<RehearsalSeedGateReport, 'key' | 'label' | 'expected' | 'actual'>>;
  supportingCounts?: Record<string, number>;
  failureDetail?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function statusClass(status: RehearsalStatus): string {
  if (status === 'PASS') return 'pass';
  if (status === 'FAIL') return 'fail';
  return 'warn';
}

export function assertSafeRehearsalDatabaseUrl(databaseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('Rehearsal database URL is not a valid URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('Rehearsal database URL must use postgres or postgresql.');
  }

  const safeHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (!safeHosts.has(parsed.hostname)) {
    throw new Error('Rehearsal database URL must point at localhost or 127.0.0.1.');
  }

  const databaseName = parsed.pathname.replace(/^\//, '');
  if (!databaseName.toLowerCase().includes('rehears')) {
    throw new Error('Rehearsal database name must include "rehears" to avoid live data loads.');
  }
}

function evaluateEntity(input: EntityInput): RehearsalEntityReport {
  const expectedRows = Math.max(0, input.sourceRows - input.sourceSkipped);
  if (expectedRows === 0) {
    return {
      ...input,
      expectedRows,
      status: input.required ? 'FAIL' : 'WARN',
      detail: input.required
        ? `${input.label} has no loadable source rows.`
        : `${input.label} is absent from this export; confirm this is intentional.`,
    };
  }

  if (input.importedRows < expectedRows || input.mappedRows < expectedRows) {
    return {
      ...input,
      expectedRows,
      status: 'FAIL',
      detail: `${input.label} loaded ${input.importedRows}/${expectedRows} rows with ${input.mappedRows} external ID mappings.`,
    };
  }

  return {
    ...input,
    expectedRows,
    status: 'PASS',
    detail: `${input.label} loaded ${input.importedRows}/${expectedRows} rows with ${input.mappedRows} external ID mappings.`,
  };
}

function evaluateSeedGate(input: Pick<RehearsalSeedGateReport, 'key' | 'label' | 'expected' | 'actual'>): RehearsalSeedGateReport {
  if (input.actual < input.expected) {
    return {
      ...input,
      status: 'FAIL',
      detail: `${input.label} verified ${input.actual}/${input.expected} required reference rows.`,
    };
  }

  return {
    ...input,
    status: 'PASS',
    detail: `${input.label} verified ${input.actual}/${input.expected} required reference rows.`,
  };
}

function overallStatus(
  commands: readonly RehearsalCommandReport[],
  entities: readonly RehearsalEntityReport[],
  referenceSeeds: readonly RehearsalSeedGateReport[],
  failureDetail?: string,
): RehearsalStatus {
  if (failureDetail || commands.some((command) => command.status === 'FAIL')) return 'FAIL';
  if (entities.some((entity) => entity.status === 'FAIL')) return 'FAIL';
  if (referenceSeeds.some((seedGate) => seedGate.status === 'FAIL')) return 'FAIL';
  if (entities.some((entity) => entity.status === 'WARN')) return 'WARN';
  if (referenceSeeds.some((seedGate) => seedGate.status === 'WARN')) return 'WARN';
  if (commands.some((command) => command.status === 'WARN')) return 'WARN';
  return 'PASS';
}

function buildNextActions(
  report: Pick<IsolatedRehearsalReport, 'overallStatus' | 'entities' | 'referenceSeeds' | 'failureDetail'>,
): string[] {
  if (report.overallStatus === 'PASS') {
    return [
      'Use this isolated rehearsal as the row-count baseline for the next staging cutover run.',
      'Run operator UAT against imported customers, carts, work orders, vendors, and accounting sync queues.',
    ];
  }

  const failed = report.entities.filter((entity) => entity.status === 'FAIL');
  const warned = report.entities.filter((entity) => entity.status === 'WARN');
  const failedSeeds = report.referenceSeeds.filter((seedGate) => seedGate.status === 'FAIL');
  const actions: string[] = [];
  if (report.failureDetail) actions.push('Repair the rehearsal runner failure and rerun against a disposable database.');
  if (failed.length > 0) actions.push(`Repair failed import coverage: ${failed.map((entity) => entity.label).join(', ')}.`);
  if (failedSeeds.length > 0) {
    actions.push(`Repair failed reference seed coverage: ${failedSeeds.map((seedGate) => seedGate.label).join(', ')}.`);
  }
  if (warned.length > 0) actions.push(`Review warning coverage: ${warned.map((entity) => entity.label).join(', ')}.`);
  actions.push('Rerun the isolated rehearsal before loading any shared staging or production database.');
  return actions;
}

export function buildIsolatedRehearsalReport(input: BuildReportInput): IsolatedRehearsalReport {
  const entities = input.entities.map(evaluateEntity);
  const referenceSeeds = (input.referenceSeeds ?? []).map(evaluateSeedGate);
  const partialReport = {
    overallStatus: overallStatus(input.commands, entities, referenceSeeds, input.failureDetail),
    entities,
    referenceSeeds,
    failureDetail: input.failureDetail,
  };

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceFile: input.sourceFile,
    sourceKind: input.sourceKind,
    database: input.database,
    overallStatus: partialReport.overallStatus,
    commands: input.commands,
    entities,
    referenceSeeds,
    supportingCounts: input.supportingCounts ?? {},
    failureDetail: input.failureDetail,
    nextActions: buildNextActions(partialReport),
  };
}

export function renderIsolatedRehearsalHtml(report: IsolatedRehearsalReport): string {
  const commandRows = report.commands
    .map((command) => `
        <tr>
          <td>${escapeHtml(command.name)}</td>
          <td><span class="pill ${statusClass(command.status)}">${command.status}</span></td>
          <td>${command.exitCode ?? 'n/a'}</td>
          <td>${(command.durationMs / 1000).toFixed(1)}s</td>
          <td><code>${escapeHtml(command.command)}</code></td>
        </tr>`)
    .join('');

  const entityRows = report.entities
    .map((entity) => `
        <tr>
          <td>${escapeHtml(entity.label)}</td>
          <td><span class="pill ${statusClass(entity.status)}">${entity.status}</span></td>
          <td>${entity.sourceRows.toLocaleString()}</td>
          <td>${entity.expectedRows.toLocaleString()}</td>
          <td>${entity.importedRows.toLocaleString()}</td>
          <td>${entity.mappedRows.toLocaleString()}</td>
          <td>${escapeHtml(entity.detail)}</td>
        </tr>`)
    .join('');

  const seedRows = report.referenceSeeds
    .map((seedGate) => `
        <tr>
          <td>${escapeHtml(seedGate.label)}</td>
          <td><span class="pill ${statusClass(seedGate.status)}">${seedGate.status}</span></td>
          <td>${seedGate.expected.toLocaleString()}</td>
          <td>${seedGate.actual.toLocaleString()}</td>
          <td>${escapeHtml(seedGate.detail)}</td>
        </tr>`)
    .join('');

  const supportingRows = Object.entries(report.supportingCounts)
    .map(([label, count]) => `
        <tr>
          <td>${escapeHtml(label)}</td>
          <td>${count.toLocaleString()}</td>
        </tr>`)
    .join('');

  const actions = report.nextActions.map((action) => `<li>${escapeHtml(action)}</li>`).join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ShopMonkey Isolated Rehearsal</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #1f2933;
        --muted: #697386;
        --line: #d8dee9;
        --brand: #b1581b;
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
      .stamp,
      .metric,
      section {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fff;
      }
      .stamp {
        padding: 10px 12px;
        color: var(--muted);
        font-size: 13px;
        white-space: nowrap;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 24px;
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
      code {
        white-space: normal;
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
          <p class="muted">Disposable database load evidence</p>
          <h1>ShopMonkey Isolated Rehearsal</h1>
          <p class="muted">Source: ${escapeHtml(report.sourceFile)} (${escapeHtml(report.sourceKind)})</p>
        </div>
        <div class="stamp">Generated: ${escapeHtml(report.generatedAt)}</div>
      </header>

      <div class="summary">
        <div class="metric"><strong class="${statusClass(report.overallStatus)}">${report.overallStatus}</strong><span>Overall status</span></div>
        <div class="metric"><strong>${report.entities.filter((entity) => entity.status === 'PASS').length}</strong><span>Passed entity gates</span></div>
        <div class="metric"><strong>${report.entities.reduce((sum, entity) => sum + entity.importedRows, 0).toLocaleString()}</strong><span>Imported rows</span></div>
        <div class="metric"><strong>${report.referenceSeeds.filter((seedGate) => seedGate.status === 'PASS').length}</strong><span>Passed seed gates</span></div>
      </div>

      <section>
        <h2>Entity Reconciliation</h2>
        <table>
          <thead>
            <tr>
              <th>Entity</th>
              <th>Status</th>
              <th>Source</th>
              <th>Expected</th>
              <th>Imported</th>
              <th>Mappings</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>${entityRows}</tbody>
        </table>
      </section>

      <section>
        <h2>Reference Seed Gates</h2>
        <table>
          <thead>
            <tr>
              <th>Seed</th>
              <th>Status</th>
              <th>Expected</th>
              <th>Actual</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>${seedRows}</tbody>
        </table>
      </section>

      <section>
        <h2>Commands</h2>
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>Status</th>
              <th>Exit</th>
              <th>Duration</th>
              <th>Command</th>
            </tr>
          </thead>
          <tbody>${commandRows}</tbody>
        </table>
      </section>

      <section>
        <h2>Supporting Counts</h2>
        <table>
          <tbody>${supportingRows}</tbody>
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
