import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CustomerLifecycleState,
  PurchaseOrderState,
  TicketReworkIssueState
} from '../../../../packages/domain/src/model/index.js';
import { InMemoryAuditSink } from '../audit/recorder.js';
import { CustomerService } from '../contexts/identity/customer.service.js';
import { InMemoryInventoryRepository } from '../contexts/inventory/inventory.repository.js';
import { ProcurementService } from '../contexts/inventory/procurement.service.js';
import { TicketReworkService } from '../contexts/tickets/ticketRework.service.js';
import { type EventEnvelope, InMemoryEventPublisher, InMemoryOutbox } from '../events/index.js';
import { ConsoleObservabilityHooks } from '../observability/index.js';

test('customer failures do not emit extra mutation audit/events', async () => {
  const audit = new InMemoryAuditSink();
  const publisher = new InMemoryEventPublisher();
  const outbox = new InMemoryOutbox();
  const service = new CustomerService({
    audit,
    publisher,
    outbox,
    observability: ConsoleObservabilityHooks
  });
  const context = { correlationId: 'customer-fail-1', actorId: 'sales-user', module: 'test' };

  const created = await service.createCustomer(
    {
      fullName: 'Alex Rivera',
      email: 'ALEX@EXAMPLE.COM'
    },
    context
  );

  await assert.rejects(
    service.createCustomer(
      {
        fullName: 'Alex Duplicate',
        email: 'alex@example.com'
      },
      context
    ),
    /Customer email already exists/
  );

  await assert.rejects(
    service.transitionState(created.id, CustomerLifecycleState.ARCHIVED, context),
    /Transition LEAD -> ARCHIVED is not allowed/
  );

  assert.equal(audit.list().length, 1);
  assert.deepEqual(
    publisher.published.map((event) => event.name),
    ['customer.created']
  );
  const outboxRecords = outbox.list();
  assert.equal(outboxRecords.length, 1);
  assert.equal(outboxRecords[0]?.state, 'PUBLISHED');
});

test('procurement rejects invalid purchase-order transition without side effects', async () => {
  const repository = new InMemoryInventoryRepository();
  const audit = new InMemoryAuditSink();
  const publisher = new InMemoryEventPublisher();
  const outbox = new InMemoryOutbox();
  const service = new ProcurementService({
    repository,
    audit,
    publisher,
    outbox,
    observability: ConsoleObservabilityHooks
  });
  const context = { correlationId: 'procurement-fail-1', actorId: 'buyer', module: 'test' };

  const vendor = await service.createVendor(
    {
      vendorCode: 'V-ACME',
      name: 'Acme Components'
    },
    context
  );
  const purchaseOrder = await service.createPurchaseOrder(
    {
      poNumber: 'PO-1001',
      vendorId: vendor.id,
      lines: [{ partSkuId: 'part-001', orderedQty: 4, unitCost: 11.5 }]
    },
    context
  );

  await assert.rejects(
    service.transitionPurchaseOrder(purchaseOrder.id, PurchaseOrderState.SENT, context),
    /Transition DRAFT -> SENT is not allowed/
  );

  const persistedPo = await repository.findPurchaseOrderById(purchaseOrder.id);
  assert.equal(persistedPo?.state, PurchaseOrderState.DRAFT);
  assert.equal(audit.list().length, 2);
  assert.equal(publisher.published.some((event) => event.name === 'purchase_order.sent'), false);
  const outboxRecords = outbox.list();
  assert.equal(outboxRecords.length, 2);
  assert.ok(outboxRecords.every((record) => record.state === 'PUBLISHED'));
});

test('procurement marks outbox FAILED when event publish throws', async () => {
  const audit = new InMemoryAuditSink();
  const outbox = new InMemoryOutbox();
  const service = new ProcurementService({
    repository: new InMemoryInventoryRepository(),
    audit,
    publisher: {
      async publish<TPayload>(_event: EventEnvelope<TPayload>): Promise<void> {
        throw new Error('dispatch unavailable');
      }
    },
    outbox,
    observability: ConsoleObservabilityHooks
  });

  await assert.rejects(
    service.createVendor(
      {
        vendorCode: 'V-FAIL',
        name: 'Failing Vendor'
      },
      {
        correlationId: 'procurement-fail-2',
        actorId: 'buyer',
        module: 'test'
      }
    ),
    /dispatch unavailable/
  );

  assert.equal(audit.list().length, 1);
  const [failedOutboxRecord] = outbox.list();
  assert.ok(failedOutboxRecord);
  assert.equal(failedOutboxRecord.state, 'FAILED');
  assert.equal(failedOutboxRecord.failureReason, 'dispatch unavailable');
  assert.ok(failedOutboxRecord.failedAt, 'Expected failedAt to be populated');
});

test('ticket rework enforces CRITICAL resolution assignment rule', async () => {
  const audit = new InMemoryAuditSink();
  const publisher = new InMemoryEventPublisher();
  const outbox = new InMemoryOutbox();
  const service = new TicketReworkService({
    audit,
    publisher,
    outbox,
    observability: ConsoleObservabilityHooks
  });
  const context = { correlationId: 'ticket-fail-1', actorId: 'qa-user', module: 'test' };

  const issue = await service.createIssue(
    {
      workOrderId: 'wo-900',
      title: 'Brake calibration mismatch',
      description: 'Observed mismatch between calibration sheet and torque checks.',
      severity: 'CRITICAL'
    },
    context
  );

  await service.transitionIssue(issue.id, TicketReworkIssueState.IN_REVIEW, context);
  await assert.rejects(
    service.transitionIssue(issue.id, TicketReworkIssueState.RESOLVED, context),
    /CRITICAL rework issue must be assigned before RESOLVED/
  );

  assert.equal(audit.list().length, 2);
  assert.equal(
    publisher.published.some((event) => event.name === 'ticket.rework.closed'),
    false
  );
  const outboxRecords = outbox.list();
  assert.equal(outboxRecords.length, 2);
  assert.ok(outboxRecords.every((record) => record.state === 'PUBLISHED'));
});
