'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, EmptyState, LoadingSkeleton, StatusBadge } from '@gg-erp/ui';
import { listWorkOrders, type WorkOrder } from '@/lib/api-client';

export default function MyQueuePage() {
  const [items, setItems] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  function handleAction(wo: WorkOrder, action: string) {
    toast.success(`${action}: ${wo.workOrderNumber}`, { description: 'Action recorded (mock)' });
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
          {items.map(wo => (
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
                  <button onClick={() => handleAction(wo, 'Start')} className="text-xs bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold px-3 py-1.5 rounded transition-colors">Start</button>
                )}
                {wo.state === 'IN_PROGRESS' && (
                  <>
                    <button onClick={() => handleAction(wo, 'Pause')} className="text-xs border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded transition-colors">Pause</button>
                    <button onClick={() => handleAction(wo, 'Complete')} className="text-xs bg-green-600 hover:bg-green-500 text-white font-semibold px-3 py-1.5 rounded transition-colors">Complete</button>
                  </>
                )}
                <button onClick={() => handleAction(wo, 'Open SOP')} className="text-xs border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded transition-colors">SOP</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
