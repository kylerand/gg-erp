/**
 * GET /sales/agent/sessions/{sessionId} — Get full chat session with messages.
 */
import { PrismaClient } from '@prisma/client';

import { wrapHandler, jsonResponse } from '../../shared/lambda/index.js';

let prisma: PrismaClient | undefined;
function getDb(): PrismaClient {
  prisma ??= new PrismaClient();
  return prisma;
}

export const handler = wrapHandler(
  async (ctx) => {
    const db = getDb();
    const sessionId = ctx.event.pathParameters?.sessionId;
    if (!sessionId) {
      return jsonResponse(400, { error: 'Missing sessionId' });
    }

    const session = await db.agentChatSession.findUnique({
      where: { id: sessionId },
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
      return jsonResponse(404, { error: 'Session not found' });
    }

    return jsonResponse(200, {
      id: session.id,
      userId: session.userId,
      opportunityId: session.opportunityId,
      startedAt: session.startedAt,
      lastMessageAt: session.lastMessageAt,
      messages: session.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        toolsUsed: m.toolCalls
          ? (m.toolCalls as Array<{ name: string }>).map((tc) => tc.name)
          : [],
        createdAt: m.createdAt,
      })),
    });
  },
  { requireAuth: true, allowedRoles: ['admin', 'sales', 'manager'] }
);
