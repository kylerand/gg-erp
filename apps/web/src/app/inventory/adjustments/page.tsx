'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { EmptyState, LoadingSkeleton, PageHeader } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
import {
  createInventoryAdjustment,
  listInventoryLots,
  type InventoryAdjustment,
  type InventoryLot,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';

const REASON_OPTIONS = [
  { value: 'CYCLE_COUNT', label: 'Cycle count' },
  { value: 'DAMAGE', label: 'Damage' },
  { value: 'LOSS', label: 'Loss' },
  { value: 'FOUND', label: 'Found stock' },
  { value: 'CORRECTION', label: 'Correction' },
];

const REASON_VALUES = new Set(REASON_OPTIONS.map((reason) => reason.value));

function formatQuantity(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

function lotOption(lot: InventoryLot): SearchableSelectOption {
  return {
    id: lot.id,
    label: `${lot.partSku} · ${lot.lotNumber || lot.id.slice(0, 8)}`,
    description: `${lot.partName} · ${lot.locationName}`,
    meta: `On hand ${formatQuantity(lot.quantityOnHand)} · Available ${formatQuantity(lot.quantityAvailable)}`,
  };
}

function parseReasonCode(value: string | null): string {
  return value && REASON_VALUES.has(value) ? value : 'CYCLE_COUNT';
}

export default function InventoryAdjustmentsPage() {
  const searchParams = useSearchParams();
  const activePartId = searchParams.get('partId') ?? '';
  const activeStockLotId = searchParams.get('stockLotId') ?? '';
  const requestedReasonCode = parseReasonCode(searchParams.get('reasonCode'));
  const requestedNotes = searchParams.get('notes') ?? '';
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedLotId, setSelectedLotId] = useState('');
  const [lotSearch, setLotSearch] = useState('');
  const [quantityDelta, setQuantityDelta] = useState('');
  const [reasonCode, setReasonCode] = useState(requestedReasonCode);
  const [notes, setNotes] = useState(requestedNotes);
  const [posting, setPosting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [postedAdjustment, setPostedAdjustment] = useState<InventoryAdjustment | null>(null);

  const loadLots = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await listInventoryLots(
        { partId: activePartId || undefined, status: 'AVAILABLE', pageSize: 100 },
        { allowMockFallback: false },
      );
      setLots(response.items);
      setSelectedLotId((current) => {
        if (current && response.items.some((lot) => lot.id === current)) return current;
        if (activeStockLotId && response.items.some((lot) => lot.id === activeStockLotId)) {
          return activeStockLotId;
        }
        return response.items.length === 1 ? response.items[0].id : '';
      });
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [activePartId, activeStockLotId]);

  useEffect(() => {
    void loadLots();
  }, [loadLots]);

  useEffect(() => {
    setReasonCode(requestedReasonCode);
    setNotes(requestedNotes);
  }, [requestedNotes, requestedReasonCode]);

  const lotOptions = useMemo(() => {
    const query = lotSearch.trim().toLowerCase();
    return lots
      .filter((lot) => {
        if (!query) return true;
        return [lot.partSku, lot.partName, lot.lotNumber, lot.locationName]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      })
      .map(lotOption);
  }, [lotSearch, lots]);

  const selectedLot = lots.find((lot) => lot.id === selectedLotId);
  const parsedDelta = Number(quantityDelta);
  const countedQuantity =
    selectedLot && Number.isFinite(parsedDelta) ? selectedLot.quantityOnHand + parsedDelta : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setPostedAdjustment(null);

    if (!selectedLotId) {
      setActionError('Select a stock lot.');
      return;
    }
    if (!Number.isFinite(parsedDelta) || parsedDelta === 0) {
      setActionError('Quantity change must be non-zero.');
      return;
    }
    if (!reasonCode) {
      setActionError('Select a reason.');
      return;
    }

    setPosting(true);
    try {
      const adjustment = await createInventoryAdjustment({
        stockLotId: selectedLotId,
        quantityDelta: parsedDelta,
        reasonCode,
        notes: notes.trim() || undefined,
      });
      setPostedAdjustment(adjustment);
      setQuantityDelta('');
      setNotes('');
      await loadLots();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPosting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Stock Adjustments"
        description="Post controlled on-hand corrections against live inventory lots"
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href={erpRoute('inventory-ledger', { movementType: 'ADJUSTMENT' })}
          className="inline-flex h-7 items-center rounded-md border border-gray-200 bg-white px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Adjustment Ledger
        </Link>
        <Link
          href={erpRoute('inventory-ledger')}
          className="inline-flex h-7 items-center rounded-md border border-gray-200 bg-white px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          All Movements
        </Link>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadLots()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh Lots
        </Button>
      </div>

      {activePartId && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
          <span className="font-medium text-amber-950">
            Filtered to available lots for the selected part.
          </span>
          <div className="flex flex-wrap gap-2">
            <Link
              href={erpRecordRoute('part', activePartId)}
              className="font-semibold text-[#B1581B] hover:underline"
            >
              Review part
            </Link>
            <Link
              href={erpRoute('inventory-ledger', { partId: activePartId })}
              className="font-semibold text-[#B1581B] hover:underline"
            >
              Movement history
            </Link>
          </div>
        </div>
      )}

      {loadError && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{loadError}</span>
        </div>
      )}

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : lots.length === 0 ? (
        <EmptyState
          title="No adjustable lots"
          description="Receive inventory before posting stock corrections."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <form
            onSubmit={handleSubmit}
            className="space-y-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
          >
            <SearchableSelect
              id="stockLotId"
              label="Stock lot"
              required
              value={selectedLotId}
              selectedOption={selectedLot ? lotOption(selectedLot) : undefined}
              searchValue={lotSearch}
              options={lotOptions}
              loading={loading}
              placeholder="Search SKU, part, lot, or location"
              emptyText="No lots match"
              onSearchChange={setLotSearch}
              onChange={setSelectedLotId}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-gray-700">Quantity change</span>
                <Input
                  type="number"
                  step="0.001"
                  value={quantityDelta}
                  onChange={(event) => setQuantityDelta(event.target.value)}
                  placeholder="-1 or 1"
                  required
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-gray-700">Reason</span>
                <select
                  value={reasonCode}
                  onChange={(event) => setReasonCode(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                >
                  {REASON_OPTIONS.map((reason) => (
                    <option key={reason.value} value={reason.value}>
                      {reason.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="space-y-1.5">
              <span className="text-sm font-medium text-gray-700">Notes</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                maxLength={1000}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>

            {actionError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {actionError}
              </div>
            )}
            {postedAdjustment && (
              <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4" />
                <span>
                  Posted {postedAdjustment.adjustmentNumber} for {postedAdjustment.partSku}.
                </span>
              </div>
            )}

            <Button type="submit" disabled={posting}>
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              {posting ? 'Posting...' : 'Post Adjustment'}
            </Button>
          </form>

          <aside className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Preview</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-gray-500">Part</dt>
                <dd className="font-medium text-gray-900">{selectedLot?.partSku ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Location</dt>
                <dd className="font-medium text-gray-900">{selectedLot?.locationName ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Current on hand</dt>
                <dd className="font-medium text-gray-900">
                  {selectedLot ? formatQuantity(selectedLot.quantityOnHand) : '-'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">After posting</dt>
                <dd
                  className={
                    countedQuantity !== null && countedQuantity < 0
                      ? 'font-medium text-red-700'
                      : 'font-medium text-gray-900'
                  }
                >
                  {countedQuantity === null ? '-' : formatQuantity(countedQuantity)}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Reserved</dt>
                <dd className="font-medium text-gray-900">
                  {selectedLot ? formatQuantity(selectedLot.quantityReserved) : '-'}
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      )}
    </div>
  );
}
