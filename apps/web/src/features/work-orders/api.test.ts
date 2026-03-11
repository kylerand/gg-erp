import assert from 'node:assert/strict';
import test from 'node:test';
import type { HttpClient } from '../../lib/http-client.js';
import { createWorkOrder, fetchWorkOrders, type ListWorkOrdersResponse } from './api.js';

class FakeHttpClient implements HttpClient {
  public readonly getCalls: string[] = [];
  public readonly postCalls: Array<{ path: string; body: unknown }> = [];

  constructor(
    private readonly getResponse: unknown,
    private readonly postResponse: unknown,
  ) {}

  async get<TResponse>(path: string): Promise<TResponse> {
    this.getCalls.push(path);
    return this.getResponse as TResponse;
  }

  async post<TRequest, TResponse>(path: string, body: TRequest): Promise<TResponse> {
    this.postCalls.push({ path, body });
    return this.postResponse as TResponse;
  }
}

test('fetchWorkOrders builds query and returns list response', async () => {
  const expected: ListWorkOrdersResponse = {
    items: [],
    total: 0,
    limit: 25,
    offset: 0,
  };
  const client = new FakeHttpClient(expected, {});

  const response = await fetchWorkOrders(client, {
    state: 'PLANNED',
    limit: 25,
    offset: 0,
  });

  assert.deepEqual(response, expected);
  assert.deepEqual(client.getCalls, ['/planning/work-orders?state=PLANNED&limit=25&offset=0']);
});

test('createWorkOrder posts payload to create endpoint', async () => {
  const expected = {
    workOrder: {
      id: 'wo-1',
      workOrderNumber: 'WO-1001',
      vehicleId: 'veh-1',
      buildConfigurationId: 'cfg-1',
      bomId: 'bom-1',
      state: 'PLANNED',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    event: {
      type: 'WorkOrderCreated',
      eventName: 'work_order.created',
      correlationId: 'corr-1',
      id: 'wo-1',
      workOrderNumber: 'WO-1001',
      state: 'PLANNED',
      workOrder: {
        id: 'wo-1',
        workOrderNumber: 'WO-1001',
        vehicleId: 'veh-1',
        buildConfigurationId: 'cfg-1',
        bomId: 'bom-1',
        state: 'PLANNED',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  } as const;

  const client = new FakeHttpClient({}, expected);
  const input = {
    workOrderNumber: 'WO-1001',
    vehicleId: 'veh-1',
    buildConfigurationId: 'cfg-1',
    bomId: 'bom-1',
  };

  const response = await createWorkOrder(client, input);

  assert.deepEqual(response, expected);
  assert.deepEqual(client.postCalls, [
    {
      path: '/planning/work-orders',
      body: input,
    },
  ]);
});
