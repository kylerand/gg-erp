import { randomUUID } from 'node:crypto';
import {
  BuildSlotState,
  type BuildSlot,
  InvariantViolationError,
  LaborCapacityState,
  type LaborCapacity,
  WorkOrderDesign,
  WorkOrderState,
  type WorkOrder,
  assertTransitionAllowed
} from '../../../../../packages/domain/src/model/index.js';
import { AUDIT_POINTS, type AuditSink } from '../../audit/index.js';
import type { DomainEventName } from '../../events/catalog.js';
import {
  type EventEnvelope,
  type EventPublisher,
  type OutboxWriter,
  publishWithOutbox,
} from '../../events/index.js';
import type { ObservabilityContext, ObservabilityHooks } from '../../observability/hooks.js';
import { toWorkOrderCreatedEvent } from './workOrder.contracts.js';
import type {
  ListWorkOrdersInput as ListWorkOrdersRepositoryInput,
  ListBuildSlotsInput as ListBuildSlotsRepositoryInput,
  ListLaborCapacityInput as ListLaborCapacityRepositoryInput,
  WorkOrderRepository,
} from './workOrder.repository.js';

export interface WorkOrderServiceDeps {
  repository: WorkOrderRepository;
  audit: AuditSink;
  publisher: EventPublisher;
  outbox: OutboxWriter;
  observability: ObservabilityHooks;
}

export interface CommandContext extends Pick<ObservabilityContext, 'correlationId' | 'actorId'> {
  module: string;
}

export interface CreateWorkOrderInput {
  workOrderNumber: string;
  vehicleId: string;
  buildConfigurationId: string;
  bomId: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
}

export interface CreateBuildSlotInput {
  slotDate: string;
  workstationCode: string;
  capacityHours: number;
}

export interface CreateLaborCapacityInput {
  capacityDate: string;
  teamCode: string;
  availableHours: number;
}

export interface ListWorkOrdersInput {
  state?: WorkOrderState;
  limit?: number;
  offset?: number;
}

export interface ListBuildSlotsInput {
  startDate?: string;
  endDate?: string;
  state?: BuildSlotState;
  workstationCode?: string;
  limit?: number;
  offset?: number;
}

export interface ListLaborCapacityInput {
  startDate?: string;
  endDate?: string;
  teamCode?: string;
  state?: LaborCapacityState;
  limit?: number;
  offset?: number;
}

export class WorkOrderService {
  constructor(private readonly deps: WorkOrderServiceDeps) {}

  async createWorkOrder(
    input: CreateWorkOrderInput,
    context: CommandContext
  ): Promise<WorkOrder> {
    if (!input.workOrderNumber.trim()) {
      throw new InvariantViolationError('workOrderNumber is required');
    }
    if (!input.vehicleId.trim()) {
      throw new InvariantViolationError('vehicleId is required');
    }
    if (!input.buildConfigurationId.trim()) {
      throw new InvariantViolationError('buildConfigurationId is required');
    }
    if (!input.bomId.trim()) {
      throw new InvariantViolationError('bomId is required');
    }
    if (input.scheduledStartAt && Number.isNaN(Date.parse(input.scheduledStartAt))) {
      throw new InvariantViolationError('scheduledStartAt must be an ISO-8601 timestamp');
    }
    if (input.scheduledEndAt && Number.isNaN(Date.parse(input.scheduledEndAt))) {
      throw new InvariantViolationError('scheduledEndAt must be an ISO-8601 timestamp');
    }
    if (
      input.scheduledStartAt &&
      input.scheduledEndAt &&
      Date.parse(input.scheduledStartAt) > Date.parse(input.scheduledEndAt)
    ) {
      throw new InvariantViolationError('scheduledStartAt cannot be after scheduledEndAt');
    }

    const existing = await this.deps.repository.findWorkOrderByNumber(input.workOrderNumber.trim());
    if (existing) {
      throw new InvariantViolationError(
        `workOrderNumber already exists: ${input.workOrderNumber}`
      );
    }

    const now = new Date().toISOString();
    const workOrder: WorkOrder = {
      id: randomUUID(),
      workOrderNumber: input.workOrderNumber.trim(),
      vehicleId: input.vehicleId,
      buildConfigurationId: input.buildConfigurationId,
      bomId: input.bomId,
      state: WorkOrderState.PLANNED,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      createdAt: now,
      updatedAt: now,
      createdByUserId: context.actorId,
      updatedByUserId: context.actorId,
      lastCorrelationId: context.correlationId,
    };

    const createdEvent = toWorkOrderCreatedEvent(workOrder, context.correlationId);
    await this.deps.repository.saveWorkOrder(workOrder);
    await this.recordMutation(
      AUDIT_POINTS.workOrderCreate,
      'WorkOrder',
      workOrder.id,
      createdEvent,
      'work_order.created',
      context
    );
    return workOrder;
  }

  async listWorkOrders(input: ListWorkOrdersInput = {}): Promise<WorkOrder[]> {
    const query = normalizeListInput(input);
    return this.deps.repository.listWorkOrders(query);
  }

  async transitionWorkOrder(
    workOrderId: string,
    nextState: WorkOrderState,
    context: CommandContext
  ): Promise<WorkOrder> {
    const existing = await this.requireWorkOrder(workOrderId);
    assertTransitionAllowed(existing.state, nextState, WorkOrderDesign.lifecycle);

    const updated: WorkOrder = {
      ...existing,
      state: nextState,
      completedAt:
        nextState === WorkOrderState.COMPLETED ? new Date().toISOString() : existing.completedAt,
      updatedAt: new Date().toISOString(),
      updatedByUserId: context.actorId,
      lastCorrelationId: context.correlationId
    };
    await this.deps.repository.saveWorkOrder(updated);

    const eventName = this.mapWorkOrderEvent(nextState);
    await this.recordMutation(
      AUDIT_POINTS.workOrderStateChange,
      'WorkOrder',
      updated.id,
      { before: existing.state, after: updated.state },
      eventName,
      context
    );
    return updated;
  }

  async createBuildSlot(
    input: CreateBuildSlotInput,
    context: CommandContext
  ): Promise<BuildSlot> {
    if (input.capacityHours < 0) {
      throw new InvariantViolationError('capacityHours must be >= 0');
    }

    const slot: BuildSlot = {
      id: randomUUID(),
      slotDate: input.slotDate,
      workstationCode: input.workstationCode,
      state: BuildSlotState.PLANNED,
      capacityHours: input.capacityHours,
      usedHours: 0,
      updatedAt: new Date().toISOString()
    };
    await this.deps.repository.saveBuildSlot(slot);
    await this.recordMutation(
      AUDIT_POINTS.buildSlotAssign,
      'BuildSlot',
      slot.id,
      slot,
      'build_slot.planned',
      context
    );
    return slot;
  }

  async allocateBuildSlotHours(
    slotId: string,
    requiredHours: number,
    context: CommandContext
  ): Promise<BuildSlot> {
    if (requiredHours <= 0) {
      throw new InvariantViolationError('requiredHours must be > 0');
    }
    const slot = await this.requireBuildSlot(slotId);
    if (slot.state === BuildSlotState.CANCELLED || slot.state === BuildSlotState.CLOSED) {
      throw new InvariantViolationError(`Cannot allocate capacity to slot in state ${slot.state}`);
    }

    const nextUsed = slot.usedHours + requiredHours;
    if (nextUsed > slot.capacityHours) {
      await this.emitEvent(
        'build_slot.capacity_exceeded',
        { slotId, requiredHours, availableHours: slot.capacityHours - slot.usedHours },
        context
      );
      this.deps.observability.metric('build_slot.capacity_conflict', 1, context);
      throw new InvariantViolationError(
        `Build slot capacity exceeded for ${slotId}: ${nextUsed} > ${slot.capacityHours}`
      );
    }

    const updated: BuildSlot = {
      ...slot,
      usedHours: nextUsed,
      updatedAt: new Date().toISOString()
    };
    await this.deps.repository.saveBuildSlot(updated);
    await this.recordMutation(
      AUDIT_POINTS.buildSlotAssign,
      'BuildSlot',
      updated.id,
      { usedHours: updated.usedHours, capacityHours: updated.capacityHours },
      'build_slot.locked',
      context
    );
    return updated;
  }

  async createLaborCapacity(
    input: CreateLaborCapacityInput,
    context: CommandContext
  ): Promise<LaborCapacity> {
    if (input.availableHours < 0) {
      throw new InvariantViolationError('availableHours must be >= 0');
    }
    const capacity: LaborCapacity = {
      id: randomUUID(),
      capacityDate: input.capacityDate,
      teamCode: input.teamCode,
      state: LaborCapacityState.OPEN,
      availableHours: input.availableHours,
      allocatedHours: 0,
      updatedAt: new Date().toISOString()
    };
    await this.deps.repository.saveLaborCapacity(capacity);
    await this.recordMutation(
      AUDIT_POINTS.laborCapacityUpdate,
      'LaborCapacity',
      capacity.id,
      capacity,
      'labor_capacity.updated',
      context
    );
    return capacity;
  }

  async allocateLaborHours(
    capacityId: string,
    hours: number,
    context: CommandContext
  ): Promise<LaborCapacity> {
    if (hours <= 0) {
      throw new InvariantViolationError('hours must be > 0');
    }
    const capacity = await this.requireLaborCapacity(capacityId);
    const nextAllocated = capacity.allocatedHours + hours;
    if (nextAllocated > capacity.availableHours) {
      await this.emitEvent(
        'labor_capacity.exceeded',
        { capacityId, requested: hours, available: capacity.availableHours - capacity.allocatedHours },
        context
      );
      throw new InvariantViolationError(
        `Labor capacity exceeded for ${capacityId}: ${nextAllocated} > ${capacity.availableHours}`
      );
    }
    const updated: LaborCapacity = {
      ...capacity,
      allocatedHours: nextAllocated,
      updatedAt: new Date().toISOString()
    };
    await this.deps.repository.saveLaborCapacity(updated);
    await this.recordMutation(
      AUDIT_POINTS.laborCapacityUpdate,
      'LaborCapacity',
      updated.id,
      { allocatedHours: updated.allocatedHours },
      'labor_capacity.updated',
      context
    );
    return updated;
  }

  async listBuildSlots(input: ListBuildSlotsInput = {}): Promise<BuildSlot[]> {
    const query = normalizeBuildSlotsInput(input);
    return this.deps.repository.listBuildSlots(query);
  }

  async listLaborCapacity(input: ListLaborCapacityInput = {}): Promise<LaborCapacity[]> {
    const query = normalizeLaborCapacityInput(input);
    return this.deps.repository.listLaborCapacity(query);
  }

  private async requireWorkOrder(workOrderId: string): Promise<WorkOrder> {
    const workOrder = await this.deps.repository.findWorkOrderById(workOrderId);
    if (!workOrder) {
      throw new InvariantViolationError(`WorkOrder not found: ${workOrderId}`);
    }
    return workOrder;
  }

  private async requireBuildSlot(slotId: string): Promise<BuildSlot> {
    const slot = await this.deps.repository.findBuildSlotById(slotId);
    if (!slot) {
      throw new InvariantViolationError(`BuildSlot not found: ${slotId}`);
    }
    return slot;
  }

  private async requireLaborCapacity(capacityId: string): Promise<LaborCapacity> {
    const capacity = await this.deps.repository.findLaborCapacityById(capacityId);
    if (!capacity) {
      throw new InvariantViolationError(`LaborCapacity not found: ${capacityId}`);
    }
    return capacity;
  }

  private mapWorkOrderEvent(nextState: WorkOrderState): DomainEventName {
    switch (nextState) {
      case WorkOrderState.RELEASED:
        return 'work_order.released';
      case WorkOrderState.IN_PROGRESS:
        return 'work_order.started';
      case WorkOrderState.BLOCKED:
        return 'work_order.blocked';
      case WorkOrderState.COMPLETED:
        return 'work_order.completed';
      case WorkOrderState.CANCELLED:
        return 'work_order.cancelled';
      default:
        return 'work_order.created';
    }
  }

  private async recordMutation(
    action: string,
    entityType: string,
    entityId: string,
    metadata: unknown,
    eventName: DomainEventName,
    context: CommandContext
  ): Promise<void> {
    await this.deps.audit.record({
      actorId: context.actorId,
      action,
      entityType,
      entityId,
      correlationId: context.correlationId,
      metadata,
      createdAt: new Date().toISOString()
    });
    await this.emitEvent(eventName, metadata, context);
    this.deps.observability.metric('work_order.transition', 1, context);
  }

  private async emitEvent(
    eventName: DomainEventName,
    payload: unknown,
    context: CommandContext
  ): Promise<void> {
    const event: EventEnvelope<unknown> = {
      name: eventName,
      correlationId: context.correlationId,
      emittedAt: new Date().toISOString(),
      payload
    };
    await publishWithOutbox(this.deps.publisher, this.deps.outbox, event);
  }
}

function normalizeListInput(input: ListWorkOrdersInput): ListWorkOrdersRepositoryInput {
  const normalizedLimit = input.limit ?? 50;
  const normalizedOffset = input.offset ?? 0;

  if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
    throw new InvariantViolationError('limit must be a positive integer');
  }

  if (!Number.isInteger(normalizedOffset) || normalizedOffset < 0) {
    throw new InvariantViolationError('offset must be a non-negative integer');
  }

  return {
    state: input.state,
    limit: normalizedLimit,
    offset: normalizedOffset,
  };
}

function normalizeBuildSlotsInput(input: ListBuildSlotsInput): ListBuildSlotsRepositoryInput {
  const normalizedLimit = input.limit ?? 50;
  const normalizedOffset = input.offset ?? 0;

  if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
    throw new InvariantViolationError('limit must be a positive integer');
  }
  if (!Number.isInteger(normalizedOffset) || normalizedOffset < 0) {
    throw new InvariantViolationError('offset must be a non-negative integer');
  }
  if (input.startDate && Number.isNaN(Date.parse(input.startDate))) {
    throw new InvariantViolationError('startDate must be a valid ISO-8601 date');
  }
  if (input.endDate && Number.isNaN(Date.parse(input.endDate))) {
    throw new InvariantViolationError('endDate must be a valid ISO-8601 date');
  }

  return {
    startDate: input.startDate,
    endDate: input.endDate,
    state: input.state,
    workstationCode: input.workstationCode,
    limit: normalizedLimit,
    offset: normalizedOffset,
  };
}

function normalizeLaborCapacityInput(input: ListLaborCapacityInput): ListLaborCapacityRepositoryInput {
  const normalizedLimit = input.limit ?? 50;
  const normalizedOffset = input.offset ?? 0;

  if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0) {
    throw new InvariantViolationError('limit must be a positive integer');
  }
  if (!Number.isInteger(normalizedOffset) || normalizedOffset < 0) {
    throw new InvariantViolationError('offset must be a non-negative integer');
  }
  if (input.startDate && Number.isNaN(Date.parse(input.startDate))) {
    throw new InvariantViolationError('startDate must be a valid ISO-8601 date');
  }
  if (input.endDate && Number.isNaN(Date.parse(input.endDate))) {
    throw new InvariantViolationError('endDate must be a valid ISO-8601 date');
  }

  return {
    startDate: input.startDate,
    endDate: input.endDate,
    teamCode: input.teamCode,
    state: input.state,
    limit: normalizedLimit,
    offset: normalizedOffset,
  };
}
