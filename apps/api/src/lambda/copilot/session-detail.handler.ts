/**
 * GET /copilot/sessions/{sessionId} — Get copilot chat session detail.
 */
import { PrismaClient } from '@prisma/client';
import { wrapHandler, jsonResponse } from '../../shared/lambda/index.js';

let prisma: PrismaClient | undefined;
function getDb() {
  prisma ??= new PrismaClient();
  return prisma;
}

export const handler = wrapHandler(
  async (ctx) => {
    const db = getDb();
    const sessionId = ctx.event.pathParameters?.sessionId;
    if (!sessionId) {
      return jsonResponse(400, { message: 'sessionId is required' });
    }

    const session = await db.agentChatSession.findFirst({
      where: { id: sessionId, userId: ctx.actorUserId! },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            toolCalls: true,
            createdAt: true,
          },
        },
      },
    });

    if (!session) {
      return jsonResponse(404, { message: 'Session not found' });
    }

    return jsonResponse(200, session);
  },
  { requireAuth: true, allowedRoles: [] }
);
