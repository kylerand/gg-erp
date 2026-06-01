'use client';

import Link from 'next/link';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, CheckSquare, Download, FileUp, Plus, RefreshCw, X } from 'lucide-react';
import { PageHeader, EmptyState } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  cancelCapacitySlot,
  createCapacitySlot,
  getSchedulePreview,
  importCapacitySlots,
  listScheduleAssignments,
  listCapacitySlots,
  publishSchedule,
  type CapacitySlot,
  type CapacitySlotImportRow,
  type CapacitySlotListResponse,
  type CapacityStockLocationOption,
  type BuildSlotDemandItem,
  type BuildSlotDemandProjection,
  type BuildSlotProjectionSlot,
  type ScheduleAssignment,
  type SchedulePreviewResponse,
} from '@/lib/api-client';
import { downloadCsv, normalizeCsvHeader, parseCsv } from '@/lib/csv-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';

interface WeekDay {
  date: string;
  label: string;
  dayName: string;
}

interface WeekRange {
  start: string;
  end: string;
  days: WeekDay[];
}

interface TodayState {
  tone: 'green' | 'amber' | 'red' | 'neutral';
  headline: string;
  subhead: string;
}

interface QueuedAction {
  severity: 'high' | 'medium' | 'low' | 'info';
  title: string;
  detail: string;
  cta: string;
  href: string;
}

interface CapacityFormState {
  date: string;
  startTime: string;
  endTime: string;
  stockLocationId: string;
  bayCode: string;
  teamCode: string;
  capacityHours: string;
}

interface CapacityImportDraftRow extends CapacitySlotImportRow {
  rowNumber: number;
  status: 'READY' | 'INVALID' | 'IMPORTED' | 'FAILED';
  message?: string;
}

function getWeekDates(): WeekRange {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

  const days = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      date: d.toISOString().split('T')[0],
      label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      dayName: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][i],
    };
  });

  return { start: days[0].date, end: days[4].date, days };
}

function workOrderOperationHref(item: { workOrderId: string; operationId: string }): string {
  return erpRecordRoute('work-order', item.workOrderId, { operationId: item.operationId });
}

export default function BuildSlotPlannerPage() {
  const [projection, setProjection] = useState<BuildSlotDemandProjection | null>(null);
  const [schedulePreview, setSchedulePreview] = useState<SchedulePreviewResponse | null>(null);
  const [publishedAssignments, setPublishedAssignments] = useState<ScheduleAssignment[]>([]);
  const [capacity, setCapacity] = useState<CapacitySlotListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [capacityForm, setCapacityForm] = useState<CapacityFormState>(() => ({
    date: '',
    startTime: '08:00',
    endTime: '17:00',
    stockLocationId: '',
    bayCode: '',
    teamCode: 'BUILD',
    capacityHours: '8',
  }));
  const [savingCapacity, setSavingCapacity] = useState(false);
  const [capacityMessage, setCapacityMessage] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<CapacityImportDraftRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const week = useMemo(() => getWeekDates(), []);

  const loadPlannerData = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([
      getSchedulePreview(
        { startDate: week.start, endDate: week.end },
        { allowMockFallback: false },
      ),
      listCapacitySlots(
        { startDate: week.start, endDate: week.end, limit: 200 },
        { allowMockFallback: false },
      ),
      listScheduleAssignments(
        { startDate: week.start, endDate: week.end, state: 'PUBLISHED', limit: 200 },
        { allowMockFallback: false },
      ),
    ])
      .then(([previewData, capacityData, assignmentData]) => {
        if (cancelled) return;
        setSchedulePreview(previewData);
        setProjection(previewData.projection);
        setCapacity(capacityData);
        setPublishedAssignments(assignmentData.items);
        setCapacityForm((current) => ({
          ...current,
          date: current.date || week.start,
          stockLocationId: current.stockLocationId || capacityData.stockLocations[0]?.id || '',
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        setSchedulePreview(null);
        setProjection(null);
        setCapacity(null);
        setPublishedAssignments([]);
        setLoadError(error instanceof Error ? error.message : 'Unable to load build-slot demand.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [week.end, week.start]);

  useEffect(() => {
    return loadPlannerData();
  }, [loadPlannerData]);

  async function handleCreateCapacitySlot() {
    setSavingCapacity(true);
    setCapacityMessage(null);
    try {
      await createCapacitySlot(
        {
          slotStart: toLocalIso(capacityForm.date, capacityForm.startTime),
          slotEnd: toLocalIso(capacityForm.date, capacityForm.endTime),
          stockLocationId: capacityForm.stockLocationId,
          bayCode: capacityForm.bayCode.trim() || undefined,
          teamCode: capacityForm.teamCode.trim() || undefined,
          capacityMinutes: Math.round(Number(capacityForm.capacityHours) * 60),
        },
        { allowMockFallback: false },
      );
      setCapacityMessage('Capacity slot saved. Projection refreshed.');
      loadPlannerData();
    } catch (error) {
      setCapacityMessage(error instanceof Error ? error.message : 'Unable to save capacity slot.');
    } finally {
      setSavingCapacity(false);
    }
  }

  async function handleCancelCapacitySlot(slot: CapacitySlot) {
    setCapacityMessage(null);
    try {
      await cancelCapacitySlot(slot.id, { expectedVersion: slot.version }, { allowMockFallback: false });
      setCapacityMessage('Capacity slot cancelled. Projection refreshed.');
      loadPlannerData();
    } catch (error) {
      setCapacityMessage(error instanceof Error ? error.message : 'Unable to cancel capacity slot.');
    }
  }

  async function handleApplyImport() {
    const readyRows = importRows.filter((row) => row.status === 'READY');
    if (readyRows.length === 0) {
      setCapacityMessage('No valid capacity rows are ready to import.');
      return;
    }

    setImporting(true);
    setCapacityMessage(null);
    try {
      const result = await importCapacitySlots(
        {
          startDate: week.start,
          endDate: week.end,
          rows: readyRows.map(toImportPayloadRow),
        },
        { allowMockFallback: false },
      );
      const failedRows = new Map(result.errors.map((error) => [error.rowNumber, error.message]));
      setImportRows((rows) =>
        rows.map((row) => {
          const message = failedRows.get(row.rowNumber);
          if (message) return { ...row, status: 'FAILED', message };
          if (row.status === 'READY') return { ...row, status: 'IMPORTED', message: 'Imported' };
          return row;
        }),
      );
      setProjection(result.projection);
      const capacityData = await listCapacitySlots(
        { startDate: week.start, endDate: week.end, limit: 200 },
        { allowMockFallback: false },
      );
      setCapacity(capacityData);
      setCapacityMessage(
        `Capacity import complete: ${result.imported} new, ${result.updated} updated, ${result.skipped} skipped.`,
      );
      loadPlannerData();
    } catch (error) {
      setCapacityMessage(error instanceof Error ? error.message : 'Unable to import capacity slots.');
    } finally {
      setImporting(false);
    }
  }

  async function handlePublishSchedule() {
    setPublishing(true);
    setPublishMessage(null);
    try {
      const result = await publishSchedule(
        {
          startDate: week.start,
          endDate: week.end,
          notes: 'Published from Build Slot Planner',
        },
        { allowMockFallback: false },
      );
      setProjection(result.projection);
      setPublishedAssignments(result.assignments);
      setPublishMessage(
        `Published ${result.assignmentCount} operation${result.assignmentCount === 1 ? '' : 's'} (${formatMinutes(result.scheduledMinutes)}).`,
      );
      loadPlannerData();
    } catch (error) {
      setPublishMessage(error instanceof Error ? error.message : 'Unable to publish schedule.');
    } finally {
      setPublishing(false);
    }
  }

  function handleDownloadTemplate() {
    const location = capacity?.stockLocations[0];
    const rows = week.days.map((day) => ({
      date: day.date,
      startTime: '08:00',
      endTime: '17:00',
      locationCode: location?.locationCode ?? 'MAIN',
      bayCode: day.dayName === 'Mon' ? 'BAY-1' : '',
      teamCode: 'BUILD',
      capacityHours: 8,
    }));
    downloadCsv(`capacity-slots-${week.start}.csv`, rows, [
      { header: 'date', value: (row) => row.date },
      { header: 'startTime', value: (row) => row.startTime },
      { header: 'endTime', value: (row) => row.endTime },
      { header: 'locationCode', value: (row) => row.locationCode },
      { header: 'bayCode', value: (row) => row.bayCode },
      { header: 'teamCode', value: (row) => row.teamCode },
      { header: 'capacityHours', value: (row) => row.capacityHours },
    ]);
  }

  const slotsByDate = useMemo(() => groupSlotsByDate(projection?.slots ?? []), [projection]);
  const actions = useMemo(() => buildActionQueue(projection), [projection]);
  const todayState = useMemo(() => summarizeState(projection, actions.length), [projection, actions]);

  return (
    <div>
      <PageHeader
        title="Build Slot Planner"
        description={
          projection
            ? `Week of ${formatDateLabel(week.start)} to ${formatDateLabel(week.end)} · ${formatProjectionFreshness(projection)}`
            : `Week of ${formatDateLabel(week.start)} to ${formatDateLabel(week.end)}`
        }
        action={
          <Link
            href={erpRoute('dispatch-board')}
            className="inline-flex h-8 items-center justify-center rounded-lg bg-yellow-400 px-3 text-sm font-semibold text-gray-900 hover:bg-yellow-300"
          >
            Open dispatch
          </Link>
        }
      />

      <TodayBanner state={todayState} loading={loading} />

      {!loading && loadError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {loadError}
        </div>
      )}

      {!loading && projection && actions.length > 0 && <ActionQueue actions={actions} />}

      {!loadError && projection && schedulePreview && (
        <SchedulePublicationPanel
          assignments={publishedAssignments}
          message={publishMessage}
          preview={schedulePreview}
          publishing={publishing}
          onPublish={handlePublishSchedule}
        />
      )}

      {!loadError && (
        <CapacityManagementPanel
          capacity={capacity}
          form={capacityForm}
          importRows={importRows}
          importing={importing}
          loading={loading}
          message={capacityMessage}
          saving={savingCapacity}
          week={week}
          onApplyImport={handleApplyImport}
          onCancelSlot={handleCancelCapacitySlot}
          onDownloadTemplate={handleDownloadTemplate}
          onFormChange={setCapacityForm}
          onImportRowsChange={setImportRows}
          onRefresh={loadPlannerData}
          onSave={handleCreateCapacitySlot}
        />
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : loadError ? null : !projection ||
        (projection.totals.demandCount === 0 && projection.slots.length === 0) ? (
        <EmptyState
          title="No build demand"
          description="No active operations or capacity slots were found for this week."
          action={
            <Link
              href={erpRoute('work-order')}
              className="text-sm font-semibold text-gray-900 underline underline-offset-4"
            >
              Open work orders
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          <section className="grid grid-cols-1 gap-3 lg:grid-cols-5">
            {week.days.map((day) => (
              <DayColumn key={day.date} day={day} slots={slotsByDate.get(day.date) ?? []} />
            ))}
          </section>

          {projection.unscheduled.length > 0 && (
            <UnscheduledSection demand={projection.unscheduled} />
          )}

          <details className="mb-2">
            <summary className="cursor-pointer py-2 text-sm font-semibold text-gray-700 hover:text-gray-900">
              Reference: projection inputs ({projection.slots.length} slot
              {projection.slots.length === 1 ? '' : 's'}, {projection.totals.demandCount}{' '}
              operation{projection.totals.demandCount === 1 ? '' : 's'})
            </summary>
            <ProjectionTotals projection={projection} />
          </details>
        </div>
      )}
    </div>
  );
}

function SchedulePublicationPanel({
  assignments,
  message,
  preview,
  publishing,
  onPublish,
}: {
  assignments: ScheduleAssignment[];
  message: string | null;
  preview: SchedulePreviewResponse;
  publishing: boolean;
  onPublish: () => void;
}) {
  const canPublish = preview.totals.assignmentCount > 0 && !publishing;
  const hasOpenIssues = preview.totals.unscheduledCount > 0 || preview.totals.overCapacityMinutes > 0;

  return (
    <section id="schedule-publication" className="mb-6 rounded-lg border border-gray-200 bg-white">
      <header className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Schedule publication</h2>
          <p className="text-xs text-gray-500">
            Persist projected operations into work-order planned times and dispatch-ready slot assignments.
          </p>
        </div>
        <Button type="button" onClick={onPublish} disabled={!canPublish}>
          <CalendarCheck data-icon="inline-start" />
          {publishing ? 'Publishing...' : 'Publish schedule'}
        </Button>
      </header>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)]">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4 xl:grid-cols-2">
            <MetricPill label="Ready to publish" value={String(preview.totals.assignmentCount)} />
            <MetricPill label="Scheduled load" value={formatMinutes(preview.totals.scheduledMinutes)} />
            <MetricPill label="Unscheduled" value={String(preview.totals.unscheduledCount)} />
            <MetricPill label="Overflow" value={formatMinutes(preview.totals.overCapacityMinutes)} />
          </div>

          {hasOpenIssues && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Publishing will persist the operations that fit now. Overflow, blocked, material-short, or missing-estimate
              work remains in the action queue.
            </div>
          )}

          {message && (
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
              {message}
            </div>
          )}
        </div>

        <div className="rounded-md border border-gray-200">
          <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold text-gray-700">
            Published assignments
          </div>
          {assignments.length === 0 ? (
            <div className="p-3 text-xs text-gray-500">No published build assignments for this week yet.</div>
          ) : (
            <ul className="max-h-72 divide-y divide-gray-100 overflow-auto">
              {assignments.map((assignment) => (
                <li key={assignment.id} className="grid gap-2 px-3 py-2 text-xs md:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <Link
                      href={workOrderOperationHref(assignment)}
                      className="font-mono font-semibold text-gray-900 hover:underline"
                    >
                      #{assignment.workOrderNumber}
                    </Link>
                    <span className="ml-2 text-gray-700">{assignment.operationName}</span>
                    <div className="truncate text-gray-400">{assignment.title}</div>
                  </div>
                  <div className="text-gray-500 md:text-right">
                    <div>{formatTime(assignment.plannedStartAt)} to {formatTime(assignment.plannedEndAt)}</div>
                    <div>{assignment.stockLocationCode}{assignment.bayCode ? ` · ${assignment.bayCode}` : ''}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function CapacityManagementPanel({
  capacity,
  form,
  importRows,
  importing,
  loading,
  message,
  saving,
  week,
  onApplyImport,
  onCancelSlot,
  onDownloadTemplate,
  onFormChange,
  onImportRowsChange,
  onRefresh,
  onSave,
}: {
  capacity: CapacitySlotListResponse | null;
  form: CapacityFormState;
  importRows: CapacityImportDraftRow[];
  importing: boolean;
  loading: boolean;
  message: string | null;
  saving: boolean;
  week: WeekRange;
  onApplyImport: () => void;
  onCancelSlot: (slot: CapacitySlot) => void;
  onDownloadTemplate: () => void;
  onFormChange: (next: CapacityFormState | ((current: CapacityFormState) => CapacityFormState)) => void;
  onImportRowsChange: (rows: CapacityImportDraftRow[]) => void;
  onRefresh: () => void;
  onSave: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stockLocations = capacity?.stockLocations ?? [];
  const activeSlots = capacity?.items.filter((slot) => slot.slotStatus !== 'CANCELLED') ?? [];
  const readyRows = importRows.filter((row) => row.status === 'READY').length;
  const invalidRows = importRows.filter((row) => row.status === 'INVALID' || row.status === 'FAILED').length;
  const canSave =
    Boolean(form.date && form.startTime && form.endTime && form.stockLocationId) &&
    Number(form.capacityHours) > 0 &&
    !saving &&
    !loading;

  function updateForm<K extends keyof CapacityFormState>(field: K, value: CapacityFormState[K]) {
    onFormChange((current) => ({ ...current, [field]: value }));
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    onImportRowsChange(parseCapacityImportCsv(text, stockLocations));
    event.target.value = '';
  }

  return (
    <section id="capacity-management" className="mb-6 rounded-lg border border-gray-200 bg-white">
      <header className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Capacity management</h2>
          <p className="text-xs text-gray-500">
            Create or import real build slots for {formatDateLabel(week.start)} to{' '}
            {formatDateLabel(week.end)}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onDownloadTemplate} disabled={loading}>
            <Download data-icon="inline-start" />
            Template
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || importing}
          >
            <FileUp data-icon="inline-start" />
            Import CSV
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw data-icon="inline-start" />
            Refresh
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            aria-label="Import capacity CSV"
            onChange={handleFileChange}
          />
        </div>
      </header>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-xs font-semibold text-gray-600">
              Date
              <input
                type="date"
                value={form.date}
                onChange={(event) => updateForm('date', event.target.value)}
                className="h-9 w-full rounded-md border border-gray-300 px-2 text-sm font-normal text-gray-900"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-gray-600">
              Start
              <input
                type="time"
                value={form.startTime}
                onChange={(event) => updateForm('startTime', event.target.value)}
                className="h-9 w-full rounded-md border border-gray-300 px-2 text-sm font-normal text-gray-900"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-gray-600">
              End
              <input
                type="time"
                value={form.endTime}
                onChange={(event) => updateForm('endTime', event.target.value)}
                className="h-9 w-full rounded-md border border-gray-300 px-2 text-sm font-normal text-gray-900"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-gray-600">
              Hours
              <input
                type="number"
                min="0.25"
                step="0.25"
                value={form.capacityHours}
                onChange={(event) => updateForm('capacityHours', event.target.value)}
                className="h-9 w-full rounded-md border border-gray-300 px-2 text-sm font-normal text-gray-900"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <label className="space-y-1 text-xs font-semibold text-gray-600">
              Shop location
              <select
                value={form.stockLocationId}
                onChange={(event) => updateForm('stockLocationId', event.target.value)}
                className="h-9 w-full rounded-md border border-gray-300 px-2 text-sm font-normal text-gray-900"
              >
                <option value="">Select location</option>
                {stockLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.locationCode} · {location.locationName}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-gray-600">
              Bay
              <input
                value={form.bayCode}
                onChange={(event) => updateForm('bayCode', event.target.value)}
                placeholder="BAY-1"
                className="h-9 w-full rounded-md border border-gray-300 px-2 text-sm font-normal text-gray-900"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-gray-600">
              Team
              <input
                value={form.teamCode}
                onChange={(event) => updateForm('teamCode', event.target.value)}
                placeholder="BUILD"
                className="h-9 w-full rounded-md border border-gray-300 px-2 text-sm font-normal text-gray-900"
              />
            </label>
            <div className="flex items-end">
              <Button type="button" onClick={onSave} disabled={!canSave} className="w-full">
                <Plus data-icon="inline-start" />
                Add slot
              </Button>
            </div>
          </div>

          {message && (
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
              {message}
            </div>
          )}

          {importRows.length > 0 && (
            <div className="rounded-md border border-gray-200">
              <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2">
                <div className="text-xs font-semibold text-gray-700">
                  Import preview · {readyRows} ready · {invalidRows} needs review
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={onApplyImport}
                  disabled={readyRows === 0 || importing}
                >
                  <CheckSquare data-icon="inline-start" />
                  {importing ? 'Importing...' : 'Apply import'}
                </Button>
              </div>
              <div className="max-h-56 overflow-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Window</th>
                      <th className="px-3 py-2">Location</th>
                      <th className="px-3 py-2">Bay</th>
                      <th className="px-3 py-2">Hours</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {importRows.map((row) => (
                      <tr key={row.rowNumber}>
                        <td className="px-3 py-2 font-mono text-gray-500">{row.rowNumber}</td>
                        <td className="px-3 py-2">{row.date}</td>
                        <td className="px-3 py-2">
                          {row.startTime} to {row.endTime}
                        </td>
                        <td className="px-3 py-2">{row.locationCode || row.stockLocationId}</td>
                        <td className="px-3 py-2">{row.bayCode || '-'}</td>
                        <td className="px-3 py-2">{row.capacityHours ?? minutesToHours(row.capacityMinutes)}</td>
                        <td className="px-3 py-2">
                          <span className={importStatusClass(row.status)}>
                            {row.status === 'INVALID' || row.status === 'FAILED'
                              ? row.message
                              : row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-md border border-gray-200">
          <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold text-gray-700">
            Current capacity slots
          </div>
          {activeSlots.length === 0 ? (
            <div className="p-3 text-xs text-gray-500">No active slots configured for this week.</div>
          ) : (
            <ul className="max-h-80 divide-y divide-gray-100 overflow-auto">
              {activeSlots.map((slot) => (
                <li key={slot.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-gray-900">
                      {slot.stockLocationCode}
                      {slot.bayCode ? ` · ${slot.bayCode}` : ''} · {formatMinutes(slot.capacityMinutes)}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {formatDateLabel(slot.date)} · {formatSlotWindow(slot)}
                    </div>
                    <div className="text-[11px] text-gray-400">
                      {slot.teamCode || 'No team'} · {slot.slotStatus} · {formatMinutes(slot.remainingMinutes)} open
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title="Cancel capacity slot"
                    aria-label={`Cancel capacity slot ${slot.stockLocationCode} ${formatSlotWindow(slot)}`}
                    onClick={() => onCancelSlot(slot)}
                    disabled={slot.allocatedMinutes > 0}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function DayColumn({ day, slots }: { day: WeekDay; slots: BuildSlotProjectionSlot[] }) {
  const capacityMinutes = slots.reduce((sum, slot) => sum + slot.capacityMinutes, 0);
  const demandMinutes = slots.reduce((sum, slot) => sum + slot.projectedDemandMinutes, 0);
  const assignedCount = slots.reduce((sum, slot) => sum + slot.demand.length, 0);
  const pct = capacityMinutes > 0 ? Math.round((demandMinutes / capacityMinutes) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-2 pt-3">
        <CardTitle className="text-xs font-semibold text-gray-700">
          {day.dayName} {day.label}
        </CardTitle>
        <p className="text-xs text-gray-400">
          {assignedCount} operation{assignedCount === 1 ? '' : 's'}
        </p>
      </CardHeader>
      <CardContent>
        {slots.length === 0 ? (
          <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
            No capacity slot configured
          </div>
        ) : (
          <div className="space-y-3">
            <UtilizationBar pct={pct} overCapacity={demandMinutes > capacityMinutes} />
            <p className="text-xs text-gray-500">
              {formatMinutes(demandMinutes)} / {formatMinutes(capacityMinutes)}
            </p>
            {slots.map((slot) => (
              <SlotPanel key={slot.slotId} slot={slot} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SlotPanel({ slot }: { slot: BuildSlotProjectionSlot }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-gray-800">
            {slot.bayCode || slot.teamCode || 'Shop capacity'}
          </div>
          <div className="text-[11px] text-gray-400">
            {formatTime(slot.slotStart)} to {formatTime(slot.slotEnd)} · {slot.status}
          </div>
        </div>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
          {slot.utilizationPct}%
        </span>
      </div>
      <div className="mt-2">
        <UtilizationBar pct={slot.utilizationPct} overCapacity={slot.overCapacityMinutes > 0} />
      </div>
      <div className="mt-2 space-y-1">
        {slot.demand.length === 0 ? (
          <span className="text-xs text-gray-300">No projected operations</span>
        ) : (
          slot.demand.map((item) => <DemandLink key={item.operationId} item={item} />)
        )}
      </div>
    </div>
  );
}

function DemandLink({ item }: { item: BuildSlotDemandItem }) {
  return (
    <Link
      href={workOrderOperationHref(item)}
      className="block rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"
      title={`${item.operationName} · ${formatMinutes(item.estimatedMinutes)}`}
    >
      <span className="font-mono">#{item.workOrderNumber}</span>
      <span className="ml-1 text-gray-500">{item.operationName}</span>
    </Link>
  );
}

function UnscheduledSection({ demand }: { demand: BuildSlotDemandItem[] }) {
  return (
    <section id="unscheduled-demand" className="rounded-lg border border-gray-200 bg-white">
      <header className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-base font-semibold text-gray-900">Unscheduled demand</h2>
        <p className="text-xs text-gray-500">
          Operations that cannot fit or should not be scheduled from the current snapshot.
        </p>
      </header>
      <ul className="divide-y divide-gray-100">
        {demand.map((item) => (
          <li
            key={item.operationId}
            className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1fr_auto_auto]"
          >
            <div className="min-w-0">
              <Link
                href={workOrderOperationHref(item)}
                className="font-mono text-xs font-semibold text-gray-900 hover:underline"
              >
                #{item.workOrderNumber}
              </Link>
              <div className="truncate text-gray-700">{item.operationName}</div>
              <div className="text-xs text-gray-400">{item.title}</div>
            </div>
            <span className="text-xs text-gray-500">{formatMinutes(item.estimatedMinutes)}</span>
            <ReasonBadge reason={item.reason} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProjectionTotals({ projection }: { projection: BuildSlotDemandProjection }) {
  const rows = [
    ['Demand', formatMinutes(projection.totals.demandMinutes)],
    ['Capacity', formatMinutes(projection.totals.capacityMinutes)],
    ['Allocated', formatMinutes(projection.totals.allocatedMinutes)],
    ['Projected', formatMinutes(projection.totals.projectedDemandMinutes)],
    ['Remaining', formatMinutes(projection.totals.remainingMinutes)],
    ['Unscheduled', formatMinutes(projection.totals.unscheduledDemandMinutes)],
    ['Conflicts', String(projection.conflicts.length)],
    ['Freshness', formatFreshnessSummary(projection)],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-4 xl:grid-cols-8">
      {rows.map(([label, value]) => (
        <div key={label}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {label}
          </div>
          <div className="mt-1 text-sm font-semibold text-gray-900">{value}</div>
        </div>
      ))}
    </div>
  );
}

function TodayBanner({ state, loading }: { state: TodayState; loading: boolean }) {
  if (loading) {
    return (
      <div className="mb-6 animate-pulse rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="h-5 w-64 rounded bg-gray-200" />
        <div className="mt-2 h-3 w-96 max-w-full rounded bg-gray-100" />
      </div>
    );
  }
  const toneStyles: Record<TodayState['tone'], string> = {
    green: 'bg-green-50 border-green-200 text-green-900',
    amber: 'bg-yellow-50 border-yellow-200 text-yellow-900',
    red: 'bg-red-50 border-red-200 text-red-900',
    neutral: 'bg-gray-50 border-gray-200 text-gray-900',
  };
  return (
    <div className={`mb-4 rounded-lg border p-4 ${toneStyles[state.tone]}`}>
      <div className="text-base font-semibold">{state.headline}</div>
      <div className="mt-1 text-sm opacity-80">{state.subhead}</div>
    </div>
  );
}

function ActionQueue({ actions }: { actions: QueuedAction[] }) {
  return (
    <div className="mb-6 space-y-2">
      {actions.map((action) => (
        <ActionRow key={`${action.title}-${action.href}`} action={action} />
      ))}
    </div>
  );
}

function ActionRow({ action }: { action: QueuedAction }) {
  const styles: Record<QueuedAction['severity'], { dot: string; border: string }> = {
    high: { dot: 'bg-red-500', border: 'border-red-200 bg-red-50/50' },
    medium: { dot: 'bg-amber-500', border: 'border-amber-200 bg-amber-50/50' },
    low: { dot: 'bg-blue-500', border: 'border-blue-200 bg-blue-50/50' },
    info: { dot: 'bg-green-500', border: 'border-green-200 bg-green-50/30' },
  };
  const style = styles[action.severity];
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-4 ${style.border}`}>
      <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${style.dot}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-gray-900">{action.title}</div>
        <p className="mt-1 text-xs text-gray-600">{action.detail}</p>
      </div>
      <Link
        href={action.href}
        className="flex-shrink-0 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:border-gray-500 hover:bg-gray-50"
      >
        {action.cta}
      </Link>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="h-48 animate-pulse rounded-lg border border-gray-200 bg-gray-50" />
      ))}
    </div>
  );
}

function UtilizationBar({ pct, overCapacity }: { pct: number; overCapacity: boolean }) {
  const bar = overCapacity ? 'bg-red-500' : pct >= 90 ? 'bg-yellow-400' : 'bg-green-400';
  return (
    <div className={`h-2 w-full rounded-full ${overCapacity ? 'bg-red-200' : 'bg-gray-200'}`}>
      <div
        className={`h-2 rounded-full transition-all ${bar}`}
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
      />
    </div>
  );
}

function ReasonBadge({ reason }: { reason: BuildSlotDemandItem['reason'] }) {
  const styles: Record<BuildSlotDemandItem['reason'], string> = {
    PROJECTED_TO_SLOT: 'bg-green-50 text-green-700 border-green-200',
    NO_CAPACITY: 'bg-red-50 text-red-700 border-red-200',
    OVER_CAPACITY: 'bg-red-50 text-red-700 border-red-200',
    MATERIAL_NOT_READY: 'bg-amber-50 text-amber-700 border-amber-200',
    OPERATION_BLOCKED: 'bg-gray-100 text-gray-700 border-gray-200',
    MISSING_ESTIMATE: 'bg-blue-50 text-blue-700 border-blue-200',
  };
  return (
    <span className={`rounded border px-2 py-1 text-[11px] font-semibold ${styles[reason]}`}>
      {formatReason(reason)}
    </span>
  );
}

function summarizeState(
  projection: BuildSlotDemandProjection | null,
  actionCount: number,
): TodayState {
  if (!projection) {
    return {
      tone: 'neutral',
      headline: 'Loading build-slot demand.',
      subhead: 'Reading live capacity slots and work-order operations.',
    };
  }
  if (projection.totals.demandCount === 0) {
    return {
      tone: 'green',
      headline: 'No active build operations need scheduling this week.',
      subhead: 'The board will populate when work orders have open operations.',
    };
  }
  if (projection.totals.unscheduledCount > 0) {
    const tone: TodayState['tone'] =
      projection.totals.overCapacityMinutes > 0 || projection.source.capacitySource === 'none'
        ? 'red'
        : 'amber';
    return {
      tone,
      headline: `${projection.totals.unscheduledCount} operation${projection.totals.unscheduledCount === 1 ? '' : 's'} need planner action.`,
      subhead: `${formatMinutes(projection.totals.unscheduledDemandMinutes)} unscheduled. Action queue lists the top ${actionCount} issue${actionCount === 1 ? '' : 's'}.`,
    };
  }
  return {
    tone: 'green',
    headline: 'Projected work fits the available build slots.',
    subhead: `${formatMinutes(projection.totals.projectedDemandMinutes)} scheduled against ${formatMinutes(projection.totals.capacityMinutes)} capacity.`,
  };
}

function buildActionQueue(projection: BuildSlotDemandProjection | null): QueuedAction[] {
  if (!projection) return [];
  const actions: QueuedAction[] = [];
  const noCapacityConflict = projection.conflicts.find(
    (conflict) => conflict.code === 'NO_CAPACITY' && !conflict.operationId,
  );
  const overCapacityConflict = projection.conflicts.find(
    (conflict) => conflict.code === 'OVER_CAPACITY',
  );

  if (noCapacityConflict) {
    actions.push({
      severity: 'high',
      title: 'Capacity slots are not configured for this week',
      detail: `${formatMinutes(projection.totals.demandMinutes)} of operation demand cannot be placed until planner capacity is loaded. ${projection.conflicts.length} conflict${projection.conflicts.length === 1 ? '' : 's'} in the projection payload.`,
      cta: 'Import capacity',
      href: '#capacity-management',
    });
  } else if (overCapacityConflict) {
    actions.push({
      severity: 'high',
      title: `${formatMinutes(projection.totals.overCapacityMinutes)} over capacity`,
      detail: 'Add capacity, move work to another week, or resolve lower-priority overflow before publishing a schedule.',
      cta: 'Review overflow',
      href: '#unscheduled-demand',
    });
  }

  if (projection.totals.blockedByMaterialCount > 0) {
    actions.push({
      severity: 'medium',
      title: `${projection.totals.blockedByMaterialCount} operation${projection.totals.blockedByMaterialCount === 1 ? '' : 's'} blocked by material readiness`,
      detail: 'Material status is not ready, so the projection keeps those operations out of capacity slots.',
      cta: 'Open material plan',
      href: erpRoute('material-planning'),
    });
  }

  if (projection.totals.blockedOperationCount > 0) {
    actions.push({
      severity: 'medium',
      title: `${projection.totals.blockedOperationCount} blocked operation${projection.totals.blockedOperationCount === 1 ? '' : 's'}`,
      detail: 'Resolve the work-order blocker before these operations can be scheduled.',
      cta: 'Open blocked work',
      href: erpRoute('blocked-work', { status: 'BLOCKED' }),
    });
  }

  if (projection.totals.missingEstimateCount > 0) {
    actions.push({
      severity: 'low',
      title: `${projection.totals.missingEstimateCount} operation${projection.totals.missingEstimateCount === 1 ? '' : 's'} missing labor estimates`,
      detail: 'Add estimated minutes so planner capacity can account for the work.',
      cta: 'Open work orders',
      href: erpRoute('work-order'),
    });
  }

  return actions.slice(0, 4);
}

function formatProjectionFreshness(projection: BuildSlotDemandProjection): string {
  const generated = new Date(projection.freshness.generatedAt).toLocaleString();
  const source = projection.freshness.latestSourceUpdatedAt
    ? `latest source ${new Date(projection.freshness.latestSourceUpdatedAt).toLocaleString()}`
    : 'no source update timestamp';
  return `snapshot ${generated} · ${source}`;
}

function formatFreshnessSummary(projection: BuildSlotDemandProjection): string {
  if (projection.freshness.state === 'NO_SOURCE') return 'No source timestamp';
  return `Live · ${formatLag(projection.freshness.sourceLagSeconds)}`;
}

function formatLag(seconds: number): string {
  if (seconds < 60) return `${seconds}s lag`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m lag`;
}

function groupSlotsByDate(slots: BuildSlotProjectionSlot[]): Map<string, BuildSlotProjectionSlot[]> {
  const grouped = new Map<string, BuildSlotProjectionSlot[]>();
  for (const slot of slots) {
    const current = grouped.get(slot.date) ?? [];
    current.push(slot);
    grouped.set(slot.date, current);
  }
  return grouped;
}

function parseCapacityImportCsv(
  text: string,
  stockLocations: CapacityStockLocationOption[],
): CapacityImportDraftRow[] {
  const csvRows = parseCsv(text);
  if (csvRows.length < 2) return [];

  const headers = csvRows[0].map(normalizeCsvHeader);
  const indexByHeader = new Map(headers.map((header, index) => [header, index]));
  const knownLocationCodes = new Set(stockLocations.map((location) => location.locationCode.toLowerCase()));
  const cell = (row: string[], header: string) => row[indexByHeader.get(header) ?? -1]?.trim() || undefined;

  return csvRows.slice(1).map((row, index) => {
    const draft: CapacityImportDraftRow = {
      rowNumber: index + 2,
      date: cell(row, 'date'),
      startTime: cell(row, 'starttime'),
      endTime: cell(row, 'endtime'),
      locationCode: cell(row, 'locationcode'),
      stockLocationId: cell(row, 'stocklocationid'),
      bayCode: cell(row, 'baycode'),
      teamCode: cell(row, 'teamcode'),
      capacityHours: Number(cell(row, 'capacityhours') ?? 0),
      status: 'READY',
    };

    const errors: string[] = [];
    if (!draft.date || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors.push('date');
    if (!draft.startTime || !/^\d{2}:\d{2}$/.test(draft.startTime)) errors.push('startTime');
    if (!draft.endTime || !/^\d{2}:\d{2}$/.test(draft.endTime)) errors.push('endTime');
    if (!draft.stockLocationId && !draft.locationCode) errors.push('location');
    if (
      draft.locationCode &&
      knownLocationCodes.size > 0 &&
      !knownLocationCodes.has(draft.locationCode.toLowerCase())
    ) {
      errors.push('known locationCode');
    }
    if (!draft.capacityHours || draft.capacityHours <= 0) errors.push('capacityHours');

    return errors.length > 0
      ? { ...draft, status: 'INVALID', message: `Check ${errors.join(', ')}` }
      : draft;
  });
}

function toImportPayloadRow(row: CapacityImportDraftRow): CapacitySlotImportRow {
  return {
    rowNumber: row.rowNumber,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    stockLocationId: row.stockLocationId,
    locationCode: row.locationCode,
    bayCode: row.bayCode,
    teamCode: row.teamCode,
    capacityHours: row.capacityHours,
  };
}

function toLocalIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

function formatSlotWindow(slot: CapacitySlot): string {
  return `${formatTime(slot.slotStart)} to ${formatTime(slot.slotEnd)}`;
}

function minutesToHours(minutes?: number): string {
  if (!minutes) return '';
  return String(minutes / 60);
}

function importStatusClass(status: CapacityImportDraftRow['status']): string {
  const styles: Record<CapacityImportDraftRow['status'], string> = {
    READY: 'rounded border border-green-200 bg-green-50 px-2 py-1 font-semibold text-green-700',
    INVALID: 'rounded border border-red-200 bg-red-50 px-2 py-1 font-semibold text-red-700',
    IMPORTED: 'rounded border border-blue-200 bg-blue-50 px-2 py-1 font-semibold text-blue-700',
    FAILED: 'rounded border border-red-200 bg-red-50 px-2 py-1 font-semibold text-red-700',
  };
  return styles[status];
}

function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) return '0h';
  const hours = minutes / 60;
  if (hours === 0) return '0h';
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${hours.toFixed(1)}h`;
}

function formatDateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatReason(reason: BuildSlotDemandItem['reason']): string {
  const labels: Record<BuildSlotDemandItem['reason'], string> = {
    PROJECTED_TO_SLOT: 'Projected',
    NO_CAPACITY: 'No capacity',
    OVER_CAPACITY: 'Overflow',
    MATERIAL_NOT_READY: 'Material',
    OPERATION_BLOCKED: 'Blocked',
    MISSING_ESTIMATE: 'No estimate',
  };
  return labels[reason];
}
