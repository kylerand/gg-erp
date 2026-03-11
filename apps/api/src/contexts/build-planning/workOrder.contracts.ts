import type { WorkOrder, WorkOrderState } from '../../../../../packages/domain/src/model/buildPlanning.js';

export interface CreateWorkOrderRequest {
  workOrderNumber: string;
  vehicleId: string;
  buildConfigurationId: string;
  bomId: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
}

export interface ListWorkOrdersQuery {
  state?: WorkOrderState;
  limit?: number;
  offset?: number;
}

export interface WorkOrderResponse {
  id: string;
  workOrderNumber: string;
  vehicleId: string;
  buildConfigurationId: string;
  bomId: string;
  state: WorkOrderState;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkOrderCreatedEvent {
  type: 'WorkOrderCreated';
  eventName: 'work_order.created';
  correlationId: string;
  id: string;
  workOrderNumber: string;
  state: WorkOrderState;
  workOrder: WorkOrderResponse;
}

export interface CreateWorkOrderResponse {
  workOrder: WorkOrderResponse;
  event: WorkOrderCreatedEvent;
}

export interface ListWorkOrdersResponse {
  items: WorkOrderResponse[];
  total: number;
  limit: number;
  offset: number;
}

export function toWorkOrderResponse(workOrder: WorkOrder): WorkOrderResponse {
  return {
    id: workOrder.id,
    workOrderNumber: workOrder.workOrderNumber,
    vehicleId: workOrder.vehicleId,
    buildConfigurationId: workOrder.buildConfigurationId,
    bomId: workOrder.bomId,
    state: workOrder.state,
    scheduledStartAt: workOrder.scheduledStartAt,
    scheduledEndAt: workOrder.scheduledEndAt,
    completedAt: workOrder.completedAt,
    createdAt: workOrder.createdAt,
    updatedAt: workOrder.updatedAt,
  };
}

export function toWorkOrderCreatedEvent(
  workOrder: WorkOrder,
  correlationId: string,
): WorkOrderCreatedEvent {
  return {
    type: 'WorkOrderCreated',
    eventName: 'work_order.created',
    correlationId,
    id: workOrder.id,
    workOrderNumber: workOrder.workOrderNumber,
    state: workOrder.state,
    workOrder: toWorkOrderResponse(workOrder),
  };
}
