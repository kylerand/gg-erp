import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditSink } from '../audit/recorder.js';
import { InMemoryEventPublisher, InMemoryOutbox } from '../events/index.js';
import { ConsoleObservabilityHooks } from '../observability/index.js';
import { InMemoryWorkOrderRepository } from '../contexts/build-planning/workOrder.repository.js';
import { WorkOrderService } from '../contexts/build-planning/workOrder.service.js';
import { WorkOrderState } from '../../../../packages/domain/src/model/buildPlanning.js';

test('work order blocks invalid transition and allows valid lifecycle', async () => {
  const service = new WorkOrderService({
    repository: new InMemoryWorkOrderRepository(),
    audit: new InMemoryAuditSink(),
    publisher: new InMemoryEventPublisher(),
    outbox: new InMemoryOutbox(),
    observability: ConsoleObservabilityHooks
  });

  const context = {
    correlationId: 'wo-correlation-1',
    actorId: 'planner',
    module: 'test'
  };

  const workOrder = await service.createWorkOrder(
    {
      workOrderNumber: 'WO-1001',
      vehicleId: 'veh-1',
      buildConfigurationId: 'cfg-1',
      bomId: 'bom-1'
    },
    context
  );

  await assert.rejects(
    service.transitionWorkOrder(workOrder.id, WorkOrderState.COMPLETED, context),
    /Transition PLANNED -> COMPLETED is not allowed/
  );

  const released = await service.transitionWorkOrder(workOrder.id, WorkOrderState.RELEASED, context);
  assert.equal(released.state, WorkOrderState.RELEASED);

  const started = await service.transitionWorkOrder(workOrder.id, WorkOrderState.IN_PROGRESS, context);
  assert.equal(started.state, WorkOrderState.IN_PROGRESS);

  const completed = await service.transitionWorkOrder(workOrder.id, WorkOrderState.COMPLETED, context);
  assert.equal(completed.state, WorkOrderState.COMPLETED);
  assert.ok(completed.completedAt, 'Completed work order should have completedAt');
});
