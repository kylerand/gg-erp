import type {
  BuildSlot,
  LaborCapacity,
  WorkOrder
} from '../../../../../packages/domain/src/model/buildPlanning.js';
import type { WorkOrderState } from '../../../../../packages/domain/src/model/buildPlanning.js';

export interface ListWorkOrdersInput {
  state?: WorkOrderState;
  limit?: number;
  offset?: number;
}

export interface WorkOrderRepository {
  findWorkOrderById(id: string): Promise<WorkOrder | undefined>;
  findWorkOrderByNumber(workOrderNumber: string): Promise<WorkOrder | undefined>;
  listWorkOrders(input?: ListWorkOrdersInput): Promise<WorkOrder[]>;
  saveWorkOrder(workOrder: WorkOrder): Promise<void>;

  findBuildSlotById(id: string): Promise<BuildSlot | undefined>;
  saveBuildSlot(slot: BuildSlot): Promise<void>;

  findLaborCapacityById(id: string): Promise<LaborCapacity | undefined>;
  saveLaborCapacity(capacity: LaborCapacity): Promise<void>;
}

export class InMemoryWorkOrderRepository implements WorkOrderRepository {
  private readonly workOrders = new Map<string, WorkOrder>();
  private readonly buildSlots = new Map<string, BuildSlot>();
  private readonly laborCapacity = new Map<string, LaborCapacity>();

  async findWorkOrderById(id: string): Promise<WorkOrder | undefined> {
    return this.workOrders.get(id);
  }

  async findWorkOrderByNumber(workOrderNumber: string): Promise<WorkOrder | undefined> {
    return [...this.workOrders.values()].find((workOrder) => workOrder.workOrderNumber === workOrderNumber);
  }

  async saveWorkOrder(workOrder: WorkOrder): Promise<void> {
    this.workOrders.set(workOrder.id, workOrder);
  }

  async listWorkOrders(input: ListWorkOrdersInput = {}): Promise<WorkOrder[]> {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;

    const filtered = [...this.workOrders.values()]
      .filter((workOrder) => (input.state ? workOrder.state === input.state : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return filtered.slice(offset, offset + limit);
  }

  async findBuildSlotById(id: string): Promise<BuildSlot | undefined> {
    return this.buildSlots.get(id);
  }

  async saveBuildSlot(slot: BuildSlot): Promise<void> {
    this.buildSlots.set(slot.id, slot);
  }

  async findLaborCapacityById(id: string): Promise<LaborCapacity | undefined> {
    return this.laborCapacity.get(id);
  }

  async saveLaborCapacity(capacity: LaborCapacity): Promise<void> {
    this.laborCapacity.set(capacity.id, capacity);
  }
}
