'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Plus, RefreshCw, Save, X } from 'lucide-react';
import { EmptyState, LoadingSkeleton, PageHeader, StatusBadge } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import {
  createPurchaseOrder,
  listParts,
  listPurchaseOrders,
  listVendors,
  type Part,
  type PurchaseOrder,
  type Vendor,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';

const STATUS_OPTIONS = [
  'ALL',
  'DRAFT',
  'APPROVED',
  'SENT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;

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

function openUnits(po: PurchaseOrder): number {
  return po.lines.reduce((sum, line) => sum + line.openQuantity, 0);
}

function orderTotal(po: PurchaseOrder): number {
  return po.lines.reduce(
    (sum, line) => sum + (line.lineTotal ?? line.orderedQuantity * line.unitCost),
    0,
  );
}

function buildPurchaseOrderHref(status: string, vendorId: string): string {
  const query: Record<string, string> = {};
  if (status !== 'ALL') query.status = status;
  if (vendorId !== 'ALL') query.vendorId = vendorId;
  return erpRoute('purchase-order', query);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get('status') ?? 'ALL';
  const vendorId = searchParams.get('vendorId') ?? 'ALL';
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState({
    vendorId: '',
    partId: '',
    expectedAt: '',
    quantity: '1',
    unitCost: '0',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [poResult, vendorResult, partResult] = await Promise.all([
        listPurchaseOrders(
          {
            status: status === 'ALL' ? undefined : status,
            vendorId: vendorId === 'ALL' ? undefined : vendorId,
            pageSize: 100,
          },
          { allowMockFallback: false },
        ),
        listVendors({ limit: 200 }, { allowMockFallback: false }),
        listParts({ partState: 'ACTIVE', limit: 200 }, { allowMockFallback: false }),
      ]);
      setPurchaseOrders(poResult.items);
      setVendors(vendorResult.items);
      setParts(partResult.items);
    } catch (err) {
      setPurchaseOrders([]);
      setVendors([]);
      setParts([]);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [status, vendorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const open = purchaseOrders.filter(
      (po) => po.purchaseOrderState !== 'RECEIVED' && po.purchaseOrderState !== 'CANCELLED',
    );
    return {
      total: purchaseOrders.length,
      open: open.length,
      openUnits: open.reduce((sum, po) => sum + openUnits(po), 0),
      value: purchaseOrders.reduce((sum, po) => sum + orderTotal(po), 0),
    };
  }, [purchaseOrders]);

  const activeVendors = useMemo(
    () => vendors.filter((vendor) => vendor.vendorState === 'ACTIVE'),
    [vendors],
  );

  useEffect(() => {
    setCreateDraft((current) => ({
      ...current,
      vendorId: current.vendorId || activeVendors[0]?.id || '',
      partId: current.partId || parts[0]?.id || '',
    }));
  }, [activeVendors, parts]);

  function updateFilters(nextStatus: string, nextVendorId: string) {
    router.push(buildPurchaseOrderHref(nextStatus, nextVendorId));
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const quantity = Number(createDraft.quantity);
    const unitCost = Number(createDraft.unitCost);
    if (
      !createDraft.vendorId ||
      !createDraft.partId ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      setError('Choose an active vendor, part, and positive quantity.');
      return;
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      setError('Unit cost must be zero or greater.');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const purchaseOrder = await createPurchaseOrder({
        vendorId: createDraft.vendorId,
        expectedAt: createDraft.expectedAt || null,
        notes: createDraft.notes || null,
        lines: [
          {
            partId: createDraft.partId,
            orderedQuantity: quantity,
            unitCost,
          },
        ],
      });
      router.push(erpRecordRoute('purchase-order', purchaseOrder.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <PageHeader title="Purchase Orders" description="Vendor orders, receiving state, and ETA" />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryMetric label="Orders" value={summary.total} />
        <SummaryMetric label="Open Orders" value={summary.open} tone="amber" />
        <SummaryMetric label="Open Units" value={summary.openUnits} tone="amber" />
        <SummaryMetric label="Order Value" value={formatMoney(summary.value)} tone="green" />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Purchase order status"
            value={status}
            onChange={(event) => updateFilters(event.target.value, vendorId)}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === 'ALL' ? 'All statuses' : option.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <select
            aria-label="Purchase order vendor"
            value={vendorId}
            onChange={(event) => updateFilters(status, event.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
          >
            <option value="ALL">All vendors</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.vendorName}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => setShowCreate((open) => !open)}>
            {showCreate ? <X data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
            {showCreate ? 'Close' : 'New PO'}
          </Button>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw data-icon="inline-start" />
            Refresh
          </Button>
        </div>
      </div>

      {showCreate && (
        <form
          onSubmit={(event) => void handleCreate(event)}
          className="mb-6 rounded-lg border border-gray-200 bg-white p-4"
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label className="block xl:col-span-2">
              <span className="text-xs font-medium uppercase text-gray-500">Vendor</span>
              <select
                value={createDraft.vendorId}
                onChange={(event) =>
                  setCreateDraft((current) => ({ ...current, vendorId: event.target.value }))
                }
                className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
              >
                {activeVendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.vendorName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block xl:col-span-2">
              <span className="text-xs font-medium uppercase text-gray-500">Part</span>
              <select
                value={createDraft.partId}
                onChange={(event) =>
                  setCreateDraft((current) => ({ ...current, partId: event.target.value }))
                }
                className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
              >
                {parts.map((part) => (
                  <option key={part.id} value={part.id}>
                    {part.sku} - {part.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase text-gray-500">Qty</span>
              <input
                type="number"
                min="0.001"
                step="0.001"
                value={createDraft.quantity}
                onChange={(event) =>
                  setCreateDraft((current) => ({ ...current, quantity: event.target.value }))
                }
                className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase text-gray-500">Unit Cost</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={createDraft.unitCost}
                onChange={(event) =>
                  setCreateDraft((current) => ({ ...current, unitCost: event.target.value }))
                }
                className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
              />
            </label>
            <label className="block xl:col-span-2">
              <span className="text-xs font-medium uppercase text-gray-500">Expected</span>
              <input
                type="date"
                value={createDraft.expectedAt}
                onChange={(event) =>
                  setCreateDraft((current) => ({ ...current, expectedAt: event.target.value }))
                }
                className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
              />
            </label>
            <label className="block xl:col-span-3">
              <span className="text-xs font-medium uppercase text-gray-500">Notes</span>
              <input
                value={createDraft.notes}
                onChange={(event) =>
                  setCreateDraft((current) => ({ ...current, notes: event.target.value }))
                }
                className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
              />
            </label>
            <div className="flex items-end xl:col-span-1">
              <Button
                type="submit"
                className="h-10 w-full"
                disabled={creating || activeVendors.length === 0 || parts.length === 0}
              >
                <Save data-icon="inline-start" />
                Create
              </Button>
            </div>
          </div>
        </form>
      )}

      {loading ? (
        <LoadingSkeleton rows={5} cols={7} />
      ) : error ? (
        <EmptyState
          icon="!"
          title="Purchase orders unavailable"
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
          title="No purchase orders"
          description="No purchase orders match the selected filters."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">PO</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Vendor</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Lines</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Open Units</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Value</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Expected</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {purchaseOrders.map((po) => (
                <tr key={po.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={erpRecordRoute('purchase-order', po.id)}
                      className="font-mono text-xs font-semibold text-gray-900 hover:underline"
                    >
                      {po.poNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{po.vendorName}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={po.purchaseOrderState} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{po.lineCount}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-amber-700">
                    {openUnits(po)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMoney(orderTotal(po))}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{formatDate(po.expectedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={erpRecordRoute('purchase-order', po.id)}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#B1581B] hover:underline"
                    >
                      <FileText size={14} />
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
  tone?: 'default' | 'amber' | 'green';
}) {
  const color =
    tone === 'amber' ? 'text-amber-700' : tone === 'green' ? 'text-green-700' : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="mt-1 text-xs font-medium text-gray-500">{label}</div>
    </div>
  );
}
