import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';
import { listWorkOrders } from '@/lib/api-client';

export default async function ReportingPage() {
  const { items } = await listWorkOrders({ limit: 100 });
  const blocked = items.filter(w => w.state === 'BLOCKED');

  return (
    <div>
      <PageHeader title="Reporting" description="Cross-context visibility and alerts" />
      {blocked.length > 0 && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-red-700 mb-3">⚠️ {blocked.length} Blocked Work Orders</p>
          <div className="space-y-2">
            {blocked.map(wo => (
              <div key={wo.id} className="flex items-center gap-3 text-sm">
                <span className="font-mono text-xs text-red-600">{wo.workOrderNumber}</span>
                <span className="text-gray-700">{wo.description ?? wo.vehicleId}</span>
                <Link href="/work-orders/open" className="ml-auto text-xs text-red-600 hover:underline">Triage →</Link>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Work Orders', value: items.length, sub: `${blocked.length} blocked`, href: '/work-orders', color: blocked.length > 0 ? 'text-red-600' : 'text-gray-900' },
          { label: 'In Progress', value: items.filter(w => w.state === 'IN_PROGRESS').length, sub: 'active builds', href: '/work-orders/dispatch', color: 'text-yellow-700' },
          { label: 'Completed', value: items.filter(w => w.state === 'COMPLETED').length, sub: 'this period', href: '/work-orders', color: 'text-green-700' },
        ].map(stat => (
          <Link key={stat.label} href={stat.href} className="bg-white rounded-lg border border-gray-200 p-4 hover:border-yellow-400 transition-colors">
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-sm font-medium text-gray-700 mt-1">{stat.label}</div>
            <div className="text-xs text-gray-400">{stat.sub}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
