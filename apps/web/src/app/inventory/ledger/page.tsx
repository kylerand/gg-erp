import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';
import {
  listInventoryLedger,
  type InventoryLedgerEntry,
  type InventoryLedgerMovementType,
} from '@/lib/api-client';
import { WorkspaceLinkGrid } from '@/components/WorkspaceLinkGrid';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';

type LedgerPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

const MOVEMENT_FILTERS: Array<{ value: InventoryLedgerMovementType | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'RECEIPT', label: 'Receipts' },
  { value: 'RESERVATION', label: 'Reservations' },
  { value: 'RELEASE', label: 'Releases' },
  { value: 'ISSUE', label: 'Issues' },
  { value: 'ADJUSTMENT', label: 'Adjustments' },
  { value: 'CYCLE_COUNT', label: 'Cycle Counts' },
  { value: 'TRANSFER_OUT', label: 'Transfers Out' },
  { value: 'TRANSFER_IN', label: 'Transfers In' },
];

function singleParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeMovement(value: string | undefined): InventoryLedgerMovementType | undefined {
  if (!value || value === 'ALL') return undefined;
  return MOVEMENT_FILTERS.some((option) => option.value === value)
    ? (value as InventoryLedgerMovementType)
    : undefined;
}

function labelForMovement(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

function formatQuantity(value: number, unit?: string): string {
  const formatted = value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatMoney(value?: number): string {
  if (value === undefined) return '-';
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function buildLedgerHref(params: {
  search?: string;
  movementType?: string;
  partId?: string;
  sourceDocumentId?: string;
  correlationId?: string;
}) {
  return erpRoute('inventory-ledger', {
    search: params.search?.trim() || undefined,
    movementType:
      params.movementType && params.movementType !== 'ALL' ? params.movementType : undefined,
    partId: params.partId,
    sourceDocumentId: params.sourceDocumentId,
    correlationId: params.correlationId,
  });
}

function movementTone(movementType: string): string {
  if (movementType === 'RECEIPT' || movementType === 'RETURN' || movementType === 'TRANSFER_IN') {
    return 'border-green-200 bg-green-50 text-green-800';
  }
  if (movementType === 'ISSUE' || movementType === 'TRANSFER_OUT') {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  if (movementType === 'REVERSAL') return 'border-red-200 bg-red-50 text-red-800';
  return 'border-gray-200 bg-gray-50 text-gray-700';
}

function documentLink(entry: InventoryLedgerEntry) {
  if (entry.purchaseOrder?.id) {
    return {
      href: erpRecordRoute('purchase-order', entry.purchaseOrder.id),
      label: entry.purchaseOrder.number ?? 'Purchase order',
    };
  }
  if (entry.workOrder?.id) {
    return {
      href: erpRecordRoute('work-order', entry.workOrder.id),
      label: entry.workOrder.number ?? 'Work order',
    };
  }
  if (entry.sourceDocument?.id) {
    return {
      href: buildLedgerHref({ sourceDocumentId: entry.sourceDocument.id }),
      label: entry.sourceDocument.type,
    };
  }
  return undefined;
}

export default async function InventoryLedgerPage({ searchParams }: LedgerPageProps) {
  const search = singleParam(searchParams?.search) ?? '';
  const movementParam = singleParam(searchParams?.movementType);
  const movementType = normalizeMovement(movementParam);
  const partId = singleParam(searchParams?.partId);
  const correlationId = singleParam(searchParams?.correlationId);
  const sourceDocumentId = singleParam(searchParams?.sourceDocumentId);

  const ledger = await listInventoryLedger(
    {
      search: search || undefined,
      movementType,
      partId,
      correlationId,
      sourceDocumentId,
      limit: 100,
    },
    { allowMockFallback: false },
  );

  const quantityDelta = ledger.items.reduce((sum, entry) => sum + entry.quantityDelta, 0);
  const valueDelta = ledger.items.reduce((sum, entry) => sum + (entry.valueDelta ?? 0), 0);
  const activeMovementLabel = movementType ? labelForMovement(movementType) : 'All Movements';

  return (
    <div>
      <PageHeader
        title="Inventory Movement Ledger"
        description="Append-only stock movement history from receiving, reservations, issues, and adjustments"
      />

      <WorkspaceLinkGrid moduleKey="inventory" variant="pills" />

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-2xl font-bold text-gray-900">{ledger.total}</div>
          <div className="mt-1 text-xs text-gray-500">Matching entries</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-2xl font-bold text-gray-900">{activeMovementLabel}</div>
          <div className="mt-1 text-xs text-gray-500">Movement filter</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div
            className={
              quantityDelta >= 0
                ? 'text-2xl font-bold text-green-700'
                : 'text-2xl font-bold text-amber-700'
            }
          >
            {formatQuantity(quantityDelta)}
          </div>
          <div className="mt-1 text-xs text-gray-500">Displayed quantity delta</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div
            className={
              valueDelta >= 0
                ? 'text-2xl font-bold text-green-700'
                : 'text-2xl font-bold text-amber-700'
            }
          >
            {formatMoney(valueDelta)}
          </div>
          <div className="mt-1 text-xs text-gray-500">Displayed value delta</div>
        </div>
      </div>

      <form
        action="/inventory/ledger"
        className="mb-4 rounded-lg border border-gray-200 bg-white p-4"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
          <label className="block">
            <span className="text-xs font-medium uppercase text-gray-500">Search</span>
            <input
              name="search"
              defaultValue={search}
              placeholder="SKU, part, PO, work order, lot, correlation"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-gray-500">Movement</span>
            <select
              name="movementType"
              defaultValue={movementType ?? 'ALL'}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {MOVEMENT_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="rounded-md bg-[#B1581B] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#8f4415]"
            >
              Apply
            </button>
            <Link
              href={erpRoute('inventory-ledger')}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-yellow-400"
            >
              Reset
            </Link>
          </div>
        </div>
      </form>

      {ledger.summary.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {ledger.summary.map((item) => (
            <Link
              key={item.movementType}
              href={buildLedgerHref({ search, movementType: item.movementType })}
              className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 transition-colors hover:border-yellow-400"
            >
              <span className="font-semibold">{labelForMovement(item.movementType)}</span>
              <span className="ml-2 text-gray-500">{item.entryCount}</span>
            </Link>
          ))}
        </div>
      )}

      {ledger.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
          <h2 className="text-base font-semibold text-gray-900">No stock movements found</h2>
          <p className="mt-1 text-sm text-gray-500">
            Receive a purchase order, reserve stock, or adjust inventory to create ledger history.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Link
              href={erpRoute('receiving')}
              className="rounded-md bg-[#B1581B] px-4 py-2 text-sm font-semibold text-white"
            >
              Open Receiving
            </Link>
            <Link
              href={erpRoute('inventory-reservation')}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700"
            >
              Open Reservations
            </Link>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                  Movement
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                  Part
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                  Quantity
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                  Source
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
                  Recorded
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ledger.items.map((entry) => {
                const doc = documentLink(entry);
                return (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 align-top">
                      <Link
                        href={buildLedgerHref({ movementType: entry.movementType })}
                        className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${movementTone(entry.movementType)}`}
                      >
                        {labelForMovement(entry.movementType)}
                      </Link>
                      <div className="mt-2 text-xs text-gray-500">{entry.reasonCode}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Link
                        href={erpRecordRoute('part', entry.part.id)}
                        className="font-mono text-sm font-semibold text-gray-900 hover:underline"
                      >
                        {entry.part.sku}
                      </Link>
                      <div className="text-sm text-gray-600">{entry.part.name}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {entry.location.name}
                        {entry.lot?.lotNumber ? ` - Lot ${entry.lot.lotNumber}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div
                        className={
                          entry.quantityDelta >= 0
                            ? 'text-sm font-semibold text-green-700'
                            : 'text-sm font-semibold text-amber-700'
                        }
                      >
                        {formatQuantity(entry.quantityDelta, entry.part.unitOfMeasure)}
                      </div>
                      <div className="text-xs text-gray-500">{formatMoney(entry.valueDelta)}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {doc ? (
                        <Link
                          href={doc.href}
                          className="text-sm font-medium text-gray-900 hover:underline"
                        >
                          {doc.label}
                        </Link>
                      ) : (
                        <span className="text-sm text-gray-500">Internal movement</span>
                      )}
                      <Link
                        href={buildLedgerHref({ correlationId: entry.correlationId })}
                        className="mt-1 block font-mono text-xs text-gray-500 hover:underline"
                      >
                        {entry.correlationId}
                      </Link>
                    </td>
                    <td className="px-4 py-3 align-top text-sm text-gray-600">
                      {formatDateTime(entry.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
