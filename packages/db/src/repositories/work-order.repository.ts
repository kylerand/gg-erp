import type { PrismaClient, WorkOrder as PrismaWorkOrder, WorkOrderStatus } from '@prisma/client';

export interface WorkOrderRecord {
  id: string;
  workOrderNumber: string;
  vehicleId: string;
  buildConfigurationId: string;
  bomId: string;
  state: WorkOrderStatus;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId?: string;
  updatedByUserId?: string;
  lastCorrelationId?: string;
  lastRequestId?: string;
}

export interface ListWorkOrderRecordsInput {
  state?: WorkOrderStatus;
  limit?: number;
  offset?: number;
}

export interface WorkOrderRepository {
  findById(id: string): Promise<WorkOrderRecord | undefined>;
  findByNumber(workOrderNumber: string): Promise<WorkOrderRecord | undefined>;
  list(input?: ListWorkOrderRecordsInput): Promise<WorkOrderRecord[]>;
  save(record: WorkOrderRecord): Promise<void>;
}

export class InMemoryWorkOrderRepository implements WorkOrderRepository {
  private readonly records = new Map<string, WorkOrderRecord>();

  async findById(id: string): Promise<WorkOrderRecord | undefined> {
    return this.records.get(id);
  }

  async findByNumber(workOrderNumber: string): Promise<WorkOrderRecord | undefined> {
    return [...this.records.values()].find((record) => record.workOrderNumber === workOrderNumber);
  }

  async list(input: ListWorkOrderRecordsInput = {}): Promise<WorkOrderRecord[]> {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;

    const filtered = [...this.records.values()]
      .filter((record) => (input.state ? record.state === input.state : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return filtered.slice(offset, offset + limit);
  }

  async save(record: WorkOrderRecord): Promise<void> {
    this.records.set(record.id, record);
  }
}

export class PrismaWorkOrderRepository implements WorkOrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<WorkOrderRecord | undefined> {
    const record = await this.prisma.workOrder.findUnique({ where: { id } });
    return record ? toWorkOrderRecord(record) : undefined;
  }

  async findByNumber(workOrderNumber: string): Promise<WorkOrderRecord | undefined> {
    const record = await this.prisma.workOrder.findUnique({
      where: { workOrderNumber },
    });
    return record ? toWorkOrderRecord(record) : undefined;
  }

  async list(input: ListWorkOrderRecordsInput = {}): Promise<WorkOrderRecord[]> {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;

    const records = await this.prisma.workOrder.findMany({
      where: input.state ? { state: input.state } : undefined,
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      skip: offset,
    });

    return records.map(toWorkOrderRecord);
  }

  async save(record: WorkOrderRecord): Promise<void> {
    await this.prisma.workOrder.upsert({
      where: { id: record.id },
      create: {
        id: record.id,
        workOrderNumber: record.workOrderNumber,
        vehicleId: record.vehicleId,
        buildConfigurationId: record.buildConfigurationId,
        bomId: record.bomId,
        state: record.state,
        scheduledStartAt: record.scheduledStartAt ? new Date(record.scheduledStartAt) : null,
        scheduledEndAt: record.scheduledEndAt ? new Date(record.scheduledEndAt) : null,
        completedAt: record.completedAt ? new Date(record.completedAt) : null,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
        createdByUserId: record.createdByUserId ?? null,
        updatedByUserId: record.updatedByUserId ?? null,
        lastCorrelationId: record.lastCorrelationId ?? null,
        lastRequestId: record.lastRequestId ?? null,
      },
      update: {
        workOrderNumber: record.workOrderNumber,
        vehicleId: record.vehicleId,
        buildConfigurationId: record.buildConfigurationId,
        bomId: record.bomId,
        state: record.state,
        scheduledStartAt: record.scheduledStartAt ? new Date(record.scheduledStartAt) : null,
        scheduledEndAt: record.scheduledEndAt ? new Date(record.scheduledEndAt) : null,
        completedAt: record.completedAt ? new Date(record.completedAt) : null,
        updatedAt: new Date(record.updatedAt),
        updatedByUserId: record.updatedByUserId ?? null,
        lastCorrelationId: record.lastCorrelationId ?? null,
        lastRequestId: record.lastRequestId ?? null,
      },
    });
  }
}

function toWorkOrderRecord(record: PrismaWorkOrder): WorkOrderRecord {
  return {
    id: record.id,
    workOrderNumber: record.workOrderNumber,
    vehicleId: record.vehicleId,
    buildConfigurationId: record.buildConfigurationId,
    bomId: record.bomId,
    state: record.state,
    scheduledStartAt: record.scheduledStartAt?.toISOString(),
    scheduledEndAt: record.scheduledEndAt?.toISOString(),
    completedAt: record.completedAt?.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    createdByUserId: record.createdByUserId ?? undefined,
    updatedByUserId: record.updatedByUserId ?? undefined,
    lastCorrelationId: record.lastCorrelationId ?? undefined,
    lastRequestId: record.lastRequestId ?? undefined,
  };
}
