import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';

const prisma = new PrismaClient();

// ─── List SOPs ────────────────────────────────────────────────────────────────

export const listSopsHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const status = qs.status as string | undefined;
  const search = qs.search;
  const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);
  const offset = parseInt(qs.offset ?? '0', 10);

  const where = {
    deletedAt: null,
    ...(status ? { documentStatus: status as 'DRAFT' | 'PUBLISHED' | 'RETIRED' } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' as const } },
            { documentCode: { contains: search, mode: 'insensitive' as const } },
            { category: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.sopDocument.findMany({
      where,
      orderBy: { documentCode: 'asc' },
      take: limit,
      skip: offset,
      include: {
        docVersions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { versionNumber: true, effectiveAt: true, changeSummary: true },
        },
      },
    }),
    prisma.sopDocument.count({ where }),
  ]);

  return jsonResponse(200, { items: items.map(toSopResponse), total, limit, offset });
}, { requireAuth: false });

// ─── Get SOP ──────────────────────────────────────────────────────────────────

export const getSopHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'SOP document ID is required.' });

  const sop = await prisma.sopDocument.findUnique({
    where: { id },
    include: {
      docVersions: { orderBy: { versionNumber: 'desc' } },
    },
  });

  if (!sop || sop.deletedAt) return jsonResponse(404, { message: `SOP not found: ${id}` });

  return jsonResponse(200, { sop: toSopResponse(sop) });
}, { requireAuth: false });

// ─── Create SOP ───────────────────────────────────────────────────────────────

interface CreateSopBody {
  documentCode: string;
  title: string;
  category?: string;
  ownerEmployeeId?: string;
}

export const createSopHandler = wrapHandler(async (ctx) => {
  const body = parseBody<CreateSopBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { documentCode, title, category, ownerEmployeeId } = body.value;
  if (!documentCode?.trim()) return jsonResponse(422, { message: 'documentCode is required.' });
  if (!title?.trim()) return jsonResponse(422, { message: 'title is required.' });

  const existing = await prisma.sopDocument.findFirst({
    where: { documentCode: documentCode.trim(), deletedAt: null },
  });
  if (existing) {
    return jsonResponse(409, { message: `SOP with code ${documentCode} already exists.` });
  }

  const now = new Date();
  const sop = await prisma.sopDocument.create({
    data: {
      id: randomUUID(),
      documentCode: documentCode.trim(),
      title: title.trim(),
      documentStatus: 'DRAFT',
      category: category?.trim() ?? null,
      ownerEmployeeId: ownerEmployeeId ?? null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
  });

  return jsonResponse(201, { sop: toSopResponse(sop) });
}, { requireAuth: false });

// ─── Publish SOP Version ──────────────────────────────────────────────────────

interface PublishSopVersionBody {
  contentMarkdown: string;
  changeSummary?: string;
  effectiveAt?: string;
}

export const publishSopVersionHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'SOP document ID is required.' });

  const body = parseBody<PublishSopVersionBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { contentMarkdown, changeSummary, effectiveAt } = body.value;
  if (!contentMarkdown?.trim()) return jsonResponse(422, { message: 'contentMarkdown is required.' });

  const sop = await prisma.sopDocument.findUnique({ where: { id } });
  if (!sop || sop.deletedAt) return jsonResponse(404, { message: `SOP not found: ${id}` });
  if (sop.documentStatus === 'RETIRED') {
    return jsonResponse(409, { message: 'Cannot publish a version on a retired SOP.' });
  }

  const { createHash } = await import('node:crypto');
  const contentHash = createHash('sha256').update(contentMarkdown).digest('hex');

  const latestVersion = await prisma.sopDocumentVersion.findFirst({
    where: { sopDocumentId: id },
    orderBy: { versionNumber: 'desc' },
    select: { versionNumber: true },
  });
  const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;

  const [version] = await prisma.$transaction([
    prisma.sopDocumentVersion.create({
      data: {
        id: randomUUID(),
        sopDocumentId: id,
        versionNumber: nextVersionNumber,
        contentMarkdown: contentMarkdown.trim(),
        contentHash,
        changeSummary: changeSummary?.trim() ?? null,
        effectiveAt: effectiveAt ? new Date(effectiveAt) : null,
        correlationId: randomUUID(),
        createdAt: new Date(),
      },
    }),
    prisma.sopDocument.update({
      where: { id },
      data: {
        documentStatus: 'PUBLISHED',
        updatedAt: new Date(),
        version: { increment: 1 },
      },
    }),
  ]);

  return jsonResponse(201, { version });
}, { requireAuth: false });

// ─── List Training Modules ────────────────────────────────────────────────────

export const listTrainingModulesHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const status = qs.status as string | undefined;
  const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);
  const offset = parseInt(qs.offset ?? '0', 10);

  const where = {
    deletedAt: null,
    ...(status ? { moduleStatus: status as 'ACTIVE' | 'INACTIVE' | 'RETIRED' } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.trainingModule.findMany({
      where,
      orderBy: { moduleCode: 'asc' },
      take: limit,
      skip: offset,
      include: {
        sopDocument: { select: { documentCode: true, title: true, documentStatus: true } },
      },
    }),
    prisma.trainingModule.count({ where }),
  ]);

  return jsonResponse(200, { items: items.map(toModuleResponse), total, limit, offset });
}, { requireAuth: false });

// ─── List My Training Assignments ─────────────────────────────────────────────

export const listMyAssignmentsHandler = wrapHandler(async (ctx) => {
  const employeeId = ctx.event.pathParameters?.employeeId
    ?? ctx.event.queryStringParameters?.employeeId;

  if (!employeeId) return jsonResponse(400, { message: 'employeeId is required.' });

  const qs = ctx.event.queryStringParameters ?? {};
  const status = qs.status;
  const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);
  const offset = parseInt(qs.offset ?? '0', 10);

  const where = {
    employeeId,
    ...(status ? { assignmentStatus: status as 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'EXEMPT' | 'CANCELLED' } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.trainingAssignment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        module: {
          select: {
            moduleCode: true,
            moduleName: true,
            passScore: true,
            validityDays: true,
            isRequired: true,
            sopDocument: { select: { documentCode: true, title: true } },
          },
        },
      },
    }),
    prisma.trainingAssignment.count({ where }),
  ]);

  return jsonResponse(200, { items: items.map(toAssignmentResponse), total, limit, offset });
}, { requireAuth: false });

// ─── Complete Training Assignment ─────────────────────────────────────────────

interface CompleteAssignmentBody {
  score?: number;
}

export const completeAssignmentHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Assignment ID is required.' });

  const body = parseBody<CompleteAssignmentBody>(ctx.event);
  const score = body.ok ? body.value.score : undefined;

  const assignment = await prisma.trainingAssignment.findUnique({
    where: { id },
    include: { module: { select: { passScore: true } } },
  });
  if (!assignment) return jsonResponse(404, { message: `Assignment not found: ${id}` });
  if (assignment.assignmentStatus === 'COMPLETED') {
    return jsonResponse(409, { message: 'Assignment is already completed.' });
  }
  if (['CANCELLED', 'EXEMPT'].includes(assignment.assignmentStatus)) {
    return jsonResponse(409, { message: `Cannot complete an assignment in ${assignment.assignmentStatus} status.` });
  }

  const passScore = assignment.module.passScore;
  const passed = passScore === null || score === undefined || score >= passScore;
  const nextStatus = passed ? 'COMPLETED' : 'FAILED';

  const updated = await prisma.trainingAssignment.update({
    where: { id },
    data: {
      assignmentStatus: nextStatus,
      completedAt: new Date(),
      score: score !== undefined ? score : null,
      updatedAt: new Date(),
      version: { increment: 1 },
    },
  });

  return jsonResponse(200, { assignment: toAssignmentResponse(updated) });
}, { requireAuth: false });

// ─── Response mappers ─────────────────────────────────────────────────────────

function toSopResponse(r: {
  id: string;
  documentCode: string;
  title: string;
  documentStatus: string;
  category: string | null;
  ownerEmployeeId: string | null;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  version: number;
  docVersions?: Array<{ versionNumber: number; effectiveAt?: Date | null; changeSummary?: string | null }>;
}) {
  const latest = r.docVersions?.[0];
  return {
    id: r.id,
    documentCode: r.documentCode,
    title: r.title,
    documentStatus: r.documentStatus,
    category: r.category ?? undefined,
    ownerEmployeeId: r.ownerEmployeeId ?? undefined,
    currentVersionId: r.currentVersionId ?? undefined,
    currentVersion: latest
      ? {
          versionNumber: latest.versionNumber,
          effectiveAt: latest.effectiveAt?.toISOString(),
          changeSummary: latest.changeSummary ?? undefined,
        }
      : undefined,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

function toModuleResponse(r: {
  id: string;
  moduleCode: string;
  moduleName: string;
  description: string | null;
  moduleStatus: string;
  passScore: number | null;
  validityDays: number | null;
  isRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
  sopDocument?: { documentCode: string; title: string; documentStatus: string } | null;
}) {
  return {
    id: r.id,
    moduleCode: r.moduleCode,
    moduleName: r.moduleName,
    description: r.description ?? undefined,
    moduleStatus: r.moduleStatus,
    passScore: r.passScore ?? undefined,
    validityDays: r.validityDays ?? undefined,
    isRequired: r.isRequired,
    sopDocument: r.sopDocument ?? undefined,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toAssignmentResponse(r: {
  id: string;
  moduleId: string;
  employeeId: string;
  assignmentStatus: string;
  dueAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  score?: { toNumber: () => number } | number | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  module?: {
    moduleCode: string;
    moduleName: string;
    passScore: number | null;
    validityDays: number | null;
    isRequired: boolean;
    sopDocument?: { documentCode: string; title: string } | null;
  };
}) {
  const scoreVal = r.score != null
    ? typeof r.score === 'number' ? r.score : r.score.toNumber()
    : undefined;
  return {
    id: r.id,
    moduleId: r.moduleId,
    employeeId: r.employeeId,
    assignmentStatus: r.assignmentStatus,
    dueAt: r.dueAt?.toISOString(),
    startedAt: r.startedAt?.toISOString(),
    completedAt: r.completedAt?.toISOString(),
    score: scoreVal,
    module: r.module
      ? {
          moduleCode: r.module.moduleCode,
          moduleName: r.module.moduleName,
          passScore: r.module.passScore ?? undefined,
          validityDays: r.module.validityDays ?? undefined,
          isRequired: r.module.isRequired,
          sopDocument: r.module.sopDocument ?? undefined,
        }
      : undefined,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}
