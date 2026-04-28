import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';

const prisma = new PrismaClient();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      orderBy: { sortOrder: 'asc' },
      take: limit,
      skip: offset,
      include: {
        sopDocument: { select: { documentCode: true, title: true, documentStatus: true } },
      },
    }),
    prisma.trainingModule.count({ where }),
  ]);

  return jsonResponse(200, { items: items.map(m => toModuleResponse(m)), total, limit, offset });
}, { requireAuth: false });

// ─── List My Training Assignments ─────────────────────────────────────────────

export const listMyAssignmentsHandler = wrapHandler(async (ctx) => {
  const employeeId = ctx.event.pathParameters?.employeeId
    ?? ctx.event.queryStringParameters?.employeeId;

  if (employeeId && !UUID_RE.test(employeeId)) return jsonResponse(400, { message: 'employeeId must be a valid UUID.' });

  const qs = ctx.event.queryStringParameters ?? {};
  const status = qs.status;
  const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);
  const offset = parseInt(qs.offset ?? '0', 10);

  const where = {
    ...(employeeId ? { employeeId } : {}),
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

// ─── Get Training Module Detail (with full content) ───────────────────────────

export const getTrainingModuleHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Module ID is required.' });

  const module = await prisma.trainingModule.findFirst({
    where: moduleWhere(id),
    include: {
      sopDocument: { select: { documentCode: true, title: true, documentStatus: true } },
    },
  });

  if (!module) return jsonResponse(404, { message: `Training module not found: ${id}` });

  return jsonResponse(200, { module: toModuleResponse(module, true) });
}, { requireAuth: false });

// ─── Get Module Progress for Employee ────────────────────────────────────────

export const getModuleProgressHandler = wrapHandler(async (ctx) => {
  const moduleId = ctx.event.pathParameters?.id;
  const employeeId = ctx.event.pathParameters?.employeeId
    ?? ctx.event.queryStringParameters?.employeeId;

  if (!moduleId) return jsonResponse(400, { message: 'Module ID is required.' });
  if (!employeeId) return jsonResponse(400, { message: 'employeeId is required.' });
  if (!UUID_RE.test(employeeId)) return jsonResponse(400, { message: 'employeeId must be a valid UUID.' });

  const module = await prisma.trainingModule.findFirst({
    where: { ...moduleWhere(moduleId), ...{} },
    select: { id: true },
  });
  if (!module) return jsonResponse(404, { message: `Module not found: ${moduleId}` });

  const [moduleProgress, stepProgressList, quizAttempts] = await Promise.all([
    prisma.moduleProgress.findUnique({
      where: { employeeId_moduleId: { employeeId, moduleId: module.id } },
    }),
    prisma.stepProgress.findMany({
      where: { employeeId, moduleId: module.id },
    }),
    prisma.quizAttempt.findMany({
      where: { employeeId, moduleId: module.id },
      orderBy: { attemptedAt: 'desc' },
      take: 5,
    }),
  ]);

  return jsonResponse(200, {
    moduleId: module.id,
    employeeId,
    status: moduleProgress?.status ?? 'not-started',
    currentStep: moduleProgress?.currentStep ?? null,
    startedAt: moduleProgress?.startedAt?.toISOString() ?? null,
    completedAt: moduleProgress?.completedAt?.toISOString() ?? null,
    steps: stepProgressList.map(s => ({
      stepId: s.stepId,
      status: s.status,
      videoWatched: s.videoWatched,
      videoProgress: Number(s.videoProgress),
      completedAt: s.completedAt?.toISOString() ?? null,
    })),
    quizAttempts: quizAttempts.map(q => ({
      id: q.id,
      score: q.score,
      totalQuestions: q.totalQuestions,
      passed: q.passed,
      attemptedAt: q.attemptedAt.toISOString(),
    })),
  });
}, { requireAuth: false });

// ─── Update Step Progress ─────────────────────────────────────────────────────

interface UpdateStepProgressBody {
  employeeId: string;
  stepId: string;
  status?: string;
  videoWatched?: boolean;
  videoProgress?: number;
  completed?: boolean;
}

export const updateStepProgressHandler = wrapHandler(async (ctx) => {
  const moduleId = ctx.event.pathParameters?.id;
  if (!moduleId) return jsonResponse(400, { message: 'Module ID is required.' });

  const body = parseBody<UpdateStepProgressBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { employeeId, stepId, status, videoWatched, videoProgress, completed } = body.value;
  if (!employeeId) return jsonResponse(422, { message: 'employeeId is required.' });
  if (!UUID_RE.test(employeeId)) return jsonResponse(422, { message: 'employeeId must be a valid UUID.' });
  if (!stepId) return jsonResponse(422, { message: 'stepId is required.' });

  const module = await prisma.trainingModule.findFirst({
    where: moduleWhere(moduleId),
    select: { id: true },
  });
  if (!module) return jsonResponse(404, { message: `Module not found: ${moduleId}` });

  const now = new Date();
  const resolvedStatus = completed ? 'completed' : (status ?? 'in-progress');

  await prisma.$transaction([
    prisma.stepProgress.upsert({
      where: { employeeId_moduleId_stepId: { employeeId, moduleId: module.id, stepId } },
      create: {
        employeeId,
        moduleId: module.id,
        stepId,
        status: resolvedStatus,
        videoWatched: videoWatched ?? false,
        videoProgress: videoProgress ?? 0,
        completedAt: completed ? now : null,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        status: resolvedStatus,
        ...(videoWatched !== undefined ? { videoWatched } : {}),
        ...(videoProgress !== undefined ? { videoProgress } : {}),
        completedAt: completed ? now : undefined,
        updatedAt: now,
      },
    }),
    prisma.moduleProgress.upsert({
      where: { employeeId_moduleId: { employeeId, moduleId: module.id } },
      create: {
        employeeId,
        moduleId: module.id,
        status: 'in-progress',
        currentStep: stepId,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        status: 'in-progress',
        currentStep: stepId,
        updatedAt: now,
      },
    }),
  ]);

  return jsonResponse(200, { ok: true });
}, { requireAuth: false });

// ─── Submit Quiz Attempt ──────────────────────────────────────────────────────

interface SubmitQuizBody {
  employeeId: string;
  answers: number[];
}

export const submitQuizHandler = wrapHandler(async (ctx) => {
  const moduleId = ctx.event.pathParameters?.id;
  if (!moduleId) return jsonResponse(400, { message: 'Module ID is required.' });

  const body = parseBody<SubmitQuizBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { employeeId, answers } = body.value;
  if (!employeeId) return jsonResponse(422, { message: 'employeeId is required.' });
  if (!UUID_RE.test(employeeId)) return jsonResponse(422, { message: 'employeeId must be a valid UUID.' });
  if (!Array.isArray(answers)) return jsonResponse(422, { message: 'answers must be an array.' });

  const module = await prisma.trainingModule.findFirst({
    where: moduleWhere(moduleId),
  });
  if (!module) return jsonResponse(404, { message: `Module not found: ${moduleId}` });

  const knowledgeChecks = (module.knowledgeChecks ?? []) as Array<{
    id: string;
    question: string;
    options: string[];
    correctAnswer: number;
    explanation?: string;
  }>;

  if (knowledgeChecks.length === 0) {
    return jsonResponse(422, { message: 'This module has no quiz questions.' });
  }

  const scoredAnswers = knowledgeChecks.map((q, i) => ({
    questionId: q.id,
    question: q.question,
    selectedAnswer: answers[i] ?? -1,
    correctAnswer: q.correctAnswer,
    isCorrect: answers[i] === q.correctAnswer,
    explanation: q.explanation,
  }));

  const score = scoredAnswers.filter(a => a.isCorrect).length;
  const passScore = module.passScore ?? 70;
  const passPct = Math.round((score / knowledgeChecks.length) * 100);
  const passed = passPct >= passScore;

  await prisma.quizAttempt.create({
    data: {
      employeeId,
      moduleId: module.id,
      score,
      totalQuestions: knowledgeChecks.length,
      passed,
      answers: scoredAnswers as object,
      attemptedAt: new Date(),
    },
  });

  if (passed) {
    await prisma.moduleProgress.upsert({
      where: { employeeId_moduleId: { employeeId, moduleId: module.id } },
      create: {
        employeeId, moduleId: module.id,
        status: 'completed',
        completedAt: new Date(),
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      update: { status: 'completed', completedAt: new Date(), updatedAt: new Date() },
    });
  }

  return jsonResponse(200, {
    score,
    totalQuestions: knowledgeChecks.length,
    percentage: passPct,
    passed,
    passScore,
    answers: scoredAnswers,
  });
}, { requireAuth: false });

// ─── Notes ────────────────────────────────────────────────────────────────────

export const listNotesHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const employeeId = qs.employeeId;
  const moduleId = qs.moduleId;
  if (!employeeId) return jsonResponse(400, { message: 'employeeId is required.' });
  if (!UUID_RE.test(employeeId)) return jsonResponse(400, { message: 'employeeId must be a valid UUID.' });

  const where = { employeeId, ...(moduleId ? { moduleId } : {}) };
  const notes = await prisma.ojtNote.findMany({ where, orderBy: { updatedAt: 'desc' } });

  return jsonResponse(200, { items: notes.map(n => ({
    id: n.id,
    moduleId: n.moduleId,
    stepId: n.stepId,
    content: n.content,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  })) });
}, { requireAuth: false });

interface NoteBody { employeeId: string; moduleId: string; stepId?: string; content: string; }

export const upsertNoteHandler = wrapHandler(async (ctx) => {
  const body = parseBody<NoteBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });
  const { employeeId, moduleId, stepId, content } = body.value;
  if (!employeeId || !moduleId || !content?.trim()) {
    return jsonResponse(422, { message: 'employeeId, moduleId, and content are required.' });
  }
  const now = new Date();
  const existing = await prisma.ojtNote.findFirst({ where: { employeeId, moduleId, stepId: stepId ?? null } });
  const note = existing
    ? await prisma.ojtNote.update({ where: { id: existing.id }, data: { content, updatedAt: now } })
    : await prisma.ojtNote.create({ data: { employeeId, moduleId, stepId: stepId ?? null, content, createdAt: now, updatedAt: now } });
  return jsonResponse(200, { id: note.id, content: note.content, updatedAt: note.updatedAt.toISOString() });
}, { requireAuth: false });

export const deleteNoteHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Note ID is required.' });
  await prisma.ojtNote.delete({ where: { id } }).catch(() => {});
  return jsonResponse(200, { ok: true });
}, { requireAuth: false });

// ─── Bookmarks ────────────────────────────────────────────────────────────────

export const listBookmarksHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const employeeId = qs.employeeId;
  if (!employeeId) return jsonResponse(400, { message: 'employeeId is required.' });
  if (!UUID_RE.test(employeeId)) return jsonResponse(400, { message: 'employeeId must be a valid UUID.' });
  const bookmarks = await prisma.ojtBookmark.findMany({
    where: { employeeId, ...(qs.moduleId ? { moduleId: qs.moduleId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
  return jsonResponse(200, { items: bookmarks.map(b => ({
    id: b.id, moduleId: b.moduleId, stepId: b.stepId, createdAt: b.createdAt.toISOString(),
  })) });
}, { requireAuth: false });

interface BookmarkBody { employeeId: string; moduleId: string; stepId: string; }

export const toggleBookmarkHandler = wrapHandler(async (ctx) => {
  const body = parseBody<BookmarkBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });
  const { employeeId, moduleId, stepId } = body.value;
  if (!employeeId || !moduleId || !stepId) {
    return jsonResponse(422, { message: 'employeeId, moduleId, stepId are required.' });
  }
  const existing = await prisma.ojtBookmark.findUnique({
    where: { employeeId_moduleId_stepId: { employeeId, moduleId, stepId } },
  });
  if (existing) {
    await prisma.ojtBookmark.delete({ where: { id: existing.id } });
    return jsonResponse(200, { bookmarked: false });
  } else {
    await prisma.ojtBookmark.create({ data: { employeeId, moduleId, stepId } });
    return jsonResponse(200, { bookmarked: true });
  }
}, { requireAuth: false });

// ─── Q&A ─────────────────────────────────────────────────────────────────────

export const listQuestionsHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const moduleId = qs.moduleId;
  const status = qs.status;
  const limit = Math.min(parseInt(qs.limit ?? '50', 10), 100);

  const where = {
    ...(moduleId ? { moduleId } : {}),
    ...(status ? { status } : {}),
  };

  const questions = await prisma.ojtQuestion.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { answers: { orderBy: { createdAt: 'asc' } } },
  });

  return jsonResponse(200, { items: questions.map(q => ({
    id: q.id,
    employeeId: q.employeeId,
    employeeName: q.employeeName,
    moduleId: q.moduleId,
    stepId: q.stepId,
    question: q.question,
    status: q.status,
    createdAt: q.createdAt.toISOString(),
    answers: q.answers.map(a => ({
      id: a.id,
      adminId: a.adminId,
      adminName: a.adminName,
      answer: a.answer,
      createdAt: a.createdAt.toISOString(),
    })),
  })) });
}, { requireAuth: false });

interface AskQuestionBody { employeeId: string; employeeName?: string; moduleId: string; stepId?: string; question: string; }

export const askQuestionHandler = wrapHandler(async (ctx) => {
  const body = parseBody<AskQuestionBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });
  const { employeeId, employeeName, moduleId, stepId, question } = body.value;
  if (!employeeId || !moduleId || !question?.trim()) {
    return jsonResponse(422, { message: 'employeeId, moduleId, and question are required.' });
  }
  const q = await prisma.ojtQuestion.create({
    data: { employeeId, employeeName: employeeName ?? '', moduleId, stepId: stepId ?? null, question },
  });
  return jsonResponse(201, { id: q.id, question: q.question, status: q.status, createdAt: q.createdAt.toISOString() });
}, { requireAuth: false });

interface AnswerQuestionBody { adminId: string; adminName?: string; answer: string; }

export const answerQuestionHandler = wrapHandler(async (ctx) => {
  const questionId = ctx.event.pathParameters?.id;
  if (!questionId) return jsonResponse(400, { message: 'Question ID is required.' });

  const body = parseBody<AnswerQuestionBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });
  const { adminId, adminName, answer } = body.value;
  if (!adminId || !answer?.trim()) return jsonResponse(422, { message: 'adminId and answer are required.' });

  const q = await prisma.ojtQuestion.findUnique({ where: { id: questionId } });
  if (!q) return jsonResponse(404, { message: `Question not found: ${questionId}` });

  await prisma.$transaction([
    prisma.ojtAnswer.create({
      data: { questionId, adminId, adminName: adminName ?? '', answer },
    }),
    prisma.ojtQuestion.update({
      where: { id: questionId },
      data: { status: 'answered' },
    }),
  ]);

  return jsonResponse(201, { ok: true });
}, { requireAuth: false });

// ─── Inspection Templates ─────────────────────────────────────────────────────

export const listInspectionTemplatesHandler = wrapHandler(async (ctx) => {
  const { active } = ctx.event.queryStringParameters ?? {};

  const where = active === 'false' ? {} : { isActive: true };

  const templates = await prisma.inspectionTemplate.findMany({
    where,
    include: { items: { orderBy: { ordinal: 'asc' } } },
    orderBy: { name: 'asc' },
  });

  const serialized = templates.map(serializeTemplate);
  return jsonResponse(200, { items: serialized, total: serialized.length });
}, { requireAuth: false });

export const getInspectionTemplateHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Template ID is required.' });

  const template = await prisma.inspectionTemplate.findFirst({
    where: UUID_RE.test(id) ? { id } : { smId: id },
    include: { items: { orderBy: { ordinal: 'asc' } } },
  });

  if (!template) return jsonResponse(404, { message: `Inspection template not found: ${id}` });

  return jsonResponse(200, { template: serializeTemplate(template) });
}, { requireAuth: false });

function serializeTemplate(t: {
  id: string; smId: string; name: string | null; category: string | null;
  isActive: boolean; smCreatedDate: Date | null; smUpdatedDate: Date | null;
  importedAt: Date; updatedAt: Date;
  items: Array<{ id: string; smId: string; inspectionTemplateId: string; name: string | null; message: string | null; ordinal: bigint; createdAt: Date }>;
}) {
  return {
    ...t,
    items: t.items.map(item => ({ ...item, ordinal: Number(item.ordinal) })),
  };
}

/** Build a Prisma where clause that matches by UUID id OR by moduleCode string */
function moduleWhere(idOrCode: string) {
  return UUID_RE.test(idOrCode)
    ? { deletedAt: null as null, id: idOrCode }
    : { deletedAt: null as null, moduleCode: idOrCode };
}

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
  estimatedTime?: string | null;
  thumbnailUrl?: string | null;
  prerequisites?: string[];
  jobRoles?: string[];
  requiresSupervisorSignoff?: boolean;
  sortOrder?: number;
  steps?: unknown;
  knowledgeChecks?: unknown;
  createdAt: Date;
  updatedAt: Date;
  sopDocument?: { documentCode: string; title: string; documentStatus: string } | null;
}, includeContent = false) {
  return {
    id: r.id,
    moduleCode: r.moduleCode,
    moduleName: r.moduleName,
    description: r.description ?? undefined,
    moduleStatus: r.moduleStatus,
    passScore: r.passScore ?? undefined,
    validityDays: r.validityDays ?? undefined,
    isRequired: r.isRequired,
    estimatedTime: r.estimatedTime ?? undefined,
    thumbnailUrl: r.thumbnailUrl ?? undefined,
    prerequisites: r.prerequisites ?? [],
    jobRoles: r.jobRoles ?? [],
    requiresSupervisorSignoff: r.requiresSupervisorSignoff ?? false,
    sortOrder: r.sortOrder ?? 0,
    sopDocument: r.sopDocument ?? undefined,
    ...(includeContent ? {
      steps: r.steps ?? [],
      knowledgeChecks: r.knowledgeChecks ?? [],
    } : {}),
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
