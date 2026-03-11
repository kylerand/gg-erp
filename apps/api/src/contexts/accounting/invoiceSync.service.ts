import { randomUUID } from 'node:crypto';
import {
  InvariantViolationError,
  InvoiceSyncRecordDesign,
  InvoiceSyncState,
  type InvoiceSyncRecord,
  assertTransitionAllowed
} from '../../../../../packages/domain/src/model/index.js';
import { AUDIT_POINTS, type AuditSink } from '../../audit/index.js';
import {
  type EventEnvelope,
  type EventPublisher,
  type OutboxWriter,
  publishWithOutbox
} from '../../events/index.js';
import type { ObservabilityContext, ObservabilityHooks } from '../../observability/hooks.js';

export interface CommandContext extends Pick<ObservabilityContext, 'correlationId' | 'actorId'> {
  module: string;
}

export interface InvoiceSyncServiceDeps {
  audit: AuditSink;
  publisher: EventPublisher;
  outbox: OutboxWriter;
  observability: ObservabilityHooks;
}

export interface CreateInvoiceSyncInput {
  invoiceNumber: string;
  workOrderId: string;
  provider: InvoiceSyncRecord['provider'];
}

export class InvoiceSyncService {
  private readonly records = new Map<string, InvoiceSyncRecord>();

  constructor(private readonly deps: InvoiceSyncServiceDeps) {}

  async createRecord(
    input: CreateInvoiceSyncInput,
    context: CommandContext
  ): Promise<InvoiceSyncRecord> {
    const duplicate = [...this.records.values()].find(
      (record) => record.invoiceNumber === input.invoiceNumber
    );
    if (duplicate) {
      throw new InvariantViolationError(
        `Invoice sync record already exists: ${input.invoiceNumber}`
      );
    }

    const now = new Date().toISOString();
    const record: InvoiceSyncRecord = {
      id: randomUUID(),
      invoiceNumber: input.invoiceNumber,
      workOrderId: input.workOrderId,
      provider: input.provider,
      state: InvoiceSyncState.PENDING,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now
    };
    this.records.set(record.id, record);
    await this.record(record.id, record, 'invoice_sync.started', context);
    return record;
  }

  async startSync(recordId: string, context: CommandContext): Promise<InvoiceSyncRecord> {
    const existing = this.requireRecord(recordId);
    if (existing.state !== InvoiceSyncState.PENDING && existing.state !== InvoiceSyncState.FAILED) {
      throw new InvariantViolationError(
        `Cannot start sync from state ${existing.state}`
      );
    }

    assertTransitionAllowed(existing.state, InvoiceSyncState.IN_PROGRESS, InvoiceSyncRecordDesign.lifecycle);
    const updated: InvoiceSyncRecord = {
      ...existing,
      state: InvoiceSyncState.IN_PROGRESS,
      attemptCount: existing.attemptCount + 1,
      updatedAt: new Date().toISOString(),
      lastErrorCode: undefined,
      lastErrorMessage: undefined
    };
    this.records.set(recordId, updated);
    const eventName =
      existing.state === InvoiceSyncState.FAILED
        ? 'invoice_sync.retried'
        : 'invoice_sync.started';
    await this.record(recordId, { before: existing.state, after: updated.state }, eventName, context);
    return updated;
  }

  async markSuccess(
    recordId: string,
    externalReference: string,
    context: CommandContext
  ): Promise<InvoiceSyncRecord> {
    const existing = this.requireRecord(recordId);
    assertTransitionAllowed(existing.state, InvoiceSyncState.SYNCED, InvoiceSyncRecordDesign.lifecycle);
    const updated: InvoiceSyncRecord = {
      ...existing,
      state: InvoiceSyncState.SYNCED,
      externalReference,
      syncedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.records.set(recordId, updated);
    await this.record(recordId, { externalReference }, 'invoice_sync.succeeded', context);
    return updated;
  }

  async markFailure(
    recordId: string,
    errorCode: string,
    errorMessage: string,
    context: CommandContext
  ): Promise<InvoiceSyncRecord> {
    const existing = this.requireRecord(recordId);
    assertTransitionAllowed(existing.state, InvoiceSyncState.FAILED, InvoiceSyncRecordDesign.lifecycle);
    const updated: InvoiceSyncRecord = {
      ...existing,
      state: InvoiceSyncState.FAILED,
      lastErrorCode: errorCode,
      lastErrorMessage: errorMessage,
      updatedAt: new Date().toISOString()
    };
    this.records.set(recordId, updated);
    await this.record(
      recordId,
      { errorCode, errorMessage, attemptCount: updated.attemptCount },
      'invoice_sync.failed',
      context
    );
    return updated;
  }

  getRecord(recordId: string): InvoiceSyncRecord | undefined {
    return this.records.get(recordId);
  }

  private requireRecord(recordId: string): InvoiceSyncRecord {
    const record = this.records.get(recordId);
    if (!record) {
      throw new InvariantViolationError(`InvoiceSyncRecord not found: ${recordId}`);
    }
    return record;
  }

  private async record(
    recordId: string,
    metadata: unknown,
    eventName:
      | 'invoice_sync.started'
      | 'invoice_sync.succeeded'
      | 'invoice_sync.failed'
      | 'invoice_sync.retried',
    context: CommandContext
  ): Promise<void> {
    await this.deps.audit.record({
      actorId: context.actorId,
      action:
        eventName === 'invoice_sync.failed'
          ? AUDIT_POINTS.invoiceSyncFail
          : eventName === 'invoice_sync.retried'
            ? AUDIT_POINTS.invoiceSyncRetry
            : AUDIT_POINTS.invoiceSyncStart,
      entityType: 'InvoiceSyncRecord',
      entityId: recordId,
      correlationId: context.correlationId,
      metadata,
      createdAt: new Date().toISOString()
    });

    const event: EventEnvelope<unknown> = {
      name: eventName,
      correlationId: context.correlationId,
      emittedAt: new Date().toISOString(),
      payload: metadata
    };
    await publishWithOutbox(this.deps.publisher, this.deps.outbox, event);
    this.deps.observability.metric('invoice_sync.transition', 1, context);
  }
}
