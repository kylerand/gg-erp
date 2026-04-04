/**
 * GET /copilot/sessions — List copilot chat sessions for the current user.
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
    const sessions = await db.agentChatSession.findMany({
      where: { userId: ctx.actorUserId!, opportunityId: null },
      orderBy: { lastMessageAt: 'desc' },
      take: 30,
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { content: true, role: true },
        },
      },
    });

    return jsonResponse(200, {
      sessions: sessions.map((s) => ({
        id: s.id,
        startedAt: s.startedAt,
        lastMessageAt: s.lastMessageAt,
        preview: s.messages[0]?.content?.slice(0, 100) || '',
      })),
    });
  },
  { requireAuth: true, allowedRoles: [] }
);
