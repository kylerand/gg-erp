import type {
  BuildSlot,
  BuildSlotState,
  LaborCapacity,
  LaborCapacityState,
  WorkOrder,
} from '../../../../../packages/domain/src/model/buildPlanning.js';
import type { WorkOrderState } from '../../../../../packages/domain/src/model/buildPlanning.js';

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

export interface WorkOrderRepository {
  findWorkOrderById(id: string): Promise<WorkOrder | undefined>;
  findWorkOrderByNumber(workOrderNumber: string): Promise<WorkOrder | undefined>;
  listWorkOrders(input?: ListWorkOrdersInput): Promise<WorkOrder[]>;
  saveWorkOrder(workOrder: WorkOrder): Promise<void>;

  findBuildSlotById(id: string): Promise<BuildSlot | undefined>;
  listBuildSlots(input?: ListBuildSlotsInput): Promise<BuildSlot[]>;
  saveBuildSlot(slot: BuildSlot): Promise<void>;

  findLaborCapacityById(id: string): Promise<LaborCapacity | undefined>;
  listLaborCapacity(input?: ListLaborCapacityInput): Promise<LaborCapacity[]>;
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
