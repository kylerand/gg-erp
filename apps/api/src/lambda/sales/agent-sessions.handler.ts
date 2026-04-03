/**
 * GET /sales/agent/sessions — List chat sessions for the current user.
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
    const userId = ctx.userId ?? '00000000-0000-0000-0000-000000000000';
    const limit = Math.min(Number(ctx.event.queryStringParameters?.limit ?? 20), 50);
    const offset = Number(ctx.event.queryStringParameters?.offset ?? 0);

    const [items, total] = await Promise.all([
      db.agentChatSession.findMany({
        where: { userId },
        orderBy: { lastMessageAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { content: true, createdAt: true },
          },
        },
      }),
      db.agentChatSession.count({ where: { userId } }),
    ]);

    return jsonResponse(200, {
      items: items.map((s) => ({
        id: s.id,
        opportunityId: s.opportunityId,
        startedAt: s.startedAt,
        lastMessageAt: s.lastMessageAt,
        lastMessage: s.messages[0]?.content?.substring(0, 100) ?? null,
      })),
      total,
      limit,
      offset,
    });
  },
  { requireAuth: true, allowedRoles: ['admin', 'sales', 'manager'] }
);
