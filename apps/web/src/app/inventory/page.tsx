import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';
import { listInventoryReservations, listParts } from '@/lib/api-client';
import { WorkspaceLinkGrid } from '@/components/WorkspaceLinkGrid';
import { erpRoute } from '@/lib/erp-routes';

export default async function InventoryPage() {
  const [partsResult, reservationsResult] = await Promise.all([
    listParts({ limit: 500, offset: 0 }, { allowMockFallback: false })
      .then((data) => ({ status: 'ready' as const, data }))
      .catch(() => ({ status: 'unavailable' as const })),
    listInventoryReservations(
      { status: 'OPEN', page: 1, pageSize: 1 },
      { allowMockFallback: false },
    )
      .then((data) => ({ status: 'ready' as const, data }))
      .catch(() => ({ status: 'unavailable' as const })),
  ]);

  const stats: Array<{ label: string; value: number | string; color: string; href: string }> = [];

  if (partsResult.status === 'ready') {
    stats.push(
      {
        label: 'Total Parts',
        value: partsResult.data.total,
        color: 'text-gray-700',
        href: erpRoute('part'),
      },
      {
        label: 'Active Parts',
        value: partsResult.data.items.filter((p) => p.partState === 'ACTIVE').length,
        color: 'text-green-700',
        href: erpRoute('part'),
      },
      {
        label: 'Out of Stock',
        value: partsResult.data.items.filter((p) => (p.quantityOnHand ?? 0) === 0).length,
        color: 'text-red-600',
        href: erpRoute('part'),
      },
    );
  } else {
    stats.push({
      label: 'Parts Feed',
      value: 'Unavailable',
      color: 'text-red-600',
      href: erpRoute('part'),
    });
  }

  stats.push(
    reservationsResult.status === 'ready'
      ? {
          label: 'Open Reservations',
          value: reservationsResult.data.total,
          color: reservationsResult.data.total > 0 ? 'text-amber-700' : 'text-green-700',
          href: erpRoute('inventory-reservation'),
        }
      : {
          label: 'Reservations Feed',
          value: 'Unavailable',
          color: 'text-red-600',
          href: erpRoute('inventory-reservation'),
        },
  );

  return (
    <div>
      <PageHeader title="Inventory" description="Parts, reservations, and receiving" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {stats.map((stat) => (
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
