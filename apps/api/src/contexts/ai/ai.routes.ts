import type { AiService, SummarizeWorkOrderNotesInput } from './ai.service.js';

export interface AiRoutes {
  summarizeWorkOrderNotes(
    input: SummarizeWorkOrderNotesInput,
    correlationId: string,
    actorId?: string
  ): ReturnType<AiService['summarizeWorkOrderNotes']>;
}

export function createAiRoutes(service: AiService): AiRoutes {
  return {
    summarizeWorkOrderNotes(input, correlationId, actorId) {
      return service.summarizeWorkOrderNotes(input, { correlationId, actorId, module: 'ai' });
    }
  };
}
