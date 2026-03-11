import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIT_POINTS, InMemoryAuditSink } from '../audit/index.js';
import { InventoryService, type CommandContext } from '../contexts/inventory/inventory.service.js';
import { INVENTORY_WORKFLOW_EVENT_NAMES } from '../contexts/inventory/inventory.events.js';
import { InMemoryInventoryRepository } from '../contexts/inventory/inventory.repository.js';
import {
  validateConfigurePartSubstitutionRequest,
  validateConsumeWorkOrderMaterialRequest,
  validateInventoryLedgerQuery,
  validateReceiveLotRequest,
  validateReconcileCycleCountRequest,
  validateRecordInventoryTransferRequest,
  validateUpsertUnitConversionRequest
} from '../contexts/inventory/inventory.validation.js';
import { InMemoryEventPublisher, InMemoryOutbox } from '../events/index.js';
import type { ObservabilityContext, ObservabilityHooks } from '../observability/hooks.js';

class RecordingObservabilityHooks implements ObservabilityHooks {
  readonly infoLogs: string[] = [];
  readonly errorLogs: string[] = [];
  readonly metrics: Array<{ name: string; value: number; correlationId: string }> = [];
  readonly traces: Array<{ operation: string; correlationId: string }> = [];

  logInfo(message: string, context: ObservabilityContext): void {
    this.infoLogs.push(`${context.correlationId}:${message}`);
  }

  logError(message: string, context: ObservabilityContext): void {
    this.errorLogs.push(`${context.correlationId}:${message}`);
  }

  metric(name: string, value: number, context: ObservabilityContext): void {
    this.metrics.push({ name, value, correlationId: context.correlationId });
  }

  trace(operation: string, context: ObservabilityContext): void {
    this.traces.push({ operation, correlationId: context.correlationId });
  }

  metricNames(): string[] {
    return this.metrics.map((metric) => metric.name);
  }

  traceOperations(): string[] {
    return this.traces.map((trace) => trace.operation);
  }
}

interface InventoryHarness {
  service: InventoryService;
  repository: InMemoryInventoryRepository;
  audit: InMemoryAuditSink;
  publisher: InMemoryEventPublisher;
  observability: RecordingObservabilityHooks;
  context: CommandContext;
}

function createHarness(correlationId: string): InventoryHarness {
  const repository = new InMemoryInventoryRepository();
  const audit = new InMemoryAuditSink();
  const publisher = new InMemoryEventPublisher();
  const outbox = new InMemoryOutbox();
  const observability = new RecordingObservabilityHooks();
  return {
    service: new InventoryService({
      repository,
      audit,
      publisher,
      outbox,
      observability
    }),
    repository,
    audit,
    publisher,
    observability,
    context: {
      correlationId,
      actorId: 'inventory-test-user',
      module: 'test'
    }
  };
}

async function createLocationAndBin(
  service: InventoryService,
  context: CommandContext,
  codeSuffix: string
): Promise<{ locationId: string; binId: string }> {
  const location = await service.createLocation(
    {
      code: `LOC-${codeSuffix}`,
      name: `Location ${codeSuffix}`,
      zone: `ZONE-${codeSuffix}`,
      locationType: 'WAREHOUSE'
    },
    context
  );
  const bin = await service.createBin(
    {
      locationId: location.id,
      code: `BIN-${codeSuffix}`
    },
    context
  );
  return {
    locationId: location.id,
    binId: bin.id
  };
}

test('inventory validators enforce scaffolded contract rules', () => {
  const receiveValidation = validateReceiveLotRequest({
    lotNumber: 'LOT-VAL-1',
    partSkuId: 'part-1',
    locationId: 'loc-1',
    binId: 'bin-1',
    quantityOnHand: 5,
    sourceDocument: {
      documentType: 'PURCHASE_ORDER',
      documentId: 'po-1',
      orderedQuantity: 4,
      receivedQuantityToDate: 0
    }
  });
  assert.equal(receiveValidation.ok, false);
  assert.ok(receiveValidation.issues.some((issue) => issue.field === 'sourceDocument.lineId'));
  assert.ok(
    receiveValidation.issues.some((issue) => issue.field === 'sourceDocument.orderedQuantity')
  );

  const transferValidation = validateRecordInventoryTransferRequest({
    partSkuId: 'part-1',
    quantity: 1,
    fromLocationId: 'loc-1',
    fromBinId: 'bin-1',
    toLocationId: 'loc-1',
    toBinId: 'bin-1'
  });
  assert.equal(transferValidation.ok, false);
  assert.ok(transferValidation.issues.some((issue) => issue.field === 'toBinId'));

  const consumeValidation = validateConsumeWorkOrderMaterialRequest({
    lotId: ' ',
    quantity: 0,
    workOrderId: ' '
  });
  assert.equal(consumeValidation.ok, false);
  assert.ok(consumeValidation.issues.some((issue) => issue.field === 'lotId'));
  assert.ok(consumeValidation.issues.some((issue) => issue.field === 'quantity'));
  assert.ok(consumeValidation.issues.some((issue) => issue.field === 'workOrderId'));

  const substitutionValidation = validateConfigurePartSubstitutionRequest({
    partSkuId: 'part-1',
    substitutePartSkuId: 'part-1',
    priority: 0
  });
  assert.equal(substitutionValidation.ok, false);
  assert.ok(substitutionValidation.issues.some((issue) => issue.field === 'substitutePartSkuId'));
  assert.ok(substitutionValidation.issues.some((issue) => issue.field === 'priority'));

  const conversionValidation = validateUpsertUnitConversionRequest({
    partSkuId: 'part-1',
    fromUnitCode: 'KIT',
    toUnitCode: 'KIT',
    factor: 0,
    roundingMode: 'NEAREST'
  });
  assert.equal(conversionValidation.ok, false);
  assert.ok(conversionValidation.issues.some((issue) => issue.field === 'toUnitCode'));
  assert.ok(conversionValidation.issues.some((issue) => issue.field === 'factor'));

  const cycleCountValidation = validateReconcileCycleCountRequest({
    sessionId: 'session-1',
    tolerancePercent: 5,
    lines: [
      {
        partSkuId: 'part-1',
        expectedQuantity: 10,
        countedQuantity: 2
      }
    ]
  });
  assert.equal(cycleCountValidation.ok, false);
  assert.ok(cycleCountValidation.issues.some((issue) => issue.field === 'lines[0]'));

  const ledgerValidation = validateInventoryLedgerQuery({
    limit: 0,
    effectiveFrom: '2026-02-01T00:00:00.000Z',
    effectiveTo: '2026-01-01T00:00:00.000Z'
  });
  assert.equal(ledgerValidation.ok, false);
  assert.ok(ledgerValidation.issues.some((issue) => issue.field === 'limit'));
  assert.ok(ledgerValidation.issues.some((issue) => issue.field === 'effectiveFrom'));
});

test('inventory service failure paths are explicit and observable', async () => {
  const harness = createHarness('inv-failure-coverage');
  const { service, context, observability, audit, publisher } = harness;

  const part = await service.createPartSku(
    {
      sku: 'INV-FAIL-001',
      name: 'Failure Harness',
      unitOfMeasure: 'EACH',
      reorderPoint: 1
    },
    context
  );
  const source = await createLocationAndBin(service, context, 'FAIL');
  const lot = await service.receiveLot(
    {
      lotNumber: 'LOT-FAIL-001',
      partSkuId: part.id,
      locationId: source.locationId,
      binId: source.binId,
      quantityOnHand: 5
    },
    context
  );

  await assert.rejects(
    service.reserveInventory(
      {
        lotId: lot.id,
        quantity: 6
      },
      context
    ),
    /Insufficient inventory/
  );

  await service.reserveInventory(
    {
      lotId: lot.id,
      quantity: 2,
      workOrderId: 'wo-failure'
    },
    context
  );

  await assert.rejects(
    service.consumeWorkOrderMaterial(
      {
        lotId: lot.id,
        quantity: 3,
        workOrderId: 'wo-failure'
      },
      context
    ),
    /reserved quantity is 2/
  );

  await assert.rejects(
    service.recordTransfer(
      {
        partSkuId: part.id,
        lotId: lot.id,
        quantity: 5,
        fromLocationId: source.locationId,
        fromBinId: source.binId,
        toLocationId: source.locationId,
        toBinId: source.binId
      },
      context
    ),
    /Transfer destination must differ from source/
  );

  await assert.rejects(
    service.upsertUnitConversion(
      {
        partSkuId: part.id,
        fromUnitCode: 'EACH',
        toUnitCode: 'BOX',
        factor: 1,
        roundingMode: 'NEAREST'
      },
      context
    ),
    /must exist before conversion/
  );

  assert.equal(
    audit.list().filter((entry) => entry.action === AUDIT_POINTS.inventoryReserve).length,
    1
  );
  assert.equal(
    audit.list().some((entry) => entry.action === AUDIT_POINTS.inventoryTransfer),
    false
  );
  assert.equal(
    publisher.published.some((event) => event.name === INVENTORY_WORKFLOW_EVENT_NAMES.shortageDetected),
    true
  );
  const metricNames = new Set(observability.metricNames());
  assert.ok(metricNames.has('inventory.stock.reserve_inventory.failure'));
  assert.ok(metricNames.has('inventory.stock.consume_work_order_material.failure'));
  assert.ok(metricNames.has('inventory.stock.record_transfer.failure'));
  assert.ok(metricNames.has('inventory.catalog.upsert_uom_conversion.failure'));
  assert.ok(
    observability.errorLogs.some((message) =>
      message.includes('inventory.stock.reserve_inventory failed')
    )
  );
});

test('core inventory mutation flows emit audit, events, and success telemetry', async () => {
  const harness = createHarness('inv-core-coverage');
  const { service, context, audit, publisher, observability } = harness;

  const part = await service.createPartSku(
    {
      sku: 'INV-CORE-001',
      name: 'Core Mutation Part',
      unitOfMeasure: 'EACH',
      reorderPoint: 2
    },
    context
  );
  const source = await createLocationAndBin(service, context, 'CORE-SRC');
  const destination = await createLocationAndBin(service, context, 'CORE-DST');

  const lot = await service.receiveLot(
    {
      lotNumber: 'LOT-CORE-001',
      partSkuId: part.id,
      locationId: source.locationId,
      binId: source.binId,
      quantityOnHand: 6
    },
    context
  );
  const reservation = await service.reserveInventory(
    {
      lotId: lot.id,
      quantity: 2,
      workOrderId: 'wo-core'
    },
    context
  );
  const allocation = await service.allocateReservation(
    {
      reservationId: reservation.reservation.id,
      quantity: 2,
      targetType: 'WORK_ORDER',
      targetId: 'wo-core'
    },
    context
  );
  await service.consumeWorkOrderMaterial(
    {
      lotId: lot.id,
      quantity: 2,
      workOrderId: 'wo-core',
      allocationId: allocation.id
    },
    context
  );
  await service.recordAdjustment(
    {
      partSkuId: part.id,
      locationId: source.locationId,
      binId: source.binId,
      lotId: lot.id,
      quantityDelta: 1,
      reasonCode: 'RECOUNT'
    },
    context
  );
  await service.recordTransfer(
    {
      partSkuId: part.id,
      lotId: lot.id,
      quantity: 5,
      fromLocationId: source.locationId,
      fromBinId: source.binId,
      toLocationId: destination.locationId,
      toBinId: destination.binId
    },
    context
  );
  const cycleSession = await service.startCycleCount(
    {
      locationId: destination.locationId,
      binId: destination.binId,
      partSkuIds: [part.id]
    },
    context
  );
  await service.reconcileCycleCount(
    {
      sessionId: cycleSession.id,
      tolerancePercent: 10,
      supervisorOverrideActorId: 'supervisor-1',
      lines: [
        {
          partSkuId: part.id,
          lotId: lot.id,
          expectedQuantity: 5,
          countedQuantity: 4,
          reasonCode: 'CYCLE_DELTA'
        }
      ]
    },
    context
  );

  const actions = new Set(audit.list().map((entry) => entry.action));
  assert.ok(actions.has(AUDIT_POINTS.inventoryReceiptRecord));
  assert.ok(actions.has(AUDIT_POINTS.inventoryReserve));
  assert.ok(actions.has(AUDIT_POINTS.inventoryAllocate));
  assert.ok(actions.has(AUDIT_POINTS.inventoryConsume));
  assert.ok(actions.has(AUDIT_POINTS.inventoryAdjustment));
  assert.ok(actions.has(AUDIT_POINTS.inventoryTransfer));
  assert.ok(actions.has(AUDIT_POINTS.inventoryCycleCountReconcile));

  const eventNames = new Set(publisher.published.map((event) => event.name));
  assert.ok(eventNames.has(INVENTORY_WORKFLOW_EVENT_NAMES.lotReceived));
  assert.ok(eventNames.has(INVENTORY_WORKFLOW_EVENT_NAMES.lotReserved));
  assert.ok(eventNames.has(INVENTORY_WORKFLOW_EVENT_NAMES.reservationAllocated));
  assert.ok(eventNames.has(INVENTORY_WORKFLOW_EVENT_NAMES.workOrderConsumptionRecorded));
  assert.ok(eventNames.has(INVENTORY_WORKFLOW_EVENT_NAMES.adjustmentRecorded));
  assert.ok(eventNames.has(INVENTORY_WORKFLOW_EVENT_NAMES.transferCompleted));
  assert.ok(eventNames.has(INVENTORY_WORKFLOW_EVENT_NAMES.cycleCountStarted));
  assert.ok(eventNames.has(INVENTORY_WORKFLOW_EVENT_NAMES.cycleCountCompleted));

  const metricNames = new Set(observability.metricNames());
  assert.ok(metricNames.has('inventory.stock.receipt.recorded'));
  assert.ok(metricNames.has('inventory.stock.reservation.recorded'));
  assert.ok(metricNames.has('inventory.stock.allocation.recorded'));
  assert.ok(metricNames.has('inventory.stock.work_order.consumed'));
  assert.ok(metricNames.has('inventory.stock.adjustment.recorded'));
  assert.ok(metricNames.has('inventory.stock.transfer.recorded'));
  assert.ok(metricNames.has('inventory.cycle_count.session.started'));
  assert.ok(metricNames.has('inventory.cycle_count.session.reconciled'));
  assert.equal(observability.errorLogs.length, 0);

  const traces = new Set(observability.traceOperations());
  assert.ok(traces.has('inventory.stock.receive_lot'));
  assert.ok(traces.has('inventory.stock.reserve_inventory'));
  assert.ok(traces.has('inventory.stock.allocate_reservation'));
  assert.ok(traces.has('inventory.stock.consume_work_order_material'));
  assert.ok(traces.has('inventory.stock.record_adjustment'));
  assert.ok(traces.has('inventory.stock.record_transfer'));
  assert.ok(traces.has('inventory.cycle_count.start'));
  assert.ok(traces.has('inventory.cycle_count.reconcile'));
});

test('partial kit reservation release allows unallocated remainder and blocks allocated release', async () => {
  const harness = createHarness('inv-partial-kit');
  const { service, context, publisher, observability } = harness;

  const part = await service.createPartSku(
    {
      sku: 'KIT-PART-001',
      name: 'Partial Kit Part',
      unitOfMeasure: 'KIT',
      reorderPoint: 1
    },
    context
  );
  const source = await createLocationAndBin(service, context, 'KIT');
  const lot = await service.receiveLot(
    {
      lotNumber: 'LOT-KIT-001',
      partSkuId: part.id,
      locationId: source.locationId,
      binId: source.binId,
      quantityOnHand: 5
    },
    context
  );
  const reservation = await service.reserveInventory(
    {
      lotId: lot.id,
      quantity: 5,
      workOrderId: 'wo-kit'
    },
    context
  );
  await service.allocateReservation(
    {
      reservationId: reservation.reservation.id,
      quantity: 3,
      targetType: 'KIT',
      targetId: 'kit-line-1'
    },
    context
  );

  const partiallyReleased = await service.releaseInventory(
    {
      lotId: lot.id,
      quantity: 2,
      reasonCode: 'KIT_PARTIAL_CANCELLED'
    },
    context
  );
  assert.equal(partiallyReleased.quantityReserved, 3);
  assert.equal(partiallyReleased.state, 'RESERVED');

  await assert.rejects(
    service.releaseInventory(
      {
        lotId: lot.id,
        quantity: 1,
        reasonCode: 'KIT_PARTIAL_CANCELLED'
      },
      context
    ),
    /allocated reservations must be deallocated first/
  );
  assert.equal(
    publisher.published.filter((event) => event.name === INVENTORY_WORKFLOW_EVENT_NAMES.lotReleased)
      .length,
    1
  );
  const metricNames = new Set(observability.metricNames());
  assert.ok(metricNames.has('inventory.stock.reservation.released'));
  assert.ok(metricNames.has('inventory.stock.release_reservation.failure'));
});

test('cancellation-like release flow clears residual reservations after allocated consumption', async () => {
  const harness = createHarness('inv-cancel-release');
  const { service, context } = harness;

  const part = await service.createPartSku(
    {
      sku: 'INV-CANCEL-001',
      name: 'Cancellation Flow Part',
      unitOfMeasure: 'EACH',
      reorderPoint: 0
    },
    context
  );
  const source = await createLocationAndBin(service, context, 'CAN');
  const lot = await service.receiveLot(
    {
      lotNumber: 'LOT-CAN-001',
      partSkuId: part.id,
      locationId: source.locationId,
      binId: source.binId,
      quantityOnHand: 6
    },
    context
  );
  const reservation = await service.reserveInventory(
    {
      lotId: lot.id,
      quantity: 6,
      workOrderId: 'wo-cancel'
    },
    context
  );
  const allocation = await service.allocateReservation(
    {
      reservationId: reservation.reservation.id,
      quantity: 4,
      targetType: 'WORK_ORDER',
      targetId: 'wo-cancel'
    },
    context
  );

  await service.consumeWorkOrderMaterial(
    {
      lotId: lot.id,
      quantity: 4,
      workOrderId: 'wo-cancel',
      allocationId: allocation.id
    },
    context
  );
  const released = await service.releaseInventory(
    {
      lotId: lot.id,
      quantity: 2,
      reasonCode: 'WO_CANCELLED'
    },
    context
  );
  assert.equal(released.quantityReserved, 0);
  assert.equal(released.state, 'AVAILABLE');

  const materialStatus = await service.getWorkOrderMaterialStatus('wo-cancel', context);
  assert.equal(materialStatus.lines.length, 1);
  assert.equal(materialStatus.lines[0]?.requested, 6);
  assert.equal(materialStatus.lines[0]?.reserved, 0);
  assert.equal(materialStatus.lines[0]?.allocated, 0);
  assert.equal(materialStatus.lines[0]?.consumed, 4);
});

test('substitute part rules and mixed-UOM kit conversions are enforced', async () => {
  const harness = createHarness('inv-substitute-uom');
  const { service, repository, context, publisher, observability } = harness;

  const primary = await service.createPartSku(
    {
      sku: 'SUB-PRIMARY-001',
      name: 'Primary Substitute Part',
      unitOfMeasure: 'EACH',
      reorderPoint: 1
    },
    context
  );
  const alternate = await service.createPartSku(
    {
      sku: 'SUB-ALT-001',
      name: 'Alternate Substitute Part',
      unitOfMeasure: 'EACH',
      reorderPoint: 1
    },
    context
  );
  const kitPart = await service.createPartSku(
    {
      sku: 'KIT-CONV-001',
      name: 'Kit Conversion Part',
      unitOfMeasure: 'KIT',
      reorderPoint: 1
    },
    context
  );

  await service.configurePartSubstitution(
    {
      partSkuId: primary.id,
      substitutePartSkuId: alternate.id,
      priority: 1,
      reasonCode: 'SUPPLIER_DELAY'
    },
    context
  );

  await assert.rejects(
    service.configurePartSubstitution(
      {
        partSkuId: primary.id,
        substitutePartSkuId: primary.id,
        priority: 1
      },
      context
    ),
    /must differ/
  );

  await service.upsertUnitOfMeasure(
    {
      code: 'EACH',
      name: 'Each',
      precisionScale: 0
    },
    context
  );
  await service.upsertUnitOfMeasure(
    {
      code: 'BOX',
      name: 'Box',
      precisionScale: 0
    },
    context
  );
  await service.upsertUnitOfMeasure(
    {
      code: 'KIT',
      name: 'Kit',
      precisionScale: 0
    },
    context
  );

  await service.upsertUnitConversion(
    {
      fromUnitCode: 'BOX',
      toUnitCode: 'EACH',
      factor: 10,
      roundingMode: 'NEAREST'
    },
    context
  );
  await service.upsertUnitConversion(
    {
      partSkuId: kitPart.id,
      fromUnitCode: 'BOX',
      toUnitCode: 'EACH',
      factor: 8,
      roundingMode: 'NEAREST'
    },
    context
  );

  const partSpecificConversion = await repository.findUnitConversion(kitPart.id, 'box', 'each');
  const globalConversion = await repository.findUnitConversion(undefined, 'box', 'each');
  assert.equal(partSpecificConversion?.factor, 8);
  assert.equal(globalConversion?.factor, 10);

  await assert.rejects(
    service.upsertUnitConversion(
      {
        partSkuId: kitPart.id,
        fromUnitCode: 'KIT',
        toUnitCode: 'PALLET',
        factor: 1,
        roundingMode: 'NEAREST'
      },
      context
    ),
    /must exist before conversion/
  );

  assert.equal(
    publisher.published.some(
      (event) => event.name === INVENTORY_WORKFLOW_EVENT_NAMES.partSubstitutionConfigured
    ),
    true
  );
  assert.equal(
    publisher.published.some((event) => event.name === INVENTORY_WORKFLOW_EVENT_NAMES.uomConversionApplied),
    true
  );
  assert.ok(
    observability.metricNames().includes('inventory.catalog.configure_part_substitution.failure')
  );
});

test('ledger remains append-only and inventory projections stay consistent', async () => {
  const harness = createHarness('inv-ledger-consistency');
  const { service, context } = harness;

  const part = await service.createPartSku(
    {
      sku: 'INV-LEDGER-001',
      name: 'Ledger Coverage Part',
      unitOfMeasure: 'EACH',
      reorderPoint: 1
    },
    context
  );
  const source = await createLocationAndBin(service, context, 'LED-SRC');
  const destination = await createLocationAndBin(service, context, 'LED-DST');

  const lot = await service.receiveLot(
    {
      lotNumber: 'LOT-LEDGER-001',
      partSkuId: part.id,
      locationId: source.locationId,
      binId: source.binId,
      quantityOnHand: 6
    },
    context
  );
  const reservation = await service.reserveInventory(
    {
      lotId: lot.id,
      quantity: 2,
      workOrderId: 'wo-ledger'
    },
    context
  );
  const allocation = await service.allocateReservation(
    {
      reservationId: reservation.reservation.id,
      quantity: 2,
      targetType: 'WORK_ORDER',
      targetId: 'wo-ledger'
    },
    context
  );
  await service.consumeWorkOrderMaterial(
    {
      lotId: lot.id,
      quantity: 2,
      workOrderId: 'wo-ledger',
      allocationId: allocation.id
    },
    context
  );
  await service.recordAdjustment(
    {
      partSkuId: part.id,
      locationId: source.locationId,
      binId: source.binId,
      lotId: lot.id,
      quantityDelta: 1,
      reasonCode: 'COUNT_FIX'
    },
    context
  );
  await service.recordTransfer(
    {
      partSkuId: part.id,
      lotId: lot.id,
      quantity: 5,
      fromLocationId: source.locationId,
      fromBinId: source.binId,
      toLocationId: destination.locationId,
      toBinId: destination.binId
    },
    context
  );

  const ledgerBeforeCycle = await service.queryLedger(
    {
      partSkuId: part.id
    },
    context
  );
  assert.equal(ledgerBeforeCycle.entries.length, 7);

  const cycleSession = await service.startCycleCount(
    {
      locationId: destination.locationId,
      binId: destination.binId,
      partSkuIds: [part.id]
    },
    context
  );
  await service.reconcileCycleCount(
    {
      sessionId: cycleSession.id,
      lines: [
        {
          partSkuId: part.id,
          lotId: lot.id,
          expectedQuantity: 5,
          countedQuantity: 4,
          reasonCode: 'COUNT_VARIANCE'
        }
      ],
      tolerancePercent: 10,
      supervisorOverrideActorId: 'inventory-supervisor'
    },
    context
  );

  const ledgerAfterCycle = await service.queryLedger(
    {
      partSkuId: part.id
    },
    context
  );
  assert.equal(ledgerAfterCycle.entries.length, ledgerBeforeCycle.entries.length + 1);
  assert.deepEqual(
    ledgerAfterCycle.entries.slice(0, ledgerBeforeCycle.entries.length).map((entry) => entry.id),
    ledgerBeforeCycle.entries.map((entry) => entry.id)
  );

  const balances = await service.getBalances(
    {
      partSkuId: part.id
    },
    context
  );
  const totalOnHand = balances.reduce((sum, balance) => sum + balance.quantity.onHand, 0);
  const totalReserved = balances.reduce((sum, balance) => sum + balance.quantity.reserved, 0);
  const totalAllocated = balances.reduce((sum, balance) => sum + balance.quantity.allocated, 0);
  assert.equal(totalOnHand, 4);
  assert.equal(totalReserved, 0);
  assert.equal(totalAllocated, 0);

  const netLedgerDelta = ledgerAfterCycle.entries.reduce(
    (sum, entry) => sum + entry.quantityDelta,
    0
  );
  assert.equal(netLedgerDelta, totalOnHand);

  const workOrderStatus = await service.getWorkOrderMaterialStatus('wo-ledger', context);
  assert.equal(workOrderStatus.lines.length, 1);
  assert.equal(workOrderStatus.lines[0]?.requested, 2);
  assert.equal(workOrderStatus.lines[0]?.reserved, 0);
  assert.equal(workOrderStatus.lines[0]?.allocated, 0);
  assert.equal(workOrderStatus.lines[0]?.consumed, 2);
});
