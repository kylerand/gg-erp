import assert from 'node:assert/strict';
import test from 'node:test';
import type { HttpClient } from '../../lib/http-client.js';
import {
  WorkOrdersPage,
  loadWorkOrdersPage,
  submitWorkOrderCreate,
} from './WorkOrdersPage.js';
import type { CreateWorkOrderResponse, ListWorkOrdersResponse } from './api.js';

class FakeHttpClient implements HttpClient {
  constructor(
    private readonly listResponse: ListWorkOrdersResponse,
    private readonly createResponse: CreateWorkOrderResponse,
  ) {}

  async get<TResponse>(_path: string): Promise<TResponse> {
    return this.listResponse as TResponse;
  }

  async post<TRequest, TResponse>(_path: string, _body: TRequest): Promise<TResponse> {
    return this.createResponse as TResponse;
  }
}

test('work-orders page loads list and renders summary', async () => {
  const listResponse: ListWorkOrdersResponse = {
    items: [
      {
        id: 'wo-1',
        workOrderNumber: 'WO-1001',
        vehicleId: 'veh-1',
        buildConfigurationId: 'cfg-1',
        bomId: 'bom-1',
        state: 'PLANNED',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    total: 1,
    limit: 50,
    offset: 0,
  };

  const createResponse: CreateWorkOrderResponse = {
    workOrder: listResponse.items[0]!,
    event: {
      type: 'WorkOrderCreated',
      eventName: 'work_order.created',
      correlationId: 'corr-1',
      id: 'wo-1',
      workOrderNumber: 'WO-1001',
      state: 'PLANNED',
      workOrder: listResponse.items[0]!,
    },
  };

  const client = new FakeHttpClient(listResponse, createResponse);
  const model = await loadWorkOrdersPage(client);
  const rendered = WorkOrdersPage(model);

  assert.equal(model.title, 'Work Orders');
  assert.ok(rendered.includes('WO-1001'));
  assert.ok(rendered.includes('Total: 1'));
});

test('submitWorkOrderCreate returns created work order summary', async () => {
  const listResponse: ListWorkOrdersResponse = {
    items: [],
    total: 0,
    limit: 50,
    offset: 0,
  };
  const createResponse: CreateWorkOrderResponse = {
    workOrder: {
      id: 'wo-2',
      workOrderNumber: 'WO-1002',
      vehicleId: 'veh-2',
      buildConfigurationId: 'cfg-2',
      bomId: 'bom-2',
      state: 'PLANNED',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
    event: {
      type: 'WorkOrderCreated',
      eventName: 'work_order.created',
      correlationId: 'corr-2',
      id: 'wo-2',
      workOrderNumber: 'WO-1002',
      state: 'PLANNED',
      workOrder: {
        id: 'wo-2',
        workOrderNumber: 'WO-1002',
        vehicleId: 'veh-2',
        buildConfigurationId: 'cfg-2',
        bomId: 'bom-2',
        state: 'PLANNED',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    },
  };
  const client = new FakeHttpClient(listResponse, createResponse);

  const created = await submitWorkOrderCreate(client, {
    workOrderNumber: 'WO-1002',
    vehicleId: 'veh-2',
    buildConfigurationId: 'cfg-2',
    bomId: 'bom-2',
  });

  assert.equal(created.id, 'wo-2');
  assert.equal(created.workOrderNumber, 'WO-1002');
});
