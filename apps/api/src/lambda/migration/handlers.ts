import { PrismaClient } from '@prisma/client';
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';

const prisma = new PrismaClient();

/** POST /migration/batches — trigger a new import batch */
export const triggerBatchHandler = wrapHandler(async (ctx) => {
  const parsed = parseBody<{ wave?: string; sourceFile?: string; dryRun?: boolean }>(ctx.event);
  if (!parsed.ok) return jsonResponse(400, { message: parsed.error });
  const body = parsed.value;

  if (!body?.wave || !body?.sourceFile) {
    return jsonResponse(400, { message: '`wave` and `sourceFile` are required.' });
  }

  const batch = await prisma.importBatch.create({
    data: {
      wave: body.wave,
      sourceFile: body.sourceFile,
      status: 'QUEUED',
    },
  });

  return jsonResponse(202, {
    id: batch.id,
    status: batch.status,
    wave: batch.wave,
    sourceFile: batch.sourceFile,
    createdAt: batch.createdAt,
    message: 'Import batch queued.',
  });
}, { requireAuth: true });

/** GET /migration/batches — list all import batches */
export const listBatchesHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const limit = Math.min(parseInt(qs.limit ?? '20', 10), 100);
  const offset = parseInt(qs.offset ?? '0', 10);

  const [batches, total] = await Promise.all([
    prisma.importBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        _count: { select: { rawRecords: true, migrationErrors: true } },
      },
    }),
    prisma.importBatch.count(),
  ]);

  return jsonResponse(200, {
    items: batches.map(b => ({
      id: b.id,
      wave: b.wave,
      sourceFile: b.sourceFile,
      status: b.status,
      recordCount: b.recordCount,
      errorCount: b.errorCount,
      rawRecordCount: b._count.rawRecords,
      migrationErrorCount: b._count.migrationErrors,
      startedAt: b.startedAt,
      completedAt: b.completedAt,
      createdAt: b.createdAt,
    })),
    total,
    limit,
    offset,
  });
}, { requireAuth: true });

/** GET /migration/batches/{id} — get batch status detail */
export const getBatchHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Missing batch id.' });

  const batch = await prisma.importBatch.findUnique({
    where: { id },
    include: {
      migrationErrors: { take: 20, orderBy: { createdAt: 'desc' } },
      _count: { select: { rawRecords: true, reconciliationResults: true, migrationErrors: true } },
    },
  });

  if (!batch) return jsonResponse(404, { message: 'Batch not found.' });

  return jsonResponse(200, {
    id: batch.id,
    wave: batch.wave,
    sourceFile: batch.sourceFile,
    status: batch.status,
    recordCount: batch.recordCount,
    errorCount: batch.errorCount,
    rawRecordCount: batch._count.rawRecords,
    reconciliationResultCount: batch._count.reconciliationResults,
    migrationErrorCount: batch._count.migrationErrors,
    recentErrors: batch.migrationErrors,
    startedAt: batch.startedAt,
    completedAt: batch.completedAt,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  });
}, { requireAuth: true });

/** PATCH /migration/batches/{id}/cancel — cancel a QUEUED batch */
export const cancelBatchHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Missing batch id.' });

  const batch = await prisma.importBatch.findUnique({ where: { id } });
  if (!batch) return jsonResponse(404, { message: 'Batch not found.' });

  if (batch.status !== 'QUEUED') {
    return jsonResponse(409, { message: `Cannot cancel batch in status: ${batch.status}` });
  }

  const updated = await prisma.importBatch.update({
    where: { id },
    data: { status: 'FAILED', completedAt: new Date() },
  });

  return jsonResponse(200, { id: updated.id, status: updated.status });
}, { requireAuth: true });
