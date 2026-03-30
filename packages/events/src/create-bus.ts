import type { EventBus } from './event-bus.js';
import { InMemoryEventBus } from './event-bus.js';
import { EventBridgeEventBus } from './eventbridge-bus.js';

export function createEventBus(): EventBus {
  if (process.env.NODE_ENV === 'production') {
    return new EventBridgeEventBus();
  }
  return new InMemoryEventBus();
}
