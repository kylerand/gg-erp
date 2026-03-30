import { randomUUID } from 'node:crypto';
import type { PrismaClient, LaborTimeEntry } from '@prisma/client';

export interface TimeEntryWithHours extends LaborTimeEntry {
  computedHours: number;
}

function computeHours(entry: LaborTimeEntry): number {
  if (entry.manualHours !== null && entry.manualHours !== undefined) {
    return Number(entry.manualHours);
  }
  if (entry.endedAt) {
    const ms = entry.endedAt.getTime() - entry.startedAt.getTime();
    return ms / (1000 * 60 * 60);
  }
  return 0;
}

function withHours(entry: LaborTimeEntry): TimeEntryWithHours {
  return { ...entry, computedHours: computeHours(entry) };
}

export interface ListTimeEntriesFilters {
  userId?: string;
  workOrderId?: string;
  date?: string;
}

export interface CreateTimeEntryInput {
  userId: string;
  workOrderId: string;
  startTime: string;
  endTime?: string;
  notes?: string;
  technicianTaskId?: string;
  source?: string;
}

export interface UpdateTimeEntryInput {
  endTime?: string;
  notes?: string;
  manualHours?: number;
}

export class TimeEntryContextService {
  constructor(private readonly db: PrismaClient) {}

  async listTimeEntries(filters: ListTimeEntriesFilters): Promise<TimeEntryWithHours[]> {
    const where = {
      ...(filters.userId ? { technicianId: filters.userId } : {}),
      ...(filters.workOrderId ? { workOrderId: filters.workOrderId } : {}),
      ...(filters.date
        ? {
            startedAt: {
              gte: new Date(`${filters.date}T00:00:00.000Z`),
              lt: new Date(
                new Date(`${filters.date}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000,
              ),
            },
          }
        : {}),
    };

    const entries = await this.db.laborTimeEntry.findMany({
      where,
      orderBy: { startedAt: 'desc' },
    });
    return entries.map(withHours);
  }

  async createTimeEntry(
    data: CreateTimeEntryInput & { correlationId: string },
  ): Promise<TimeEntryWithHours> {
    const now = new Date();
    const entry = await this.db.laborTimeEntry.create({
      data: {
        id: randomUUID(),
        workOrderId: data.workOrderId,
        technicianId: data.userId,
        technicianTaskId: data.technicianTaskId ?? null,
        startedAt: new Date(data.startTime),
        endedAt: data.endTime ? new Date(data.endTime) : null,
        description: data.notes ?? null,
        source: data.source ?? 'MANUAL',
        createdAt: now,
        updatedAt: now,
      },
    });
    return withHours(entry);
  }

  async updateTimeEntry(id: string, data: UpdateTimeEntryInput): Promise<TimeEntryWithHours> {
    const entry = await this.db.laborTimeEntry.update({
      where: { id },
      data: {
        ...(data.endTime !== undefined ? { endedAt: new Date(data.endTime) } : {}),
        ...(data.notes !== undefined ? { description: data.notes } : {}),
        ...(data.manualHours !== undefined ? { manualHours: data.manualHours } : {}),
        updatedAt: new Date(),
      },
    });
    return withHours(entry);
  }

  async deleteTimeEntry(id: string): Promise<void> {
    await this.db.laborTimeEntry.delete({ where: { id } });
  }
}
