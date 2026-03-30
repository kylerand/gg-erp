import { PrismaClient, WorkOrderStatus } from '@prisma/client';
import {
  WorkOrderState,
  type BuildSlot,
  type LaborCapacity,
  type WorkOrder,
} from '../../../../../packages/domain/src/model/buildPlanning.js';
import type { ListWorkOrdersInput, ListBuildSlotsInput, ListLaborCapacityInput, WorkOrderRepository } from './workOrder.repository.js';

const domainStateByPrismaState: Record<WorkOrderStatus, WorkOrderState> = {
  PLANNED: WorkOrderState.PLANNED,
  RELEASED: WorkOrderState.RELEASED,
  IN_PROGRESS: WorkOrderState.IN_PROGRESS,
  BLOCKED: WorkOrderState.BLOCKED,
  COMPLETED: WorkOrderState.COMPLETED,
  CANCELLED: WorkOrderState.CANCELLED,
};

const prismaStateByDomainState: Record<WorkOrderState, WorkOrderStatus> = {
  PLANNED: 'PLANNED',
  RELEASED: 'RELEASED',
  IN_PROGRESS: 'IN_PROGRESS',
  BLOCKED: 'BLOCKED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

export interface PrismaWorkOrderRepositoryOptions {
  prisma?: PrismaClient;
}

export class PrismaWorkOrderRepository implements WorkOrderRepository {
  private readonly prisma: PrismaClient;
  private readonly buildSlots = new Map<string, BuildSlot>();
  private readonly laborCapacity = new Map<string, LaborCapacity>();

  constructor(options: PrismaWorkOrderRepositoryOptions = {}) {
    this.prisma = options.prisma ?? new PrismaClient();
  }

  async findWorkOrderById(id: string): Promise<WorkOrder | undefined> {
    const record = await this.prisma.workOrder.findUnique({ where: { id } });
    return record ? toDomainWorkOrder(record) : undefined;
  }

  async findWorkOrderByNumber(workOrderNumber: string): Promise<WorkOrder | undefined> {
    const record = await this.prisma.workOrder.findUnique({
      where: { workOrderNumber },
    });
    return record ? toDomainWorkOrder(record) : undefined;
  }

  async listWorkOrders(input: ListWorkOrdersInput = {}): Promise<WorkOrder[]> {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;

    const records = await this.prisma.workOrder.findMany({
      where: input.state ? { state: prismaStateByDomainState[input.state] } : undefined,
      orderBy: [{ createdAt: 'desc' }],
      skip: offset,
      take: limit,
    });

    return records.map(toDomainWorkOrder);
  }

  async saveWorkOrder(workOrder: WorkOrder): Promise<void> {
    await this.prisma.workOrder.upsert({
      where: { id: workOrder.id },
      create: {
        id: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        vehicleId: workOrder.vehicleId,
        buildConfigurationId: workOrder.buildConfigurationId,
        bomId: workOrder.bomId,
        state: prismaStateByDomainState[workOrder.state],
        scheduledStartAt: workOrder.scheduledStartAt ? new Date(workOrder.scheduledStartAt) : null,
        scheduledEndAt: workOrder.scheduledEndAt ? new Date(workOrder.scheduledEndAt) : null,
        completedAt: workOrder.completedAt ? new Date(workOrder.completedAt) : null,
        createdAt: new Date(workOrder.createdAt),
        updatedAt: new Date(workOrder.updatedAt),
        createdByUserId: workOrder.createdByUserId ?? null,
        updatedByUserId: workOrder.updatedByUserId ?? null,
        lastCorrelationId: workOrder.lastCorrelationId ?? null,
      },
      update: {
        workOrderNumber: workOrder.workOrderNumber,
        vehicleId: workOrder.vehicleId,
        buildConfigurationId: workOrder.buildConfigurationId,
        bomId: workOrder.bomId,
        state: prismaStateByDomainState[workOrder.state],
        scheduledStartAt: workOrder.scheduledStartAt ? new Date(workOrder.scheduledStartAt) : null,
        scheduledEndAt: workOrder.scheduledEndAt ? new Date(workOrder.scheduledEndAt) : null,
        completedAt: workOrder.completedAt ? new Date(workOrder.completedAt) : null,
        updatedAt: new Date(workOrder.updatedAt),
        updatedByUserId: workOrder.updatedByUserId ?? null,
        lastCorrelationId: workOrder.lastCorrelationId ?? null,
      },
    });
  }

  async findBuildSlotById(id: string): Promise<BuildSlot | undefined> {
    return this.buildSlots.get(id);
  }

  async listBuildSlots(input: ListBuildSlotsInput = {}): Promise<BuildSlot[]> {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;

    const filtered = [...this.buildSlots.values()]
      .filter((slot) => {
        if (input.state && slot.state !== input.state) return false;
        if (input.workstationCode && slot.workstationCode !== input.workstationCode) return false;
        if (input.startDate && slot.slotDate < input.startDate) return false;
        if (input.endDate && slot.slotDate > input.endDate) return false;
        return true;
      })
      .sort((left, right) => left.slotDate.localeCompare(right.slotDate));

    return filtered.slice(offset, offset + limit);
  }

  async saveBuildSlot(slot: BuildSlot): Promise<void> {
    this.buildSlots.set(slot.id, slot);
  }

  async findLaborCapacityById(id: string): Promise<LaborCapacity | undefined> {
    return this.laborCapacity.get(id);
  }

  async listLaborCapacity(input: ListLaborCapacityInput = {}): Promise<LaborCapacity[]> {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;

    const filtered = [...this.laborCapacity.values()]
      .filter((cap) => {
        if (input.state && cap.state !== input.state) return false;
        if (input.teamCode && cap.teamCode !== input.teamCode) return false;
        if (input.startDate && cap.capacityDate < input.startDate) return false;
        if (input.endDate && cap.capacityDate > input.endDate) return false;
        return true;
      })
      .sort((left, right) => left.capacityDate.localeCompare(right.capacityDate));

    return filtered.slice(offset, offset + limit);
  }

  async saveLaborCapacity(capacity: LaborCapacity): Promise<void> {
    this.laborCapacity.set(capacity.id, capacity);
  }
}

function toDomainWorkOrder(record: {
  id: string;
  workOrderNumber: string;
  vehicleId: string;
  buildConfigurationId: string;
  bomId: string;
  state: WorkOrderStatus;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  lastCorrelationId: string | null;
}): WorkOrder {
  return {
    id: record.id,
    workOrderNumber: record.workOrderNumber,
    vehicleId: record.vehicleId,
    buildConfigurationId: record.buildConfigurationId,
    bomId: record.bomId,
    state: domainStateByPrismaState[record.state],
    scheduledStartAt: record.scheduledStartAt?.toISOString(),
    scheduledEndAt: record.scheduledEndAt?.toISOString(),
    completedAt: record.completedAt?.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    createdByUserId: record.createdByUserId ?? undefined,
    updatedByUserId: record.updatedByUserId ?? undefined,
    lastCorrelationId: record.lastCorrelationId ?? undefined,
  };
}
