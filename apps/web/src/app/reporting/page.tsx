import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';
import {
  getErpSavedReportViews,
  getLiveErpReports,
  type ErpReportCategory,
  type ErpReportBlockedWorkOrder,
  type ErpReportDescriptor,
  type ErpReportExportRun,
  type ErpReportSnapshotMetric,
  type ErpReportSubscription,
} from '@gg-erp/domain';
import {
  getReportExportRuns,
  getReportSubscriptions,
  getReportingSnapshot,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';
import { ReportingExportActions } from './ReportingExportActions';
import { ReportingSubscriptionsPanel } from './ReportingSubscriptionsPanel';

type ReportingCategoryFilter = ErpReportCategory | 'all';

interface ReportingPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

type ReportMetric = ErpReportSnapshotMetric;

interface ReportSignals {
  metrics: Record<string, ReportMetric>;
  blockedOrders: ErpReportBlockedWorkOrder[];
  warnings: string[];
}

interface ReportingAutomation {
  subscriptions: ErpReportSubscription[];
  exportRuns: ErpReportExportRun[];
  warnings: string[];
}

const CATEGORY_LABELS: Record<ErpReportCategory, string> = {
  operations: 'Operations',
  inventory: 'Inventory',
  sales: 'Sales',
  accounting: 'Accounting',
  training: 'Training',
  admin: 'Admin',
};

const CATEGORY_FILTERS: Array<{ label: string; value: ReportingCategoryFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Operations', value: 'operations' },
  { label: 'Inventory', value: 'inventory' },
  { label: 'Sales', value: 'sales' },
  { label: 'Accounting', value: 'accounting' },
  { label: 'Training', value: 'training' },
  { label: 'Admin', value: 'admin' },
];

function singleParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function normalizeCategory(value: string): ReportingCategoryFilter {
  return CATEGORY_FILTERS.some((filter) => filter.value === value)
    ? (value as ReportingCategoryFilter)
    : 'all';
}

function reportingHref(category: ReportingCategoryFilter, query: string): string {
  const params = new URLSearchParams();
  if (category !== 'all') params.set('category', category);
  if (query.trim()) params.set('query', query.trim());
  const qs = params.toString();
  return `${erpRoute('reporting')}${qs ? `?${qs}` : ''}`;
}

function reportMatchesQuery(report: ErpReportDescriptor, query: string): boolean {
  if (!query.trim()) return true;
  const haystack = [
    report.label,
    report.description,
    report.category,
    report.module,
    report.ownerContext,
    ...report.keywords,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

async function loadReportSignals(): Promise<ReportSignals> {
  try {
    const snapshot = await getReportingSnapshot({ allowMockFallback: false });
    return {
      metrics: snapshot.metrics,
      blockedOrders: snapshot.blockedWorkOrders,
      warnings: snapshot.warnings.map((warning) => `${warning.source}: ${warning.message}`),
    };
  } catch (error) {
    return {
      metrics: {},
      blockedOrders: [],
      warnings: [
        error instanceof Error
          ? `reporting.snapshot: ${error.message}`
          : 'reporting.snapshot: unavailable',
      ],
    };
  }
}

async function loadReportingAutomation(): Promise<ReportingAutomation> {
  try {
    const [subscriptions, exportRuns] = await Promise.all([
      getReportSubscriptions({ allowMockFallback: false }),
      getReportExportRuns({ limit: 20 }, { allowMockFallback: false }),
    ]);
    return {
      subscriptions: subscriptions.items,
      exportRuns: exportRuns.items,
      warnings: [],
    };
  } catch {
    return {
      subscriptions: [],
      exportRuns: [],
      warnings: [],
    };
  }
}

function metricToneClasses(tone: ReportMetric['tone']): string {
  switch (tone) {
    case 'green':
      return 'text-green-700';
    case 'amber':
      return 'text-yellow-700';
    case 'red':
      return 'text-red-600';
    default:
      return 'text-gray-900';
  }
}

export default async function ReportingPage({ searchParams }: ReportingPageProps) {
  const activeCategory = normalizeCategory(singleParam(searchParams?.category));
  const query = singleParam(searchParams?.query);
  const reports = getLiveErpReports();
  const savedViews = getErpSavedReportViews();
  const filteredReports = reports.filter(
    (report) =>
      (activeCategory === 'all' || report.category === activeCategory) &&
      reportMatchesQuery(report, query),
  );
  const [signals, automation] = await Promise.all([loadReportSignals(), loadReportingAutomation()]);

  return (
    <div>
      <PageHeader
        title="Reporting"
        description={`${filteredReports.length} operational report${filteredReports.length === 1 ? '' : 's'} ready for drill-through`}
      />

      {[...signals.warnings, ...automation.warnings].length > 0 && (
        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
          Some live report signals could not be loaded. The report destinations are still available.
        </div>
      )}

      {signals.blockedOrders.length > 0 && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="mb-3 flex items-center justify-between gap-4">
            <p className="text-sm font-semibold text-red-700">
              {signals.blockedOrders.length} blocked work order
              {signals.blockedOrders.length === 1 ? '' : 's'} returned in the triage sample
            </p>
            <Link
              href={erpRoute('report-work-order-blockers')}
              className="text-xs font-semibold text-red-700 hover:underline"
            >
              Triage all
            </Link>
          </div>
          <div className="space-y-2">
            {signals.blockedOrders.map((wo) => (
              <div key={wo.id} className="flex items-center gap-3 text-sm">
                <Link
                  href={erpRecordRoute('work-order', wo.id)}
                  className="font-mono text-xs text-red-700 hover:underline"
                >
                  {wo.workOrderNumber}
                </Link>
                <span className="text-gray-700">{wo.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ReportingExportActions reports={filteredReports} savedViews={savedViews} />

      <ReportingSubscriptionsPanel
        savedViews={savedViews}
        initialSubscriptions={automation.subscriptions}
        initialExportRuns={automation.exportRuns}
      />

      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Saved Views
          </h2>
          <span className="text-xs font-medium text-gray-500">
            {savedViews.length} reusable report scope{savedViews.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {savedViews.map((view) => (
            <Link
              key={view.key}
              href={view.route}
              className="rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-yellow-400"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{view.label}</h3>
                  <p className="mt-1 text-sm leading-5 text-gray-600">{view.description}</p>
                </div>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[0.7rem] font-semibold text-gray-500">
                  {view.cadence}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                <span className="rounded-full bg-gray-50 px-2 py-1">{view.ownerContext}</span>
                <span className="rounded-full bg-gray-50 px-2 py-1">
                  {view.reportKeys.length} reports
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {CATEGORY_FILTERS.map((filter) => {
            const active = activeCategory === filter.value;
            return (
              <Link
                key={filter.value}
                href={reportingHref(filter.value, query)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-[#E37125] bg-[#FFF3E8] text-[#8A4A18]'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-yellow-400'
                }`}
              >
                {filter.label}
              </Link>
            );
          })}
        </div>
        <form action={erpRoute('reporting')} className="flex w-full gap-2 lg:max-w-md">
          {activeCategory !== 'all' && (
            <input type="hidden" name="category" value={activeCategory} />
          )}
          <input
            name="query"
            defaultValue={query}
            placeholder="Search reports, sources, owners..."
            className="h-9 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-sm focus:border-yellow-400 focus:outline-none focus:ring-2 focus:ring-yellow-100"
          />
          <button
            type="submit"
            className="h-9 rounded-lg bg-yellow-400 px-4 text-sm font-semibold text-gray-900 hover:bg-yellow-300"
          >
            Search
          </button>
          {(query || activeCategory !== 'all') && (
            <Link
              href={erpRoute('reporting')}
              className="inline-flex h-9 items-center rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 hover:border-yellow-400"
            >
              Reset
            </Link>
          )}
        </form>
      </div>

      {filteredReports.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center text-sm text-gray-500">
          No reports match the current filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filteredReports.map((report) => (
            <ReportCard key={report.key} report={report} metric={signals.metrics[report.key]} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report, metric }: { report: ErpReportDescriptor; metric?: ReportMetric }) {
  return (
    <Link
      href={report.route}
      className="rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-yellow-400"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-gray-900">{report.label}</h2>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[0.7rem] font-semibold text-gray-500">
              {CATEGORY_LABELS[report.category]}
            </span>
          </div>
          <p className="mt-2 text-sm leading-5 text-gray-600">{report.description}</p>
        </div>
        {metric && (
          <div className="shrink-0 text-right">
            <div className={`text-xl font-bold ${metricToneClasses(metric.tone)}`}>
              {metric.value}
            </div>
            <div className="text-xs text-gray-400">{metric.label}</div>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="rounded-full bg-gray-50 px-2 py-1">{report.cadence}</span>
        <span className="rounded-full bg-gray-50 px-2 py-1">{report.ownerContext}</span>
        {report.sourceObjectKeys.slice(0, 3).map((source) => (
          <span key={source} className="rounded-full bg-gray-50 px-2 py-1">
            {source}
          </span>
        ))}
      </div>
      <div className="mt-4 text-sm font-semibold text-[#B1581B]">{report.drillThroughLabel}</div>
    </Link>
  );
}
