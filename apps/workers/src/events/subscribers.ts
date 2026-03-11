import type { DomainEventName } from '../../../../packages/domain/src/events.js';

export interface WorkerEvent<TPayload = unknown> {
  id: string;
  name: DomainEventName;
  correlationId: string;
  payload: TPayload;
  emittedAt: string;
}

export type WorkerEventHandler = (event: WorkerEvent) => Promise<void>;

export interface EventSubscriberRegistry {
  register(eventName: DomainEventName, handler: WorkerEventHandler): void;
  get(eventName: DomainEventName): WorkerEventHandler | undefined;
}

export class InMemorySubscriberRegistry implements EventSubscriberRegistry {
  private readonly handlers = new Map<DomainEventName, WorkerEventHandler>();

  register(eventName: DomainEventName, handler: WorkerEventHandler): void {
    this.handlers.set(eventName, handler);
  }

  get(eventName: DomainEventName): WorkerEventHandler | undefined {
    return this.handlers.get(eventName);
  }
}
