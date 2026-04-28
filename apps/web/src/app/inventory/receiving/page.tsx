'use client';
import { useEffect, useState } from 'react';
import { PageHeader, EmptyState, LoadingSkeleton, StatusBadge } from '@gg-erp/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listPurchaseOrders, type PurchaseOrder } from '@/lib/api-client';

const OPEN_STATES = new Set(['APPROVED', 'SENT', 'PARTIALLY_RECEIVED']);

export default function ReceivingPage() {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listPurchaseOrders({ pageSize: 100 })
      .then(res => setPurchaseOrders(res.items.filter(po => OPEN_STATES.has(po.purchaseOrderState))))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader title="Receiving & Counts" description="Open purchase orders ready for receipt" />
      {loading ? (
        <LoadingSkeleton rows={4} cols={4} />
      ) : purchaseOrders.length === 0 ? (
        <EmptyState icon="📭" title="No open POs" description="No approved or sent purchase orders are ready for receipt." />
      ) : (
        <div className="space-y-4">
          {purchaseOrders.map(po => (
            <Card key={po.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{po.poNumber} · {po.vendorName}</CardTitle>
                  <StatusBadge status={po.purchaseOrderState} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Line</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Part</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Ordered</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Received</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Open</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {po.lines.map(line => {
                        const openQty = Math.max(line.orderedQuantity - line.receivedQuantity - line.rejectedQuantity, 0);
                        return (
                          <tr key={line.id}>
                            <td className="px-3 py-2 text-gray-500">{line.lineNumber}</td>
                            <td className="px-3 py-2 font-mono text-xs text-gray-700">{line.partId}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{line.orderedQuantity}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{line.receivedQuantity}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium">{openQty}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
