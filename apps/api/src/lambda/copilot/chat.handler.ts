/**
 * POST /copilot/chat — Global ERP copilot chat endpoint.
 */
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';
import { processCopilotChat } from './copilot-core.js';

export const handler = wrapHandler(
  async (ctx) => {
    const parsed = parseBody<{ message?: string; sessionId?: string; context?: string }>(
      ctx.event
    );
    if (!parsed.ok) {
      return jsonResponse(400, { message: parsed.error, correlationId: ctx.correlationId });
    }

    const { message, sessionId, context } = parsed.value;
    if (!message || !message.trim()) {
      return jsonResponse(400, {
        message: 'message is required',
        correlationId: ctx.correlationId,
      });
    }

    const result = await processCopilotChat(
      { message, sessionId, context },
      ctx.actorUserId!
    );

    return jsonResponse(200, result);
  },
  { requireAuth: true, allowedRoles: [] }
);
