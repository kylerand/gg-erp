import type { HttpClient } from '../../lib/http-client.js';

export interface WorkOrderSummary {
  id: string;
  workOrderNumber: string;
  vehicleId: string;
  buildConfigurationId: string;
  bomId: string;
  state: WorkOrderStatus;
  createdAt: string;
  updatedAt: string;
}

export type WorkOrderStatus =
  | 'PLANNED'
  | 'RELEASED'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface FetchWorkOrdersOptions {
  state?: WorkOrderStatus;
  limit?: number;
  offset?: number;
}

export interface ListWorkOrdersResponse {
  items: WorkOrderSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateWorkOrderInput {
  workOrderNumber: string;
  vehicleId: string;
  buildConfigurationId: string;
  bomId: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
}

export interface WorkOrderCreatedEvent {
  type: 'WorkOrderCreated';
  eventName: 'work_order.created';
  correlationId: string;
  id: string;
  workOrderNumber: string;
  state: WorkOrderStatus;
  workOrder: WorkOrderSummary;
}

export interface CreateWorkOrderResponse {
  workOrder: WorkOrderSummary;
  event: WorkOrderCreatedEvent;
}

export async function fetchWorkOrders(
  client: HttpClient,
  options: FetchWorkOrdersOptions = {},
): Promise<ListWorkOrdersResponse> {
  const query = buildWorkOrderListQuery(options);
  const path = query ? `/planning/work-orders?${query}` : '/planning/work-orders';
  return client.get<ListWorkOrdersResponse>(path);
}

export async function createWorkOrder(
  client: HttpClient,
  input: CreateWorkOrderInput,
): Promise<CreateWorkOrderResponse> {
  return client.post<CreateWorkOrderInput, CreateWorkOrderResponse>('/planning/work-orders', input);
}

function buildWorkOrderListQuery(options: FetchWorkOrdersOptions): string {
  const searchParams = new URLSearchParams();

  if (options.state) {
    searchParams.set('state', options.state);
  }
  if (options.limit !== undefined) {
    searchParams.set('limit', String(options.limit));
  }
  if (options.offset !== undefined) {
    searchParams.set('offset', String(options.offset));
  }

  return searchParams.toString();
}
