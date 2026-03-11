'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { StatusBadge } from '@gg-erp/ui';
import type { WorkOrder } from '@/lib/api-client';

const COLUMNS: { state: WorkOrder['state']; label: string }[] = [
  { state: 'PLANNED', label: 'Planned' },
  { state: 'IN_PROGRESS', label: 'In Progress' },
  { state: 'BLOCKED', label: 'Blocked' },
  { state: 'COMPLETED', label: 'Completed' },
];

export function DispatchClient({ initialItems }: { initialItems: WorkOrder[] }) {
  const [items, setItems] = useState(initialItems);

  function reassign(wo: WorkOrder, toState: WorkOrder['state']) {
    setItems(prev => prev.map(w => w.id === wo.id ? { ...w, state: toState } : w));
    toast.success(`${wo.workOrderNumber} moved to ${toState}`, { description: 'Reassignment recorded (mock)' });
  }

  return (
    <div className="grid grid-cols-4 gap-4 overflow-x-auto">
      {COLUMNS.map(col => {
        const colItems = items.filter(w => w.state === col.state);
        return (
          <div key={col.state} className="min-w-[220px]">
            <div className="flex items-center gap-2 mb-3">
              <StatusBadge status={col.state} />
              <span className="text-xs text-gray-500 font-medium">{colItems.length}</span>
            </div>
            <div className="space-y-2">
              {colItems.map(wo => (
                <div key={wo.id} className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                  <div className="font-mono text-xs text-gray-500 mb-1">{wo.workOrderNumber}</div>
                  <div className="text-sm font-medium text-gray-900 truncate">{wo.description ?? wo.vehicleId}</div>
                  <div className="text-xs text-gray-400 mt-1">{wo.vehicleId}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {COLUMNS.filter(c => c.state !== col.state).map(c => (
                      <button key={c.state} onClick={() => reassign(wo, c.state)}
                        className="text-xs text-gray-500 border border-gray-200 hover:border-yellow-400 hover:text-yellow-700 px-2 py-0.5 rounded transition-colors">
                        → {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {colItems.length === 0 && (
                <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center text-xs text-gray-400">Empty</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
