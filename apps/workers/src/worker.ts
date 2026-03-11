import type { DomainEventName } from '../../../packages/domain/src/events.js';
import {
  InMemorySubscriberRegistry,
  type WorkerEvent,
  type WorkerEventHandler
} from './events/subscribers.js';
import { consoleWorkerLogger, type WorkerLogger } from './observability/logger.js';
import { consoleWorkerMetrics, type WorkerMetrics } from './observability/metrics.js';

export interface WorkerRuntimeOptions {
  maxRetries: number;
  logger?: WorkerLogger;
  metrics?: WorkerMetrics;
}

export class WorkerRuntime {
  private readonly registry = new InMemorySubscriberRegistry();
  private readonly maxRetries: number;
  private readonly logger: WorkerLogger;
  private readonly metrics: WorkerMetrics;

  constructor(options: WorkerRuntimeOptions) {
    this.maxRetries = options.maxRetries;
    this.logger = options.logger ?? consoleWorkerLogger;
    this.metrics = options.metrics ?? consoleWorkerMetrics;
  }

  register(eventName: DomainEventName, handler: WorkerEventHandler): void {
    this.registry.register(eventName, handler);
  }

  async handle(event: WorkerEvent): Promise<void> {
    const handler = this.registry.get(event.name);
    if (!handler) {
      this.logger.info('No handler registered for event', { eventName: event.name });
      this.metrics.increment('worker.event.unhandled', 1, { eventName: event.name });
      return;
    }

    let attempt = 0;
    while (attempt < this.maxRetries) {
      attempt += 1;
      try {
        await handler(event);
        this.metrics.increment('worker.event.processed', 1, { eventName: event.name });
        return;
      } catch (error) {
        this.logger.error('Worker event handling failed', {
          eventName: event.name,
          correlationId: event.correlationId,
          attempt,
          error: error instanceof Error ? error.message : String(error)
        });

        if (attempt >= this.maxRetries) {
          this.metrics.increment('worker.event.failed', 1, { eventName: event.name });
          throw error;
        }
      }
    }
  }
}
