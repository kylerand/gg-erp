import { WorkOrderState } from '../../../../../packages/domain/src/model/buildPlanning.js';
import type {
  CreateBuildSlotInput,
  CreateLaborCapacityInput,
  CreateWorkOrderInput,
  ListBuildSlotsInput,
  ListLaborCapacityInput,
  ListWorkOrdersInput,
  WorkOrderService,
} from './workOrder.service.js';

export interface WorkOrderRoutes {
  createWorkOrder(
    input: CreateWorkOrderInput,
    correlationId: string,
    actorId?: string
  ): ReturnType<WorkOrderService['createWorkOrder']>;
  transitionWorkOrder(
    workOrderId: string,
    state: WorkOrderState,
    correlationId: string,
    actorId?: string
  ): ReturnType<WorkOrderService['transitionWorkOrder']>;
  listWorkOrders(input?: ListWorkOrdersInput): ReturnType<WorkOrderService['listWorkOrders']>;
  createBuildSlot(
    input: CreateBuildSlotInput,
    correlationId: string,
    actorId?: string
  ): ReturnType<WorkOrderService['createBuildSlot']>;
  allocateBuildSlot(
    slotId: string,
    requiredHours: number,
    correlationId: string,
    actorId?: string
  ): ReturnType<WorkOrderService['allocateBuildSlotHours']>;
  listBuildSlots(input?: ListBuildSlotsInput): ReturnType<WorkOrderService['listBuildSlots']>;
  createLaborCapacity(
    input: CreateLaborCapacityInput,
    correlationId: string,
    actorId?: string
  ): ReturnType<WorkOrderService['createLaborCapacity']>;
  allocateLaborHours(
    capacityId: string,
    hours: number,
    correlationId: string,
    actorId?: string
  ): ReturnType<WorkOrderService['allocateLaborHours']>;
  listLaborCapacity(input?: ListLaborCapacityInput): ReturnType<WorkOrderService['listLaborCapacity']>;
}

export function createWorkOrderRoutes(service: WorkOrderService): WorkOrderRoutes {
  return {
    createWorkOrder(input, correlationId, actorId) {
      return service.createWorkOrder(input, { correlationId, actorId, module: 'build-planning' });
    },
    transitionWorkOrder(workOrderId, state, correlationId, actorId) {
      return service.transitionWorkOrder(workOrderId, state, {
        correlationId,
        actorId,
        module: 'build-planning'
      });
    },
    listWorkOrders(input = {}) {
      return service.listWorkOrders(input);
    },
    createBuildSlot(input, correlationId, actorId) {
      return service.createBuildSlot(input, { correlationId, actorId, module: 'build-planning' });
    },
    allocateBuildSlot(slotId, requiredHours, correlationId, actorId) {
      return service.allocateBuildSlotHours(slotId, requiredHours, {
        correlationId,
        actorId,
        module: 'build-planning'
      });
    },
    createLaborCapacity(input, correlationId, actorId) {
      return service.createLaborCapacity(input, {
        correlationId,
        actorId,
        module: 'build-planning'
      });
    },
    allocateLaborHours(capacityId, hours, correlationId, actorId) {
      return service.allocateLaborHours(capacityId, hours, {
        correlationId,
        actorId,
        module: 'build-planning'
      });
    },
    listBuildSlots(input = {}) {
      return service.listBuildSlots(input);
    },
    listLaborCapacity(input = {}) {
      return service.listLaborCapacity(input);
    }
  };
}
