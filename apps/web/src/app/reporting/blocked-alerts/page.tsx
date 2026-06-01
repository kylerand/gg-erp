import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';
import { getBlockedAlerts } from '@/lib/api-client';

const STRICT_LIVE_DATA = { allowMockFallback: false } as const;

function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function severityClasses(severity: string): string {
  if (severity === 'P1') return 'border-red-200 bg-red-50 text-red-700';
  if (severity === 'P2') return 'border-yellow-200 bg-yellow-50 text-yellow-800';
  return 'border-gray-200 bg-gray-50 text-gray-700';
}

export default async function BlockedAlertsPage() {
  let feed;
  let error: string | undefined;
  try {
    feed = await getBlockedAlerts({ limit: 50 }, STRICT_LIVE_DATA);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Blocked alerts are unavailable.';
  }

  const summary = feed?.summary ?? {
    total: 0,
    p1: 0,
    p2: 0,
    p3: 0,
    unowned: 0,
    averageAgeMinutes: 0,
    oldestAgeMinutes: 0,
  };
  const items = feed?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Blocked Alerts"
        description={`${summary.total} active blocker${summary.total === 1 ? '' : 's'} requiring owner follow-up`}
      />

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {error}
        </div>
      )}

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{summary.total}</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-600">P1</p>
          <p className="mt-2 text-2xl font-semibold text-red-700">{summary.p1}</p>
        </div>
        <div className="rounded-lg border border-yellow-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-yellow-700">P2</p>
          <p className="mt-2 text-2xl font-semibold text-yellow-800">{summary.p2}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Oldest</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">
            {formatAge(summary.oldestAgeMinutes)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Avg age</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">
            {formatAge(summary.averageAgeMinutes)}
          </p>
        </div>
      </section>

      {items.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm font-semibold text-gray-900">No active blockers</p>
          <p className="mt-1 text-sm text-gray-500">Work orders, tasks, operations, and part demand are clear.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${severityClasses(
                        item.severity,
                      )}`}
                    >
                      {item.severity}
                    </span>
                    <span className="font-mono text-xs text-gray-500">{item.workOrderNumber}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                      {item.sourceType.replaceAll('_', ' ')}
                    </span>
                    <span className="text-xs text-gray-500">{formatAge(item.ageMinutes)}</span>
                  </div>
                  <Link href={item.route} className="text-sm font-semibold text-gray-900 hover:text-[#B1581B]">
                    {item.workOrderTitle}
                  </Link>
                  <p className="mt-1 text-sm text-gray-600">{item.reason}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                    <span className="rounded-full bg-gray-50 px-2 py-1">{item.ownerLabel}</span>
                    <span className="rounded-full bg-gray-50 px-2 py-1">{item.reasonCode}</span>
                    {item.customerReference && (
                      <span className="rounded-full bg-gray-50 px-2 py-1">{item.customerReference}</span>
                    )}
                    {item.assetReference && (
                      <span className="rounded-full bg-gray-50 px-2 py-1">{item.assetReference}</span>
                    )}
                  </div>
                  <p className="mt-3 text-sm font-medium text-gray-800">{item.nextAction}</p>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {item.actions.map((action) => (
                    <Link
                      key={`${item.id}:${action.label}`}
                      href={action.href}
                      className="rounded border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-yellow-400 hover:bg-yellow-50"
                    >
                      {action.label}
                    </Link>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
