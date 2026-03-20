import { randomUUID } from 'node:crypto';
import type { PrismaClient, LaborTimeEntry } from '@prisma/client';
import type { CreateLaborTimeEntryInput } from '../../../../../packages/domain/src/model/tickets.js';

export interface LaborTimeEntryWithHours extends LaborTimeEntry {
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

function withHours(entry: LaborTimeEntry): LaborTimeEntryWithHours {
  return { ...entry, computedHours: computeHours(entry) };
}

export class TimeEntryService {
  constructor(private readonly db: PrismaClient) {}

  async listEntries(params: {
    workOrderId: string;
    technicianId?: string;
  }): Promise<LaborTimeEntryWithHours[]> {
    const entries = await this.db.laborTimeEntry.findMany({
      where: {
        workOrderId: params.workOrderId,
        ...(params.technicianId ? { technicianId: params.technicianId } : {}),
      },
      orderBy: { startedAt: 'desc' },
    });
    return entries.map(withHours);
  }

  async createEntry(
    input: CreateLaborTimeEntryInput & { correlationId: string },
  ): Promise<LaborTimeEntryWithHours> {
    const now = new Date();
    const entry = await this.db.laborTimeEntry.create({
      data: {
        id: randomUUID(),
        workOrderId: input.workOrderId,
        technicianId: input.technicianId,
        technicianTaskId: input.technicianTaskId ?? null,
        startedAt: new Date(input.startedAt),
        endedAt: input.endedAt ? new Date(input.endedAt) : null,
        manualHours: input.manualHours ?? null,
        description: input.description ?? null,
        source: input.source ?? 'MANUAL',
        createdAt: now,
        updatedAt: now,
      },
    });
    return withHours(entry);
  }

  async updateEntry(
    id: string,
    patch: { endedAt?: string; manualHours?: number; description?: string },
    _correlationId: string,
  ): Promise<LaborTimeEntryWithHours> {
    const entry = await this.db.laborTimeEntry.update({
      where: { id },
      data: {
        ...(patch.endedAt !== undefined ? { endedAt: new Date(patch.endedAt) } : {}),
        ...(patch.manualHours !== undefined ? { manualHours: patch.manualHours } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        updatedAt: new Date(),
      },
    });
    return withHours(entry);
  }

  async deleteEntry(id: string): Promise<void> {
    await this.db.laborTimeEntry.delete({ where: { id } });
  }

  async autoStartEntry(params: {
    technicianTaskId: string;
    workOrderId: string;
    technicianId: string;
    correlationId: string;
  }): Promise<LaborTimeEntryWithHours> {
    const now = new Date();
    const entry = await this.db.laborTimeEntry.create({
      data: {
        id: randomUUID(),
        workOrderId: params.workOrderId,
        technicianId: params.technicianId,
        technicianTaskId: params.technicianTaskId,
        startedAt: now,
        endedAt: null,
        source: 'AUTO',
        createdAt: now,
        updatedAt: now,
      },
    });
    return withHours(entry);
  }

  async autoEndEntry(params: {
    technicianTaskId: string;
    correlationId: string;
  }): Promise<void> {
    const openEntry = await this.db.laborTimeEntry.findFirst({
      where: {
        technicianTaskId: params.technicianTaskId,
        source: 'AUTO',
        endedAt: null,
      },
    });
    if (!openEntry) return;

    await this.db.laborTimeEntry.update({
      where: { id: openEntry.id },
      data: { endedAt: new Date(), updatedAt: new Date() },
    });
  }
}
