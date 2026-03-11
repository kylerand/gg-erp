import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';
import { listParts } from '@/lib/api-client';

export default async function InventoryPage() {
  const { items: parts } = await listParts();
  const lowStock = parts.filter(p => (p.quantityOnHand ?? 0) === 0).length;
  const activeCount = parts.filter(p => p.partState === 'ACTIVE').length;

  return (
    <div>
      <PageHeader title="Inventory" description="Parts, reservations, and receiving" />
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Active Parts', value: activeCount, color: 'text-green-700', href: '/inventory/parts' },
          { label: 'Out of Stock', value: lowStock, color: 'text-red-600', href: '/inventory/parts' },
          { label: 'Reservations', value: '—', color: 'text-yellow-700', href: '/inventory/reservations' },
        ].map(stat => (
          <Link key={stat.label} href={stat.href} className="bg-white rounded-lg border border-gray-200 p-4 hover:border-yellow-400 transition-colors">
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-gray-500 mt-1">{stat.label}</div>
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Part Lookup', description: 'Search SKUs, bins, stock', href: '/inventory/parts', icon: '🔍' },
          { label: 'Reservations', description: 'Pick list & shortage handling', href: '/inventory/reservations', icon: '📋' },
          { label: 'Receiving', description: 'PO receipt & variance', href: '/inventory/receiving', icon: '📥' },
        ].map(item => (
          <Link key={item.href} href={item.href} className="bg-white rounded-lg border border-gray-200 p-5 hover:border-yellow-400 hover:shadow-sm transition-all">
            <div className="text-2xl mb-2">{item.icon}</div>
            <div className="font-semibold text-sm text-gray-900">{item.label}</div>
            <div className="text-xs text-gray-500 mt-0.5">{item.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
