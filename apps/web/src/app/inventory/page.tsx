import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';
import { listInventoryReservations, listParts, listPurchaseOrders } from '@/lib/api-client';
import { WorkspaceLinkGrid } from '@/components/WorkspaceLinkGrid';
import { erpRoute } from '@/lib/erp-routes';

export default async function InventoryPage() {
  const [
    partsResult,
    activePartsResult,
    outOfStockResult,
    reservationsResult,
    sentPurchaseOrdersResult,
  ] = await Promise.all([
    listParts({ limit: 1, offset: 0 }, { allowMockFallback: false })
      .then((data) => ({ status: 'ready' as const, data }))
      .catch(() => ({ status: 'unavailable' as const })),
    listParts({ partState: 'ACTIVE', limit: 1, offset: 0 }, { allowMockFallback: false })
      .then((data) => ({ status: 'ready' as const, data }))
      .catch(() => ({ status: 'unavailable' as const })),
    listParts({ stock: 'OUT', limit: 1, offset: 0 }, { allowMockFallback: false })
      .then((data) => ({ status: 'ready' as const, data }))
      .catch(() => ({ status: 'unavailable' as const })),
    listInventoryReservations(
      { status: 'OPEN', page: 1, pageSize: 1 },
      { allowMockFallback: false },
    )
      .then((data) => ({ status: 'ready' as const, data }))
      .catch(() => ({ status: 'unavailable' as const })),
    listPurchaseOrders({ status: 'SENT', pageSize: 1 }, { allowMockFallback: false })
      .then((data) => ({ status: 'ready' as const, data }))
      .catch(() => ({ status: 'unavailable' as const })),
  ]);

  const stats: Array<{ label: string; value: number | string; color: string; href: string }> = [];

  if (partsResult.status === 'ready') {
    stats.push({
      label: 'Total Parts',
      value: partsResult.data.total,
      color: 'text-gray-700',
      href: erpRoute('part'),
    });
  }

  if (activePartsResult.status === 'ready') {
    stats.push({
      label: 'Active Parts',
      value: activePartsResult.data.total,
      color: 'text-green-700',
      href: erpRoute('part', { partState: 'ACTIVE' }),
    });
  }

  if (outOfStockResult.status === 'ready') {
    stats.push({
      label: 'Out of Stock',
      value: outOfStockResult.data.total,
      color: 'text-red-600',
      href: erpRoute('part', { stock: 'OUT' }),
    });
  }

  if (
    partsResult.status === 'unavailable' ||
    activePartsResult.status === 'unavailable' ||
    outOfStockResult.status === 'unavailable'
  ) {
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
          href: erpRoute('inventory-reservation', { status: 'OPEN' }),
        }
      : {
          label: 'Reservations Feed',
          value: 'Unavailable',
          color: 'text-red-600',
          href: erpRoute('inventory-reservation'),
        },
  );

  stats.push(
    sentPurchaseOrdersResult.status === 'ready'
      ? {
          label: 'Sent POs',
          value: sentPurchaseOrdersResult.data.total,
          color: sentPurchaseOrdersResult.data.total > 0 ? 'text-amber-700' : 'text-green-700',
          href: erpRoute('purchase-order', { status: 'SENT' }),
        }
      : {
          label: 'PO Feed',
          value: 'Unavailable',
          color: 'text-red-600',
          href: erpRoute('purchase-order'),
        },
  );

  return (
    <div>
      <PageHeader title="Inventory" description="Parts, reservations, and receiving" />
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
