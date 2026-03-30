import {
  EventBridgeClient,
  PutEventsCommand,
  type PutEventsRequestEntry,
} from '@aws-sdk/client-eventbridge';
import type { EventEnvelope, EventName } from './event-types.js';
import type { EventBus, EventPublisher, EventSubscriber } from './event-bus.js';

const EVENT_SOURCE = 'gg-erp';

export class EventBridgeEventBus implements EventBus, EventPublisher {
  private readonly client: EventBridgeClient;
  private readonly busName: string;
  private readonly subscribers = new Map<EventName, EventSubscriber[]>();

  constructor(client?: EventBridgeClient) {
    this.busName = process.env.EVENT_BUS_NAME ?? '';
    if (!this.busName) {
      throw new Error(
        'EVENT_BUS_NAME environment variable is required for EventBridgeEventBus',
      );
    }
    this.client = client ?? new EventBridgeClient({});
  }

  register<TPayload>(eventName: EventName, subscriber: EventSubscriber<TPayload>): void {
    const existing = this.subscribers.get(eventName) ?? [];
    existing.push(subscriber as EventSubscriber);
    this.subscribers.set(eventName, existing);
  }

  async publish<TPayload>(event: EventEnvelope<TPayload>): Promise<void> {
    const entry: PutEventsRequestEntry = {
      Source: EVENT_SOURCE,
      DetailType: event.name,
      Detail: JSON.stringify(event),
      EventBusName: this.busName,
    };

    const command = new PutEventsCommand({ Entries: [entry] });

    try {
      const result = await this.client.send(command);

      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        const failed = result.Entries?.find((e) => e.ErrorCode);
        const errorMessage = failed
          ? `EventBridge put failed: ${failed.ErrorCode} — ${failed.ErrorMessage}`
          : 'EventBridge put failed with unknown error';
        console.error(errorMessage, { eventName: event.name, correlationId: event.correlationId });
        throw new Error(errorMessage);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('EventBridge put failed')) {
        throw error;
      }
      console.error('Failed to publish event to EventBridge', {
        eventName: event.name,
        correlationId: event.correlationId,
        error,
      });
      throw new Error(
        `Failed to publish event ${event.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Notify local subscribers after successful publish
    const subscribers = this.subscribers.get(event.name) ?? [];
    for (const subscriber of subscribers) {
      await subscriber(event);
    }
  }
}
