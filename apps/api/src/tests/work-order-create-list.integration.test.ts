import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkOrderState } from '../../../../packages/domain/src/model/buildPlanning.js';
import { InMemoryAuditSink } from '../audit/recorder.js';
import { createWorkOrderRoutes } from '../contexts/build-planning/workOrder.routes.js';
import { InMemoryWorkOrderRepository } from '../contexts/build-planning/workOrder.repository.js';
import { WorkOrderService } from '../contexts/build-planning/workOrder.service.js';
import { InMemoryEventPublisher, InMemoryOutbox } from '../events/index.js';
import { ConsoleObservabilityHooks } from '../observability/index.js';

test('create and list work orders end-to-end via routes/service/repository', async () => {
  const repository = new InMemoryWorkOrderRepository();
  const publisher = new InMemoryEventPublisher();
  const service = new WorkOrderService({
    repository,
    audit: new InMemoryAuditSink(),
    publisher,
    outbox: new InMemoryOutbox(),
    observability: ConsoleObservabilityHooks,
  });
  const routes = createWorkOrderRoutes(service);

  const createdFirst = await routes.createWorkOrder(
    {
      workOrderNumber: 'WO-1001',
      vehicleId: 'veh-1',
      buildConfigurationId: 'cfg-1',
      bomId: 'bom-1',
    },
    'corr-1',
    'actor-1',
  );
  await routes.createWorkOrder(
    {
      workOrderNumber: 'WO-1002',
      vehicleId: 'veh-2',
      buildConfigurationId: 'cfg-2',
      bomId: 'bom-2',
    },
    'corr-2',
    'actor-2',
  );

  await routes.transitionWorkOrder(
    createdFirst.id,
    WorkOrderState.RELEASED,
    'corr-3',
    'actor-3',
  );

  const all = await routes.listWorkOrders({ limit: 10, offset: 0 });
  const released = await routes.listWorkOrders({
    state: WorkOrderState.RELEASED,
    limit: 10,
    offset: 0,
  });

  assert.equal(all.length, 2);
  assert.equal(released.length, 1);
  assert.equal(released[0]?.id, createdFirst.id);
  assert.equal(publisher.published[0]?.name, 'work_order.created');
  assert.equal((publisher.published[0]?.payload as { type?: string })?.type, 'WorkOrderCreated');
});
