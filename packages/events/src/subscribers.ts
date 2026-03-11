import type { EventEnvelope, EventName } from './event-types.js';

export interface EventSubscriberRegistry {
  register<TPayload>(eventName: EventName, handler: (event: EventEnvelope<TPayload>) => Promise<void>): void;
  get(eventName: EventName): ((event: EventEnvelope<unknown>) => Promise<void>) | undefined;
}

export class InMemorySubscriberRegistry implements EventSubscriberRegistry {
  private readonly handlers = new Map<EventName, (event: EventEnvelope<unknown>) => Promise<void>>();

  register<TPayload>(
    eventName: EventName,
    handler: (event: EventEnvelope<TPayload>) => Promise<void>
  ): void {
    this.handlers.set(eventName, handler as (event: EventEnvelope<unknown>) => Promise<void>);
  }

  get(eventName: EventName): ((event: EventEnvelope<unknown>) => Promise<void>) | undefined {
    return this.handlers.get(eventName);
  }
}
