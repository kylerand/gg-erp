'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, PackageCheck, RefreshCw } from 'lucide-react';
import { EmptyState, LoadingSkeleton, PageHeader, StatusBadge } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import {
  getPurchaseOrder,
  getVendor,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type Vendor,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';

function formatDate(value?: string): string {
  return value ? new Date(value).toLocaleDateString() : 'Unscheduled';
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

function lineOpenQuantity(line: PurchaseOrderLine): number {
  return Math.max(line.openQuantity, 0);
}

function lineTotal(line: PurchaseOrderLine): number {
  return line.lineTotal ?? line.orderedQuantity * line.unitCost;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [vendorError, setVendorError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!params.id) return;
    setLoading(true);
    setError(null);
    setVendorError(null);
    try {
      const po = await getPurchaseOrder(params.id, { allowMockFallback: false });
      setPurchaseOrder(po);
      getVendor(po.vendorId, { allowMockFallback: false })
        .then(setVendor)
        .catch((err) => {
          setVendor(null);
          setVendorError(errorMessage(err));
        });
    } catch (err) {
      setPurchaseOrder(null);
      setVendor(null);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    if (!purchaseOrder) {
      return { ordered: 0, received: 0, rejected: 0, open: 0, value: 0 };
    }
    return purchaseOrder.lines.reduce(
      (acc, line) => ({
        ordered: acc.ordered + line.orderedQuantity,
        received: acc.received + line.receivedQuantity,
        rejected: acc.rejected + line.rejectedQuantity,
        open: acc.open + lineOpenQuantity(line),
        value: acc.value + lineTotal(line),
      }),
      { ordered: 0, received: 0, rejected: 0, open: 0, value: 0 },
    );
  }, [purchaseOrder]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Purchase Order" description="Loading..." />
        <LoadingSkeleton rows={6} cols={4} />
      </div>
    );
  }

  if (error || !purchaseOrder) {
    return (
      <div>
        <PageHeader title="Purchase Order" description="Unable to load" />
        <EmptyState
          icon="!"
          title="Purchase order unavailable"
          description={error ?? `No purchase order with id ${params.id}`}
          action={
            <Button type="button" variant="outline" onClick={() => void load()}>
              <RefreshCw data-icon="inline-start" />
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <Link
          href={erpRoute('purchase-order')}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={15} />
          Purchase Orders
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageHeader title={purchaseOrder.poNumber} description={purchaseOrder.vendorName} />
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={purchaseOrder.purchaseOrderState} />
          <Button type="button" variant="outline" onClick={() => void load()}>
            <RefreshCw data-icon="inline-start" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryMetric label="Ordered" value={totals.ordered} />
        <SummaryMetric label="Received" value={totals.received} tone="green" />
        <SummaryMetric label="Open" value={totals.open} tone="amber" />
        <SummaryMetric label="Rejected" value={totals.rejected} tone="red" />
        <SummaryMetric label="Value" value={formatMoney(totals.value)} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-gray-200 bg-white p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-900">Order Context</h2>
          <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <DetailField label="Vendor Code" value={purchaseOrder.vendorCode} />
            <DetailField label="Ordered" value={formatDate(purchaseOrder.orderedAt)} />
            <DetailField label="Expected" value={formatDate(purchaseOrder.expectedAt)} />
            <DetailField label="Sent" value={formatDate(purchaseOrder.sentAt)} />
            <DetailField label="Closed" value={formatDate(purchaseOrder.closedAt)} />
            <DetailField label="Lines" value={purchaseOrder.lineCount} />
            <DetailField label="Created" value={formatDate(purchaseOrder.createdAt)} />
            <DetailField label="Updated" value={formatDate(purchaseOrder.updatedAt)} />
          </dl>
          {purchaseOrder.notes && (
            <div className="mt-4 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {purchaseOrder.notes}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Vendor</h2>
          <dl className="mt-4 space-y-3">
            <DetailField label="Name" value={vendor?.vendorName ?? purchaseOrder.vendorName} />
            <DetailField label="Email" value={vendor?.email} />
            <DetailField label="Phone" value={vendor?.phone} />
            <DetailField
              label="Lead Time"
              value={vendor?.leadTimeDays ? `${vendor.leadTimeDays} days` : undefined}
            />
            <DetailField label="Payment Terms" value={vendor?.paymentTerms} />
            <DetailField label="Open POs" value={vendor?.openPurchaseOrderCount} />
          </dl>
          {vendorError && <p className="mt-3 text-xs text-amber-700">{vendorError}</p>}
        </section>
      </div>

      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[1120px] text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Line</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Part</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Receive To</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Ordered</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Received</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Rejected</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Open</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Unit Cost</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Line Total</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Promised</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {purchaseOrder.lines.map((line) => {
              const lineOpen = lineOpenQuantity(line);
              const receiveHref = `${erpRoute('receiving')}?purchaseOrderId=${encodeURIComponent(
                purchaseOrder.id,
              )}&lineId=${encodeURIComponent(line.id)}`;
              return (
                <tr key={line.id}>
                  <td className="px-4 py-3 text-gray-500">{line.lineNumber}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={erpRecordRoute('part', line.partId)}
                      className="font-mono text-xs font-semibold text-gray-900 hover:underline"
                    >
                      {line.partSku ?? line.partId}
                    </Link>
                    {line.partName && <div className="mt-0.5 text-gray-600">{line.partName}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {line.defaultLocationName ?? 'Default location'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {line.orderedQuantity} {line.unitOfMeasure ?? ''}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{line.receivedQuantity}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{line.rejectedQuantity}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-amber-700">
                    {lineOpen}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMoney(line.unitCost)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMoney(lineTotal(line))}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{formatDate(line.promisedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {lineOpen > 0 ? (
                      <Link
                        href={receiveHref}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#B1581B] hover:underline"
                      >
                        <PackageCheck size={14} />
                        Receive
                      </Link>
                    ) : (
                      <span className="text-xs font-medium text-green-700">Complete</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'amber' | 'green' | 'red';
}) {
  const color =
    tone === 'amber'
      ? 'text-amber-700'
      : tone === 'green'
        ? 'text-green-700'
        : tone === 'red'
          ? 'text-red-600'
          : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="mt-1 text-xs font-medium text-gray-500">{label}</div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value?: string | number }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-gray-900">
        {value === undefined || value === '' ? '-' : value}
      </dd>
    </div>
  );
}
