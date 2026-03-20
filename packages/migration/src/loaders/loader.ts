import type { PrismaClient, Prisma, ImportEntityType } from '@prisma/client';

export type Wave = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

export interface LoadResult {
  batchId: string;
  wave: Wave;
  inserted: number;
  skipped: number;
  errors: number;
}

export interface WaveRunnerOptions {
  prisma: PrismaClient;
  wave: Wave;
  sourceFile: string;
  dryRun?: boolean;
}

export async function createBatch(
  prisma: PrismaClient,
  wave: Wave,
  sourceFile: string,
): Promise<string> {
  const batch = await prisma.importBatch.create({
    data: { wave, sourceFile, status: 'RUNNING', startedAt: new Date() },
  });
  return batch.id;
}

export async function completeBatch(
  prisma: PrismaClient,
  batchId: string,
  recordCount: number,
  errorCount: number,
  status: 'COMPLETED' | 'FAILED',
): Promise<void> {
  await prisma.importBatch.update({
    where: { id: batchId },
    data: { status, recordCount, errorCount, completedAt: new Date() },
  });
}

export async function recordRawRecord(
  prisma: PrismaClient,
  batchId: string,
  entityType: string,
  sourceId: string,
  rawData: unknown,
): Promise<string> {
  const crypto = await import('crypto');
  const checksum = crypto
    .createHash('sha256')
    .update(JSON.stringify(rawData))
    .digest('hex');

  const existing = await prisma.rawRecord.findUnique({
    where: { batchId_sourceId_entityType: { batchId, sourceId, entityType: entityType as ImportEntityType } },
  });
  if (existing) return existing.id;

  const record = await prisma.rawRecord.create({
    data: { batchId, entityType: entityType as ImportEntityType, sourceId, rawJson: rawData as Prisma.InputJsonValue, checksum },
  });
  return record.id;
}

export async function recordError(
  prisma: PrismaClient,
  batchId: string,
  phase: string,
  errorCode: string,
  message: string,
  rawRecordId?: string,
): Promise<void> {
  await prisma.migrationError.create({
    data: { batchId, rawRecordId, phase, errorCode, errorMessage: message, retryable: true },
  });
}
