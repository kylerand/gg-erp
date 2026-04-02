'use client';
import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { PageHeader, EmptyState, LoadingSkeleton, StatusBadge } from '@gg-erp/ui';
import { listWoOrders, type WoOrder } from '@/lib/api-client';
import { Pagination } from '@/components/ui/pagination';

const PAGE_SIZE = 25;

export default function OpenBlockedPage() {
  const [items, setItems] = useState<WoOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'BLOCKED' | 'IN_PROGRESS'>('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const load = useCallback(async (f: string, p: number, ps: number) => {
    setLoading(true);
    try {
      const status = f === 'ALL' ? undefined : f;
      const r = await listWoOrders({ status, limit: ps, offset: (p - 1) * ps });
      setItems(r.items);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(filter, page, pageSize); }, [filter, page, pageSize, load]);

  function handleFilter(f: 'ALL' | 'BLOCKED' | 'IN_PROGRESS') {
    setFilter(f);
    setPage(1);
  }

  const displayed = filter === 'ALL'
    ? items.filter(w => ['BLOCKED', 'READY', 'IN_PROGRESS', 'SCHEDULED'].includes(w.status))
    : items;

  return (
    <div>
      <PageHeader title="Open / Blocked" description={`Triage stalled and waiting work — ${total} total`} />

      <div className="flex gap-2 mb-6">
        {(['ALL', 'BLOCKED', 'IN_PROGRESS'] as const).map(f => (
          <button key={f} onClick={() => handleFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${filter === f ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600 hover:border-gray-400'}`}>
            {f === 'ALL' ? 'All Open' : f.replace('_', ' ')}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSkeleton rows={5} cols={4} />
      ) : displayed.length === 0 ? (
        <EmptyState icon="🎉" title="No blockers" description="All work orders are progressing." />
      ) : (
        <>
          <div className="space-y-2">
            {displayed.map(wo => (
              <div key={wo.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-start gap-4">
                {wo.status === 'BLOCKED' && <span className="text-red-500 text-lg mt-0.5" aria-label="Blocked">⚠️</span>}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-gray-500">{wo.workOrderNumber}</span>
                    <StatusBadge status={wo.status} />
                  </div>
                  <p className="text-sm font-medium text-gray-900">{wo.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{wo.customerReference ?? wo.assetReference ?? '—'}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => toast.success(`Acknowledged ${wo.workOrderNumber}`)}
                    className="text-xs border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded transition-colors">
                    Acknowledge
                  </button>
                  <button onClick={() => toast.info(`Escalating ${wo.workOrderNumber}…`)}
                    className="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded transition-colors">
                    Escalate
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={ps => { setPageSize(ps); setPage(1); }} />
        </>
      )}
    </div>
  );
}
