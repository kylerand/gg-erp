import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';
import { listCustomers, listDealers } from '@/lib/api-client';
import { WorkspaceLinkGrid } from '@/components/WorkspaceLinkGrid';
import { erpRoute } from '@/lib/erp-routes';

export default async function CustomerDealersPage() {
  const [customers, dealers] = await Promise.all([
    listCustomers({ limit: 1, offset: 0 }),
    listDealers(),
  ]);

  return (
    <div>
      <PageHeader
        title="Customer & Dealer Ops"
        description="Customer lifecycle and dealer management"
      />
      <div className="grid grid-cols-2 gap-4 mb-8">
        <Link
          href={erpRoute('customer')}
          className="bg-white rounded-lg border border-gray-200 p-4 hover:border-yellow-400 transition-colors"
        >
          <div className="text-2xl font-bold text-gray-900">{customers.total}</div>
          <div className="text-xs text-gray-500 mt-1">Total Customers</div>
        </Link>
        <Link
          href={erpRoute('dealer')}
          className="bg-white rounded-lg border border-gray-200 p-4 hover:border-yellow-400 transition-colors"
        >
          <div className="text-2xl font-bold text-gray-900">{dealers.length}</div>
          <div className="text-xs text-gray-500 mt-1">Dealers</div>
        </Link>
      </div>
      <WorkspaceLinkGrid moduleKey="customers" />
    </div>
  );
}
