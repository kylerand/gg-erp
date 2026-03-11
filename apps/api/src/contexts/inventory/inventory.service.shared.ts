import type { AuditSink } from '../../audit/index.js';
import type { DomainEventName } from '../../events/catalog.js';
import {
  type EventEnvelope,
  type EventPublisher,
  type OutboxWriter,
  publishWithOutbox
} from '../../events/index.js';
import type { ObservabilityContext, ObservabilityHooks } from '../../observability/hooks.js';
import type { InventoryRepository } from './inventory.repository.js';

export interface InventoryServiceDeps {
  repository: InventoryRepository;
  audit: AuditSink;
  publisher: EventPublisher;
  outbox: OutboxWriter;
  observability: ObservabilityHooks;
}

export interface CommandContext extends Pick<ObservabilityContext, 'correlationId' | 'actorId'> {
  module: string;
}

interface MutationRecordInput {
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  eventName: DomainEventName;
  successMetricName: string;
}

export class InventoryServiceSupport {
  constructor(private readonly deps: InventoryServiceDeps) {}

  async withObservedExecution<T>(
    operation: string,
    context: CommandContext,
    execute: () => Promise<T>
  ): Promise<T> {
    this.deps.observability.trace(operation, context);
    try {
      return await execute();
    } catch (error) {
      this.deps.observability.logError(
        `${operation} failed: ${this.toFailureMessage(error)}`,
        context
      );
      this.deps.observability.metric(`${operation}.failure`, 1, context);
      throw error;
    }
  }

  async recordMutation(input: MutationRecordInput, context: CommandContext): Promise<void> {
    await this.deps.audit.record({
      actorId: context.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      correlationId: context.correlationId,
      metadata: input.metadata,
      createdAt: new Date().toISOString()
    });
    await this.emitEvent(input.eventName, input.metadata, context);
    this.deps.observability.metric(input.successMetricName, 1, context);
  }

  async emitEvent(eventName: DomainEventName, payload: unknown, context: CommandContext): Promise<void> {
    const event: EventEnvelope<unknown> = {
      name: eventName,
      correlationId: context.correlationId,
      emittedAt: new Date().toISOString(),
      payload
    };
    await publishWithOutbox(this.deps.publisher, this.deps.outbox, event);
  }

  private toFailureMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
