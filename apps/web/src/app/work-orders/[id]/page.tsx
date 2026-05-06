'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  MessageCircle,
  Package,
  PackageCheck,
  Printer,
  Receipt,
  Send,
  ShieldCheck,
  Timer,
  Undo2,
  Wrench,
} from 'lucide-react';
import {
  consumeInventoryReservation,
  createInventoryReservation,
  getWoOrder,
  listInventoryLots,
  releaseInventoryReservation,
  type InventoryLot,
  type InventoryReservation,
  type WoOrderDetail,
  type WoOrderPartLine,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';
import { MaterialReadinessBadge, PageHeader, StatusBadge, SyncStatusBadge } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const ORDER_TABS = [
  { id: 'services', label: 'Services', icon: Wrench },
  { id: 'parts', label: 'Parts', icon: Package },
  { id: 'time', label: 'Time', icon: Timer },
  { id: 'qc', label: 'QC', icon: ShieldCheck },
  { id: 'messages', label: 'Messages', icon: MessageCircle },
  { id: 'accounting', label: 'Accounting', icon: Receipt },
];

interface MaterialDraft {
  stockLotId: string;
  quantity: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

function formatQuantity(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function createDrafts(parts: WoOrderPartLine[], lotsByPartLine: Record<string, InventoryLot[]>) {
  return parts.reduce<Record<string, MaterialDraft>>((acc, part) => {
    const firstAvailableLot = lotsByPartLine[part.id]?.find((lot) => lot.quantityAvailable > 0);
    const quantity =
      firstAvailableLot && part.openQuantity > 0
        ? Math.min(part.openQuantity, firstAvailableLot.quantityAvailable)
        : part.openQuantity;
    acc[part.id] = {
      stockLotId: firstAvailableLot?.id ?? '',
      quantity: quantity > 0 ? String(quantity) : '',
    };
    return acc;
  }, {});
}

export default function WorkOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [workOrder, setWorkOrder] = useState<WoOrderDetail | null>(null);
  const [availableLots, setAvailableLots] = useState<Record<string, InventoryLot[]>>({});
  const [drafts, setDrafts] = useState<Record<string, MaterialDraft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextWorkOrder = await getWoOrder(id, { allowMockFallback: false });
      if (!nextWorkOrder) {
        setWorkOrder(null);
        setAvailableLots({});
        setDrafts({});
        return;
      }

      const lotEntries = await Promise.all(
        nextWorkOrder.parts.map(async (part) => {
          if (!part.partSku) return [part.id, []] as const;
          const result = await listInventoryLots(
            { partNumber: part.partSku, status: 'AVAILABLE', pageSize: 50 },
            { allowMockFallback: false },
          );
          return [
            part.id,
            result.items.filter((lot) => lot.quantityAvailable > 0 && lot.partSku === part.partSku),
          ] as const;
        }),
      );
      const lotsByPartLine = Object.fromEntries(lotEntries);

      setWorkOrder(nextWorkOrder);
      setAvailableLots(lotsByPartLine);
      setDrafts(createDrafts(nextWorkOrder.parts, lotsByPartLine));
    } catch (err) {
      setWorkOrder(null);
      setAvailableLots({});
      setDrafts({});
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateDraft(partLineId: string, patch: Partial<MaterialDraft>) {
    setDrafts((current) => ({
      ...current,
      [partLineId]: {
        stockLotId: current[partLineId]?.stockLotId ?? '',
        quantity: current[partLineId]?.quantity ?? '',
        ...patch,
      },
    }));
  }

  async function handleReserve(part: WoOrderPartLine) {
    if (!workOrder) return;
    const draft = drafts[part.id];
    const lot = availableLots[part.id]?.find((item) => item.id === draft?.stockLotId);
    const quantity = Number(draft?.quantity);

    if (!lot) {
      setActionError('Select an available lot before reserving material.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > part.openQuantity) {
      setActionError(
        `Reserve quantity must be between 0 and ${formatQuantity(part.openQuantity)}.`,
      );
      return;
    }
    if (quantity > lot.quantityAvailable) {
      setActionError(`Selected lot only has ${formatQuantity(lot.quantityAvailable)} available.`);
      return;
    }

    setActionBusy(`reserve:${part.id}`);
    setActionError(null);
    try {
      await createInventoryReservation({
        stockLotId: lot.id,
        quantity,
        workOrderId: workOrder.id,
        workOrderPartId: part.id,
      });
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleReservationAction(
    reservation: InventoryReservation,
    action: 'release' | 'consume',
  ) {
    setActionBusy(`${action}:${reservation.id}`);
    setActionError(null);
    try {
      if (action === 'release') {
        await releaseInventoryReservation(reservation.id);
      } else {
        await consumeInventoryReservation(reservation.id);
      }
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActionBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
        <div className="h-40 animate-pulse rounded-lg bg-gray-100" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-56 animate-pulse rounded-lg bg-gray-100 lg:col-span-2" />
          <div className="h-56 animate-pulse rounded-lg bg-gray-100" />
        </div>
      </div>
    );
  }

  if (error || !workOrder) {
    return (
      <div>
        <PageHeader title="Work Order" description="Unable to load work-order detail" />
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error ?? 'Work order not found.'}
        </div>
        <Link
          href={erpRoute('work-order')}
          className="mt-4 inline-block text-sm font-semibold text-[#B1581B] hover:underline"
        >
          Back to work orders
        </Link>
      </div>
    );
  }

  const doneCount = workOrder.checklist.filter((item) => item.done).length;
  const serviceProgress =
    workOrder.checklist.length > 0 ? Math.round((doneCount / workOrder.checklist.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <PageHeader
          title={`${workOrder.number}: ${workOrder.title}`}
          description={`${workOrder.customer} · ${workOrder.cart}`}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Printer size={15} />
            Print
          </Button>
          <LinkButton href={erpRoute('message-thread', { workOrder: workOrder.id })}>
            <Send size={15} />
            Send
          </LinkButton>
          <LinkButton href={erpRoute('message-thread', { workOrder: workOrder.id })}>
            <MessageCircle size={15} />
            Message
          </LinkButton>
        </div>
      </div>

      <section className="rounded-lg border border-[#D9CCBE] bg-white p-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <SummaryItem label="Status">
            <StatusBadge status={workOrder.status} />
          </SummaryItem>
          <SummaryItem label="Material">
            <MaterialReadinessBadge
              status={workOrder.materialReadiness}
              shortageCount={workOrder.shortageCount}
            />
          </SummaryItem>
          <SummaryItem label="Accounting">
            <SyncStatusBadge status={workOrder.syncStatus} />
          </SummaryItem>
          <SummaryItem label="Bay" value={workOrder.bay} />
          <SummaryItem label="Due" value={workOrder.eta} />
          <SummaryItem label="Service Progress" value={`${serviceProgress}%`} />
        </div>
      </section>

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      <nav className="flex gap-2 overflow-x-auto border-b border-[#D9CCBE] pb-2">
        {ORDER_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <a
              key={tab.id}
              href={`#${tab.id}`}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-[#D9CCBE] bg-white px-3 py-2 text-sm font-semibold text-[#4F4641] hover:border-[#E37125] hover:text-[#211F1E]"
            >
              <Icon size={15} />
              {tab.label}
            </a>
          );
        })}
      </nav>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <section id="services" className="rounded-lg border border-gray-200 bg-white">
            <SectionHeader
              icon={Wrench}
              title="Services"
              actionHref={erpRoute('sop-runner', { workOrderId: workOrder.id })}
              actionLabel="Open SOP Runner"
            />
            <div className="divide-y divide-gray-100">
              {workOrder.checklist.length > 0 ? (
                workOrder.checklist.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                    <CheckCircle2
                      size={18}
                      className={item.done ? 'text-green-600' : 'text-gray-300'}
                    />
                    <span className="text-sm font-medium text-gray-800">{item.label}</span>
                    <span className="ml-auto text-xs text-gray-500">
                      {item.done ? 'Done' : 'Open'}
                    </span>
                  </div>
                ))
              ) : (
                <EmptyPanel text="No service operations are attached to this work order yet." />
              )}
            </div>
          </section>

          <section id="parts" className="rounded-lg border border-gray-200 bg-white">
            <SectionHeader
              icon={Package}
              title="Parts and Reservations"
              actionHref={erpRoute('inventory-reservation', { workOrderId: workOrder.id })}
              actionLabel="Manage Reservations"
            />
            {workOrder.parts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-200 bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">Part</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">Requested</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">Reserved</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">Fulfilled</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">Open</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">
                        Reservations
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">Reserve</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {workOrder.parts.map((part) => (
                      <PartRow
                        key={part.id}
                        part={part}
                        lots={availableLots[part.id] ?? []}
                        draft={
                          drafts[part.id] ?? {
                            stockLotId: '',
                            quantity: '',
                          }
                        }
                        actionBusy={actionBusy}
                        onDraftChange={(patch) => updateDraft(part.id, patch)}
                        onReserve={() => void handleReserve(part)}
                        onReservationAction={(reservation, action) =>
                          void handleReservationAction(reservation, action)
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyPanel text="No parts are reserved for this work order." />
            )}
          </section>

          <section id="time" className="rounded-lg border border-gray-200 bg-white">
            <SectionHeader
              icon={Timer}
              title="Time"
              actionHref={erpRoute('time-logging', { workOrderId: workOrder.id })}
              actionLabel="Log Time"
            />
            <EmptyPanel text="Time entries will appear here after technicians clock time to this work order." />
          </section>

          <section id="qc" className="rounded-lg border border-gray-200 bg-white">
            <SectionHeader
              icon={ShieldCheck}
              title="Quality Control"
              actionHref={erpRoute('qc-checklist', { workOrderId: workOrder.id })}
              actionLabel="Open QC"
            />
            <EmptyPanel text="QC gates and inspection results will appear here as the build progresses." />
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-900">Order Details</h2>
            <div className="mt-4 space-y-3 text-sm">
              <DetailLine label="Customer" value={workOrder.customer} />
              <DetailLine label="Cart" value={workOrder.cart} />
              <DetailLine label="Bay" value={workOrder.bay} />
              <DetailLine label="Rework Loop" value={String(workOrder.reworkLoop)} />
            </div>
          </section>

          <section id="messages" className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <MessageCircle size={15} />
              Messages and Notes
            </h2>
            <div className="mt-4 space-y-3">
              {workOrder.notes.length > 0 ? (
                workOrder.notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm"
                  >
                    <div className="font-semibold text-gray-800">{note.author}</div>
                    <p className="mt-1 text-gray-600">{note.message}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">No notes yet.</p>
              )}
              <Link
                href={erpRoute('message-thread', { workOrder: workOrder.id })}
                className="inline-flex text-sm font-semibold text-[#B1581B] hover:underline"
              >
                Open message thread
              </Link>
            </div>
          </section>

          <section id="accounting" className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Receipt size={15} />
              Accounting
            </h2>
            <div className="mt-4 space-y-3 text-sm">
              <Link
                href={erpRoute('accounting-sync', { view: 'invoices' })}
                className="flex items-center gap-2 text-[#B1581B] hover:underline"
              >
                <FileText size={14} />
                Invoice sync history
              </Link>
              <Link
                href={erpRoute('accounting-reconciliation')}
                className="flex items-center gap-2 text-[#B1581B] hover:underline"
              >
                <ClipboardCheck size={14} />
                Reconciliation runs
              </Link>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Clock size={15} />
              Activity
            </h2>
            <p className="mt-3 text-sm text-gray-500">
              Activity events will appear here once the work-order event stream is exposed to the
              web app.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50"
    >
      {children}
    </Link>
  );
}

function SummaryItem({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 text-sm font-semibold text-gray-900">{children ?? value ?? '-'}</div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  actionHref,
  actionLabel,
}: {
  icon: typeof Wrench;
  title: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Icon size={16} />
        {title}
      </h2>
      <Link href={actionHref} className="text-xs font-semibold text-[#B1581B] hover:underline">
        {actionLabel}
      </Link>
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return <div className="px-4 py-8 text-sm text-gray-500">{text}</div>;
}

function PartRow({
  part,
  lots,
  draft,
  actionBusy,
  onDraftChange,
  onReserve,
  onReservationAction,
}: {
  part: WoOrderPartLine;
  lots: InventoryLot[];
  draft: MaterialDraft;
  actionBusy: string | null;
  onDraftChange: (patch: Partial<MaterialDraft>) => void;
  onReserve: () => void;
  onReservationAction: (reservation: InventoryReservation, action: 'release' | 'consume') => void;
}) {
  const selectedLot = lots.find((lot) => lot.id === draft.stockLotId);
  const quantity = Number(draft.quantity);
  const reserveBusy = actionBusy === `reserve:${part.id}`;
  const canReserve =
    part.openQuantity > 0 &&
    Boolean(selectedLot) &&
    Number.isFinite(quantity) &&
    quantity > 0 &&
    quantity <= part.openQuantity &&
    quantity <= (selectedLot?.quantityAvailable ?? 0) &&
    !actionBusy;

  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <Link
          href={erpRecordRoute('part', part.partId)}
          className="font-mono text-xs font-semibold text-gray-900 hover:underline"
        >
          {part.partSku}
        </Link>
        <div className="mt-1 font-medium text-gray-900">{part.name}</div>
        <div className="mt-2">
          <StatusBadge status={part.state}>{part.state.replace(/_/g, ' ')}</StatusBadge>
        </div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
        {formatQuantity(part.requestedQuantity)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
        {formatQuantity(part.reservedQuantity)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
        {formatQuantity(part.consumedQuantity)}
      </td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums text-amber-700">
        {formatQuantity(part.openQuantity)}
      </td>
      <td className="min-w-[18rem] px-4 py-3">
        {part.reservations.length > 0 ? (
          <div className="space-y-2">
            {part.reservations.map((reservation) => {
              const releaseBusy = actionBusy === `release:${reservation.id}`;
              const consumeBusy = actionBusy === `consume:${reservation.id}`;
              const canAct = reservation.openQuantity > 0 && !actionBusy;

              return (
                <div
                  key={reservation.id}
                  className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-gray-900">
                        {reservation.lotNumber ?? reservation.stockLotId}
                      </div>
                      <div className="text-xs text-gray-500">{reservation.locationName}</div>
                    </div>
                    <StatusBadge status={reservation.status}>
                      {reservation.status.replace(/_/g, ' ')}
                    </StatusBadge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
                    <span>Open {formatQuantity(reservation.openQuantity)}</span>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!canAct}
                        onClick={() => onReservationAction(reservation, 'release')}
                      >
                        <Undo2 data-icon="inline-start" />
                        {releaseBusy ? 'Releasing' : 'Release'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!canAct}
                        onClick={() => onReservationAction(reservation, 'consume')}
                      >
                        <CheckCircle2 data-icon="inline-start" />
                        {consumeBusy ? 'Fulfilling' : 'Fulfill'}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <span className="text-sm text-gray-500">No active reservations</span>
        )}
      </td>
      <td className="min-w-[18rem] px-4 py-3">
        <div className="grid gap-2">
          <select
            value={draft.stockLotId}
            disabled={part.openQuantity <= 0 || Boolean(actionBusy)}
            onChange={(event) => {
              const nextLot = lots.find((lot) => lot.id === event.target.value);
              onDraftChange({
                stockLotId: event.target.value,
                quantity: nextLot
                  ? String(Math.min(part.openQuantity, nextLot.quantityAvailable))
                  : draft.quantity,
              });
            }}
            className="h-9 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-900"
          >
            <option value="">Select available lot</option>
            {lots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {(lot.lotNumber ?? lot.id).slice(0, 28)} · {formatQuantity(lot.quantityAvailable)}{' '}
                available
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Input
              type="number"
              min="0.001"
              step="0.001"
              value={draft.quantity}
              disabled={part.openQuantity <= 0 || Boolean(actionBusy)}
              onChange={(event) => onDraftChange({ quantity: event.target.value })}
              className="h-9 text-right"
            />
            <Button type="button" disabled={!canReserve} onClick={onReserve}>
              <PackageCheck data-icon="inline-start" />
              {reserveBusy ? 'Reserving' : 'Reserve'}
            </Button>
          </div>
          {part.openQuantity <= 0 ? (
            <div className="text-xs text-green-700">Requested quantity is fully covered.</div>
          ) : lots.length === 0 ? (
            <div className="text-xs text-red-600">No available lots for this SKU.</div>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className="text-right font-medium text-gray-900">{value}</span>
    </div>
  );
}
