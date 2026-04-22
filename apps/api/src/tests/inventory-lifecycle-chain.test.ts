import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAuditSink } from '../audit/recorder.js';
import { InMemoryEventPublisher, InMemoryOutbox } from '../events/index.js';
import { ConsoleObservabilityHooks } from '../observability/index.js';
import { InMemoryInventoryRepository } from '../contexts/inventory/inventory.repository.js';
import { InventoryService } from '../contexts/inventory/inventory.service.js';
import { LifecycleLevel, InstallStage, ManufacturerState, PartCategory } from '../../../../packages/domain/src/model/inventory.js';

function makeService() {
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
  return { service, repository, publisher };
}

const ctx = (correlationId = 'corr-test') => ({
  correlationId,
  actorId: 'tester',
  module: 'test' as const
});

test('prepared component requires a raw-component predecessor', async () => {
  const { service } = makeService();

  await assert.rejects(
    service.createPartSku(
      {
        sku: 'GG-FAB-SUS-PREP',
        name: '4-Link Suspension',
        variant: 'Bent',
        unitOfMeasure: 'EACH',
        reorderPoint: 1,
        lifecycleLevel: LifecycleLevel.PREPARED_COMPONENT
      },
      ctx()
    ),
    /requires producedFromPartId/
  );
});

test('lifecycle chain enforces predecessor level matching', async () => {
  const { service } = makeService();

  const raw = await service.createPartSku(
    {
      sku: 'GG-FAB-SUS-RAW',
      name: '4-Link Suspension',
      variant: 'Bent',
      unitOfMeasure: 'EACH',
      reorderPoint: 2,
      lifecycleLevel: LifecycleLevel.RAW_COMPONENT,
      installStage: InstallStage.FABRICATION
    },
    ctx()
  );

  const prepared = await service.createPartSku(
    {
      sku: 'GG-FAB-SUS-PREP',
      name: '4-Link Suspension',
      variant: 'Bent',
      unitOfMeasure: 'EACH',
      reorderPoint: 1,
      lifecycleLevel: LifecycleLevel.PREPARED_COMPONENT,
      installStage: InstallStage.FRAME,
      producedFromPartId: raw.id,
      producedViaStage: InstallStage.FABRICATION
    },
    ctx()
  );

  assert.equal(prepared.producedFromPartId, raw.id);
  assert.equal(prepared.producedViaStage, InstallStage.FABRICATION);

  // Assembled component pointing at RAW should be rejected (must come from PREPARED).
  await assert.rejects(
    service.createPartSku(
      {
        sku: 'GG-FAB-SUS-ASM',
        name: '4-Link Suspension',
        variant: 'Bent',
        unitOfMeasure: 'EACH',
        reorderPoint: 1,
        lifecycleLevel: LifecycleLevel.ASSEMBLED_COMPONENT,
        producedFromPartId: raw.id
      },
      ctx()
    ),
    /must be produced from a PREPARED_COMPONENT/
  );

  const assembled = await service.createPartSku(
    {
      sku: 'GG-FAB-SUS-ASM',
      name: '4-Link Suspension',
      variant: 'Bent',
      unitOfMeasure: 'EACH',
      reorderPoint: 1,
      lifecycleLevel: LifecycleLevel.ASSEMBLED_COMPONENT,
      producedFromPartId: prepared.id,
      producedViaStage: InstallStage.FRAME
    },
    ctx()
  );

  const chain = await service.getPartChain(prepared.id, ctx());
  assert.equal(chain.ancestors.length, 1);
  assert.equal(chain.ancestors[0].part.id, raw.id);
  assert.equal(chain.part.id, prepared.id);
  assert.equal(chain.descendants.length, 1);
  assert.equal(chain.descendants[0].part.id, assembled.id);
});

test('list parts filters by install stage and category', async () => {
  const { service } = makeService();

  const fabRaw = await service.createPartSku(
    {
      sku: 'GG-FAB-A',
      name: 'Part A',
      unitOfMeasure: 'EACH',
      reorderPoint: 0,
      lifecycleLevel: LifecycleLevel.RAW_COMPONENT,
      installStage: InstallStage.FABRICATION,
      category: PartCategory.FABRICATION
    },
    ctx()
  );

  await service.createPartSku(
    {
      sku: 'GG-WIRE-B',
      name: 'Part B',
      unitOfMeasure: 'EACH',
      reorderPoint: 0,
      lifecycleLevel: LifecycleLevel.RAW_COMPONENT,
      installStage: InstallStage.WIRING,
      category: PartCategory.ELECTRONICS
    },
    ctx()
  );

  const fabParts = await service.listPartSkus({ installStage: InstallStage.FABRICATION }, ctx());
  assert.equal(fabParts.total, 1);
  assert.equal(fabParts.items[0].id, fabRaw.id);

  const electronics = await service.listPartSkus({ category: PartCategory.ELECTRONICS }, ctx());
  assert.equal(electronics.total, 1);
  assert.equal(electronics.items[0].sku, 'GG-WIRE-B');
});

test('manufacturer CRUD rejects duplicates and exposes listing', async () => {
  const { service } = makeService();

  const mfr = await service.createManufacturer(
    { manufacturerCode: 'MFR-NAV', name: 'Navitas' },
    ctx()
  );
  assert.equal(mfr.state, ManufacturerState.ACTIVE);

  await assert.rejects(
    service.createManufacturer({ manufacturerCode: 'MFR-NAV', name: 'Other' }, ctx()),
    /already exists/
  );
  await assert.rejects(
    service.createManufacturer({ manufacturerCode: 'MFR-NAV-2', name: 'Navitas' }, ctx()),
    /already exists/
  );

  const all = await service.listManufacturers({}, ctx());
  assert.equal(all.length, 1);
  assert.equal(all[0].name, 'Navitas');
});

test('material plan groups parts by install stage and flags shortfalls', async () => {
  const { service } = makeService();

  const fabPart = await service.createPartSku(
    {
      sku: 'GG-FAB-X',
      name: 'Frame tube',
      unitOfMeasure: 'EACH',
      reorderPoint: 5,
      installStage: InstallStage.FABRICATION
    },
    ctx()
  );
  const framePart = await service.createPartSku(
    {
      sku: 'GG-FRAME-Y',
      name: 'Bracket',
      unitOfMeasure: 'EACH',
      reorderPoint: 0,
      installStage: InstallStage.FRAME
    },
    ctx()
  );
  const orphan = await service.createPartSku(
    {
      sku: 'GG-ORPHAN',
      name: 'Spare',
      unitOfMeasure: 'EACH',
      reorderPoint: 3
    },
    ctx()
  );

  // Stock only one unit against the FAB part so it shows a shortfall of 4.
  await service.receiveLot(
    {
      lotNumber: 'LOT-X',
      partSkuId: fabPart.id,
      locationId: 'loc',
      binId: 'bin',
      quantityOnHand: 1
    },
    ctx()
  );

  const plan = await service.planMaterialByStage(ctx());
  const fabGroup = plan.groups.find((g) => g.installStage === InstallStage.FABRICATION);
  const frameGroup = plan.groups.find((g) => g.installStage === InstallStage.FRAME);

  assert.ok(fabGroup);
  assert.equal(fabGroup!.lines[0].part.id, fabPart.id);
  assert.equal(fabGroup!.lines[0].onHand, 1);
  assert.equal(fabGroup!.lines[0].shortfall, 4);

  assert.ok(frameGroup);
  assert.equal(frameGroup!.lines[0].part.id, framePart.id);
  assert.equal(frameGroup!.totalShortfall, 0);

  assert.equal(plan.unassigned.length, 1);
  assert.equal(plan.unassigned[0].part.id, orphan.id);
  assert.equal(plan.unassigned[0].shortfall, 3);
});
