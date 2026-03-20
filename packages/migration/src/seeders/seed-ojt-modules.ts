/**
 * Seeds OJT training modules from the gg-ojt JSON data files into sop_ojt.training_modules.
 * Run: npx tsx src/seeders/seed-ojt-modules.ts [--dry-run]
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const OJT_MODULES_DIR = path.resolve(
  '/Users/kylerand/Documents/Documents - Mac/code/gg/gg-ojt/data/modules'
);

interface OjtStep {
  id: string;
  title: string;
  instructions: string;
  videoUrl?: string;
  videoDuration?: number;
  videoThumbnail?: string;
  tools?: string[];
  materials?: string[];
  safetyWarnings?: Array<{ severity: string; text: string }>;
  commonMistakes?: string[];
  whyItMatters?: string;
  requiresConfirmation?: boolean;
  requiresVideoCompletion?: boolean;
}

interface OjtKnowledgeCheck {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation?: string;
}

interface OjtModule {
  id: string;
  title: string;
  description: string;
  estimatedTime: string;
  thumbnailUrl?: string;
  prerequisites: string[];
  requiresSupervisorSignoff: boolean;
  jobRoles?: string[];
  steps: OjtStep[];
  knowledgeChecks: OjtKnowledgeCheck[];
}

async function seedModules() {
  console.log(`🏫 Seeding OJT training modules from: ${OJT_MODULES_DIR}`);
  if (DRY_RUN) console.log('  (dry run — no DB writes)');

  const files = fs.readdirSync(OJT_MODULES_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();

  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(OJT_MODULES_DIR, file);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as OjtModule;

    // Map OJT id to moduleCode (e.g. "01-orientation")
    const moduleCode = raw.id;

    if (!DRY_RUN) {
      const existing = await prisma.trainingModule.findFirst({
        where: { moduleCode },
      });

      if (existing) {
        console.log(`  ⏭  Skipping ${moduleCode} (already exists)`);
        skipped++;
        continue;
      }

      await prisma.trainingModule.create({
        data: {
          moduleCode,
          moduleName: raw.title,
          description: raw.description,
          moduleStatus: 'ACTIVE',
          estimatedTime: raw.estimatedTime,
          thumbnailUrl: raw.thumbnailUrl ?? null,
          prerequisites: raw.prerequisites ?? [],
          requiresSupervisorSignoff: raw.requiresSupervisorSignoff ?? false,
          jobRoles: raw.jobRoles ?? [],
          steps: raw.steps as object,
          knowledgeChecks: raw.knowledgeChecks as object,
          passScore: 70,
          isRequired: true,
          sortOrder: i + 1,
          version: 0,
        },
      });
      inserted++;
      console.log(`  ✅  Inserted: ${moduleCode} — "${raw.title}" (${raw.steps.length} steps, ${raw.knowledgeChecks.length} quiz Qs)`);
    } else {
      console.log(`  👁  Would insert: ${moduleCode} — "${raw.title}" (${raw.steps.length} steps, ${raw.knowledgeChecks.length} quiz Qs)`);
      inserted++;
    }
  }

  console.log(`\n📊 Summary: ${inserted} inserted, ${skipped} skipped`);
}

seedModules()
  .catch(e => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
