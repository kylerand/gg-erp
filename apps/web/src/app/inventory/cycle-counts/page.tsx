'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ClipboardCheck, RefreshCw } from 'lucide-react';
import { EmptyState, LoadingSkeleton, PageHeader } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createCycleCount,
  listInventoryLocations,
  listInventoryLots,
  type CycleCount,
  type InventoryLocation,
  type InventoryLot,
} from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatQuantity(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

export default function InventoryCycleCountsPage() {
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [scheduledFor, setScheduledFor] = useState(today());
  const [notes, setNotes] = useState('');
  const [countedByLot, setCountedByLot] = useState<Record<string, string>>({});
  const [posting, setPosting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [postedCount, setPostedCount] = useState<CycleCount | null>(null);

  const loadCountData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [lotResponse, locationResponse] = await Promise.all([
        listInventoryLots({ status: 'AVAILABLE', pageSize: 200 }, { allowMockFallback: false }),
        listInventoryLocations({ allowMockFallback: false }),
      ]);
      setLots(lotResponse.items);
      setLocations(locationResponse.items);
      setCountedByLot({});
      setSelectedLocationId((current) => current || locationResponse.items[0]?.id || '');
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCountData();
  }, [loadCountData]);

  const selectedLocation = locations.find((location) => location.id === selectedLocationId);
  const locationLots = useMemo(
    () => lots.filter((lot) => lot.stockLocationId === selectedLocationId),
    [lots, selectedLocationId],
  );

  const countValue = useCallback((lot: InventoryLot): string => {
    return countedByLot[lot.id] ?? String(lot.quantityOnHand);
  }, [countedByLot]);

  const preview = useMemo(() => {
    return locationLots.reduce(
      (summary, lot) => {
        const countedQuantity = Number(countValue(lot));
        if (!Number.isFinite(countedQuantity)) return summary;
        const variance = countedQuantity - lot.quantityOnHand;
        return {
          lineCount: summary.lineCount + 1,
          varianceCount: summary.varianceCount + (variance === 0 ? 0 : 1),
          netQuantityDelta: summary.netQuantityDelta + variance,
        };
      },
      { lineCount: 0, varianceCount: 0, netQuantityDelta: 0 },
    );
  }, [countValue, locationLots]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setPostedCount(null);

    if (!selectedLocationId) {
      setActionError('Select a stock location.');
      return;
    }
    if (locationLots.length === 0) {
      setActionError('Selected location has no available lots to count.');
      return;
    }

    const lines = locationLots.map((lot) => ({
      stockLotId: lot.id,
      countedQuantity: Number(countValue(lot)),
      reasonCode: 'CYCLE_COUNT',
    }));
    const invalidLine = lines.find((line) => !Number.isFinite(line.countedQuantity) || line.countedQuantity < 0);
    if (invalidLine) {
      setActionError('Counted quantities must be zero or greater.');
      return;
    }

    setPosting(true);
    try {
      const cycleCount = await createCycleCount({
        stockLocationId: selectedLocationId,
        scheduledFor,
        notes: notes.trim() || undefined,
        lines,
      });
      setPostedCount(cycleCount);
      setNotes('');
      await loadCountData();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPosting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Cycle Counts"
        description="Post physical count batches against live inventory lots with ledger-backed variances"
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href={erpRoute('inventory-ledger', { movementType: 'CYCLE_COUNT' })}
          className="inline-flex h-7 items-center rounded-md border border-gray-200 bg-white px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cycle Count Ledger
        </Link>
        <Link
          href={erpRoute('inventory-adjustment')}
          className="inline-flex h-7 items-center rounded-md border border-gray-200 bg-white px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Stock Adjustments
        </Link>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadCountData()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh Stock
        </Button>
      </div>

      {loadError && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{loadError}</span>
        </div>
      )}

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : lots.length === 0 ? (
        <EmptyState
          title="No countable stock"
          description="Receive inventory before running cycle counts."
        />
      ) : (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="space-y-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-gray-700">Stock location</span>
                <select
                  value={selectedLocationId}
                  onChange={(event) => {
                    setSelectedLocationId(event.target.value);
                    setCountedByLot({});
                  }}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.locationCode} · {location.locationName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-medium text-gray-700">Scheduled date</span>
                <Input
                  type="date"
                  value={scheduledFor}
                  onChange={(event) => setScheduledFor(event.target.value)}
                  required
                />
              </label>
            </div>

            {locationLots.length === 0 ? (
              <EmptyState
                title="No lots at this location"
                description="Select another location or receive stock here first."
              />
            ) : (
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Part</th>
                      <th className="px-4 py-3 text-left font-medium">Lot</th>
                      <th className="px-4 py-3 text-right font-medium">Expected</th>
                      <th className="px-4 py-3 text-right font-medium">Counted</th>
                      <th className="px-4 py-3 text-right font-medium">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {locationLots.map((lot) => {
                      const countedQuantity = Number(countValue(lot));
                      const variance = Number.isFinite(countedQuantity)
                        ? countedQuantity - lot.quantityOnHand
                        : 0;
                      return (
                        <tr key={lot.id}>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{lot.partSku}</div>
                            <div className="text-xs text-gray-500">{lot.partName}</div>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{lot.lotNumber || lot.id.slice(0, 8)}</td>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {formatQuantity(lot.quantityOnHand)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Input
                              type="number"
                              step="0.001"
                              min="0"
                              value={countValue(lot)}
                              onChange={(event) =>
                                setCountedByLot((current) => ({
                                  ...current,
                                  [lot.id]: event.target.value,
                                }))
                              }
                              className="ml-auto w-28 text-right"
                              required
                            />
                          </td>
                          <td
                            className={
                              variance < 0
                                ? 'px-4 py-3 text-right font-medium text-red-700'
                                : variance > 0
                                  ? 'px-4 py-3 text-right font-medium text-green-700'
                                  : 'px-4 py-3 text-right text-gray-500'
                            }
                          >
                            {formatQuantity(variance)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

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
            {postedCount && (
              <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4" />
                <span>
                  Posted {postedCount.cycleCountNumber} with {postedCount.varianceCount} variances.
                </span>
              </div>
            )}

            <Button type="submit" disabled={posting || locationLots.length === 0}>
              <ClipboardCheck className="mr-2 h-4 w-4" />
              {posting ? 'Posting...' : 'Post Cycle Count'}
            </Button>
          </section>

          <aside className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Batch</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-gray-500">Location</dt>
                <dd className="font-medium text-gray-900">{selectedLocation?.locationName ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Lots</dt>
                <dd className="font-medium text-gray-900">{preview.lineCount}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Variances</dt>
                <dd className="font-medium text-gray-900">{preview.varianceCount}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Net quantity delta</dt>
                <dd
                  className={
                    preview.netQuantityDelta < 0
                      ? 'font-medium text-red-700'
                      : preview.netQuantityDelta > 0
                        ? 'font-medium text-green-700'
                        : 'font-medium text-gray-900'
                  }
                >
                  {formatQuantity(preview.netQuantityDelta)}
                </dd>
              </div>
            </dl>
          </aside>
        </form>
      )}
    </div>
  );
}
