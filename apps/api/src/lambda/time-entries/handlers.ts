import { PrismaClient } from '@prisma/client';
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';
import {
  TimeEntryContextService,
  type CreateTimeEntryInput,
  type UpdateTimeEntryInput,
} from '../../contexts/time-entry/time-entry.service.js';

let prisma: PrismaClient | undefined;
let timeEntryService: TimeEntryContextService | undefined;
let serviceOverride:
  | Pick<
      TimeEntryContextService,
      'listTimeEntries' | 'createTimeEntry' | 'updateTimeEntry' | 'deleteTimeEntry'
    >
  | undefined;

function getPrisma(): PrismaClient {
  prisma ??= new PrismaClient();
  return prisma;
}

function getService(): TimeEntryContextService {
  if (serviceOverride) return serviceOverride as TimeEntryContextService;
  timeEntryService ??= new TimeEntryContextService(getPrisma());
  return timeEntryService;
}

export function setTimeEntryServiceForTests(
  service:
    | Pick<
        TimeEntryContextService,
        'listTimeEntries' | 'createTimeEntry' | 'updateTimeEntry' | 'deleteTimeEntry'
      >
    | undefined,
): void {
  serviceOverride = service;
}

export async function disconnectTimeEntryDependencies(): Promise<void> {
  await prisma?.$disconnect();
  prisma = undefined;
  timeEntryService = undefined;
  serviceOverride = undefined;
}

// ─── List Time Entries ────────────────────────────────────────────────────────

export const listTimeEntriesHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};

  const entries = await getService().listTimeEntries({
    userId: qs.userId,
    workOrderId: qs.workOrderId,
    date: qs.date,
  });

  return jsonResponse(200, { entries: entries.map(toTimeEntryResponse) });
}, { requireAuth: false });

// ─── Create Time Entry ───────────────────────────────────────────────────────

export const createTimeEntryHandler = wrapHandler(async (ctx) => {
  const body = parseBody<CreateTimeEntryInput>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const input = body.value;
  if (!input.workOrderId) return jsonResponse(422, { message: 'workOrderId is required.' });
  if (!input.userId) return jsonResponse(422, { message: 'userId is required.' });
  if (!input.startTime) return jsonResponse(422, { message: 'startTime is required.' });

  const entry = await getService().createTimeEntry({
    ...input,
    correlationId: ctx.correlationId,
  });

  return jsonResponse(201, { entry: toTimeEntryResponse(entry) });
}, { requireAuth: false });

// ─── Update Time Entry ───────────────────────────────────────────────────────

export const updateTimeEntryHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Time entry ID is required.' });

  const body = parseBody<UpdateTimeEntryInput>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const entry = await getService().updateTimeEntry(id, body.value);
  return jsonResponse(200, { entry: toTimeEntryResponse(entry) });
}, { requireAuth: false });

// ─── Delete Time Entry ───────────────────────────────────────────────────────

export const deleteTimeEntryHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Time entry ID is required.' });

  await getService().deleteTimeEntry(id);
  return jsonResponse(204, {});
}, { requireAuth: false });

// ─── Response mapper ──────────────────────────────────────────────────────────

function toTimeEntryResponse(r: {
  id: string;
  workOrderId: string;
  technicianId: string;
  technicianTaskId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  manualHours: unknown;
  description: string | null;
  source: string;
  computedHours: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    workOrderId: r.workOrderId,
    userId: r.technicianId,
    technicianTaskId: r.technicianTaskId ?? undefined,
    startTime: r.startedAt.toISOString(),
    endTime: r.endedAt?.toISOString(),
    manualHours: r.manualHours !== null ? Number(r.manualHours) : undefined,
    notes: r.description ?? undefined,
    source: r.source,
    computedHours: r.computedHours,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
