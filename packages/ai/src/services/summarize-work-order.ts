import type { AiProvider } from '../ports/ai-provider.js';

export interface WorkOrderSummaryInput {
  correlationId: string;
  workOrderId: string;
  notes: string;
}

export async function summarizeWorkOrder(
  provider: AiProvider,
  input: WorkOrderSummaryInput
): Promise<string> {
  const response = await provider.summarize({
    correlationId: input.correlationId,
    instruction: 'Summarize this work order for shift handoff in under 120 words.',
    context: `workOrderId=${input.workOrderId}\n${input.notes}`
  });

  return response.content;
}
