'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, EmptyState, LoadingSkeleton, StatusBadge } from '@gg-erp/ui';
import { listWorkOrders, type WorkOrder } from '@/lib/api-client';

export default function OpenBlockedPage() {
  const [items, setItems] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'BLOCKED' | 'PLANNED'>('ALL');

  useEffect(() => {
    listWorkOrders({ limit: 50 }).then(r => { setItems(r.items); setLoading(false); });
  }, []);

  const filtered = items.filter(w =>
    filter === 'ALL' ? ['BLOCKED', 'PLANNED', 'RELEASED'].includes(w.state) : w.state === filter
  );

  if (loading) return <div><PageHeader title="Open / Blocked" /><LoadingSkeleton rows={5} cols={4} /></div>;

  return (
    <div>
      <PageHeader title="Open / Blocked" description="Triage stalled and waiting work" />

      <div className="flex gap-2 mb-6">
        {(['ALL', 'BLOCKED', 'PLANNED'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${filter === f ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600 hover:border-gray-400'}`}>
            {f === 'ALL' ? 'All Open' : f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="🎉" title="No blockers" description="All work orders are progressing." />
      ) : (
        <div className="space-y-2">
          {filtered.map(wo => (
            <div key={wo.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-start gap-4">
              {wo.state === 'BLOCKED' && <span className="text-red-500 text-lg mt-0.5" aria-label="Blocked">⚠️</span>}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs text-gray-500">{wo.workOrderNumber}</span>
                  <StatusBadge status={wo.state} />
                </div>
                <p className="text-sm font-medium text-gray-900">{wo.description ?? wo.vehicleId}</p>
                <p className="text-xs text-gray-400 mt-0.5">Vehicle: {wo.vehicleId}</p>
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
      )}
    </div>
  );
}
