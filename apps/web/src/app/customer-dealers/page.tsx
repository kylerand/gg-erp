import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';
import { listCustomers, listDealerRelationships, listDealers } from '@/lib/api-client';
import { WorkspaceLinkGrid } from '@/components/WorkspaceLinkGrid';
import { erpRoute } from '@/lib/erp-routes';

export default async function CustomerDealersPage() {
  const strictApiOptions = { allowMockFallback: false } as const;
  const [customersResult, dealersResult, relationshipsResult] = await Promise.allSettled([
    listCustomers({ limit: 1, offset: 0 }, strictApiOptions),
    listDealers({ limit: 1, offset: 0 }, strictApiOptions),
    listDealerRelationships({ limit: 1, offset: 0 }, strictApiOptions),
  ]);
  const customerTotal = customersResult.status === 'fulfilled' ? customersResult.value.total : null;
  const dealerTotal = dealersResult.status === 'fulfilled' ? dealersResult.value.total : null;
  const relationshipTotal = relationshipsResult.status === 'fulfilled' ? relationshipsResult.value.total : null;

  return (
    <div>
      <PageHeader
        title="Customer & Dealer Ops"
        description="Customer lifecycle, commercial accounts, and cart ownership links"
      />
      <div className="grid gap-4 mb-8 md:grid-cols-3">
        <Link
          href={erpRoute('customer')}
          className="bg-white rounded-lg border border-gray-200 p-4 hover:border-yellow-400 transition-colors"
        >
          <div className="text-2xl font-bold text-gray-900">
            {customerTotal === null ? 'Unavailable' : customerTotal}
          </div>
          <div className="text-xs text-gray-500 mt-1">Total Customers</div>
        </Link>
        <Link
          href={erpRoute('dealer')}
          className="bg-white rounded-lg border border-gray-200 p-4 hover:border-yellow-400 transition-colors"
        >
          <div className="text-2xl font-bold text-gray-900">
            {dealerTotal === null ? 'Unavailable' : dealerTotal}
          </div>
          <div className="text-xs text-gray-500 mt-1">Dealers</div>
        </Link>
        <Link
          href={erpRoute('customer-relationship')}
          className="bg-white rounded-lg border border-gray-200 p-4 hover:border-yellow-400 transition-colors"
        >
          <div className="text-2xl font-bold text-gray-900">
            {relationshipTotal === null ? 'Unavailable' : relationshipTotal}
          </div>
          <div className="text-xs text-gray-500 mt-1">Dealer relationships</div>
        </Link>
      </div>
      <WorkspaceLinkGrid moduleKey="customers" />
    </div>
  );
}
