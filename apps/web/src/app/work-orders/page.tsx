import Link from 'next/link';
import { listWoOrders } from '@/lib/api-client';
import { PageHeader, StatusBadge } from '@gg-erp/ui';

export default async function WorkOrdersPage() {
  const { items, total } = await listWoOrders({ limit: 10 });
  const blocked = items.filter(w => w.status === 'BLOCKED').length;
  const inProgress = items.filter(w => w.status === 'IN_PROGRESS').length;

  return (
    <div>
      <PageHeader title="Work Orders" description={`${total} total`} />

      <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-4">
        {[
          { label: 'In Progress', value: inProgress, color: 'text-yellow-700', href: '/work-orders/my-queue' },
          { label: 'Blocked', value: blocked, color: 'text-red-600', href: '/work-orders/open' },
          { label: 'Total', value: total, color: 'text-gray-700', href: '/work-orders/open' },
          { label: 'Dispatch', value: '—', color: 'text-purple-700', href: '/work-orders/dispatch' },
        ].map(stat => (
          <Link key={stat.label} href={stat.href} className="bg-white rounded-lg border border-gray-200 p-4 hover:border-yellow-400 transition-colors">
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-gray-500 mt-1">{stat.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'My Queue', description: 'Your assigned work', href: '/work-orders/my-queue', icon: '📋' },
          { label: 'Dispatch Board', description: 'Assign & balance load', href: '/work-orders/dispatch', icon: '🗂️' },
          { label: 'Open / Blocked', description: 'Triage stalled work', href: '/work-orders/open', icon: '🚧' },
          { label: 'New Work Order', description: 'Create a build job', href: '/work-orders/new', icon: '➕' },
        ].map(item => (
          <Link key={item.href} href={item.href} className="bg-white rounded-lg border border-gray-200 p-5 hover:border-yellow-400 hover:shadow-sm transition-all">
            <div className="text-2xl mb-2">{item.icon}</div>
            <div className="font-semibold text-sm text-gray-900">{item.label}</div>
            <div className="text-xs text-gray-500 mt-0.5">{item.description}</div>
          </Link>
        ))}
      </div>

      {items.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent Work Orders</h2>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">WO #</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Title</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(wo => (
                  <tr key={wo.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-medium text-gray-900">{wo.workOrderNumber}</td>
                    <td className="px-4 py-3 text-gray-700 truncate max-w-xs">{wo.title}</td>
                    <td className="px-4 py-3 text-gray-500 truncate max-w-xs">{wo.customerReference ?? '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={wo.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
