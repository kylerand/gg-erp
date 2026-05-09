'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PackageCheck, RefreshCw } from 'lucide-react';
import { EmptyState, LoadingSkeleton, PageHeader, StatusBadge } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  listPurchaseOrders,
  receiveInventoryLot,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from '@/lib/api-client';
import { erpRecordRoute } from '@/lib/erp-routes';

const OPEN_STATES = new Set(['APPROVED', 'SENT', 'PARTIALLY_RECEIVED']);

interface ReceiptDraft {
  quantity: string;
  lotNumber: string;
  serialNumber: string;
  expiresAt: string;
}

function formatQuantity(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function openQuantity(line: PurchaseOrderLine): number {
  return Math.max(
    line.openQuantity ?? line.orderedQuantity - line.receivedQuantity - line.rejectedQuantity,
    0,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

export default function ReceivingPage() {
  const searchParams = useSearchParams();
  const focusedPurchaseOrderId = searchParams.get('purchaseOrderId');
  const focusedLineId = searchParams.get('lineId');
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ReceiptDraft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listPurchaseOrders({ pageSize: 100 }, { allowMockFallback: false });
      const openOrders = res.items.filter((po) => OPEN_STATES.has(po.purchaseOrderState));
      setPurchaseOrders(
        focusedPurchaseOrderId
          ? openOrders.filter((po) => po.id === focusedPurchaseOrderId)
          : openOrders,
      );
    } catch (err) {
      setPurchaseOrders([]);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [focusedPurchaseOrderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openLines = useMemo(
    () => purchaseOrders.flatMap((po) => po.lines.filter((line) => openQuantity(line) > 0)),
    [purchaseOrders],
  );
  const openUnits = openLines.reduce((sum, line) => sum + openQuantity(line), 0);
  const receivedUnits = purchaseOrders.reduce(
    (sum, po) => sum + po.lines.reduce((lineSum, line) => lineSum + line.receivedQuantity, 0),
    0,
  );

  function draftFor(line: PurchaseOrderLine): ReceiptDraft {
    return (
      drafts[line.id] ?? {
        quantity: String(openQuantity(line)),
        lotNumber: '',
        serialNumber: '',
        expiresAt: '',
      }
    );
  }

  function updateDraft(lineId: string, patch: Partial<ReceiptDraft>) {
    setDrafts((current) => ({
      ...current,
      [lineId]: {
        quantity: current[lineId]?.quantity ?? '',
        lotNumber: current[lineId]?.lotNumber ?? '',
        serialNumber: current[lineId]?.serialNumber ?? '',
        expiresAt: current[lineId]?.expiresAt ?? '',
        ...patch,
      },
    }));
  }

  async function handleReceive(line: PurchaseOrderLine) {
    const draft = draftFor(line);
    const quantity = Number(draft.quantity);

    setActionBusy(line.id);
    setActionError(null);
    try {
      await receiveInventoryLot({
        purchaseOrderId: focusedPurchaseOrderId ?? undefined,
        purchaseOrderLineId: line.id,
        quantity,
        lotNumber: draft.lotNumber.trim() || undefined,
        serialNumber: draft.serialNumber.trim() || undefined,
        expiresAt: draft.expiresAt || undefined,
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[line.id];
        return next;
      });
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Receiving & Counts" description="Open purchase orders ready for receipt" />

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-2xl font-semibold text-gray-900">{purchaseOrders.length}</div>
          <div className="mt-1 text-xs font-medium text-gray-500">Open Purchase Orders</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-2xl font-semibold text-amber-700">{formatQuantity(openUnits)}</div>
          <div className="mt-1 text-xs font-medium text-gray-500">Units Remaining</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-2xl font-semibold text-green-700">
            {formatQuantity(receivedUnits)}
          </div>
          <div className="mt-1 text-xs font-medium text-gray-500">Units Received</div>
        </div>
      </div>

      <div className="mb-4 flex justify-end">
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw data-icon="inline-start" />
          Refresh
        </Button>
      </div>

      {actionError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton rows={4} cols={6} />
      ) : error ? (
        <EmptyState
          icon="!"
          title="Receiving unavailable"
          description={error}
          action={
            <Button type="button" variant="outline" onClick={() => void load()}>
              <RefreshCw data-icon="inline-start" />
              Retry
            </Button>
          }
        />
      ) : purchaseOrders.length === 0 ? (
        <EmptyState
          icon="P"
          title={focusedPurchaseOrderId ? 'Selected PO is not open' : 'No open POs'}
          description={
            focusedPurchaseOrderId
              ? 'The selected purchase order is closed, cancelled, or no longer ready for receipt.'
              : 'No approved or sent purchase orders are ready for receipt.'
          }
        />
      ) : (
        <div className="space-y-4">
          {purchaseOrders.map((po) => (
            <Card key={po.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-sm">
                    <Link
                      href={erpRecordRoute('purchase-order', po.id)}
                      className="hover:underline"
                    >
                      {po.poNumber}
                    </Link>{' '}
                    · {po.vendorName}
                  </CardTitle>
                  <StatusBadge status={po.purchaseOrderState} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full min-w-[1080px] text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Line</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Part</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">
                          Receive To
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Ordered</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Received</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Open</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Lot</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Serial</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Expires</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Qty</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {po.lines.map((line) => {
                        const lineOpen = openQuantity(line);
                        const draft = draftFor(line);
                        const quantity = Number(draft.quantity);
                        const busy = actionBusy === line.id;
                        const canReceive =
                          lineOpen > 0 &&
                          Number.isFinite(quantity) &&
                          quantity > 0 &&
                          quantity <= lineOpen &&
                          !actionBusy;

                        return (
                          <tr
                            key={line.id}
                            className={
                              focusedLineId === line.id
                                ? 'bg-amber-50 outline outline-1 outline-amber-200'
                                : undefined
                            }
                          >
                            <td className="px-3 py-2 text-gray-500">{line.lineNumber}</td>
                            <td className="px-3 py-2">
                              <Link
                                href={erpRecordRoute('part', line.partId)}
                                className="font-mono text-xs font-semibold text-gray-900 hover:underline"
                              >
                                {line.partSku ?? line.partId}
                              </Link>
                              {line.partName && (
                                <div className="mt-0.5 text-gray-600">{line.partName}</div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-gray-600">
                              {line.defaultLocationName ?? 'Default location'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatQuantity(line.orderedQuantity)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatQuantity(line.receivedQuantity)}
                            </td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums text-amber-700">
                              {formatQuantity(lineOpen)}
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                value={draft.lotNumber}
                                disabled={lineOpen <= 0 || Boolean(actionBusy)}
                                onChange={(event) =>
                                  updateDraft(line.id, { lotNumber: event.target.value })
                                }
                                className="h-8"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                value={draft.serialNumber}
                                disabled={lineOpen <= 0 || Boolean(actionBusy)}
                                onChange={(event) =>
                                  updateDraft(line.id, { serialNumber: event.target.value })
                                }
                                className="h-8"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="date"
                                value={draft.expiresAt}
                                disabled={lineOpen <= 0 || Boolean(actionBusy)}
                                onChange={(event) =>
                                  updateDraft(line.id, { expiresAt: event.target.value })
                                }
                                className="h-8"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                min="0.001"
                                step="0.001"
                                value={draft.quantity}
                                disabled={lineOpen <= 0 || Boolean(actionBusy)}
                                onChange={(event) =>
                                  updateDraft(line.id, { quantity: event.target.value })
                                }
                                className="h-8 text-right"
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Button
                                type="button"
                                size="sm"
                                disabled={!canReceive}
                                onClick={() => void handleReceive(line)}
                              >
                                <PackageCheck data-icon="inline-start" />
                                {busy ? 'Receiving' : 'Receive'}
                              </Button>
                            </td>
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
