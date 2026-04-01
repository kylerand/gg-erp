import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SqlEvent {
  sql: string;
}

export async function handler(event: SqlEvent) {
  if (!event.sql) {
    return { statusCode: 400, body: JSON.stringify({ message: 'No SQL provided' }) };
  }

  const statements = event.sql
    .split(';')
    .map((s: string) => {
      // Remove SQL comment lines but keep the actual SQL
      return s
        .split('\n')
        .filter((line: string) => !line.trim().startsWith('--'))
        .join('\n')
        .trim();
    })
    .filter((s: string) => s.length > 0);

  const results: Array<{ ok: boolean; stmt: string; error?: string }> = [];

  for (const stmt of statements) {
    try {
      await prisma.$executeRawUnsafe(stmt + ';');
      results.push({ ok: true, stmt: stmt.substring(0, 100) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ ok: false, stmt: stmt.substring(0, 100), error: msg });
    }
  }

  await prisma.$disconnect();

  const failed = results.filter((r) => !r.ok);
  return {
    statusCode: failed.length > 0 ? 207 : 200,
    body: JSON.stringify({
      total: statements.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: failed.length,
      results,
    }),
  };
}
