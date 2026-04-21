'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, EmptyState, LoadingSkeleton, SyncStatusBadge } from '@gg-erp/ui';
import type { SyncStatus } from '@gg-erp/ui';
import { listInvoiceSyncRecords, retryInvoiceSync, getQbStatus, type InvoiceSyncRecord } from '@/lib/api-client';
import { Button } from '@/components/ui/button';

export default function SyncMonitorPage() {
  const [records, setRecords] = useState<InvoiceSyncRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'FAILED' | 'PENDING' | 'SYNCED'>('ALL');
  const [qbConnected, setQbConnected] = useState<boolean | null>(null);
  const [qbCompany, setQbCompany] = useState<string | undefined>();
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    Promise.allSettled([
      listInvoiceSyncRecords().then(r => setRecords(r.items)),
      getQbStatus().then(s => { setQbConnected(s.connected); setQbCompany(s.companyName); }),
    ]).then(([syncResult, statusResult]) => {
      const errs = [syncResult, statusResult]
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map(r => r.reason instanceof Error ? r.reason.message : String(r.reason));
      if (errs.length) setLoadError(errs[0]);
    }).finally(() => setLoading(false));
  }, []);

  async function retry(id: string) {
    setRetrying(id);
    setRecords(prev => prev.map(r => r.id === id ? { ...r, state: 'IN_PROGRESS' as const } : r));
    try {
      await retryInvoiceSync(id);
      setRecords(prev => prev.map(r => r.id === id ? { ...r, state: 'PENDING' as const } : r));
      toast.success('Retry queued');
    } catch (err) {
      setRecords(prev => prev.map(r => r.id === id ? { ...r, state: 'FAILED' as const } : r));
      toast.error(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(null);
    }
  }

  const filtered = records.filter(r => filter === 'ALL' || r.state === filter);
  const failedCount = records.filter(r => r.state === 'FAILED').length;

  return (
    <div>
      <PageHeader
        title="Sync Monitor"
        description="QuickBooks invoice sync status"
        action={
          qbConnected === false ? (
            <a href="/api/accounting/oauth/connect">
              <Button className="bg-yellow-400 hover:bg-yellow-300 text-gray-900">Connect QuickBooks</Button>
            </a>
          ) : qbConnected ? (
            <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full">
              ✓ Connected: {qbCompany}
            </span>
          ) : null
        }
      />
      {loadError && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-yellow-800">⚠ Could not load sync data: {loadError}</p>
        </div>
      )}
      {failedCount > 0 && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
          <p className="text-sm font-semibold text-red-700">❌ {failedCount} sync failure{failedCount > 1 ? 's' : ''} require attention</p>
          <Button size="sm" variant="outline" className="text-red-600 border-red-300" onClick={() => toast.info('Bulk retry — select records individually')}>
            Retry All Failed
          </Button>
        </div>
      )}
      <div className="flex gap-2 mb-4">
        {(['ALL', 'FAILED', 'PENDING', 'SYNCED'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${filter === f ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600 hover:border-gray-400'}`}
          >
            {f}
          </button>
        ))}
      </div>
      {loading ? (
        <LoadingSkeleton rows={4} cols={5} />
      ) : filtered.length === 0 ? (
        <EmptyState icon="✅" title="No sync issues" description="All records are in sync." />
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Entity</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">ID</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Retries</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Error</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900 font-medium">{r.provider}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.invoiceNumber}</td>
                  <td className="px-4 py-3"><SyncStatusBadge status={r.state as SyncStatus} /></td>
                  <td className="px-4 py-3 text-gray-500">{r.attemptCount}</td>
                  <td className="px-4 py-3 text-xs text-red-600 max-w-xs truncate">{r.lastErrorMessage ?? '—'}</td>
                  <td className="px-4 py-3">
                    {(r.state === 'FAILED' || r.state === 'CANCELLED') && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retrying === r.id}
                        onClick={() => retry(r.id)}
                      >
                        {retrying === r.id ? 'Queuing…' : 'Retry'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
