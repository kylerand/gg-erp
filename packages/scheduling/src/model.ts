export interface WorkItemDemand {
  workOrderId: string;
  operationId: string;
  estimatedHours: number;
  priority: number;
  dueAt?: string;
}

export interface CapacitySlot {
  slotId: string;
  startsAt: string;
  availableHours: number;
}

export interface PlannedAssignment {
  slotId: string;
  workOrderId: string;
  operationId: string;
  assignedHours: number;
}

export interface SchedulingResult {
  assignments: PlannedAssignment[];
  unassigned: WorkItemDemand[];
}
