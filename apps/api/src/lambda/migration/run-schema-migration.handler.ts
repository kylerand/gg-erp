/**
 * Lambda handler that applies Prisma schema migrations to Aurora.
 * Invoked directly (not via API Gateway) from the CD pipeline.
 *
 * Accepts an event with the migration SQL to execute, or runs all pending
 * Prisma migrations if no SQL is provided.
 *
 * Event:
 *   { "sql": "CREATE SCHEMA IF NOT EXISTS ...", "migrationName": "20260403124419_add_sales_pipeline" }
 */
import { PrismaClient, Prisma } from '@prisma/client';

let prisma: PrismaClient;
function getPrisma(): PrismaClient {
  prisma ??= new PrismaClient();
  return prisma;
}

interface MigrationEvent {
  sql?: string;
  migrationName?: string;
}

export async function handler(event: MigrationEvent) {
  const db = getPrisma();

  if (!event.sql) {
    return { statusCode: 400, body: 'Missing "sql" in event payload' };
  }

  const statements = event.sql
    .split(';')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0 && !s.startsWith('--'));

  const results: Array<{ index: number; statement: string; status: string; error?: string }> = [];

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      await db.$executeRawUnsafe(stmt);
      results.push({ index: i, statement: stmt.substring(0, 80), status: 'ok' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Skip "already exists" errors for idempotency
      if (message.includes('already exists') || message.includes('duplicate')) {
        results.push({ index: i, statement: stmt.substring(0, 80), status: 'skipped', error: message });
      } else {
        results.push({ index: i, statement: stmt.substring(0, 80), status: 'error', error: message });
        return {
          statusCode: 500,
          body: JSON.stringify({ error: `Failed at statement ${i}`, detail: message, results }),
        };
      }
    }
  }

  // Record the migration in Prisma's migration history table
  if (event.migrationName) {
    try {
      await db.$executeRawUnsafe(`
        INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
        VALUES (gen_random_uuid(), 'manual-via-lambda', NOW(), $1, NULL, NULL, NOW(), ${statements.length})
        ON CONFLICT DO NOTHING
      `, event.migrationName);
      results.push({ index: -1, statement: `Record migration: ${event.migrationName}`, status: 'ok' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ index: -1, statement: `Record migration: ${event.migrationName}`, status: 'error', error: message });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      totalStatements: statements.length,
      ok: results.filter(r => r.status === 'ok').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      errors: results.filter(r => r.status === 'error').length,
      results,
    }),
  };
}
