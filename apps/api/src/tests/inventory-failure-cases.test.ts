import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditSink } from '../audit/recorder.js';
import { InMemoryEventPublisher, InMemoryOutbox } from '../events/index.js';
import { ConsoleObservabilityHooks } from '../observability/index.js';
import { InMemoryInventoryRepository } from '../contexts/inventory/inventory.repository.js';
import { InventoryService } from '../contexts/inventory/inventory.service.js';

test('inventory reserve fails on shortage and emits shortage event', async () => {
  const audit = new InMemoryAuditSink();
  const publisher = new InMemoryEventPublisher();
  const outbox = new InMemoryOutbox();
  const repository = new InMemoryInventoryRepository();
  const service = new InventoryService({
    repository,
    audit,
    publisher,
    outbox,
    observability: ConsoleObservabilityHooks
  });

  const correlationId = 'test-correlation-1';
  const actorId = 'tester';

  const part = await service.createPartSku(
    {
      sku: 'PART-001',
      name: 'Controller Harness',
      unitOfMeasure: 'EACH',
      reorderPoint: 2
    },
    { correlationId, actorId, module: 'test' }
  );

  const lot = await service.receiveLot(
    {
      lotNumber: 'LOT-001',
      partSkuId: part.id,
      locationId: 'loc-1',
      binId: 'bin-1',
      quantityOnHand: 5
    },
    { correlationId, actorId, module: 'test' }
  );

  await assert.rejects(
    service.reserveLotQuantity(lot.id, 6, {
      correlationId,
      actorId,
      module: 'test'
    }),
    /Insufficient inventory/
  );

  const shortageEvent = publisher.published.find((event) => event.name === 'inventory.shortage_detected');
  assert.ok(shortageEvent, 'Expected inventory.shortage_detected event');
});
