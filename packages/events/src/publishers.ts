import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from './event-types.js';
import type { EventPublisher, OutboxRecord, OutboxWriter } from './event-bus.js';

function toFailureReason(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export class InMemoryEventPublisher implements EventPublisher {
  readonly published: EventEnvelope<unknown>[] = [];

  async publish<TPayload>(event: EventEnvelope<TPayload>): Promise<void> {
    this.published.push(event as EventEnvelope<unknown>);
  }
}

export async function publishWithOutbox<TPayload>(
  publisher: EventPublisher,
  outbox: OutboxWriter,
  event: EventEnvelope<TPayload>
): Promise<OutboxRecord<TPayload>> {
  const pending = await outbox.append({
    id: randomUUID(),
    name: event.name,
    correlationId: event.correlationId,
    payload: event.payload,
    state: 'PENDING',
    emittedAt: event.emittedAt
  });

  try {
    await publisher.publish(event);
  } catch (error) {
    await outbox.updateState(pending.id, 'FAILED', {
      updatedAt: new Date().toISOString(),
      failureReason: toFailureReason(error)
    });
    throw error;
  }

  return outbox.updateState(pending.id, 'PUBLISHED', {
    updatedAt: new Date().toISOString()
  });
}
