import { PrismaClient } from '@prisma/client';
import type { EventBus } from './event-bus.js';
import type { EventEnvelope, EventName } from './event-types.js';

export interface OutboxProcessorOptions {
  batchSize?: number;
  prisma?: OutboxPrismaClient;
}

export interface OutboxProcessorResult {
  processed: number;
  published: number;
  failed: number;
}

interface OutboxRow {
  id: string;
  eventName: string;
  correlationId: string;
  payload: unknown;
  state: string;
  attemptCount: number;
  lastError: string | null;
  createdAt: Date;
  publishedAt: Date | null;
}

interface OutboxPrismaClient {
  eventOutbox: {
    findMany(args: {
      where: { state: string };
      orderBy: { createdAt: 'asc' | 'desc' };
      take: number;
    }): Promise<OutboxRow[]>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
}

export async function processOutbox(
  bus: EventBus,
  options: OutboxProcessorOptions = {},
): Promise<OutboxProcessorResult> {
  const batchSize = options.batchSize ?? 25;
  const prisma: OutboxPrismaClient = options.prisma ?? new PrismaClient();

  const pending: OutboxRow[] = await prisma.eventOutbox.findMany({
    where: { state: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });

  if (pending.length === 0) {
    return { processed: 0, published: 0, failed: 0 };
  }

  let published = 0;
  let failed = 0;

  for (const record of pending) {
    const envelope: EventEnvelope = {
      id: record.id,
      name: record.eventName as EventName,
      correlationId: record.correlationId,
      emittedAt: record.createdAt.toISOString(),
      payload: record.payload,
    };

    try {
      await bus.publish(envelope);

      await prisma.eventOutbox.update({
        where: { id: record.id },
        data: {
          state: 'PUBLISHED',
          publishedAt: new Date(),
          attemptCount: record.attemptCount + 1,
        },
      });

      published += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      await prisma.eventOutbox.update({
        where: { id: record.id },
        data: {
          state: 'FAILED',
          lastError: reason,
          attemptCount: record.attemptCount + 1,
        },
      });

      failed += 1;
    }
  }

  return { processed: pending.length, published, failed };
}
