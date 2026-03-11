import type { HttpClient } from '../../lib/http-client.js';
import {
  createWorkOrder,
  fetchWorkOrders,
  type CreateWorkOrderInput,
  type FetchWorkOrdersOptions,
  type ListWorkOrdersResponse,
  type WorkOrderSummary,
} from './api.js';

export interface WorkOrderCreateFormSchema {
  fields: readonly ['workOrderNumber', 'vehicleId', 'buildConfigurationId', 'bomId'];
}

export interface WorkOrdersPageModel {
  title: string;
  createForm: WorkOrderCreateFormSchema;
  list: ListWorkOrdersResponse;
}

const createFormSchema: WorkOrderCreateFormSchema = {
  fields: ['workOrderNumber', 'vehicleId', 'buildConfigurationId', 'bomId'],
};

export async function loadWorkOrdersPage(
  client: HttpClient,
  options: FetchWorkOrdersOptions = {},
): Promise<WorkOrdersPageModel> {
  const list = await fetchWorkOrders(client, options);
  return {
    title: 'Work Orders',
    createForm: createFormSchema,
    list,
  };
}

export async function submitWorkOrderCreate(
  client: HttpClient,
  input: CreateWorkOrderInput,
): Promise<WorkOrderSummary> {
  const created = await createWorkOrder(client, input);
  return created.workOrder;
}

export function WorkOrdersPage(model: WorkOrdersPageModel): string {
  const rows = model.list.items
    .map(
      (workOrder) =>
        `${workOrder.workOrderNumber} | ${workOrder.state} | ${workOrder.vehicleId} | ${workOrder.createdAt}`,
    )
    .join('\n');

  return [
    model.title,
    `Create fields: ${model.createForm.fields.join(', ')}`,
    `Total: ${model.list.total}`,
    rows || 'No work orders found.',
  ].join('\n');
}
