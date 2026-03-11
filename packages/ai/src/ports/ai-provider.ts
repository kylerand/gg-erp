export interface AiPromptRequest {
  correlationId: string;
  instruction: string;
  context: string;
}

export interface AiPromptResponse {
  content: string;
  model: string;
}

export interface AiProvider {
  summarize(request: AiPromptRequest): Promise<AiPromptResponse>;
}
