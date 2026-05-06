'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  Info,
  MessageCircle,
  Package,
  PackageCheck,
  Printer,
  RefreshCw,
  Receipt,
  Send,
  ShieldCheck,
  Timer,
  Undo2,
  Wrench,
} from 'lucide-react';
import {
  consumeInventoryReservation,
  createLaborTimeEntry,
  createInventoryReservation,
  getWoOrder,
  listWorkOrderQcGates,
  listWorkOrderTimeEntries,
  listInventoryLots,
  releaseInventoryReservation,
  submitWorkOrderQcGates,
  type InventoryLot,
  type InventoryReservation,
  type LaborTimeEntry,
  type QcGateResult,
  type SubmitWorkOrderQcResponse,
  type WoOrderDetail,
  type WoOrderPartLine,
  type WorkOrderQcGate,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';
import { useRole } from '@/lib/role-context';
import { MaterialReadinessBadge, PageHeader, StatusBadge, SyncStatusBadge } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

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

interface TimeDraft {
  hours: string;
  description: string;
}

interface ExecutionErrors {
  time?: string;
  qc?: string;
}

type QcOutcome =
  | { status: 'PASSED' }
  | { status: 'FAILED'; openReworkCount: number; reworkLoopCount: number };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

function formatQuantity(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatHours(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function formatDateTime(value?: string): string {
  if (!value) return 'Not recorded';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function qcStatusFromResponse(response: SubmitWorkOrderQcResponse): 'PASSED' | 'FAILED' {
  return response.status ?? response.overallResult ?? 'FAILED';
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
  const { user, loading: roleLoading } = useRole();
  const [workOrder, setWorkOrder] = useState<WoOrderDetail | null>(null);
  const [availableLots, setAvailableLots] = useState<Record<string, InventoryLot[]>>({});
  const [drafts, setDrafts] = useState<Record<string, MaterialDraft>>({});
  const [timeEntries, setTimeEntries] = useState<LaborTimeEntry[]>([]);
  const [qcGates, setQcGates] = useState<WorkOrderQcGate[]>([]);
  const [timeDraft, setTimeDraft] = useState<TimeDraft>({ hours: '', description: '' });
  const [qcOutcome, setQcOutcome] = useState<QcOutcome | null>(null);
  const [executionErrors, setExecutionErrors] = useState<ExecutionErrors>({});
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
        setTimeEntries([]);
        setQcGates([]);
        setQcOutcome(null);
        setExecutionErrors({});
        return;
      }

      const [lotEntries, timeResult, qcResult] = await Promise.all([
        Promise.all(
          nextWorkOrder.parts.map(async (part) => {
            if (!part.partSku) return [part.id, []] as const;
            const result = await listInventoryLots(
              { partNumber: part.partSku, status: 'AVAILABLE', pageSize: 50 },
              { allowMockFallback: false },
            );
            return [
              part.id,
              result.items.filter(
                (lot) => lot.quantityAvailable > 0 && lot.partSku === part.partSku,
              ),
            ] as const;
          }),
        ),
        listWorkOrderTimeEntries(nextWorkOrder.id, { allowMockFallback: false }).then(
          (entries) => ({ ok: true as const, entries }),
          (err: unknown) => ({ ok: false as const, error: errorMessage(err) }),
        ),
        listWorkOrderQcGates(nextWorkOrder.id, undefined, { allowMockFallback: false }).then(
          (gates) => ({ ok: true as const, gates }),
          (err: unknown) => ({ ok: false as const, error: errorMessage(err) }),
        ),
      ]);
      const lotsByPartLine = Object.fromEntries(lotEntries);

      setWorkOrder(nextWorkOrder);
      setAvailableLots(lotsByPartLine);
      setDrafts(createDrafts(nextWorkOrder.parts, lotsByPartLine));
      setTimeEntries(timeResult.ok ? timeResult.entries : []);
      setQcGates(qcResult.ok ? qcResult.gates : []);
      setQcOutcome(null);
      setExecutionErrors({
        ...(timeResult.ok ? {} : { time: timeResult.error }),
        ...(qcResult.ok ? {} : { qc: qcResult.error }),
      });
    } catch (err) {
      setWorkOrder(null);
      setAvailableLots({});
      setDrafts({});
      setTimeEntries([]);
      setQcGates([]);
      setQcOutcome(null);
      setExecutionErrors({});
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

  async function handleLogTime() {
    if (!workOrder) return;
    const technicianId = user?.userId;
    const hours = Number(timeDraft.hours);
    const description = timeDraft.description.trim();

    if (!technicianId) {
      setActionError('Sign in before logging labor time.');
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      setActionError('Log time must be greater than 0 and no more than 24 hours.');
      return;
    }
    if (!description) {
      setActionError('Add a short labor note before logging time.');
      return;
    }

    setActionBusy('time:create');
    setActionError(null);
    try {
      await createLaborTimeEntry({
        workOrderId: workOrder.id,
        technicianId,
        manualHours: hours,
        description,
        source: 'MANUAL',
        startedAt: new Date(Date.now() - hours * 3_600_000).toISOString(),
      });
      setTimeDraft({ hours: '', description: '' });
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActionBusy(null);
    }
  }

  function setQcResult(gateId: string, result: QcGateResult) {
    setQcOutcome(null);
    setQcGates((current) =>
      current.map((gate) =>
        gate.id === gateId
          ? { ...gate, result, failureNote: result === 'FAIL' ? gate.failureNote : undefined }
          : gate,
      ),
    );
  }

  function setQcFailureNote(gateId: string, failureNote: string) {
    setQcOutcome(null);
    setQcGates((current) =>
      current.map((gate) => (gate.id === gateId ? { ...gate, failureNote } : gate)),
    );
  }

  async function handleSubmitQc() {
    if (!workOrder) return;
    const reviewedBy = user?.userId;
    if (!reviewedBy) {
      setActionError('Sign in before submitting QC.');
      return;
    }

    const criticalPending = qcGates.filter((gate) => gate.isCritical && !gate.result);
    const criticalFailMissingNote = qcGates.filter(
      (gate) => gate.isCritical && gate.result === 'FAIL' && !gate.failureNote?.trim(),
    );
    if (criticalPending.length > 0) {
      setActionError('All critical QC gates need a pass, fail, or N/A result before submit.');
      return;
    }
    if (criticalFailMissingNote.length > 0) {
      setActionError('Critical QC failures need a failure note before submit.');
      return;
    }

    setActionBusy('qc:submit');
    setActionError(null);
    try {
      const response = await submitWorkOrderQcGates(workOrder.id, {
        reviewedBy,
        results: qcGates.map((gate) => ({
          gateLabel: gate.gateLabel,
          isCritical: gate.isCritical,
          result: gate.result ?? 'NA',
          failureNote: gate.failureNote,
        })),
      });
      const status = qcStatusFromResponse(response);
      const reworkLoopCount = response.activeReworkLoopCount ?? 0;
      setQcOutcome(
        status === 'PASSED'
          ? { status: 'PASSED' }
          : {
              status: 'FAILED',
              openReworkCount: response.openReworkCount ?? response.reworkIssuesCreated ?? 0,
              reworkLoopCount,
            },
      );
      const refreshedGates = await listWorkOrderQcGates(workOrder.id, undefined, {
        allowMockFallback: false,
      });
      setQcGates(refreshedGates);
      setExecutionErrors((current) => ({ ...current, qc: undefined }));
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
              title="Labor Time"
              actionHref={erpRoute('time-logging', { workOrderId: workOrder.id })}
              actionLabel="Open Time Page"
            />
            <TimeExecutionPanel
              entries={timeEntries}
              draft={timeDraft}
              actionBusy={actionBusy}
              error={executionErrors.time}
              roleLoading={roleLoading}
              signedIn={Boolean(user?.userId)}
              onDraftChange={(patch) => setTimeDraft((current) => ({ ...current, ...patch }))}
              onLogTime={() => void handleLogTime()}
              onRetry={() => void load()}
            />
          </section>

          <section id="qc" className="rounded-lg border border-gray-200 bg-white">
            <SectionHeader
              icon={ShieldCheck}
              title="Quality Control"
              actionHref={erpRoute('qc-checklist', { workOrderId: workOrder.id })}
              actionLabel="Open QC Page"
            />
            <QcExecutionPanel
              gates={qcGates}
              outcome={qcOutcome}
              actionBusy={actionBusy}
              error={executionErrors.qc}
              roleLoading={roleLoading}
              signedIn={Boolean(user?.userId)}
              onResult={setQcResult}
              onFailureNote={setQcFailureNote}
              onSubmit={() => void handleSubmitQc()}
              onRetry={() => void load()}
            />
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
            <ActivityPanel workOrder={workOrder} timeEntries={timeEntries} qcGates={qcGates} />
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

function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="m-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <span className="flex-1">{message}</span>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        <RefreshCw data-icon="inline-start" />
        Retry
      </Button>
    </div>
  );
}

function TimeExecutionPanel({
  entries,
  draft,
  actionBusy,
  error,
  roleLoading,
  signedIn,
  onDraftChange,
  onLogTime,
  onRetry,
}: {
  entries: LaborTimeEntry[];
  draft: TimeDraft;
  actionBusy: string | null;
  error?: string;
  roleLoading: boolean;
  signedIn: boolean;
  onDraftChange: (patch: Partial<TimeDraft>) => void;
  onLogTime: () => void;
  onRetry: () => void;
}) {
  const totalHours = entries.reduce((sum, entry) => sum + Number(entry.computedHours ?? 0), 0);
  const hours = Number(draft.hours);
  const canSubmit =
    signedIn &&
    !roleLoading &&
    !actionBusy &&
    Number.isFinite(hours) &&
    hours > 0 &&
    hours <= 24 &&
    draft.description.trim().length > 0;

  return (
    <div>
      {error && <PanelError message={error} onRetry={onRetry} />}
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_18rem]">
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-gray-900">
              {formatHours(totalHours)}h logged
            </div>
            <div className="text-xs text-gray-500">
              {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
            </div>
          </div>
          {entries.length > 0 ? (
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {entries.slice(0, 5).map((entry) => (
                <div key={entry.id} className="grid gap-2 px-3 py-2 sm:grid-cols-[5rem_1fr]">
                  <div className="font-semibold tabular-nums text-amber-700">
                    {formatHours(Number(entry.computedHours ?? 0))}h
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {entry.description ?? 'Labor entry'}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                      <span>{formatDateTime(entry.startedAt)}</span>
                      <span>{entry.source.replace(/_/g, ' ')}</span>
                      <span>{entry.technicianId}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyPanel text="No labor time has been logged for this work order. Add a manual entry when a technician completes shop work." />
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <h3 className="text-sm font-semibold text-gray-900">Log Manual Time</h3>
          <div className="mt-3 grid gap-2">
            <Input
              type="number"
              min="0.25"
              max="24"
              step="0.25"
              value={draft.hours}
              disabled={Boolean(actionBusy) || roleLoading}
              onChange={(event) => onDraftChange({ hours: event.target.value })}
              placeholder="Hours"
            />
            <Input
              value={draft.description}
              disabled={Boolean(actionBusy) || roleLoading}
              onChange={(event) => onDraftChange({ description: event.target.value })}
              placeholder="Labor note"
            />
            {!signedIn && !roleLoading && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                Sign in to log labor.
              </div>
            )}
            <Button type="button" disabled={!canSubmit} onClick={onLogTime}>
              <Timer data-icon="inline-start" />
              {actionBusy === 'time:create' ? 'Logging' : 'Log Time'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function QcExecutionPanel({
  gates,
  outcome,
  actionBusy,
  error,
  roleLoading,
  signedIn,
  onResult,
  onFailureNote,
  onSubmit,
  onRetry,
}: {
  gates: WorkOrderQcGate[];
  outcome: QcOutcome | null;
  actionBusy: string | null;
  error?: string;
  roleLoading: boolean;
  signedIn: boolean;
  onResult: (gateId: string, result: QcGateResult) => void;
  onFailureNote: (gateId: string, failureNote: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
}) {
  const criticalPending = gates.filter((gate) => gate.isCritical && !gate.result);
  const criticalFailMissingNote = gates.filter(
    (gate) => gate.isCritical && gate.result === 'FAIL' && !gate.failureNote?.trim(),
  );
  const canSubmit =
    signedIn &&
    !roleLoading &&
    !actionBusy &&
    gates.length > 0 &&
    criticalPending.length === 0 &&
    criticalFailMissingNote.length === 0;

  return (
    <div>
      {error && <PanelError message={error} onRetry={onRetry} />}
      <div className="space-y-4 p-4">
        {outcome?.status === 'PASSED' && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-800">
            QC passed. This work order can proceed to close once other required work is complete.
          </div>
        )}
        {outcome?.status === 'FAILED' && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <strong>QC failed.</strong> {outcome.openReworkCount} rework issue
            {outcome.openReworkCount === 1 ? '' : 's'} created. Rework loop{' '}
            {outcome.reworkLoopCount}.
          </div>
        )}

        {gates.length > 0 ? (
          <div className="space-y-3">
            {gates.map((gate) => (
              <div key={gate.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-gray-900">{gate.gateLabel}</div>
                      {gate.isCritical && (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                          Critical
                        </span>
                      )}
                      {gate.reviewedAt && (
                        <span className="text-xs text-gray-500">
                          Reviewed {formatDateTime(gate.reviewedAt)}
                        </span>
                      )}
                    </div>
                    {gate.failureNote && (
                      <p className="mt-1 text-xs text-red-700">{gate.failureNote}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(['PASS', 'FAIL', 'NA'] as const).map((result) => (
                      <button
                        key={result}
                        type="button"
                        disabled={Boolean(actionBusy) || roleLoading}
                        onClick={() => onResult(gate.id, result)}
                        className={`h-8 rounded-md border px-2 text-xs font-semibold transition-colors ${
                          gate.result === result
                            ? result === 'PASS'
                              ? 'border-green-600 bg-green-600 text-white'
                              : result === 'FAIL'
                                ? 'border-red-600 bg-red-600 text-white'
                                : 'border-gray-600 bg-gray-600 text-white'
                            : 'border-gray-300 bg-white text-gray-600 hover:border-gray-500'
                        }`}
                      >
                        {result}
                      </button>
                    ))}
                  </div>
                </div>
                {gate.isCritical && gate.result === 'FAIL' && (
                  <Textarea
                    value={gate.failureNote ?? ''}
                    disabled={Boolean(actionBusy) || roleLoading}
                    onChange={(event) => onFailureNote(gate.id, event.target.value)}
                    placeholder="Failure note required for critical failures"
                    className="mt-3 min-h-20 text-sm"
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyPanel text="No QC gates are configured for this work order. Open the QC page after gates are generated from the active service plan." />
        )}

        {!signedIn && !roleLoading && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Sign in to submit QC results.
          </div>
        )}
        {criticalPending.length > 0 && (
          <div className="flex items-start gap-2 text-xs text-amber-700">
            <Info size={14} />
            {criticalPending.length} critical gate{criticalPending.length === 1 ? '' : 's'} still
            need a result.
          </div>
        )}
        {criticalFailMissingNote.length > 0 && (
          <div className="text-xs text-red-700">
            Critical failures require a note before submission.
          </div>
        )}
        <Button type="button" disabled={!canSubmit} onClick={onSubmit}>
          <ShieldCheck data-icon="inline-start" />
          {actionBusy === 'qc:submit' ? 'Submitting' : 'Submit QC'}
        </Button>
      </div>
    </div>
  );
}

function ActivityPanel({
  workOrder,
  timeEntries,
  qcGates,
}: {
  workOrder: WoOrderDetail;
  timeEntries: LaborTimeEntry[];
  qcGates: WorkOrderQcGate[];
}) {
  const items = [
    ...workOrder.reservations.map((reservation) => ({
      id: `reservation:${reservation.id}`,
      at: reservation.updatedAt,
      title: `${reservation.status.replace(/_/g, ' ')} reservation`,
      detail: `${reservation.partSku} · ${reservation.lotNumber ?? reservation.stockLotId ?? 'No lot'}`,
    })),
    ...timeEntries.map((entry) => ({
      id: `time:${entry.id}`,
      at: entry.startedAt,
      title: `${formatHours(Number(entry.computedHours ?? 0))}h labor logged`,
      detail: entry.description ?? entry.technicianId,
    })),
    ...qcGates
      .filter((gate) => gate.result)
      .map((gate) => ({
        id: `qc:${gate.id}`,
        at: gate.reviewedAt ?? gate.createdAt,
        title: `QC ${gate.result}`,
        detail: gate.gateLabel,
      })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 6);

  if (items.length === 0) {
    return (
      <p className="mt-3 text-sm text-gray-500">
        No material, labor, or QC activity has been recorded for this work order.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {items.map((item) => (
        <div key={item.id} className="border-l-2 border-[#E37125] pl-3">
          <div className="text-sm font-semibold text-gray-900">{item.title}</div>
          <div className="mt-0.5 text-xs text-gray-500">{item.detail}</div>
          <div className="mt-0.5 text-xs text-gray-400">{formatDateTime(item.at)}</div>
        </div>
      ))}
    </div>
  );
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
