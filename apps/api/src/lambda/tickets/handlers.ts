import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';

const prisma = new PrismaClient();

// ─── Technician Tasks ─────────────────────────────────────────────────────────

export const listTasksHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const workOrderId = qs.workOrderId;
  const technicianId = qs.technicianId;
  const state = qs.state as string | undefined;
  const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);

  const where = {
    ...(workOrderId ? { workOrderId } : {}),
    ...(technicianId ? { technicianId } : {}),
    ...(state ? { state: state as 'READY' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED' } : {}),
  };

  const items = await prisma.technicianTask.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });

  return jsonResponse(200, { items: items.map(toTaskResponse) });
}, { requireAuth: false });

export const createTaskHandler = wrapHandler(async (ctx) => {
  const body = parseBody<{ workOrderId: string; routingStepId: string; technicianId?: string }>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { workOrderId, routingStepId, technicianId } = body.value;
  if (!workOrderId) return jsonResponse(422, { message: 'workOrderId is required.' });
  if (!routingStepId) return jsonResponse(422, { message: 'routingStepId is required.' });

  const task = await prisma.technicianTask.create({
    data: {
      id: randomUUID(),
      workOrderId,
      routingStepId,
      technicianId: technicianId ?? null,
      state: 'READY',
      correlationId: ctx.correlationId,
      updatedAt: new Date(),
    },
  });

  return jsonResponse(201, { task: toTaskResponse(task) });
}, { requireAuth: false });

const TASK_TRANSITIONS: Record<string, string[]> = {
  READY: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'DONE', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

export const transitionTaskHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Task ID is required.' });

  const body = parseBody<{ state: string; blockedReason?: string; technicianId?: string }>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { state: nextState, blockedReason, technicianId } = body.value;
  if (!nextState) return jsonResponse(422, { message: 'state is required.' });

  const existing = await prisma.technicianTask.findUnique({ where: { id } });
  if (!existing) return jsonResponse(404, { message: `Task not found: ${id}` });

  const allowed = TASK_TRANSITIONS[existing.state as string] ?? [];
  if (!allowed.includes(nextState)) {
    return jsonResponse(409, {
      message: `Cannot transition task from ${existing.state} to ${nextState}.`,
      allowedTransitions: allowed,
    });
  }

  const now = new Date();
  const task = await prisma.technicianTask.update({
    where: { id },
    data: {
      state: nextState as 'READY' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED',
      updatedAt: now,
      ...(nextState === 'IN_PROGRESS' && !existing.startedAt ? { startedAt: now } : {}),
      ...(nextState === 'DONE' ? { completedAt: now } : {}),
      ...(nextState === 'BLOCKED' && blockedReason ? { blockedReason } : {}),
      ...(technicianId ? { technicianId } : {}),
    },
  });

  return jsonResponse(200, { task: toTaskResponse(task) });
}, { requireAuth: false });

// ─── Rework Issues ────────────────────────────────────────────────────────────

export const listReworkHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const workOrderId = qs.workOrderId;
  const state = qs.state as string | undefined;
  const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);

  const where = {
    ...(workOrderId ? { workOrderId } : {}),
    ...(state ? { state: state as 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'REOPENED' | 'CLOSED' } : {}),
  };

  const items = await prisma.reworkIssue.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return jsonResponse(200, { items: items.map(toReworkResponse) });
}, { requireAuth: false });

export const createReworkHandler = wrapHandler(async (ctx) => {
  const body = parseBody<{
    workOrderId: string;
    title: string;
    description: string;
    severity: string;
    reportedBy: string;
    assignedTo?: string;
  }>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { workOrderId, title, description, severity, reportedBy, assignedTo } = body.value;
  if (!workOrderId) return jsonResponse(422, { message: 'workOrderId is required.' });
  if (!title?.trim()) return jsonResponse(422, { message: 'title is required.' });
  if (!description?.trim()) return jsonResponse(422, { message: 'description is required.' });
  if (!severity) return jsonResponse(422, { message: 'severity is required.' });
  if (!reportedBy) return jsonResponse(422, { message: 'reportedBy is required.' });

  const issue = await prisma.reworkIssue.create({
    data: {
      id: randomUUID(),
      workOrderId,
      title: title.trim(),
      description: description.trim(),
      severity: severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
      state: 'OPEN',
      reportedBy,
      assignedTo: assignedTo ?? null,
      correlationId: ctx.correlationId,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return jsonResponse(201, { issue: toReworkResponse(issue) });
}, { requireAuth: false });

// ─── Invoice Sync ─────────────────────────────────────────────────────────────

export const listInvoiceSyncHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const state = qs.state as string | undefined;
  const workOrderId = qs.workOrderId;
  const limit = Math.min(parseInt(qs.limit ?? '50', 10), 200);

  const where = {
    ...(state ? { state: state as 'PENDING' | 'IN_PROGRESS' | 'SYNCED' | 'FAILED' | 'CANCELLED' } : {}),
    ...(workOrderId ? { workOrderId } : {}),
  };

  const items = await prisma.invoiceSyncRecord.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return jsonResponse(200, { items: items.map(toSyncResponse) });
}, { requireAuth: false });

// ─── Response mappers ─────────────────────────────────────────────────────────

function toTaskResponse(r: {
  id: string; workOrderId: string; routingStepId: string; technicianId: string | null;
  state: string; startedAt?: Date | null; completedAt?: Date | null;
  blockedReason?: string | null; updatedAt: Date;
}) {
  return {
    id: r.id,
    workOrderId: r.workOrderId,
    routingStepId: r.routingStepId,
    technicianId: r.technicianId ?? undefined,
    state: r.state,
    startedAt: r.startedAt?.toISOString(),
    completedAt: r.completedAt?.toISOString(),
    blockedReason: r.blockedReason ?? undefined,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toReworkResponse(r: {
  id: string; workOrderId: string; title: string; description: string;
  severity: string; state: string; reportedBy: string; assignedTo: string | null;
  createdAt: Date; resolvedAt?: Date | null;
}) {
  return {
    id: r.id,
    workOrderId: r.workOrderId,
    title: r.title,
    description: r.description,
    severity: r.severity,
    state: r.state,
    reportedBy: r.reportedBy,
    assignedTo: r.assignedTo ?? undefined,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString(),
  };
}

function toSyncResponse(r: {
  id: string; invoiceNumber: string; workOrderId: string; provider: string;
  state: string; attemptCount: number; lastErrorCode: string | null;
  lastErrorMessage: string | null; externalReference: string | null;
  createdAt: Date; syncedAt?: Date | null;
}) {
  return {
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    workOrderId: r.workOrderId,
    provider: r.provider,
    state: r.state,
    attemptCount: r.attemptCount,
    lastErrorCode: r.lastErrorCode ?? undefined,
    lastErrorMessage: r.lastErrorMessage ?? undefined,
    externalReference: r.externalReference ?? undefined,
    createdAt: r.createdAt.toISOString(),
    syncedAt: r.syncedAt?.toISOString(),
  };
}
