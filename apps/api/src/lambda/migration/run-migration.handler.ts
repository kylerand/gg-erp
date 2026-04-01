/**
 * Lambda handler that runs the Shopmonkey → ERP migration pipeline.
 *
 * Reads the export JSON from S3, runs waves A→G in order.
 * Invoked directly (not via API Gateway) with a longer timeout (15min).
 */
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { runWaveA } from '@gg-erp/migration/loaders/wave-a.loader.js';
import { runWaveB } from '@gg-erp/migration/loaders/wave-b.loader.js';
import { runWaveC } from '@gg-erp/migration/loaders/wave-c.loader.js';
import { runWaveD } from '@gg-erp/migration/loaders/wave-d.loader.js';
import { runWaveF } from '@gg-erp/migration/loaders/wave-f.loader.js';
import { runWaveG } from '@gg-erp/migration/loaders/wave-g.loader.js';

interface LoadResult {
  batchId: string;
  wave: string;
  inserted: number;
  skipped: number;
  errors: number;
}

interface MigrationEvent {
  s3Bucket: string;
  s3Key: string;
  dryRun?: boolean;
  skipWaves?: string[];
  onlyWaves?: string[];
}

interface WaveReport {
  wave: string;
  label: string;
  inserted: number;
  skipped: number;
  errors: number;
  durationMs: number;
  status: 'ok' | 'error' | 'skipped';
  error?: string;
}

const s3 = new S3Client({});

async function downloadExport(bucket: string, key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const resp = await s3.send(cmd);
  const body = await resp.Body?.transformToString('utf-8');
  if (!body) throw new Error(`Empty S3 object: s3://${bucket}/${key}`);
  // Write to /tmp for the loaders that read from file path
  const fs = await import('fs');
  const tmpPath = `/tmp/shopmonkey-export.json`;
  fs.writeFileSync(tmpPath, body);
  return tmpPath;
}

function shouldRun(wave: string, skip: Set<string>, only: Set<string> | null): boolean {
  if (only) return only.has(wave);
  return !skip.has(wave);
}

async function runTracked(
  wave: string,
  label: string,
  fn: () => Promise<LoadResult | Record<string, LoadResult>>,
): Promise<WaveReport> {
  console.log(`🚀 Wave ${wave} — ${label}`);
  const start = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    let inserted = 0, skipped = 0, errors = 0;
    if ('batchId' in result) {
      const r = result as LoadResult;
      inserted = r.inserted; skipped = r.skipped; errors = r.errors;
    } else {
      for (const r of Object.values(result as Record<string, LoadResult>)) {
        inserted += r.inserted; skipped += r.skipped; errors += r.errors;
      }
    }
    console.log(`  ✅ ${label}: ${inserted} inserted, ${skipped} skipped, ${errors} errors (${(durationMs / 1000).toFixed(1)}s)`);
    return { wave, label, inserted, skipped, errors, durationMs, status: errors > 0 ? 'error' : 'ok' };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ ${label}: FAILED — ${message}`);
    return { wave, label, inserted: 0, skipped: 0, errors: 1, durationMs, status: 'error', error: message };
  }
}

export async function handle(event: MigrationEvent) {
  const { s3Bucket, s3Key, dryRun = false, skipWaves = [], onlyWaves } = event;
  const skip = new Set(skipWaves.map(s => s.toUpperCase()));
  const only = onlyWaves ? new Set(onlyWaves.map(s => s.toUpperCase())) : null;

  console.log(`Starting migration: s3://${s3Bucket}/${s3Key} dryRun=${dryRun}`);

  const exportFile = await downloadExport(s3Bucket, s3Key);
  const prisma = new PrismaClient({ datasourceUrl: process.env.DB_DATABASE_URL });
  const reports: WaveReport[] = [];

  try {
    if (shouldRun('A', skip, only)) {
      reports.push(await runTracked('A', 'Seeds', () => runWaveA(prisma, dryRun)));
    }
    if (shouldRun('B', skip, only)) {
      reports.push(await runTracked('B', 'Users/Employees', () => runWaveB(prisma, exportFile, dryRun)));
    }
    if (shouldRun('D', skip, only)) {
      reports.push(await runTracked('D', 'Customers+Vehicles', () => runWaveD(prisma, exportFile, undefined, dryRun)));
    }
    if (shouldRun('C', skip, only)) {
      reports.push(await runTracked('C', 'Inventory Parts', () => runWaveC(prisma, exportFile, dryRun)));
    }
    if (shouldRun('F', skip, only)) {
      reports.push(await runTracked('F', 'Vendors+POs', () => runWaveF(prisma, exportFile, dryRun)));
    }
    if (shouldRun('G', skip, only)) {
      reports.push(await runTracked('G', 'Work Orders', () => runWaveG(prisma, exportFile, dryRun)));
    }

    const totalInserted = reports.reduce((s, r) => s + r.inserted, 0);
    const totalSkipped = reports.reduce((s, r) => s + r.skipped, 0);
    const totalErrors = reports.reduce((s, r) => s + r.errors, 0);
    const hasFailures = reports.some(r => r.status === 'error');

    const summary = {
      status: hasFailures ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
      totalInserted,
      totalSkipped,
      totalErrors,
      waves: reports,
    };

    console.log(`Migration complete: ${totalInserted} inserted, ${totalSkipped} skipped, ${totalErrors} errors`);
    return summary;
  } finally {
    await prisma.$disconnect();
  }
}
