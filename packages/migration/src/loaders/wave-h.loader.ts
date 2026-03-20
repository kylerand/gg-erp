/**
 * Wave H — ShopMonkey Inspection Templates Loader
 *
 * Fetches inspection templates from ShopMonkey API and upserts them into
 * sop_ojt.inspection_templates + sop_ojt.inspection_template_items.
 *
 * Usage (as part of wave runner):
 *   SM_EMAIL=you@shop.com SM_PASSWORD=secret npm run migrate H
 *
 * Direct usage:
 *   SM_EMAIL=... SM_PASSWORD=... npx tsx --env-file=../../.env src/loaders/wave-h.loader.ts
 */

import { PrismaClient } from '@prisma/client';
import { login, fetchInspectionTemplates } from '../connectors/shopmonkey-api.connector.js';

const prisma = new PrismaClient();

export interface WaveHResult {
  batchId: string;
  wave: 'H';
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

export async function runWaveH(batchId: string, dryRun = false): Promise<WaveHResult> {
  const result: WaveHResult = { batchId, wave: 'H', inserted: 0, updated: 0, skipped: 0, errors: 0 };

  const email = process.env.SM_EMAIL;
  const password = process.env.SM_PASSWORD;

  if (!email || !password) {
    throw new Error('SM_EMAIL and SM_PASSWORD environment variables are required for Wave H');
  }

  console.log('[wave-h] Logging in to ShopMonkey...');
  const session = await login(email, password);

  const templates = await fetchInspectionTemplates(session);

  if (dryRun) {
    console.log(`[wave-h] DRY RUN — would import ${templates.length} inspection templates`);
    templates.forEach(t => console.log(`  [${t.id}] ${t.name} (${t.items?.length ?? 0} items)`));
    result.skipped = templates.length;
    return result;
  }

  for (const t of templates) {
    try {
      const existing = await prisma.inspectionTemplate.findUnique({ where: { smId: t.id } });

      if (existing) {
        // Update if name changed
        await prisma.inspectionTemplate.update({
          where: { smId: t.id },
          data: {
            name: t.name,
            isActive: !t.deleted,
            smUpdatedDate: t.updatedDate ? new Date(t.updatedDate) : null,
            updatedAt: new Date(),
          },
        });

        // Upsert items
        for (const item of t.items ?? []) {
          await prisma.inspectionTemplateItem.upsert({
            where: { smId: item.id },
            create: {
              smId: item.id,
              inspectionTemplateId: existing.id,
              name: item.name ?? null,
              message: item.message ?? null,
              ordinal: BigInt(item.ordinal ?? 0),
            },
            update: {
              name: item.name ?? null,
              message: item.message ?? null,
              ordinal: BigInt(item.ordinal ?? 0),
            },
          });
        }
        result.updated++;
      } else {
        // Create template with items
        await prisma.inspectionTemplate.create({
          data: {
            smId: t.id,
            name: t.name ?? null,
            isActive: !t.deleted,
            smCreatedDate: t.createdDate ? new Date(t.createdDate) : null,
            smUpdatedDate: t.updatedDate ? new Date(t.updatedDate) : null,
            items: {
              create: (t.items ?? []).map(item => ({
                smId: item.id,
                name: item.name ?? null,
                message: item.message ?? null,
                ordinal: BigInt(item.ordinal ?? 0),
              })),
            },
          },
        });
        result.inserted++;
      }
    } catch (err) {
      console.error(`[wave-h] Error importing template ${t.id} (${t.name}):`, (err as Error).message);
      result.errors++;
    }
  }

  console.log(`[wave-h] Done — ${result.inserted} inserted, ${result.updated} updated, ${result.errors} errors`);
  return result;
}

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes('--dry-run');
  const batchId = `manual-wave-h-${Date.now()}`;

  runWaveH(batchId, dryRun)
    .then(r => {
      console.log('\nResult:', JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal:', err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
