import type {
  AiPromptRequest,
  AiPromptResponse,
  AiProvider
} from '../../../../../packages/ai/src/ports/ai-provider.js';

export class BaselineAiProvider implements AiProvider {
  async summarize(request: AiPromptRequest): Promise<AiPromptResponse> {
    const notes = request.context
      .split('\n')
      .slice(1)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const content = notes.length > 120 ? `${notes.slice(0, 117)}...` : notes;
    return {
      content: content || 'No work order notes provided.',
      model: 'baseline-heuristic-v1'
    };
  }
}
