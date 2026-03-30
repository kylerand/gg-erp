import { EventBridgeEventBus } from '@gg-erp/events';
import { processOutbox } from '@gg-erp/events';
import { consoleWorkerLogger } from './observability/logger.js';

export async function handler(): Promise<{ statusCode: number; body: string }> {
  consoleWorkerLogger.info('Outbox publisher invoked');

  const bus = new EventBridgeEventBus();
  const result = await processOutbox(bus);

  consoleWorkerLogger.info('Outbox publisher completed', {
    processed: result.processed,
    published: result.published,
    failed: result.failed,
  });

  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
}
