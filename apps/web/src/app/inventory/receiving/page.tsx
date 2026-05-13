'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, PackageCheck, RefreshCw } from 'lucide-react';
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
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';

const OPEN_STATES = new Set(['APPROVED', 'SENT', 'PARTIALLY_RECEIVED']);

interface ReceiptDraft {
  quantity: string;
  rejectedQuantity: string;
  lotNumber: string;
  serialNumber: string;
  expiresAt: string;
}

interface ReceivingVarianceRow {
  id: string;
  purchaseOrder: PurchaseOrder;
  line: PurchaseOrderLine;
  status: 'Rejected' | 'Overdue' | 'Partial';
  detail: string;
  openQuantity: number;
  rejectedQuantity: number;
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

function isPastDue(value?: string): boolean {
  if (!value) return false;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return due < today;
}

function buildVarianceRows(purchaseOrders: PurchaseOrder[]): ReceivingVarianceRow[] {
  return purchaseOrders
    .flatMap((purchaseOrder) =>
      purchaseOrder.lines.flatMap((line) => {
        const lineOpen = openQuantity(line);
        const rejectedQuantity = line.rejectedQuantity ?? 0;
        const hasRejectedQuantity = rejectedQuantity > 0;
        const hasPartialReceipt = line.receivedQuantity > 0 && lineOpen > 0;
        const hasOverdueOpenQuantity = isPastDue(purchaseOrder.expectedAt) && lineOpen > 0;
        if (!hasRejectedQuantity && !hasPartialReceipt && !hasOverdueOpenQuantity) return [];

        const status: ReceivingVarianceRow['status'] = hasRejectedQuantity
          ? 'Rejected'
          : hasOverdueOpenQuantity
            ? 'Overdue'
            : 'Partial';
        const detail =
          status === 'Rejected'
            ? `${formatQuantity(rejectedQuantity)} rejected unit${rejectedQuantity === 1 ? '' : 's'} recorded against the PO.`
            : status === 'Overdue'
              ? 'Expected date has passed while quantity remains open.'
              : 'Receipt is started but remaining quantity is still open.';
        return [
          {
            id: `${purchaseOrder.id}:${line.id}:${status}`,
            purchaseOrder,
            line,
            status,
            detail,
            openQuantity: lineOpen,
            rejectedQuantity,
          },
        ];
      }),
    )
    .sort((a, b) => {
      const statusRank = { Rejected: 0, Overdue: 1, Partial: 2 } as const;
      return (
        statusRank[a.status] - statusRank[b.status] ||
        b.rejectedQuantity - a.rejectedQuantity ||
        b.openQuantity - a.openQuantity
      );
    });
}

function receivingLineHref(purchaseOrderId: string, lineId: string): string {
  const qs = new URLSearchParams({ purchaseOrderId, lineId });
  return `${erpRoute('receiving')}?${qs}`;
}

function VarianceReport({ rows }: { rows: ReceivingVarianceRow[] }) {
  const statusStyles: Record<ReceivingVarianceRow['status'], string> = {
    Rejected: 'bg-red-100 text-red-800',
    Overdue: 'bg-amber-100 text-amber-800',
    Partial: 'bg-blue-100 text-blue-800',
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Receiving variance report
          </CardTitle>
          <span className="text-xs font-medium text-gray-500">
            {rows.length} line{rows.length === 1 ? '' : 's'} needing review
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
            No rejected, overdue, or partial receiving variances are open for these purchase orders.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">State</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">PO</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Part</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Ordered</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Accepted</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Rejected</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Open</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusStyles[row.status]}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={erpRecordRoute('purchase-order', row.purchaseOrder.id)}
                        className="font-semibold text-gray-900 hover:underline"
                      >
                        {row.purchaseOrder.poNumber}
                      </Link>
                      <div className="text-xs text-gray-500">{row.purchaseOrder.vendorName}</div>
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={erpRecordRoute('part', row.line.partId)}
                        className="font-mono text-xs font-semibold text-gray-900 hover:underline"
                      >
                        {row.line.partSku ?? row.line.partId}
                      </Link>
                      <div className="text-xs text-gray-500">{row.detail}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatQuantity(row.line.orderedQuantity)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatQuantity(row.line.receivedQuantity)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-red-700">
                      {formatQuantity(row.rejectedQuantity)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-amber-700">
                      {formatQuantity(row.openQuantity)}
                    </td>
                    <td className="px-3 py-2">
                      {row.openQuantity > 0 ? (
                        <Link
                          href={receivingLineHref(row.purchaseOrder.id, row.line.id)}
                          className="text-xs font-semibold text-gray-900 hover:underline"
                        >
                          Receive or reject remainder
                        </Link>
                      ) : (
                        <Link
                          href={erpRecordRoute('purchase-order', row.purchaseOrder.id)}
                          className="text-xs font-semibold text-gray-900 hover:underline"
                        >
                          Review closed PO
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
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
      const receivingOrders = res.items.filter(
        (po) =>
          OPEN_STATES.has(po.purchaseOrderState) ||
          po.lines.some((line) => line.rejectedQuantity > 0),
      );
      setPurchaseOrders(
        focusedPurchaseOrderId
          ? receivingOrders.filter((po) => po.id === focusedPurchaseOrderId)
          : receivingOrders,
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
  const varianceRows = useMemo(() => buildVarianceRows(purchaseOrders), [purchaseOrders]);
  const openPurchaseOrderCount = purchaseOrders.filter((po) =>
    OPEN_STATES.has(po.purchaseOrderState),
  ).length;
  const openUnits = openLines.reduce((sum, line) => sum + openQuantity(line), 0);
  const receivedUnits = purchaseOrders.reduce(
    (sum, po) => sum + po.lines.reduce((lineSum, line) => lineSum + line.receivedQuantity, 0),
    0,
  );
  const rejectedUnits = purchaseOrders.reduce(
    (sum, po) => sum + po.lines.reduce((lineSum, line) => lineSum + line.rejectedQuantity, 0),
    0,
  );

  function draftFor(line: PurchaseOrderLine): ReceiptDraft {
    return (
      drafts[line.id] ?? {
        quantity: String(openQuantity(line)),
        rejectedQuantity: '0',
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
        rejectedQuantity: current[lineId]?.rejectedQuantity ?? '0',
        lotNumber: current[lineId]?.lotNumber ?? '',
        serialNumber: current[lineId]?.serialNumber ?? '',
        expiresAt: current[lineId]?.expiresAt ?? '',
        ...patch,
      },
    }));
  }

  async function handleReceive(line: PurchaseOrderLine) {
    const draft = draftFor(line);
    const quantity = Number(draft.quantity || 0);
    const rejectedQuantity = Number(draft.rejectedQuantity || 0);

    setActionBusy(line.id);
    setActionError(null);
    try {
      await receiveInventoryLot({
        purchaseOrderId: focusedPurchaseOrderId ?? undefined,
        purchaseOrderLineId: line.id,
        quantity,
        rejectedQuantity: rejectedQuantity > 0 ? rejectedQuantity : undefined,
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

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-2xl font-semibold text-gray-900">{openPurchaseOrderCount}</div>
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
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-2xl font-semibold text-red-700">{formatQuantity(rejectedUnits)}</div>
          <div className="mt-1 text-xs font-medium text-gray-500">Units Rejected</div>
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

      {!loading && !error && purchaseOrders.length > 0 && <VarianceReport rows={varianceRows} />}

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
          title={focusedPurchaseOrderId ? 'Selected PO is not open' : 'No open POs or variances'}
          description={
            focusedPurchaseOrderId
              ? 'The selected purchase order is closed, cancelled, or no longer ready for receipt.'
              : 'No approved or sent purchase orders are ready for receipt, and no rejected receiving lines need review.'
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
                  <table className="w-full min-w-[1220px] text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Line</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Part</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">
                          Receive To
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Ordered</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Received</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Rejected</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Open</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Lot</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Serial</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">Expires</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Accept</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Reject</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {po.lines.map((line) => {
                        const lineOpen = openQuantity(line);
                        const draft = draftFor(line);
                        const quantity = Number(draft.quantity || 0);
                        const rejectedQuantity = Number(draft.rejectedQuantity || 0);
                        const totalReceiptQuantity = quantity + rejectedQuantity;
                        const busy = actionBusy === line.id;
                        const canReceive =
                          lineOpen > 0 &&
                          Number.isFinite(quantity) &&
                          Number.isFinite(rejectedQuantity) &&
                          quantity >= 0 &&
                          rejectedQuantity >= 0 &&
                          totalReceiptQuantity > 0 &&
                          totalReceiptQuantity <= lineOpen &&
                          !actionBusy;
                        const hasAcceptedQuantity = quantity > 0;

                        return (
                          <tr
                            key={line.id}
                            className={
                              focusedLineId === line.id
                                ? 'bg-amber-50 outline outline-1 outline-amber-200'
                                : line.rejectedQuantity > 0
                                  ? 'bg-red-50/40'
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
                            <td className="px-3 py-2 text-right tabular-nums text-red-700">
                              {formatQuantity(line.rejectedQuantity)}
                            </td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums text-amber-700">
                              {formatQuantity(lineOpen)}
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                value={draft.lotNumber}
                                disabled={
                                  lineOpen <= 0 || !hasAcceptedQuantity || Boolean(actionBusy)
                                }
                                onChange={(event) =>
                                  updateDraft(line.id, { lotNumber: event.target.value })
                                }
                                className="h-8"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                value={draft.serialNumber}
                                disabled={
                                  lineOpen <= 0 || !hasAcceptedQuantity || Boolean(actionBusy)
                                }
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
                                disabled={
                                  lineOpen <= 0 || !hasAcceptedQuantity || Boolean(actionBusy)
                                }
                                onChange={(event) =>
                                  updateDraft(line.id, { expiresAt: event.target.value })
                                }
                                className="h-8"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                min="0"
                                step="0.001"
                                value={draft.quantity}
                                disabled={lineOpen <= 0 || Boolean(actionBusy)}
                                onChange={(event) =>
                                  updateDraft(line.id, { quantity: event.target.value })
                                }
                                className="h-8 text-right"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                min="0"
                                step="0.001"
                                value={draft.rejectedQuantity}
                                disabled={lineOpen <= 0 || Boolean(actionBusy)}
                                onChange={(event) =>
                                  updateDraft(line.id, { rejectedQuantity: event.target.value })
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
                                {busy
                                  ? 'Posting'
                                  : quantity > 0 && rejectedQuantity > 0
                                    ? 'Post variance'
                                    : quantity > 0
                                      ? 'Receive'
                                      : 'Reject'}
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
