'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Edit3,
  Lock,
  PackageCheck,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { EmptyState, LoadingSkeleton, PageHeader, StatusBadge } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  getPurchaseOrder,
  getVendor,
  listParts,
  listVendors,
  sendPurchaseOrder,
  updatePurchaseOrder,
  type Part,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type Vendor,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';

function formatDate(value?: string): string {
  return value ? new Date(value).toLocaleDateString() : 'Unscheduled';
}

function toDateInput(value?: string): string {
  return value ? value.slice(0, 10) : '';
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

interface DraftLine {
  id?: string;
  partId: string;
  orderedQuantity: string;
  unitCost: string;
  promisedAt: string;
}

interface DraftEditState {
  vendorId: string;
  expectedAt: string;
  notes: string;
  lines: DraftLine[];
}

function draftFromPurchaseOrder(purchaseOrder: PurchaseOrder): DraftEditState {
  return {
    vendorId: purchaseOrder.vendorId,
    expectedAt: toDateInput(purchaseOrder.expectedAt),
    notes: purchaseOrder.notes ?? '',
    lines: purchaseOrder.lines.map((line) => ({
      id: line.id,
      partId: line.partId,
      orderedQuantity: String(line.orderedQuantity),
      unitCost: String(line.unitCost),
      promisedAt: toDateInput(line.promisedAt),
    })),
  };
}

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [draftEdit, setDraftEdit] = useState<DraftEditState | null>(null);
  const [editingDraft, setEditingDraft] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [vendorError, setVendorError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!params.id) return;
    setLoading(true);
    setError(null);
    setCommandError(null);
    setVendorError(null);
    try {
      const po = await getPurchaseOrder(params.id, { allowMockFallback: false });
      setPurchaseOrder(po);
      setDraftEdit(draftFromPurchaseOrder(po));
      setEditingDraft(false);
      getVendor(po.vendorId, { allowMockFallback: false })
        .then(setVendor)
        .catch((err) => {
          setVendor(null);
          setVendorError(errorMessage(err));
        });
      if (po.purchaseOrderState === 'DRAFT') {
        Promise.all([
          listVendors({ state: 'ACTIVE', limit: 200 }, { allowMockFallback: false }),
          listParts({ partState: 'ACTIVE', limit: 200 }, { allowMockFallback: false }),
        ])
          .then(([vendorResult, partResult]) => {
            setVendors(vendorResult.items);
            setParts(partResult.items);
          })
          .catch(() => {
            setVendors([]);
            setParts([]);
          });
      }
    } catch (err) {
      setPurchaseOrder(null);
      setVendor(null);
      setDraftEdit(null);
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

  const canCancel =
    purchaseOrder &&
    ['DRAFT', 'APPROVED', 'SENT'].includes(purchaseOrder.purchaseOrderState) &&
    totals.received + totals.rejected === 0;
  const canClose =
    purchaseOrder &&
    ['SENT', 'PARTIALLY_RECEIVED'].includes(purchaseOrder.purchaseOrderState) &&
    totals.open === 0;
  const draftVendorOptions = vendors.length > 0 ? vendors : vendor ? [vendor] : [];

  async function handleTransition(action: 'approve' | 'send' | 'cancel' | 'close') {
    if (!purchaseOrder) return;
    setActioning(action);
    setCommandError(null);
    try {
      const next =
        action === 'approve'
          ? await approvePurchaseOrder(purchaseOrder.id)
          : action === 'send'
            ? await sendPurchaseOrder(purchaseOrder.id)
            : action === 'cancel'
              ? await cancelPurchaseOrder(purchaseOrder.id)
              : await closePurchaseOrder(purchaseOrder.id);
      setPurchaseOrder(next);
      setDraftEdit(draftFromPurchaseOrder(next));
      setEditingDraft(false);
    } catch (err) {
      setCommandError(errorMessage(err));
    } finally {
      setActioning(null);
    }
  }

  async function handleSaveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!purchaseOrder || !draftEdit) return;

    const lines = draftEdit.lines.map((line) => ({
      id: line.id,
      partId: line.partId,
      orderedQuantity: Number(line.orderedQuantity),
      unitCost: Number(line.unitCost),
      promisedAt: line.promisedAt || null,
    }));
    if (
      !draftEdit.vendorId ||
      lines.length === 0 ||
      lines.some(
        (line) =>
          !line.partId || !Number.isFinite(line.orderedQuantity) || line.orderedQuantity <= 0,
      )
    ) {
      setCommandError('Draft lines need a part and positive quantity.');
      return;
    }
    if (lines.some((line) => !Number.isFinite(line.unitCost) || line.unitCost < 0)) {
      setCommandError('Draft line costs must be zero or greater.');
      return;
    }

    setSavingDraft(true);
    setCommandError(null);
    try {
      const updated = await updatePurchaseOrder(purchaseOrder.id, {
        vendorId: draftEdit.vendorId,
        expectedAt: draftEdit.expectedAt || null,
        notes: draftEdit.notes || null,
        lines,
      });
      setPurchaseOrder(updated);
      setDraftEdit(draftFromPurchaseOrder(updated));
      setEditingDraft(false);
    } catch (err) {
      setCommandError(errorMessage(err));
    } finally {
      setSavingDraft(false);
    }
  }

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
          {purchaseOrder.purchaseOrderState === 'DRAFT' && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingDraft((open) => !open)}
              >
                {editingDraft ? <X data-icon="inline-start" /> : <Edit3 data-icon="inline-start" />}
                {editingDraft ? 'Close Edit' : 'Edit Draft'}
              </Button>
              <Button
                type="button"
                onClick={() => void handleTransition('approve')}
                disabled={actioning !== null}
              >
                <CheckCircle2 data-icon="inline-start" />
                Approve
              </Button>
            </>
          )}
          {purchaseOrder.purchaseOrderState === 'APPROVED' && (
            <Button
              type="button"
              onClick={() => void handleTransition('send')}
              disabled={actioning !== null}
            >
              <Send data-icon="inline-start" />
              Send
            </Button>
          )}
          {canClose && (
            <Button
              type="button"
              onClick={() => void handleTransition('close')}
              disabled={actioning !== null}
            >
              <Lock data-icon="inline-start" />
              Close
            </Button>
          )}
          {canCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleTransition('cancel')}
              disabled={actioning !== null}
            >
              <Ban data-icon="inline-start" />
              Cancel
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => void load()}>
            <RefreshCw data-icon="inline-start" />
            Refresh
          </Button>
        </div>
      </div>

      {commandError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {commandError}
        </div>
      )}

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

      {purchaseOrder.purchaseOrderState === 'DRAFT' && editingDraft && draftEdit && (
        <form
          onSubmit={(event) => void handleSaveDraft(event)}
          className="mb-6 rounded-lg border border-gray-200 bg-white p-4"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-900">Draft Edit</h2>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDraftEdit(draftFromPurchaseOrder(purchaseOrder));
                  setEditingDraft(false);
                }}
              >
                <X data-icon="inline-start" />
                Cancel
              </Button>
              <Button type="submit" disabled={savingDraft || parts.length === 0}>
                <Save data-icon="inline-start" />
                Save Draft
              </Button>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="block">
              <span className="text-xs font-medium uppercase text-gray-500">Vendor</span>
              <select
                value={draftEdit.vendorId}
                onChange={(event) =>
                  setDraftEdit((current) =>
                    current ? { ...current, vendorId: event.target.value } : current,
                  )
                }
                className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
              >
                {draftVendorOptions.map((vendorOption) => (
                  <option key={vendorOption.id} value={vendorOption.id}>
                    {vendorOption.vendorName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase text-gray-500">Expected</span>
              <input
                type="date"
                value={draftEdit.expectedAt}
                onChange={(event) =>
                  setDraftEdit((current) =>
                    current ? { ...current, expectedAt: event.target.value } : current,
                  )
                }
                className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase text-gray-500">Notes</span>
              <input
                value={draftEdit.notes}
                onChange={(event) =>
                  setDraftEdit((current) =>
                    current ? { ...current, notes: event.target.value } : current,
                  )
                }
                className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
              />
            </label>
          </div>

          <div className="space-y-3">
            {draftEdit.lines.map((line, index) => (
              <div
                key={line.id ?? index}
                className="grid grid-cols-1 gap-3 rounded-md border border-gray-100 bg-gray-50 p-3 md:grid-cols-12"
              >
                <label className="block md:col-span-5">
                  <span className="text-xs font-medium uppercase text-gray-500">Part</span>
                  <select
                    value={line.partId}
                    onChange={(event) =>
                      setDraftEdit((current) =>
                        current
                          ? {
                              ...current,
                              lines: current.lines.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, partId: event.target.value }
                                  : item,
                              ),
                            }
                          : current,
                      )
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
                <label className="block md:col-span-2">
                  <span className="text-xs font-medium uppercase text-gray-500">Qty</span>
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={line.orderedQuantity}
                    onChange={(event) =>
                      setDraftEdit((current) =>
                        current
                          ? {
                              ...current,
                              lines: current.lines.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, orderedQuantity: event.target.value }
                                  : item,
                              ),
                            }
                          : current,
                      )
                    }
                    className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
                  />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-xs font-medium uppercase text-gray-500">Unit Cost</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unitCost}
                    onChange={(event) =>
                      setDraftEdit((current) =>
                        current
                          ? {
                              ...current,
                              lines: current.lines.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, unitCost: event.target.value }
                                  : item,
                              ),
                            }
                          : current,
                      )
                    }
                    className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
                  />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-xs font-medium uppercase text-gray-500">Promised</span>
                  <input
                    type="date"
                    value={line.promisedAt}
                    onChange={(event) =>
                      setDraftEdit((current) =>
                        current
                          ? {
                              ...current,
                              lines: current.lines.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, promisedAt: event.target.value }
                                  : item,
                              ),
                            }
                          : current,
                      )
                    }
                    className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
                  />
                </label>
                <div className="flex items-end md:col-span-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 w-full"
                    aria-label="Remove line"
                    disabled={draftEdit.lines.length === 1}
                    onClick={() =>
                      setDraftEdit((current) =>
                        current
                          ? {
                              ...current,
                              lines: current.lines.filter((_, itemIndex) => itemIndex !== index),
                            }
                          : current,
                      )
                    }
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            className="mt-3"
            disabled={parts.length === 0}
            onClick={() =>
              setDraftEdit((current) =>
                current
                  ? {
                      ...current,
                      lines: [
                        ...current.lines,
                        {
                          partId: parts[0]?.id ?? '',
                          orderedQuantity: '1',
                          unitCost: '0',
                          promisedAt: '',
                        },
                      ],
                    }
                  : current,
              )
            }
          >
            <Plus data-icon="inline-start" />
            Add Line
          </Button>
        </form>
      )}

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
