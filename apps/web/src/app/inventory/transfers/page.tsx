'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRightLeft, CheckCircle2, RefreshCw } from 'lucide-react';
import { EmptyState, LoadingSkeleton, PageHeader } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
import {
  createInventoryTransfer,
  listInventoryLocations,
  listInventoryLots,
  type InventoryLocation,
  type InventoryLot,
  type InventoryTransfer,
} from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';

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
    meta: `Available ${formatQuantity(lot.quantityAvailable)} · On hand ${formatQuantity(lot.quantityOnHand)}`,
  };
}

function locationOption(location: InventoryLocation): SearchableSelectOption {
  return {
    id: location.id,
    label: `${location.locationCode} · ${location.locationName}`,
    description: location.locationType,
    meta: location.isPickable ? 'Pickable' : 'Non-pickable',
  };
}

export default function InventoryTransfersPage() {
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedLotId, setSelectedLotId] = useState('');
  const [toStockLocationId, setToStockLocationId] = useState('');
  const [lotSearch, setLotSearch] = useState('');
  const [locationSearch, setLocationSearch] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reasonCode, setReasonCode] = useState('STOCK_TRANSFER');
  const [notes, setNotes] = useState('');
  const [posting, setPosting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [postedTransfer, setPostedTransfer] = useState<InventoryTransfer | null>(null);

  const loadTransferData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [lotResponse, locationResponse] = await Promise.all([
        listInventoryLots({ status: 'AVAILABLE', pageSize: 100 }, { allowMockFallback: false }),
        listInventoryLocations({ allowMockFallback: false }),
      ]);
      setLots(lotResponse.items);
      setLocations(locationResponse.items);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTransferData();
  }, [loadTransferData]);

  const selectedLot = lots.find((lot) => lot.id === selectedLotId);
  const destinationLocation = locations.find((location) => location.id === toStockLocationId);
  const parsedQuantity = Number(quantity);
  const sourceAfter =
    selectedLot && Number.isFinite(parsedQuantity)
      ? selectedLot.quantityOnHand - parsedQuantity
      : null;

  const lotOptions = useMemo(() => {
    const query = lotSearch.trim().toLowerCase();
    return lots
      .filter((lot) => lot.quantityAvailable > 0)
      .filter((lot) => {
        if (!query) return true;
        return [lot.partSku, lot.partName, lot.lotNumber, lot.locationName]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      })
      .map(lotOption);
  }, [lotSearch, lots]);

  const locationOptions = useMemo(() => {
    const sourceLocationId = selectedLot?.stockLocationId;
    const query = locationSearch.trim().toLowerCase();
    return locations
      .filter((location) => location.id !== sourceLocationId)
      .filter((location) => {
        if (!query) return true;
        return [location.locationCode, location.locationName, location.locationType]
          .some((value) => value.toLowerCase().includes(query));
      })
      .map(locationOption);
  }, [locationSearch, locations, selectedLot?.stockLocationId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setPostedTransfer(null);

    if (!selectedLotId) {
      setActionError('Select a source stock lot.');
      return;
    }
    if (!toStockLocationId) {
      setActionError('Select a destination location.');
      return;
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setActionError('Transfer quantity must be greater than zero.');
      return;
    }
    if (selectedLot && parsedQuantity > selectedLot.quantityAvailable) {
      setActionError(`Transfer quantity exceeds available quantity (${formatQuantity(selectedLot.quantityAvailable)}).`);
      return;
    }

    setPosting(true);
    try {
      const transfer = await createInventoryTransfer({
        stockLotId: selectedLotId,
        quantity: parsedQuantity,
        toStockLocationId,
        reasonCode: reasonCode.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setPostedTransfer(transfer);
      setQuantity('');
      setNotes('');
      await loadTransferData();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPosting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Stock Transfers"
        description="Move available inventory between live shop locations with ledger traceability"
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href={erpRoute('inventory-ledger', { movementType: 'TRANSFER_OUT,TRANSFER_IN' })}
          className="inline-flex h-7 items-center rounded-md border border-gray-200 bg-white px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Transfer Ledger
        </Link>
        <Link
          href={erpRoute('inventory-ledger')}
          className="inline-flex h-7 items-center rounded-md border border-gray-200 bg-white px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          All Movements
        </Link>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadTransferData()}>
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
        <LoadingSkeleton rows={5} />
      ) : lots.filter((lot) => lot.quantityAvailable > 0).length === 0 ? (
        <EmptyState
          title="No transferable stock"
          description="Receive inventory or release reservations before moving stock."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <form
            onSubmit={handleSubmit}
            className="space-y-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
          >
            <SearchableSelect
              id="stockLotId"
              label="Source stock lot"
              required
              value={selectedLotId}
              selectedOption={selectedLot ? lotOption(selectedLot) : undefined}
              searchValue={lotSearch}
              options={lotOptions}
              loading={loading}
              placeholder="Search SKU, part, lot, or source location"
              emptyText="No stock lots match"
              onSearchChange={setLotSearch}
              onChange={(lotId) => {
                setSelectedLotId(lotId);
                setToStockLocationId('');
              }}
            />

            <SearchableSelect
              id="toStockLocationId"
              label="Destination location"
              required
              value={toStockLocationId}
              selectedOption={destinationLocation ? locationOption(destinationLocation) : undefined}
              searchValue={locationSearch}
              options={locationOptions}
              loading={loading}
              placeholder="Search location code or name"
              emptyText="No destination locations match"
              onSearchChange={setLocationSearch}
              onChange={setToStockLocationId}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-gray-700">Quantity</span>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  placeholder="1"
                  required
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-gray-700">Reason code</span>
                <Input
                  value={reasonCode}
                  onChange={(event) => setReasonCode(event.target.value)}
                  maxLength={80}
                  required
                />
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
            {postedTransfer && (
              <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4" />
                <span>
                  Posted {postedTransfer.transferNumber} for {postedTransfer.partSku}.
                </span>
              </div>
            )}

            <Button type="submit" disabled={posting}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              {posting ? 'Posting...' : 'Post Transfer'}
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
                <dt className="text-gray-500">From</dt>
                <dd className="font-medium text-gray-900">{selectedLot?.locationName ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">To</dt>
                <dd className="font-medium text-gray-900">{destinationLocation?.locationName ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Available</dt>
                <dd className="font-medium text-gray-900">
                  {selectedLot ? formatQuantity(selectedLot.quantityAvailable) : '-'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Source after posting</dt>
                <dd
                  className={
                    sourceAfter !== null && sourceAfter < 0
                      ? 'font-medium text-red-700'
                      : 'font-medium text-gray-900'
                  }
                >
                  {sourceAfter === null ? '-' : formatQuantity(sourceAfter)}
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      )}
    </div>
  );
}
