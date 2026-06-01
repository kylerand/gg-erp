import { computeDeterministicSchedule } from '../../../../../packages/scheduling/src/index.js';

export type MaterialReadiness = 'READY' | 'PARTIAL' | 'NOT_READY';

export type BuildSlotDemandReason =
  | 'PROJECTED_TO_SLOT'
  | 'NO_CAPACITY'
  | 'OVER_CAPACITY'
  | 'MATERIAL_NOT_READY'
  | 'OPERATION_BLOCKED'
  | 'MISSING_ESTIMATE';

export interface BuildSlotDemandInput {
  workOrderId: string;
  workOrderNumber: string;
  title: string;
  status: string;
  priority: number;
  dueAt?: string;
  materialReadiness: MaterialReadiness;
  operationId: string;
  operationCode: string;
  operationName: string;
  sequenceNo: number;
  operationStatus: string;
  requiredSkillCode?: string;
  estimatedMinutes: number;
  plannedStartAt?: string;
  plannedEndAt?: string;
  updatedAt?: string;
}

export interface BuildSlotCapacityInput {
  slotId: string;
  slotStart: string;
  slotEnd: string;
  stockLocationId?: string;
  bayCode?: string;
  teamCode?: string;
  status: string;
  capacityMinutes: number;
  allocatedMinutes: number;
  updatedAt?: string;
}

export interface BuildSlotDemandItem extends BuildSlotDemandInput {
  reason: BuildSlotDemandReason;
}

export interface BuildSlotProjectionWarning {
  code: 'OVER_CAPACITY' | 'MISSING_ESTIMATE' | 'NO_SLOT' | 'UNSCHEDULED' | 'BLOCKED';
  message: string;
}

export interface BuildSlotProjectionFreshness {
  state: 'LIVE' | 'NO_SOURCE';
  generatedAt: string;
  latestCapacityUpdatedAt?: string;
  latestDemandUpdatedAt?: string;
  latestSourceUpdatedAt?: string;
  sourceLagSeconds: number;
  staleAfterSeconds: number;
}

export type BuildSlotProjectionConflictCode =
  | 'NO_CAPACITY'
  | 'OVER_CAPACITY'
  | 'MATERIAL_NOT_READY'
  | 'OPERATION_BLOCKED'
  | 'MISSING_ESTIMATE';

export interface BuildSlotProjectionConflict {
  code: BuildSlotProjectionConflictCode;
  severity: 'high' | 'medium' | 'low';
  message: string;
  workOrderId?: string;
  workOrderNumber?: string;
  operationId?: string;
  capacitySlotId?: string;
  reason?: BuildSlotDemandReason;
}

export interface BuildSlotProjectionSlot {
  slotId: string;
  date: string;
  slotStart: string;
  slotEnd: string;
  stockLocationId?: string;
  bayCode?: string;
  teamCode?: string;
  status: string;
  capacityMinutes: number;
  allocatedMinutes: number;
  projectedDemandMinutes: number;
  remainingMinutes: number;
  overCapacityMinutes: number;
  utilizationPct: number;
  updatedAt?: string;
  demand: BuildSlotDemandItem[];
  warnings: BuildSlotProjectionWarning[];
}

export interface BuildSlotDemandProjection {
  startDate: string;
  endDate: string;
  generatedAt: string;
  source: {
    workOrderStatuses: string[];
    operationStatuses: string[];
    capacitySource: 'planning.capacity_slots' | 'none';
  };
  totals: {
    demandMinutes: number;
    capacityMinutes: number;
    allocatedMinutes: number;
    projectedDemandMinutes: number;
    remainingMinutes: number;
    unscheduledDemandMinutes: number;
    overCapacityMinutes: number;
    demandCount: number;
    scheduledCount: number;
    unscheduledCount: number;
    blockedByMaterialCount: number;
    blockedOperationCount: number;
    missingEstimateCount: number;
  };
  freshness: BuildSlotProjectionFreshness;
  conflicts: BuildSlotProjectionConflict[];
  slots: BuildSlotProjectionSlot[];
  unscheduled: BuildSlotDemandItem[];
  warnings: BuildSlotProjectionWarning[];
}

export interface BuildSlotScheduleAssignment {
  workOrderId: string;
  workOrderNumber: string;
  title: string;
  status: string;
  priority: number;
  dueAt?: string;
  materialReadiness: MaterialReadiness;
  operationId: string;
  operationCode: string;
  operationName: string;
  operationSequenceNo: number;
  operationStatus: string;
  requiredSkillCode?: string;
  estimatedMinutes: number;
  capacitySlotId: string;
  slotStart: string;
  slotEnd: string;
  stockLocationId?: string;
  bayCode?: string;
  teamCode?: string;
  plannedStartAt: string;
  plannedEndAt: string;
  slotSequenceNo: number;
  reason: 'PROJECTED_TO_SLOT';
}

export interface BuildSlotDemandProjectionInput {
  startDate: string;
  endDate: string;
  generatedAt?: string;
  slots: BuildSlotCapacityInput[];
  demand: BuildSlotDemandInput[];
}

const TERMINAL_OPERATION_STATUSES = new Set(['DONE', 'SKIPPED', 'CANCELLED']);

export function buildSlotDemandProjection(
  input: BuildSlotDemandProjectionInput,
): BuildSlotDemandProjection {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const slots = [...input.slots].sort(compareSlots);
  const demand = [...input.demand]
    .filter((item) => !TERMINAL_OPERATION_STATUSES.has(item.operationStatus))
    .sort(compareDemand);

  const slotById = new Map(slots.map((slot) => [slot.slotId, slot]));
  const slotDemand = new Map<string, BuildSlotDemandItem[]>(
    slots.map((slot) => [slot.slotId, []]),
  );

  const unscheduled: BuildSlotDemandItem[] = [];
  const schedulable = demand.filter((item) => {
    const reason = getUnschedulableReason(item);
    if (!reason) return true;
    unscheduled.push({ ...item, reason });
    return false;
  });

  if (slots.length === 0) {
    for (const item of schedulable) {
      unscheduled.push({ ...item, reason: 'NO_CAPACITY' });
    }
  } else {
    const schedule = computeDeterministicSchedule(
      schedulable.map((item) => ({
        workOrderId: item.workOrderId,
        operationId: item.operationId,
        estimatedHours: item.estimatedMinutes / 60,
        priority: item.priority,
        dueAt: item.dueAt,
      })),
      slots.map((slot) => ({
        slotId: slot.slotId,
        startsAt: slot.slotStart,
        availableHours: Math.max(slot.capacityMinutes - slot.allocatedMinutes, 0) / 60,
      })),
    );

    const demandByOperationId = new Map(schedulable.map((item) => [item.operationId, item]));
    for (const assignment of schedule.assignments) {
      const item = demandByOperationId.get(assignment.operationId);
      const slot = slotById.get(assignment.slotId);
      if (!item || !slot) continue;
      slotDemand.get(slot.slotId)?.push({ ...item, reason: 'PROJECTED_TO_SLOT' });
    }
    for (const item of schedule.unassigned) {
      const demandItem = demandByOperationId.get(item.operationId);
      if (!demandItem) continue;
      unscheduled.push({ ...demandItem, reason: 'OVER_CAPACITY' });
    }
  }

  const projectedSlots = slots.map((slot): BuildSlotProjectionSlot => {
    const assigned = (slotDemand.get(slot.slotId) ?? []).sort(compareDemand);
    const projectedDemandMinutes = assigned.reduce((sum, item) => sum + item.estimatedMinutes, 0);
    const capacityMinutes = Math.max(slot.capacityMinutes, 0);
    const allocatedMinutes = Math.max(slot.allocatedMinutes, 0);
    const consumedMinutes = allocatedMinutes + projectedDemandMinutes;
    const overCapacityMinutes = Math.max(consumedMinutes - capacityMinutes, 0);
    const remainingMinutes = Math.max(capacityMinutes - consumedMinutes, 0);
    const warnings: BuildSlotProjectionWarning[] = [];

    if (overCapacityMinutes > 0) {
      warnings.push({
        code: 'OVER_CAPACITY',
        message: `${overCapacityMinutes} projected minute${overCapacityMinutes === 1 ? '' : 's'} exceed capacity.`,
      });
    }

    return {
      slotId: slot.slotId,
      date: toDateKey(slot.slotStart),
      slotStart: slot.slotStart,
      slotEnd: slot.slotEnd,
      stockLocationId: slot.stockLocationId,
      bayCode: slot.bayCode,
      teamCode: slot.teamCode,
      status: slot.status,
      capacityMinutes,
      allocatedMinutes,
      projectedDemandMinutes,
      remainingMinutes,
      overCapacityMinutes,
      utilizationPct:
        capacityMinutes > 0 ? Math.round((consumedMinutes / capacityMinutes) * 100) : 0,
      updatedAt: slot.updatedAt,
      demand: assigned,
      warnings,
    };
  });

  const demandMinutes = demand.reduce((sum, item) => sum + Math.max(item.estimatedMinutes, 0), 0);
  const capacityMinutes = projectedSlots.reduce((sum, slot) => sum + slot.capacityMinutes, 0);
  const allocatedMinutes = projectedSlots.reduce((sum, slot) => sum + slot.allocatedMinutes, 0);
  const projectedDemandMinutes = projectedSlots.reduce(
    (sum, slot) => sum + slot.projectedDemandMinutes,
    0,
  );
  const remainingMinutes = projectedSlots.reduce((sum, slot) => sum + slot.remainingMinutes, 0);
  const unscheduledDemandMinutes = unscheduled.reduce(
    (sum, item) => sum + Math.max(item.estimatedMinutes, 0),
    0,
  );
  const computedOverCapacityMinutes = Math.max(
    demandMinutes - Math.max(capacityMinutes - allocatedMinutes, 0),
    0,
  );
  const overCapacityMinutes =
    projectedSlots.reduce((sum, slot) => sum + slot.overCapacityMinutes, 0) ||
    computedOverCapacityMinutes;

  const topWarnings: BuildSlotProjectionWarning[] = [];
  if (slots.length === 0 && demand.length > 0) {
    topWarnings.push({
      code: 'NO_SLOT',
      message: 'No capacity slots exist for this date range.',
    });
  }
  const missingEstimateCount = unscheduled.filter((item) => item.reason === 'MISSING_ESTIMATE')
    .length;
  if (missingEstimateCount > 0) {
    topWarnings.push({
      code: 'MISSING_ESTIMATE',
      message: `${missingEstimateCount} operation${missingEstimateCount === 1 ? '' : 's'} need labor estimates.`,
    });
  }
  const sortedUnscheduled = unscheduled.sort(compareDemand);

  return {
    startDate: input.startDate,
    endDate: input.endDate,
    generatedAt,
    source: {
      workOrderStatuses: uniqueSorted(demand.map((item) => item.status)),
      operationStatuses: uniqueSorted(demand.map((item) => item.operationStatus)),
      capacitySource: slots.length > 0 ? 'planning.capacity_slots' : 'none',
    },
    totals: {
      demandMinutes,
      capacityMinutes,
      allocatedMinutes,
      projectedDemandMinutes,
      remainingMinutes,
      unscheduledDemandMinutes,
      overCapacityMinutes,
      demandCount: demand.length,
      scheduledCount: projectedSlots.reduce((sum, slot) => sum + slot.demand.length, 0),
      unscheduledCount: unscheduled.length,
      blockedByMaterialCount: unscheduled.filter((item) => item.reason === 'MATERIAL_NOT_READY')
        .length,
      blockedOperationCount: unscheduled.filter((item) => item.reason === 'OPERATION_BLOCKED')
        .length,
      missingEstimateCount,
    },
    freshness: buildFreshness({ generatedAt, slots, demand }),
    conflicts: buildConflicts({
      demand,
      slots,
      projectedSlots,
      unscheduled: sortedUnscheduled,
    }),
    slots: projectedSlots,
    unscheduled: sortedUnscheduled,
    warnings: topWarnings,
  };
}

export function buildScheduleAssignmentsFromProjection(
  projection: BuildSlotDemandProjection,
): BuildSlotScheduleAssignment[] {
  return [...projection.slots]
    .sort(compareProjectionSlots)
    .flatMap((slot) => {
      let cursorMs =
        new Date(slot.slotStart).getTime() + Math.max(slot.allocatedMinutes, 0) * 60_000;
      return slot.demand.map((item, index): BuildSlotScheduleAssignment => {
        const plannedStartAt = new Date(cursorMs).toISOString();
        cursorMs += Math.max(item.estimatedMinutes, 0) * 60_000;
        const plannedEndAt = new Date(cursorMs).toISOString();
        return {
          workOrderId: item.workOrderId,
          workOrderNumber: item.workOrderNumber,
          title: item.title,
          status: item.status,
          priority: item.priority,
          dueAt: item.dueAt,
          materialReadiness: item.materialReadiness,
          operationId: item.operationId,
          operationCode: item.operationCode,
          operationName: item.operationName,
          operationSequenceNo: item.sequenceNo,
          operationStatus: item.operationStatus,
          requiredSkillCode: item.requiredSkillCode,
          estimatedMinutes: item.estimatedMinutes,
          capacitySlotId: slot.slotId,
          slotStart: slot.slotStart,
          slotEnd: slot.slotEnd,
          stockLocationId: slot.stockLocationId,
          bayCode: slot.bayCode,
          teamCode: slot.teamCode,
          plannedStartAt,
          plannedEndAt,
          slotSequenceNo: index + 1,
          reason: 'PROJECTED_TO_SLOT',
        };
      });
    });
}

function getUnschedulableReason(item: BuildSlotDemandInput): BuildSlotDemandReason | undefined {
  if (item.estimatedMinutes <= 0) return 'MISSING_ESTIMATE';
  if (item.operationStatus === 'BLOCKED') return 'OPERATION_BLOCKED';
  if (item.materialReadiness !== 'READY') return 'MATERIAL_NOT_READY';
  return undefined;
}

function compareSlots(left: BuildSlotCapacityInput, right: BuildSlotCapacityInput): number {
  return (
    left.slotStart.localeCompare(right.slotStart) ||
    (left.bayCode ?? '').localeCompare(right.bayCode ?? '') ||
    (left.teamCode ?? '').localeCompare(right.teamCode ?? '') ||
    left.slotId.localeCompare(right.slotId)
  );
}

function compareProjectionSlots(
  left: BuildSlotProjectionSlot,
  right: BuildSlotProjectionSlot,
): number {
  return (
    left.slotStart.localeCompare(right.slotStart) ||
    (left.bayCode ?? '').localeCompare(right.bayCode ?? '') ||
    (left.teamCode ?? '').localeCompare(right.teamCode ?? '') ||
    left.slotId.localeCompare(right.slotId)
  );
}

function compareDemand(left: BuildSlotDemandInput, right: BuildSlotDemandInput): number {
  if (left.priority !== right.priority) return right.priority - left.priority;
  const dueDelta = toTimestamp(left.dueAt) - toTimestamp(right.dueAt);
  if (dueDelta !== 0) return dueDelta;
  return (
    left.workOrderNumber.localeCompare(right.workOrderNumber) ||
    left.sequenceNo - right.sequenceNo ||
    left.operationId.localeCompare(right.operationId)
  );
}

function toTimestamp(value: string | undefined): number {
  return value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
}

function toDateKey(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function buildFreshness({
  generatedAt,
  slots,
  demand,
}: {
  generatedAt: string;
  slots: BuildSlotCapacityInput[];
  demand: BuildSlotDemandInput[];
}): BuildSlotProjectionFreshness {
  const latestCapacityUpdatedAt = latestIso(slots.map((slot) => slot.updatedAt));
  const latestDemandUpdatedAt = latestIso(demand.map((item) => item.updatedAt));
  const latestSourceUpdatedAt = latestIso([latestCapacityUpdatedAt, latestDemandUpdatedAt]);
  const sourceLagSeconds = latestSourceUpdatedAt
    ? Math.max(0, Math.round((Date.parse(generatedAt) - Date.parse(latestSourceUpdatedAt)) / 1000))
    : 0;

  return {
    state: latestSourceUpdatedAt ? 'LIVE' : 'NO_SOURCE',
    generatedAt,
    latestCapacityUpdatedAt,
    latestDemandUpdatedAt,
    latestSourceUpdatedAt,
    sourceLagSeconds,
    staleAfterSeconds: 900,
  };
}

function buildConflicts({
  demand,
  slots,
  projectedSlots,
  unscheduled,
}: {
  demand: BuildSlotDemandInput[];
  slots: BuildSlotCapacityInput[];
  projectedSlots: BuildSlotProjectionSlot[];
  unscheduled: BuildSlotDemandItem[];
}): BuildSlotProjectionConflict[] {
  const conflicts: BuildSlotProjectionConflict[] = [];

  if (slots.length === 0 && demand.length > 0) {
    conflicts.push({
      code: 'NO_CAPACITY',
      severity: 'high',
      message: 'No capacity slots exist for this date range.',
    });
  }

  for (const slot of projectedSlots) {
    if (slot.overCapacityMinutes <= 0) continue;
    conflicts.push({
      code: 'OVER_CAPACITY',
      severity: 'high',
      capacitySlotId: slot.slotId,
      message: `${slot.overCapacityMinutes} projected minute${slot.overCapacityMinutes === 1 ? '' : 's'} exceed ${slot.bayCode ?? slot.teamCode ?? 'slot'} capacity.`,
    });
  }

  for (const item of unscheduled) {
    if (item.reason === 'PROJECTED_TO_SLOT') continue;
    conflicts.push({
      code: conflictCodeForReason(item.reason),
      severity: conflictSeverityForReason(item.reason),
      message: conflictMessageForDemand(item),
      workOrderId: item.workOrderId,
      workOrderNumber: item.workOrderNumber,
      operationId: item.operationId,
      reason: item.reason,
    });
  }

  return conflicts;
}

function conflictCodeForReason(reason: BuildSlotDemandReason): BuildSlotProjectionConflictCode {
  if (reason === 'NO_CAPACITY') return 'NO_CAPACITY';
  if (reason === 'OVER_CAPACITY') return 'OVER_CAPACITY';
  if (reason === 'MATERIAL_NOT_READY') return 'MATERIAL_NOT_READY';
  if (reason === 'OPERATION_BLOCKED') return 'OPERATION_BLOCKED';
  return 'MISSING_ESTIMATE';
}

function conflictSeverityForReason(reason: BuildSlotDemandReason): BuildSlotProjectionConflict['severity'] {
  if (reason === 'NO_CAPACITY' || reason === 'OVER_CAPACITY') return 'high';
  if (reason === 'MATERIAL_NOT_READY' || reason === 'OPERATION_BLOCKED') return 'medium';
  return 'low';
}

function conflictMessageForDemand(item: BuildSlotDemandItem): string {
  const label = `${item.workOrderNumber} ${item.operationName}`;
  if (item.reason === 'NO_CAPACITY') return `${label} needs capacity before it can be scheduled.`;
  if (item.reason === 'OVER_CAPACITY') return `${label} does not fit in the available capacity.`;
  if (item.reason === 'MATERIAL_NOT_READY') return `${label} is waiting on material readiness.`;
  if (item.reason === 'OPERATION_BLOCKED') return `${label} is blocked on the work order.`;
  return `${label} needs an estimated labor duration.`;
}

function latestIso(values: Array<string | undefined>): string | undefined {
  const timestamps = values
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) return undefined;
  return new Date(Math.max(...timestamps)).toISOString();
}
