import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';
import { listCustomers, listDealers } from '@/lib/api-client';

export default async function CustomerDealersPage() {
  const [customers, dealers] = await Promise.all([listCustomers({ limit: 1, offset: 0 }), listDealers()]);

  return (
    <div>
      <PageHeader title="Customer & Dealer Ops" description="Customer lifecycle and dealer management" />
      <div className="grid grid-cols-2 gap-4 mb-8">
        <Link href="/customer-dealers/customers" className="bg-white rounded-lg border border-gray-200 p-4 hover:border-yellow-400 transition-colors">
          <div className="text-2xl font-bold text-gray-900">{customers.total}</div>
          <div className="text-xs text-gray-500 mt-1">Total Customers</div>
        </Link>
        <Link href="/customer-dealers/dealers" className="bg-white rounded-lg border border-gray-200 p-4 hover:border-yellow-400 transition-colors">
          <div className="text-2xl font-bold text-gray-900">{dealers.length}</div>
          <div className="text-xs text-gray-500 mt-1">Dealers</div>
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Customers', description: 'Profiles and lifecycle', href: '/customer-dealers/customers', icon: '🏢' },
          { label: 'Dealers', description: 'Dealer profiles and service', href: '/customer-dealers/dealers', icon: '🤝' },
          { label: 'Relationships', description: 'Customer-dealer links', href: '/customer-dealers/relationships', icon: '🔗' },
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
