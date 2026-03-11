'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, EmptyState } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';

interface Reservation {
  id: string;
  workOrderNumber: string;
  sku: string;
  partName: string;
  qtyRequested: number;
  qtyAvailable: number;
  status: 'PENDING' | 'PICKED' | 'SHORT' | 'SUBSTITUTED';
}

const MOCK_RESERVATIONS: Reservation[] = [
  { id: 'r1', workOrderNumber: 'WO-002', sku: 'BAT-48V-105AH', partName: '48V Battery Pack', qtyRequested: 1, qtyAvailable: 4, status: 'PENDING' },
  { id: 'r2', workOrderNumber: 'WO-002', sku: 'CTL-CNVSN-KT', partName: 'Conversion Controller Kit', qtyRequested: 1, qtyAvailable: 0, status: 'SHORT' },
  { id: 'r3', workOrderNumber: 'WO-001', sku: 'CHRG-48V-OBC', partName: 'On-Board Charger', qtyRequested: 1, qtyAvailable: 6, status: 'PICKED' },
];

const STATUS_CLASSES: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800', PICKED: 'bg-green-100 text-green-800',
  SHORT: 'bg-red-100 text-red-800', SUBSTITUTED: 'bg-blue-100 text-blue-800',
};

export default function ReservationsPage() {
  const [reservations, setReservations] = useState(MOCK_RESERVATIONS);

  function pick(id: string) {
    setReservations(prev => prev.map(r => r.id === id ? { ...r, status: 'PICKED' as const } : r));
    toast.success('Part picked and confirmed');
  }

  function markShort(id: string) {
    setReservations(prev => prev.map(r => r.id === id ? { ...r, status: 'SHORT' as const } : r));
    toast.warning('Shortage flagged — work order may be blocked', { duration: 4000 });
  }

  const pending = reservations.filter(r => r.status === 'PENDING' || r.status === 'SHORT');
  const done = reservations.filter(r => r.status === 'PICKED' || r.status === 'SUBSTITUTED');

  return (
    <div>
      <PageHeader title="Reservations" description="Pick list and shortage handling" />
      {pending.length === 0 && <EmptyState icon="✅" title="All picks complete" description="No pending reservations." />}
      {pending.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Pending Picks ({pending.length})</h2>
          <div className="space-y-2">
            {pending.map(r => (
              <div key={r.id} className={`bg-white rounded-lg border p-4 flex items-start gap-4 ${r.status === 'SHORT' ? 'border-red-300' : 'border-gray-200'}`}>
                {r.status === 'SHORT' && <span className="text-red-500 text-lg mt-0.5" aria-label="Shortage">⚠️</span>}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-gray-500">{r.sku}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CLASSES[r.status]}`}>{r.status}</span>
                  </div>
                  <p className="text-sm font-medium text-gray-900">{r.partName}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    WO: {r.workOrderNumber} · Requested: {r.qtyRequested} · Available: <span className={r.qtyAvailable === 0 ? 'text-red-600 font-semibold' : ''}>{r.qtyAvailable}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  {r.qtyAvailable > 0 && r.status !== 'SHORT' && (
                    <Button size="sm" onClick={() => pick(r.id)} className="bg-yellow-400 hover:bg-yellow-300 text-gray-900">Confirm Pick</Button>
                  )}
                  {r.status !== 'SHORT' && <Button size="sm" variant="outline" onClick={() => markShort(r.id)}>Mark Short</Button>}
                  {r.status === 'SHORT' && <Button size="sm" variant="outline" onClick={() => toast.info('Substitution requested')}>Request Sub</Button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {done.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Completed ({done.length})</h2>
          <div className="space-y-2 opacity-60">
            {done.map(r => (
              <div key={r.id} className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-3">
                <span className="text-green-500">✅</span>
                <span className="font-mono text-xs text-gray-500">{r.sku}</span>
                <span className="text-sm text-gray-700">{r.partName}</span>
                <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CLASSES[r.status]}`}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
