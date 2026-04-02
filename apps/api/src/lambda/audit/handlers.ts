import { PrismaClient } from '@prisma/client';
import { wrapHandler, jsonResponse } from '../../shared/lambda/index.js';

const prisma = new PrismaClient();

export const listAuditEventsHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const search = qs.search?.trim();
    const action = qs.action?.trim();
    const entityType = qs.entityType?.trim();
    const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);
    const offset = parseInt(qs.offset ?? '0', 10);

    const where = {
      ...(action ? { action } : {}),
      ...(entityType ? { entityType } : {}),
      ...(search
        ? {
            OR: [
              { action: { contains: search, mode: 'insensitive' as const } },
              { entityType: { contains: search, mode: 'insensitive' as const } },
              { entityId: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.auditEvent.count({ where }),
    ]);

    return jsonResponse(200, {
      items: items.map((e) => ({
        id: e.id,
        actorId: e.actorId,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        correlationId: e.correlationId,
        metadata: e.metadata,
        createdAt: e.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    });
  },
  { requireAuth: false },
);
