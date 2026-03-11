import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';
import { listInvoiceSyncRecords } from '@/lib/api-client';

export default async function AccountingPage() {
  const { items: records } = await listInvoiceSyncRecords();
  const failed = records.filter(r => r.state === 'FAILED').length;
  const pending = records.filter(r => r.state === 'PENDING').length;

  return (
    <div>
      <PageHeader title="Accounting" description="Invoice sync and reconciliation" />
      <div className="grid grid-cols-2 gap-4 mb-8">
        <Link href="/accounting/sync" className="bg-white rounded-lg border border-gray-200 p-4 hover:border-yellow-400 transition-colors">
          <div className={`text-2xl font-bold ${failed > 0 ? 'text-red-600' : 'text-gray-900'}`}>{failed}</div>
          <div className="text-xs text-gray-500 mt-1">Sync Failures</div>
        </Link>
        <Link href="/accounting/reconciliation" className="bg-white rounded-lg border border-gray-200 p-4 hover:border-yellow-400 transition-colors">
          <div className="text-2xl font-bold text-yellow-700">{pending}</div>
          <div className="text-xs text-gray-500 mt-1">Pending Records</div>
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-4 max-w-xl">
        {[
          { label: 'Sync Monitor', description: 'QuickBooks sync status and retries', href: '/accounting/sync', icon: '🔄' },
          { label: 'Reconciliation', description: 'Exception handling and resolution', href: '/accounting/reconciliation', icon: '⚖️' },
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
