import type { EventEnvelope } from '../../../events/src/event-types.js';
import type { AiProvider } from '../ports/ai-provider.js';
import { summarizeWorkOrder } from '../services/summarize-work-order.js';

export async function handleWorkOrderCompletedForAi(
  provider: AiProvider,
  event: EventEnvelope<{ id?: string; notes?: string }>
): Promise<string> {
  if (!event.payload?.id) {
    throw new Error('work_order.completed payload must include id');
  }

  return summarizeWorkOrder(provider, {
    correlationId: event.correlationId,
    workOrderId: event.payload.id,
    notes: event.payload.notes ?? ''
  });
}
