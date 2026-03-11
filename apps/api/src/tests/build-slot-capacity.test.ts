import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditSink } from '../audit/recorder.js';
import { InMemoryEventPublisher, InMemoryOutbox } from '../events/index.js';
import { ConsoleObservabilityHooks } from '../observability/index.js';
import { InMemoryWorkOrderRepository } from '../contexts/build-planning/workOrder.repository.js';
import { WorkOrderService } from '../contexts/build-planning/workOrder.service.js';

test('build slot allocation rejects over-capacity assignments', async () => {
  const service = new WorkOrderService({
    repository: new InMemoryWorkOrderRepository(),
    audit: new InMemoryAuditSink(),
    publisher: new InMemoryEventPublisher(),
    outbox: new InMemoryOutbox(),
    observability: ConsoleObservabilityHooks
  });

  const context = {
    correlationId: 'slot-correlation-1',
    actorId: 'planner',
    module: 'test'
  };

  const slot = await service.createBuildSlot(
    {
      slotDate: '2026-04-01',
      workstationCode: 'WS-01',
      capacityHours: 4
    },
    context
  );

  const updated = await service.allocateBuildSlotHours(slot.id, 3, context);
  assert.equal(updated.usedHours, 3);

  await assert.rejects(
    service.allocateBuildSlotHours(slot.id, 2, context),
    /Build slot capacity exceeded/
  );
});
