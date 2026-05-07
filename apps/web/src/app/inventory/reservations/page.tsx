'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import { EmptyState, LoadingSkeleton, PageHeader, StatusBadge } from '@gg-erp/ui';
import {
  consumeInventoryReservation,
  createInventoryReservation,
  listInventoryLots,
  listInventoryReservations,
  releaseInventoryReservation,
  type InventoryLot,
  type InventoryReservation,
  type InventoryReservationStatus,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ReservationFilter = InventoryReservationStatus | 'OPEN' | 'ALL';

const STATUS_OPTIONS: Array<{ value: ReservationFilter; label: string }> = [
  { value: 'OPEN', label: 'Open' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PARTIALLY_CONSUMED', label: 'Partially Consumed' },
  { value: 'CONSUMED', label: 'Consumed' },
  { value: 'RELEASED', label: 'Released' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'ALL', label: 'All' },
];

function normalizeReservationFilter(value: string | null): ReservationFilter {
  return STATUS_OPTIONS.some((option) => option.value === value)
    ? (value as ReservationFilter)
    : 'OPEN';
}

function formatQuantity(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatDateTime(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

export default function ReservationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const statusFilter = normalizeReservationFilter(searchParams.get('status'));
  const activeSearch = searchParams.get('search') ?? '';
  const [reservations, setReservations] = useState<InventoryReservation[]>([]);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [total, setTotal] = useState(0);
  const [searchText, setSearchText] = useState(activeSearch);
  const [selectedLotId, setSelectedLotId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [workOrderId, setWorkOrderId] = useState('');
  const [loading, setLoading] = useState(true);
  const [lotsUnavailable, setLotsUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLotsUnavailable(false);

    const [reservationResult, lotResult] = await Promise.allSettled([
      listInventoryReservations(
        { status: statusFilter, search: activeSearch || undefined, page: 1, pageSize: 100 },
        { allowMockFallback: false },
      ),
      listInventoryLots(
        { status: 'AVAILABLE', page: 1, pageSize: 200 },
        { allowMockFallback: false },
      ),
    ]);

    if (reservationResult.status === 'fulfilled') {
      setReservations(reservationResult.value.items);
      setTotal(reservationResult.value.total);
    } else {
      setReservations([]);
      setTotal(0);
      setError(errorMessage(reservationResult.reason));
    }

    if (lotResult.status === 'fulfilled') {
      setLots(lotResult.value.items);
    } else {
      setLots([]);
      setLotsUnavailable(true);
    }

    setLoading(false);
  }, [activeSearch, statusFilter]);

  useEffect(() => {
    const timeout = setTimeout(() => void load(), 250);
    return () => clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    setSearchText(activeSearch);
  }, [activeSearch]);

  const availableLots = useMemo(
    () => lots.filter((lot) => lot.lotState === 'AVAILABLE' && lot.quantityAvailable > 0),
    [lots],
  );
  const selectedLot = availableLots.find((lot) => lot.id === selectedLotId);
  const openReservations = reservations.filter((reservation) => reservation.openQuantity > 0);
  const openQuantity = openReservations.reduce(
    (sum, reservation) => sum + reservation.openQuantity,
    0,
  );
  const consumedQuantity = reservations.reduce(
    (sum, reservation) => sum + reservation.consumedQuantity,
    0,
  );
  const canReserve =
    Boolean(selectedLot) &&
    quantity > 0 &&
    quantity <= (selectedLot?.quantityAvailable ?? 0) &&
    !actionBusy;

  async function handleCreateReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedLot) return;

    setActionBusy('create');
    setActionError(null);
    try {
      await createInventoryReservation({
        stockLotId: selectedLot.id,
        quantity,
        workOrderId: workOrderId.trim() || undefined,
      });
      setSelectedLotId('');
      setQuantity(1);
      setWorkOrderId('');
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActionBusy(null);
    }
  }

  function buildReservationsHref(next: { status?: ReservationFilter; search?: string }) {
    const status = next.status ?? statusFilter;
    const search = next.search !== undefined ? next.search : activeSearch;
    return erpRoute('inventory-reservation', {
      status: status === 'OPEN' ? 'OPEN' : status,
      search: search.trim() || undefined,
    });
  }

  function applyListSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(buildReservationsHref({ search: searchText }));
  }

  async function handleReservationAction(id: string, action: 'release' | 'consume') {
    setActionBusy(`${action}:${id}`);
    setActionError(null);
    try {
      if (action === 'release') {
        await releaseInventoryReservation(id);
      } else {
        await consumeInventoryReservation(id);
      }
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Reservations" description={`${total} reservation records`} />

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-2xl font-semibold text-gray-900">{openReservations.length}</div>
          <div className="mt-1 text-xs font-medium text-gray-500">Open Reservations</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-2xl font-semibold text-amber-700">
            {formatQuantity(openQuantity)}
          </div>
          <div className="mt-1 text-xs font-medium text-gray-500">Reserved Qty Open</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-2xl font-semibold text-green-700">
            {formatQuantity(consumedQuantity)}
          </div>
          <div className="mt-1 text-xs font-medium text-gray-500">Fulfilled Qty</div>
        </div>
      </div>

      <form
        onSubmit={handleCreateReservation}
        className="mb-6 rounded-lg border border-gray-200 bg-white p-4"
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(260px,1fr)_120px_minmax(220px,320px)_auto]">
          <label className="grid gap-1 text-sm font-medium text-gray-700">
            Lot
            <select
              value={selectedLotId}
              onChange={(event) => setSelectedLotId(event.target.value)}
              disabled={lotsUnavailable || availableLots.length === 0 || Boolean(actionBusy)}
              className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-sm"
            >
              <option value="">
                {lotsUnavailable
                  ? 'Lots unavailable'
                  : availableLots.length === 0
                    ? 'No available lots'
                    : 'Select lot'}
              </option>
              {availableLots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.partSku} · {lot.lotNumber} · {lot.locationName} ·{' '}
                  {formatQuantity(lot.quantityAvailable)} available
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-gray-700">
            Qty
            <Input
              type="number"
              min="0.001"
              step="0.001"
              value={quantity}
              disabled={!selectedLot || Boolean(actionBusy)}
              onChange={(event) => setQuantity(Number(event.target.value))}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-gray-700">
            Work Order ID
            <Input
              value={workOrderId}
              disabled={Boolean(actionBusy)}
              onChange={(event) => setWorkOrderId(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <div className="flex items-end">
            <Button type="submit" disabled={!canReserve} className="w-full lg:w-auto">
              <Plus data-icon="inline-start" />
              Reserve
            </Button>
          </div>
        </div>
        {selectedLot && quantity > selectedLot.quantityAvailable && (
          <div className="mt-2 text-sm text-red-600">
            Available quantity is {formatQuantity(selectedLot.quantityAvailable)}.
          </div>
        )}
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form onSubmit={applyListSearch} className="flex w-full gap-2 sm:max-w-md">
          <Input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search SKU, lot, or work order"
            className="h-9"
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <select
          value={statusFilter}
          onChange={(event) =>
            router.push(buildReservationsHref({ status: event.target.value as ReservationFilter }))
          }
          className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-sm"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
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
        <LoadingSkeleton rows={6} cols={7} />
      ) : error ? (
        <EmptyState
          icon="!"
          title="Reservations unavailable"
          description={error}
          action={
            <Button type="button" variant="outline" onClick={() => void load()}>
              <RefreshCw data-icon="inline-start" />
              Retry
            </Button>
          }
        />
      ) : reservations.length === 0 ? (
        <EmptyState
          icon="R"
          title="No reservations found"
          description="No reservation records match the current filters."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Part</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Lot / Location</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Work Order</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Reserved</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Open</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Fulfilled</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Expires</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reservations.map((reservation) => {
                const canAct = reservation.openQuantity > 0;
                const releaseBusy = actionBusy === `release:${reservation.id}`;
                const consumeBusy = actionBusy === `consume:${reservation.id}`;

                return (
                  <tr key={reservation.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={erpRecordRoute('part', reservation.partId)}
                        className="font-mono text-xs font-semibold text-gray-900 hover:underline"
                      >
                        {reservation.partSku}
                      </Link>
                      <div className="mt-0.5 text-gray-600">{reservation.partName}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-gray-700">
                        {reservation.lotNumber ?? '-'}
                      </div>
                      <div className="mt-0.5 text-gray-500">{reservation.locationName}</div>
                    </td>
                    <td className="px-4 py-3">
                      {reservation.workOrderId ? (
                        <Link
                          href={erpRecordRoute('work-order', reservation.workOrderId)}
                          className="font-medium text-gray-900 hover:underline"
                        >
                          {reservation.workOrderNumber ?? reservation.workOrderId}
                        </Link>
                      ) : (
                        <span className="text-gray-500">Unassigned</span>
                      )}
                      {reservation.workOrderTitle && (
                        <div className="mt-0.5 max-w-[220px] truncate text-gray-500">
                          {reservation.workOrderTitle}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatQuantity(reservation.reservedQuantity)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-amber-700">
                      {formatQuantity(reservation.openQuantity)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatQuantity(reservation.consumedQuantity)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={reservation.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatDateTime(reservation.expiresAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!canAct || Boolean(actionBusy)}
                          onClick={() => void handleReservationAction(reservation.id, 'release')}
                        >
                          <RotateCcw data-icon="inline-start" />
                          {releaseBusy ? 'Releasing' : 'Release'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={!canAct || Boolean(actionBusy)}
                          onClick={() => void handleReservationAction(reservation.id, 'consume')}
                        >
                          <CheckCircle2 data-icon="inline-start" />
                          {consumeBusy ? 'Fulfilling' : 'Fulfill'}
                        </Button>
                      </div>
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
