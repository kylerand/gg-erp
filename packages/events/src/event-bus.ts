import type { EventEnvelope, EventName } from './event-types.js';

export interface EventPublisher {
  publish<TPayload>(event: EventEnvelope<TPayload>): Promise<void>;
}

export type OutboxState = 'PENDING' | 'PUBLISHED' | 'FAILED';

export interface OutboxRecord<TPayload> {
  id: string;
  name: EventName;
  correlationId: string;
  payload: TPayload;
  state: OutboxState;
  emittedAt: string;
  publishedAt?: string;
  failedAt?: string;
  failureReason?: string;
}

export interface OutboxStateUpdate {
  updatedAt: string;
  failureReason?: string;
}

export interface OutboxWriter {
  append<TPayload>(record: OutboxRecord<TPayload>): Promise<OutboxRecord<TPayload>>;
  updateState<TPayload>(
    recordId: string,
    state: Exclude<OutboxState, 'PENDING'>,
    update: OutboxStateUpdate
  ): Promise<OutboxRecord<TPayload>>;
}

export type EventSubscriber<TPayload = unknown> = (event: EventEnvelope<TPayload>) => Promise<void>;

export interface EventBus {
  register<TPayload>(eventName: EventName, subscriber: EventSubscriber<TPayload>): void;
  publish<TPayload>(event: EventEnvelope<TPayload>): Promise<void>;
}

export class InMemoryOutbox implements OutboxWriter {
  private readonly records: OutboxRecord<unknown>[] = [];

  async append<TPayload>(record: OutboxRecord<TPayload>): Promise<OutboxRecord<TPayload>> {
    this.records.push(record as OutboxRecord<unknown>);
    return record;
  }

  async updateState<TPayload>(
    recordId: string,
    state: Exclude<OutboxState, 'PENDING'>,
    update: OutboxStateUpdate
  ): Promise<OutboxRecord<TPayload>> {
    const index = this.records.findIndex((record) => record.id === recordId);
    if (index === -1) {
      throw new Error(`Outbox record not found: ${recordId}`);
    }

    const existing = this.records[index];
    if (existing.state !== 'PENDING') {
      throw new Error(
        `Outbox record ${recordId} is already finalized as ${existing.state}`
      );
    }

    const next: OutboxRecord<unknown> = {
      ...existing,
      state,
      publishedAt: state === 'PUBLISHED' ? update.updatedAt : undefined,
      failedAt: state === 'FAILED' ? update.updatedAt : undefined,
      failureReason: state === 'FAILED' ? update.failureReason : undefined
    };
    this.records[index] = next;
    return next as OutboxRecord<TPayload>;
  }

  list(): OutboxRecord<unknown>[] {
    return [...this.records];
  }
}

export class InMemoryEventBus implements EventBus, EventPublisher {
  private readonly subscribers = new Map<EventName, EventSubscriber[]>();

  register<TPayload>(eventName: EventName, subscriber: EventSubscriber<TPayload>): void {
    const existing = this.subscribers.get(eventName) ?? [];
    existing.push(subscriber as EventSubscriber);
    this.subscribers.set(eventName, existing);
  }

  async publish<TPayload>(event: EventEnvelope<TPayload>): Promise<void> {
    const subscribers = this.subscribers.get(event.name) ?? [];
    for (const subscriber of subscribers) {
      await subscriber(event);
    }
  }
}
