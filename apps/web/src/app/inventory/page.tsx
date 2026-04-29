import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';
import { listParts } from '@/lib/api-client';
import { WorkspaceLinkGrid } from '@/components/WorkspaceLinkGrid';
import { erpRoute } from '@/lib/erp-routes';

export default async function InventoryPage() {
  const res = await listParts({ limit: 500, offset: 0 });
  const lowStock = res.items.filter((p) => (p.quantityOnHand ?? 0) === 0).length;
  const activeCount = res.items.filter((p) => p.partState === 'ACTIVE').length;

  return (
    <div>
      <PageHeader title="Inventory" description="Parts, reservations, and receiving" />
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          {
            label: 'Total Parts',
            value: res.total,
            color: 'text-gray-700',
            href: erpRoute('part'),
          },
          {
            label: 'Active Parts',
            value: activeCount,
            color: 'text-green-700',
            href: erpRoute('part'),
          },
          { label: 'Out of Stock', value: lowStock, color: 'text-red-600', href: erpRoute('part') },
          {
            label: 'Reservations',
            value: '—',
            color: 'text-yellow-700',
            href: erpRoute('inventory-reservation'),
          },
        ].map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="bg-white rounded-lg border border-gray-200 p-4 hover:border-yellow-400 transition-colors"
          >
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-gray-500 mt-1">{stat.label}</div>
          </Link>
        ))}
      </div>
      <WorkspaceLinkGrid moduleKey="inventory" />
    </div>
  );
}
