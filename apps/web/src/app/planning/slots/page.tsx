'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader, EmptyState } from '@gg-erp/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getBuildSlotDemandProjection,
  type BuildSlotDemandItem,
  type BuildSlotDemandProjection,
  type BuildSlotProjectionSlot,
} from '@/lib/api-client';
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

export default function BuildSlotPlannerPage() {
  const [projection, setProjection] = useState<BuildSlotDemandProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const week = useMemo(() => getWeekDates(), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    getBuildSlotDemandProjection(
      { startDate: week.start, endDate: week.end },
      { allowMockFallback: false },
    )
      .then((data) => {
        if (cancelled) return;
        setProjection(data);
      })
      .catch((error) => {
        if (cancelled) return;
        setProjection(null);
        setLoadError(error instanceof Error ? error.message : 'Unable to load build-slot demand.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [week.start, week.end]);

  const slotsByDate = useMemo(() => groupSlotsByDate(projection?.slots ?? []), [projection]);
  const actions = useMemo(() => buildActionQueue(projection), [projection]);
  const todayState = useMemo(() => summarizeState(projection, actions.length), [projection, actions]);

  return (
    <div>
      <PageHeader
        title="Build Slot Planner"
        description={
          projection
            ? `Week of ${formatDateLabel(week.start)} to ${formatDateLabel(week.end)} · snapshot ${new Date(projection.generatedAt).toLocaleString()}`
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
      href={erpRecordRoute('work-order', item.workOrderId)}
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
                href={erpRecordRoute('work-order', item.workOrderId)}
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
  ];
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-6">
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

  if (projection.source.capacitySource === 'none' && projection.totals.demandCount > 0) {
    actions.push({
      severity: 'high',
      title: 'Capacity slots are not configured for this week',
      detail: `${formatMinutes(projection.totals.demandMinutes)} of operation demand cannot be placed until planner capacity is loaded.`,
      cta: 'Review demand',
      href: '#unscheduled-demand',
    });
  } else if (projection.totals.overCapacityMinutes > 0) {
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

function groupSlotsByDate(slots: BuildSlotProjectionSlot[]): Map<string, BuildSlotProjectionSlot[]> {
  const grouped = new Map<string, BuildSlotProjectionSlot[]>();
  for (const slot of slots) {
    const current = grouped.get(slot.date) ?? [];
    current.push(slot);
    grouped.set(slot.date, current);
  }
  return grouped;
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
