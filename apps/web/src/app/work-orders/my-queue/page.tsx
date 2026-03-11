'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, EmptyState, LoadingSkeleton, StatusBadge } from '@gg-erp/ui';
import { listWorkOrders, transitionWorkOrderState, type WorkOrder } from '@/lib/api-client';

export default function MyQueuePage() {
  const [items, setItems] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { items } = await listWorkOrders({ state: 'IN_PROGRESS', limit: 20 });
      setItems(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleTransition(wo: WorkOrder, nextState: WorkOrder['state']) {
    setTransitioning(wo.id);
    try {
      const updated = await transitionWorkOrderState(wo.id, nextState);
      setItems(prev => prev.map(w => w.id === wo.id ? updated : w));
      toast.success(`${wo.workOrderNumber} → ${nextState}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to update ${wo.workOrderNumber}`);
    } finally {
      setTransitioning(null);
    }
  }

  if (loading) return <div className="space-y-4"><PageHeader title="My Queue" /><LoadingSkeleton rows={6} cols={4} /></div>;
  if (error) return (
    <div>
      <PageHeader title="My Queue" />
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <p className="text-red-700 text-sm font-medium">{error}</p>
        <button onClick={() => void load()} className="mt-3 text-xs text-red-600 underline">Retry</button>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader title="My Queue" description="Work assigned to you" />
      {items.length === 0 ? (
        <EmptyState icon="✅" title="Queue is empty" description="No work currently assigned to you." />
      ) : (
        <div className="space-y-3">
          {items.map(wo => {
            const busy = transitioning === wo.id;
            return (
              <div key={wo.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-gray-500">{wo.workOrderNumber}</span>
                    <StatusBadge status={wo.state} />
                  </div>
                  <p className="text-sm font-medium text-gray-900">{wo.description ?? wo.vehicleId}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Vehicle: {wo.vehicleId}</p>
                </div>
                <div className="flex gap-2">
                  {wo.state === 'PLANNED' && (
                    <button disabled={busy} onClick={() => handleTransition(wo, 'IN_PROGRESS')}
                      className="text-xs bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold px-3 py-1.5 rounded transition-colors disabled:opacity-50">
                      {busy ? '…' : 'Start'}
                    </button>
                  )}
                  {wo.state === 'IN_PROGRESS' && (
                    <>
                      <button disabled={busy} onClick={() => handleTransition(wo, 'BLOCKED')}
                        className="text-xs border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded transition-colors disabled:opacity-50">
                        {busy ? '…' : 'Block'}
                      </button>
                      <button disabled={busy} onClick={() => handleTransition(wo, 'COMPLETED')}
                        className="text-xs bg-green-600 hover:bg-green-500 text-white font-semibold px-3 py-1.5 rounded transition-colors disabled:opacity-50">
                        {busy ? '…' : 'Complete'}
                      </button>
                    </>
                  )}
                  {wo.state === 'BLOCKED' && (
                    <button disabled={busy} onClick={() => handleTransition(wo, 'IN_PROGRESS')}
                      className="text-xs bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold px-3 py-1.5 rounded transition-colors disabled:opacity-50">
                      {busy ? '…' : 'Unblock'}
                    </button>
                  )}
                  <button onClick={() => toast.info(`SOP for ${wo.workOrderNumber} (coming soon)`)}
                    className="text-xs border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded transition-colors">
                    SOP
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
