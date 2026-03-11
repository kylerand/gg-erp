'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, EmptyState, StatusBadge } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface POLine { id: string; sku: string; partName: string; qtyOrdered: number; qtyReceived: number; }
interface PO { id: string; poNumber: string; vendor: string; status: 'OPEN' | 'PARTIAL' | 'RECEIVED' | 'CLOSED'; lines: POLine[]; }

const MOCK_POS: PO[] = [
  { id: 'po1', poNumber: 'PO-2026-001', vendor: 'East Coast Golf Carts', status: 'OPEN', lines: [
    { id: 'l1', sku: 'BAT-48V-105AH', partName: '48V Battery Pack', qtyOrdered: 10, qtyReceived: 0 },
    { id: 'l2', sku: 'CTL-CNVSN-KT', partName: 'Conversion Controller Kit', qtyOrdered: 5, qtyReceived: 0 },
  ]},
  { id: 'po2', poNumber: 'PO-2026-002', vendor: 'Western Cart Co', status: 'PARTIAL', lines: [
    { id: 'l3', sku: 'CHRG-48V-OBC', partName: 'On-Board Charger', qtyOrdered: 8, qtyReceived: 3 },
  ]},
];

export default function ReceivingPage() {
  const [pos, setPos] = useState(MOCK_POS);
  const [receiving, setReceiving] = useState<Record<string, string>>({});
  const [selectedPO, setSelectedPO] = useState<string | null>(null);

  function receiveLines(poId: string) {
    setPos(prev => prev.map(po => {
      if (po.id !== poId) return po;
      const lines = po.lines.map(l => {
        const qty = parseInt(receiving[l.id] ?? '0', 10);
        if (qty > l.qtyOrdered - l.qtyReceived) { toast.error(`Over-receipt on ${l.sku} — max ${l.qtyOrdered - l.qtyReceived}`); return l; }
        return { ...l, qtyReceived: l.qtyReceived + (qty || 0) };
      });
      const allReceived = lines.every(l => l.qtyReceived >= l.qtyOrdered);
      return { ...po, lines, status: allReceived ? 'RECEIVED' as const : 'PARTIAL' as const };
    }));
    setReceiving({});
    toast.success('Receipt recorded');
  }

  const openPOs = pos.filter(p => p.status !== 'CLOSED');
  if (openPOs.length === 0) return <div><PageHeader title="Receiving" /><EmptyState icon="📭" title="No open POs" description="All purchase orders are closed." /></div>;

  return (
    <div>
      <PageHeader title="Receiving & Counts" description="Record PO receipts and resolve variances" />
      <div className="space-y-4">
        {openPOs.map(po => (
          <Card key={po.id} className={selectedPO === po.id ? 'border-yellow-400' : ''}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{po.poNumber} · {po.vendor}</CardTitle>
                <div className="flex items-center gap-3">
                  <StatusBadge status={po.status} />
                  <Button size="sm" variant="outline" onClick={() => setSelectedPO(selectedPO === po.id ? null : po.id)}>
                    {selectedPO === po.id ? 'Collapse' : 'Receive'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            {selectedPO === po.id && (
              <CardContent>
                <div className="space-y-3 mb-4">
                  {po.lines.map(line => (
                    <div key={line.id} className="flex items-center gap-4">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{line.partName}</p>
                        <p className="text-xs text-gray-400">{line.sku} · Ordered: {line.qtyOrdered} · Received: {line.qtyReceived}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input type="number" min="0" max={line.qtyOrdered - line.qtyReceived}
                          value={receiving[line.id] ?? ''}
                          onChange={e => setReceiving(prev => ({ ...prev, [line.id]: e.target.value }))}
                          placeholder="Qty" className="w-20 h-8 text-sm" />
                        <span className="text-xs text-gray-400">of {line.qtyOrdered - line.qtyReceived}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <Button size="sm" onClick={() => receiveLines(po.id)} className="bg-yellow-400 hover:bg-yellow-300 text-gray-900">
                  Record Receipt
                </Button>
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
