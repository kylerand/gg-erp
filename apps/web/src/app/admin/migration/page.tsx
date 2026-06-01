import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Database, FileWarning, History } from 'lucide-react';
import { PageHeader, StatusBadge } from '@gg-erp/ui';
import {
  listMigrationBatches,
  type MigrationBatchStatus,
  type MigrationBatchSummary,
} from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';

type CheckStatus = 'PASS' | 'WARN' | 'FAIL';

interface ReadinessCheck {
  key: string;
  label: string;
  description: string;
  status: CheckStatus;
  detail: string;
}

interface MigrationReadiness {
  batches: MigrationBatchSummary[];
  warnings: string[];
  summary: {
    totalBatches: number;
    completedBatches: number;
    failedBatches: number;
    openBatches: number;
    totalRecords: number;
    totalErrors: number;
    latestBatch: MigrationBatchSummary | null;
  };
  checks: ReadinessCheck[];
}

const VALIDATION_LINKS = [
  {
    label: 'Customers',
    href: erpRoute('customer'),
    description: 'Imported customer identities, contacts, and dealer records',
  },
  {
    label: 'Parts',
    href: erpRoute('part'),
    description: 'Inventory masters and vendor-linked stock data',
  },
  {
    label: 'Work Orders',
    href: erpRoute('work-order'),
    description: 'Historical orders, operations, and execution context',
  },
  {
    label: 'Accounting Sync',
    href: erpRoute('accounting-sync', { view: 'failures' }),
    description: 'Financial handoff failures and QuickBooks reconciliation',
  },
];

function formatDate(value?: string | null): string {
  return value ? new Date(value).toLocaleString() : '-';
}

function pluralize(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function statusTone(status: CheckStatus): string {
  if (status === 'PASS') return 'border-green-200 bg-green-50 text-green-900';
  if (status === 'FAIL') return 'border-red-200 bg-red-50 text-red-900';
  return 'border-yellow-200 bg-yellow-50 text-yellow-900';
}

function batchStatusLabel(status: MigrationBatchStatus): string {
  if (status === 'QUEUED') return 'PENDING';
  return status;
}

function buildChecks(summary: MigrationReadiness['summary']): ReadinessCheck[] {
  const latest = summary.latestBatch;
  const latestStatus = latest?.status;
  const hasCompletedBatch = summary.completedBatches > 0;
  const hasRecords = summary.totalRecords > 0;
  const hasErrors = summary.totalErrors > 0;

  return [
    {
      key: 'rehearsal',
      label: 'Migration rehearsal',
      status:
        latestStatus === 'FAILED'
          ? 'FAIL'
          : summary.openBatches > 0
            ? 'WARN'
            : hasCompletedBatch
              ? 'PASS'
              : 'WARN',
      description: 'Latest ShopMonkey batch state and open runner queue.',
      detail: latest
        ? `Latest ${latest.wave} batch is ${latest.status.toLowerCase()} from ${latest.sourceFile}.`
        : 'No ShopMonkey migration batch has been recorded.',
    },
    {
      key: 'records',
      label: 'Source coverage',
      status: hasRecords ? 'PASS' : 'WARN',
      description: 'Imported raw/staged records available for cutover inspection.',
      detail: hasRecords
        ? `${pluralize(summary.totalRecords, 'record')} captured across recent migration batches.`
        : 'Run a rehearsal export before promoting this environment.',
    },
    {
      key: 'errors',
      label: 'Error queue',
      status: hasErrors ? 'FAIL' : hasCompletedBatch ? 'PASS' : 'WARN',
      description: 'Unresolved migration errors that need repair before cutover.',
      detail: hasErrors
        ? `${pluralize(summary.totalErrors, 'error')} returned by recent migration batches.`
        : hasCompletedBatch
          ? 'No batch-level migration errors returned in recent runs.'
          : 'Error state will be available after the first rehearsal run.',
    },
    {
      key: 'gate',
      label: 'Cutover gate',
      status:
        hasCompletedBatch && hasRecords && !hasErrors && summary.openBatches === 0
          ? 'PASS'
          : hasErrors || latestStatus === 'FAILED'
            ? 'FAIL'
            : 'WARN',
      description: 'Go/no-go rollup for data promotion readiness.',
      detail:
        hasCompletedBatch && hasRecords && !hasErrors && summary.openBatches === 0
          ? 'Recent migration evidence is clean enough for staging sign-off review.'
          : 'Cutover remains open until a clean completed rehearsal is reviewed.',
    },
  ];
}

async function loadMigrationReadiness(): Promise<MigrationReadiness> {
  const warnings: string[] = [];
  let batches: MigrationBatchSummary[] = [];
  let totalBatches = 0;

  try {
    const result = await listMigrationBatches({ limit: 50 }, { allowMockFallback: false });
    batches = result.items;
    totalBatches = result.total;
  } catch (error) {
    warnings.push(
      error instanceof Error ? error.message : 'Migration batches are unavailable.',
    );
  }

  const completedBatches = batches.filter((batch) => batch.status === 'COMPLETED').length;
  const failedBatches = batches.filter((batch) => batch.status === 'FAILED').length;
  const openBatches = batches.filter((batch) =>
    ['QUEUED', 'RUNNING'].includes(batch.status),
  ).length;
  const totalRecords = batches.reduce(
    (sum, batch) => sum + Math.max(batch.recordCount, batch.rawRecordCount),
    0,
  );
  const totalErrors = batches.reduce(
    (sum, batch) => sum + Math.max(batch.errorCount, batch.migrationErrorCount),
    0,
  );

  const summary = {
    totalBatches,
    completedBatches,
    failedBatches,
    openBatches,
    totalRecords,
    totalErrors,
    latestBatch: batches[0] ?? null,
  };

  return {
    batches,
    warnings,
    summary,
    checks: buildChecks(summary),
  };
}

export default async function MigrationCutoverPage() {
  const readiness = await loadMigrationReadiness();
  const { summary } = readiness;

  return (
    <div>
      <PageHeader
        title="Migration Cutover"
        description="ShopMonkey rehearsal status, record coverage, and cutover inspection links"
      />

      {readiness.warnings.length > 0 && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          Migration readiness could not load from the live API.
        </div>
      )}

      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Batches"
          value={summary.totalBatches}
          detail={`${summary.completedBatches} completed / ${summary.openBatches} open`}
          icon={<History size={18} />}
        />
        <MetricCard
          label="Records"
          value={summary.totalRecords}
          detail="Raw or imported rows in recent runs"
          icon={<Database size={18} />}
        />
        <MetricCard
          label="Errors"
          value={summary.totalErrors}
          detail={`${summary.failedBatches} failed batches`}
          icon={<FileWarning size={18} />}
        />
        <MetricCard
          label="Latest Run"
          value={summary.latestBatch?.wave ?? '-'}
          detail={summary.latestBatch ? formatDate(summary.latestBatch.createdAt) : 'No batch data'}
          icon={<Clock3 size={18} />}
        />
      </section>

      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Readiness Checks
          </h2>
          <span className="text-xs font-medium text-gray-500">
            Live migration batch evidence
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {readiness.checks.map((check) => (
            <ReadinessCheckCard key={check.key} check={check} />
          ))}
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Cutover Inspection
          </h2>
          <span className="text-xs font-medium text-gray-500">Live ERP destinations</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {VALIDATION_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-yellow-400"
            >
              <div className="font-semibold text-gray-900">{link.label}</div>
              <div className="mt-1 text-xs leading-5 text-gray-500">{link.description}</div>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Recent Batches
          </h2>
          <span className="text-xs font-medium text-gray-500">
            {pluralize(readiness.batches.length, 'visible run')}
          </span>
        </div>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Wave</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Records</th>
                <th className="px-4 py-3">Errors</th>
                <th className="px-4 py-3">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {readiness.batches.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-sm text-gray-500" colSpan={6}>
                    No migration rehearsal batches were returned by the live API.
                  </td>
                </tr>
              ) : (
                readiness.batches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{batch.wave}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-gray-600">
                      {batch.sourceFile}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={batchStatusLabel(batch.status)} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {Math.max(batch.recordCount, batch.rawRecordCount).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {Math.max(batch.errorCount, batch.migrationErrorCount).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatDate(batch.completedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#FFF3E8] text-[#B1581B]">
          {icon}
        </div>
      </div>
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
      <div className="mt-1 text-xs leading-5 text-gray-500">{detail}</div>
    </section>
  );
}

function ReadinessCheckCard({ check }: { check: ReadinessCheck }) {
  const Icon = check.status === 'PASS' ? CheckCircle2 : AlertTriangle;

  return (
    <section className={`rounded-lg border p-4 ${statusTone(check.status)}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{check.label}</h3>
            <StatusBadge status={check.status} />
          </div>
          <p className="mt-1 text-xs leading-5 opacity-80">{check.description}</p>
        </div>
        <Icon size={18} className="shrink-0" />
      </div>
      <div className="mt-3 text-sm font-medium">{check.detail}</div>
    </section>
  );
}
