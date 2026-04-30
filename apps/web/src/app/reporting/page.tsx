import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';
import { listWoOrders } from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';

export default async function ReportingPage() {
  const ordersResult = await listWoOrders({ limit: 100 }, { allowMockFallback: false })
    .then((data) => ({ status: 'ready' as const, data }))
    .catch(() => ({ status: 'unavailable' as const }));
  const blocked =
    ordersResult.status === 'ready'
      ? ordersResult.data.items.filter((w) => w.status === 'BLOCKED')
      : [];

  const stats =
    ordersResult.status === 'ready'
      ? [
          {
            label: 'Work Orders',
            value: ordersResult.data.total,
            sub: `${blocked.length} blocked`,
            href: erpRoute('work-order'),
            color: blocked.length > 0 ? 'text-red-600' : 'text-gray-900',
          },
          {
            label: 'In Progress',
            value: ordersResult.data.items.filter((w) => w.status === 'IN_PROGRESS').length,
            sub: 'active builds',
            href: erpRoute('dispatch-board'),
            color: 'text-yellow-700',
          },
          {
            label: 'Completed',
            value: ordersResult.data.items.filter((w) => w.status === 'COMPLETED').length,
            sub: 'returned records',
            href: erpRoute('work-order'),
            color: 'text-green-700',
          },
        ]
      : [
          {
            label: 'Work Orders',
            value: 'Unavailable',
            sub: 'API did not return data',
            href: erpRoute('work-order'),
            color: 'text-red-600',
          },
        ];

  return (
    <div>
      <PageHeader title="Reporting" description="Cross-context visibility and alerts" />
      {blocked.length > 0 && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-red-700 mb-3">
            ⚠️ {blocked.length} Blocked Work Orders
          </p>
          <div className="space-y-2">
            {blocked.map((wo) => (
              <div key={wo.id} className="flex items-center gap-3 text-sm">
                <span className="font-mono text-xs text-red-600">{wo.workOrderNumber}</span>
                <span className="text-gray-700">{wo.title}</span>
                <Link
                  href={erpRoute('blocked-work')}
                  className="ml-auto text-xs text-red-600 hover:underline"
                >
                  Triage →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="bg-white rounded-lg border border-gray-200 p-4 hover:border-yellow-400 transition-colors"
          >
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-sm font-medium text-gray-700 mt-1">{stat.label}</div>
            <div className="text-xs text-gray-400">{stat.sub}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
