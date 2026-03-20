import { readFile } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import type { SanitizedUser } from '../sanitize/sanitize-export.js';
import { sanitizeExport } from '../sanitize/sanitize-export.js';
import type { ShopMonkeyExport } from '../connectors/shopmonkey-api.connector.js';
import { isAlreadyImported, recordImportMapping } from './idempotency.js';
import { createBatch, completeBatch, recordRawRecord, recordError } from './loader.js';
import type { LoadResult } from './loader.js';

/**
 * Wave B — Users / Employees from JSON export.
 *
 * Creates:
 *   1. identity.users   — login account (with placeholder cognito_subject)
 *   2. hr.employees     — employee record linked to the user
 *
 * Generates stable placeholder cognito subjects: `imported:sm:<smId>`
 * and employee numbers: `SM-<smId first 8 chars>`.
 *
 * sourceFile: path to shopmonkey-export-<ts>.json
 */
export async function runWaveB(
  prisma: PrismaClient,
  sourceFile: string,
  dryRun = false,
): Promise<LoadResult> {
  const batchId = await createBatch(prisma, 'B', sourceFile);

  const raw = await readFile(sourceFile, 'utf8');
  const exportData: ShopMonkeyExport = JSON.parse(raw);
  const report = sanitizeExport(exportData, sourceFile);
  const users: SanitizedUser[] = report.users;

  let inserted = 0;
  let skipped = 0;
  let errorCount = 0;

  for (const user of users) {
    try {
      if (user.skip) {
        skipped++;
        continue;
      }

      if (await isAlreadyImported(prisma, 'EMPLOYEE', user.smId)) {
        skipped++;
        continue;
      }

      await recordRawRecord(prisma, batchId, 'EMPLOYEE', user.smId, user);

      if (!dryRun) {
        const cognitoSubject = `imported:sm:${user.smId}`;
        const email = user.email ?? `imported+${user.smId}@golfin.local`;
        const displayName = user.fullName;
        const status = user.active ? 'ACTIVE' : 'DISABLED';

        // ── 1. identity.users ──────────────────────────────────────────
        const userResult = await prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO identity.users
            (cognito_subject, email, display_name, status, created_at, updated_at, version)
          VALUES
            (${cognitoSubject}, ${email}, ${displayName},
             ${status}::"identity"."UserStatus",
             NOW(), NOW(), 0)
          ON CONFLICT (cognito_subject) DO NOTHING
          RETURNING id
        `;

        let userId: string;
        if (userResult[0]) {
          userId = userResult[0].id;
        } else {
          // Already existed (cognito_subject conflict) — look it up
          const existing = await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM identity.users WHERE cognito_subject = ${cognitoSubject} LIMIT 1
          `;
          if (!existing[0]) {
            await recordError(prisma, batchId, 'LOAD', 'USER_CONFLICT',
              `User ${user.smId} cognito_subject conflict but row not found`);
            errorCount++;
            continue;
          }
          userId = existing[0].id;
        }

        // ── 2. hr.employees ────────────────────────────────────────────
        const nameParts = user.fullName.split(' ');
        const firstName = nameParts[0] ?? 'Unknown';
        const lastName = nameParts.slice(1).join(' ') || 'Unknown';
        const employeeNumber = `SM-${user.smId.slice(0, 8).toUpperCase()}`;

        const empResult = await prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO hr.employees
            (user_id, employee_number, first_name, last_name,
             employment_state, hire_date,
             created_at, updated_at, version)
          VALUES
            (CAST(${userId} AS uuid), ${employeeNumber},
             ${firstName}, ${lastName},
             ${user.active ? 'ACTIVE' : 'TERMINATED'}::"hr"."EmploymentState",
             CURRENT_DATE,
             NOW(), NOW(), 0)
          ON CONFLICT DO NOTHING
          RETURNING id
        `;

        if (empResult[0]) {
          await recordImportMapping(prisma, 'EMPLOYEE', user.smId, empResult[0].id);
          inserted++;
        } else {
          skipped++;
        }
      } else {
        inserted++;
      }
    } catch (err) {
      errorCount++;
      await recordError(
        prisma, batchId, 'LOAD', 'INSERT_FAILED',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  await completeBatch(prisma, batchId, users.length, errorCount, errorCount === 0 ? 'COMPLETED' : 'FAILED');
  return { batchId, wave: 'B', inserted, skipped, errors: errorCount };
}

