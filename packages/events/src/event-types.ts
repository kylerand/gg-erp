import { randomUUID } from 'node:crypto';
import type { DomainEventName } from '../../domain/src/events.js';

export type EventName = DomainEventName;

export interface EventEnvelope<TPayload = unknown> {
  id?: string;
  name: EventName;
  correlationId: string;
  emittedAt: string;
  payload: TPayload;
}

export function createEventEnvelope<TPayload>(
  name: EventName,
  correlationId: string,
  payload: TPayload
): EventEnvelope<TPayload> {
  return {
    id: randomUUID(),
    name,
    correlationId,
    emittedAt: new Date().toISOString(),
    payload
  };
}
