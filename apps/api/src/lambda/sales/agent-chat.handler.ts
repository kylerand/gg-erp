/**
 * POST /sales/agent/chat — AI Sales Copilot chat endpoint.
 * Accepts a message, runs the Bedrock-powered agent, returns the response.
 */
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';
import { processChat } from './agent-core.js';

export const handler = wrapHandler(
  async (ctx) => {
    const parsed = parseBody<{ message?: string; sessionId?: string; opportunityId?: string }>(
      ctx.event
    );
    if (!parsed.ok) {
      return jsonResponse(400, { error: parsed.error });
    }
    const body = parsed.value;
    const message = body.message;
    if (!message || typeof message !== 'string') {
      return jsonResponse(400, { error: 'Missing "message" in request body' });
    }

    const userId = ctx.userId ?? '00000000-0000-0000-0000-000000000000';

    const result = await processChat(
      {
        sessionId: body.sessionId,
        message,
        opportunityId: body.opportunityId,
      },
      userId
    );

    return jsonResponse(200, result);
  },
  { requireAuth: true, allowedRoles: ['admin', 'sales', 'manager'] }
);
