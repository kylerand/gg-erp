import type {
  CapacitySlot,
  PlannedAssignment,
  SchedulingResult,
  WorkItemDemand,
} from './model.js';

const toTimestamp = (value: string | undefined): number =>
  value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;

export function computeDeterministicSchedule(
  demands: readonly WorkItemDemand[],
  slots: readonly CapacitySlot[],
): SchedulingResult {
  const orderedDemands = [...demands].sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }

    const dueDelta = toTimestamp(left.dueAt) - toTimestamp(right.dueAt);
    if (dueDelta !== 0) {
      return dueDelta;
    }

    return left.workOrderId.localeCompare(right.workOrderId);
  });

  const slotRemaining = new Map<string, number>();
  for (const slot of slots) {
    slotRemaining.set(slot.slotId, slot.availableHours);
  }

  const assignments: PlannedAssignment[] = [];
  const unassigned: WorkItemDemand[] = [];

  for (const demand of orderedDemands) {
    let assigned = false;

    for (const slot of slots) {
      const remaining = slotRemaining.get(slot.slotId) ?? 0;
      if (remaining < demand.estimatedHours) {
        continue;
      }

      slotRemaining.set(slot.slotId, remaining - demand.estimatedHours);
      assignments.push({
        slotId: slot.slotId,
        workOrderId: demand.workOrderId,
        operationId: demand.operationId,
        assignedHours: demand.estimatedHours,
      });
      assigned = true;
      break;
    }

    if (!assigned) {
      unassigned.push(demand);
    }
  }

  return {
    assignments,
    unassigned,
  };
}
