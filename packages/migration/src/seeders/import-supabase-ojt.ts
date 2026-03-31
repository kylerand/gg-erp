/**
 * Supabase → ERP OJT Data Importer
 *
 * Pulls users, module_progress, step_progress, quiz_attempts,
 * notes, bookmarks, and Q&A from the cobblestone-ojt Supabase project
 * and imports them into the local ERP sop_ojt tables.
 *
 * Usage:
 *   SUPABASE_URL=https://...supabase.co \
 *   SUPABASE_SERVICE_KEY=... \
 *   npx tsx --env-file=../../.env src/seeders/import-supabase-ojt.ts
 *
 * The Supabase creds can also come from .env if you add them there.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SUPABASE_URL = process.env.SUPABASE_OJT_URL ?? 'https://dwrwikxhrfcvecwumwbo.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_OJT_SERVICE_KEY ?? '';

if (!SUPABASE_SERVICE_KEY) {
  console.error('⚠️  SUPABASE_OJT_SERVICE_KEY not set — fetching anonymously (RLS may block data)');
}

async function sbFetch<T>(table: string, query = ''): Promise<T[]> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*${query ? `&${query}` : ''}`;
  const headers: Record<string, string> = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase fetch failed for ${table}: ${res.status} ${text}`);
  }
  return res.json() as Promise<T[]>;
}

interface SbUser {
  id: string;
  employee_id: string;
  name: string;
  email: string;
  role: string;
  job_role: string;
  department: string;
  hire_date: string | null;
  created_at: string;
}

interface SbModuleProgress {
  id: string;
  trainee_id: string;
  module_id: string;
  status: string;
  current_step: number;
  started_at: string | null;
  completed_at: string | null;
}

interface SbStepProgress {
  id: string;
  trainee_id: string;
  module_id: string;
  step_id: string;
  status: string;
  video_watched: boolean;
  video_progress: number;
  completed_at: string | null;
}

interface SbQuizAttempt {
  id: string;
  trainee_id: string;
  module_id: string;
  score: number;
  total_questions: number;
  passed: boolean;
  answers: unknown[];
  attempted_at: string;
}

interface SbNote {
  id: string;
  trainee_id: string;
  module_id: string;
  step_id: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

interface SbBookmark {
  id: string;
  trainee_id: string;
  module_id: string;
  step_id: string;
  created_at: string;
}

interface SbQuestion {
  id: string;
  trainee_id: string;
  trainee_name: string;
  module_id: string;
  step_id: string | null;
  question: string;
  status: string;
  created_at: string;
}

interface SbAnswer {
  id: string;
  question_id: string;
  admin_id: string;
  admin_name: string;
  answer: string;
  created_at: string;
}

async function main() {
  console.log('🔄 Starting Supabase OJT data import...\n');

  const stats = { users: 0, moduleProgress: 0, stepProgress: 0, quizAttempts: 0, notes: 0, bookmarks: 0, questions: 0, answers: 0 };

  // ─── 1. Fetch all remote data ───────────────────────────────────────────────
  const [sbUsers, sbModuleProgress, sbStepProgress, sbQuizAttempts, sbNotes, sbBookmarks, sbQuestions, sbAnswers] = await Promise.all([
    sbFetch<SbUser>('users'),
    sbFetch<SbModuleProgress>('module_progress'),
    sbFetch<SbStepProgress>('step_progress'),
    sbFetch<SbQuizAttempt>('quiz_attempts'),
    sbFetch<SbNote>('notes'),
    sbFetch<SbBookmark>('bookmarks'),
    sbFetch<SbQuestion>('questions'),
    sbFetch<SbAnswer>('answers'),
  ]);

  console.log(`📥 Remote data:`);
  console.log(`   Users: ${sbUsers.length}`);
  console.log(`   Module progress: ${sbModuleProgress.length}`);
  console.log(`   Step progress: ${sbStepProgress.length}`);
  console.log(`   Quiz attempts: ${sbQuizAttempts.length}`);
  console.log(`   Notes: ${sbNotes.length}`);
  console.log(`   Bookmarks: ${sbBookmarks.length}`);
  console.log(`   Questions: ${sbQuestions.length}`);
  console.log(`   Answers: ${sbAnswers.length}\n`);

  // ─── 2. Build module lookup (moduleCode → id) ────────────────────────────────
  const modules = await prisma.trainingModule.findMany({ select: { id: true, moduleCode: true } });
  const moduleByCode = new Map(modules.map(m => [m.moduleCode, m.id]));
  const moduleById = new Map(modules.map(m => [m.id, m.id]));

  function resolveModuleId(raw: string): string | null {
    return moduleByCode.get(raw) ?? moduleById.get(raw) ?? null;
  }

  // ─── 3. Import users → upsert as employees ──────────────────────────────────
  for (const u of sbUsers) {
    if (u.role === 'admin' && u.employee_id === 'admin') continue; // skip default admin

    try {
      await prisma.$executeRaw`
        INSERT INTO hr.employees (id, employee_number, full_name, email, department, job_title, hire_date, created_at, updated_at)
        VALUES (gen_random_uuid(), ${u.employee_id}, ${u.name}, ${u.email},
                ${u.department || null}, ${u.job_role || null},
                ${u.hire_date ? new Date(u.hire_date) : null}::timestamptz,
                NOW(), NOW())
        ON CONFLICT (employee_number) DO NOTHING
      `;
      stats.users++;
    } catch (err) {
      console.warn(`   ⚠️  Could not import user ${u.employee_id}:`, (err as Error).message);
    }
  }

  // ─── 4. Import module_progress ───────────────────────────────────────────────
  for (const mp of sbModuleProgress) {
    const moduleId = resolveModuleId(mp.module_id);
    if (!moduleId) {
      console.warn(`   ⚠️  Module not found for code: ${mp.module_id}`);
      continue;
    }
    try {
      await prisma.moduleProgress.upsert({
        where: { employeeId_moduleId: { employeeId: mp.trainee_id, moduleId } },
        create: {
          employeeId: mp.trainee_id,
          moduleId,
          status: mp.status,
          currentStep: mp.current_step?.toString() ?? null,
          startedAt: mp.started_at ? new Date(mp.started_at) : null,
          completedAt: mp.completed_at ? new Date(mp.completed_at) : null,
        },
        update: {
          status: mp.status,
          currentStep: mp.current_step?.toString() ?? null,
          completedAt: mp.completed_at ? new Date(mp.completed_at) : null,
        },
      });
      stats.moduleProgress++;
    } catch (err) {
      console.warn(`   ⚠️  Module progress import error:`, (err as Error).message);
    }
  }

  // ─── 5. Import step_progress ─────────────────────────────────────────────────
  for (const sp of sbStepProgress) {
    const moduleId = resolveModuleId(sp.module_id);
    if (!moduleId) continue;

    // Ensure parent ModuleProgress exists
    await prisma.moduleProgress.upsert({
      where: { employeeId_moduleId: { employeeId: sp.trainee_id, moduleId } },
      create: { employeeId: sp.trainee_id, moduleId, status: 'in-progress' },
      update: {},
    });

    const modProg = await prisma.moduleProgress.findUnique({
      where: { employeeId_moduleId: { employeeId: sp.trainee_id, moduleId } },
    });
    if (!modProg) continue;

    try {
      await prisma.stepProgress.upsert({
        where: { employeeId_moduleId_stepId: { employeeId: sp.trainee_id, moduleId, stepId: sp.step_id } },
        create: {
          employeeId: sp.trainee_id,
          moduleId,
          stepId: sp.step_id,
          status: sp.status,
          videoWatched: sp.video_watched,
          videoProgress: sp.video_progress,
          completedAt: sp.completed_at ? new Date(sp.completed_at) : null,
        },
        update: {
          status: sp.status,
          videoWatched: sp.video_watched,
          videoProgress: sp.video_progress,
          completedAt: sp.completed_at ? new Date(sp.completed_at) : null,
        },
      });
      stats.stepProgress++;
    } catch (err) {
      console.warn(`   ⚠️  Step progress import error:`, (err as Error).message);
    }
  }

  // ─── 6. Import quiz attempts ─────────────────────────────────────────────────
  for (const qa of sbQuizAttempts) {
    const moduleId = resolveModuleId(qa.module_id);
    if (!moduleId) continue;

    const modProg = await prisma.moduleProgress.findUnique({
      where: { employeeId_moduleId: { employeeId: qa.trainee_id, moduleId } },
    });
    if (!modProg) continue;

    try {
      await prisma.quizAttempt.create({
        data: {
          employeeId: qa.trainee_id,
          moduleId,
          score: qa.score,
          totalQuestions: qa.total_questions,
          passed: qa.passed,
          attemptedAt: new Date(qa.attempted_at),
        },
      });
      stats.quizAttempts++;
    } catch (err) {
      console.warn(`   ⚠️  Quiz attempt import error:`, (err as Error).message);
    }
  }

  // ─── 7. Import notes ─────────────────────────────────────────────────────────
  for (const n of sbNotes) {
    const moduleId = resolveModuleId(n.module_id);
    if (!moduleId) continue;

    try {
      await prisma.ojtNote.create({
        data: {
          employeeId: n.trainee_id,
          moduleId,
          stepId: n.step_id ?? null,
          content: n.content,
          createdAt: new Date(n.created_at),
          updatedAt: new Date(n.updated_at),
        },
      });
      stats.notes++;
    } catch (err) {
      console.warn(`   ⚠️  Note import error:`, (err as Error).message);
    }
  }

  // ─── 8. Import bookmarks ─────────────────────────────────────────────────────
  for (const b of sbBookmarks) {
    const moduleId = resolveModuleId(b.module_id);
    if (!moduleId) continue;

    try {
      await prisma.ojtBookmark.upsert({
        where: { employeeId_moduleId_stepId: { employeeId: b.trainee_id, moduleId, stepId: b.step_id } },
        create: {
          employeeId: b.trainee_id,
          moduleId,
          stepId: b.step_id,
          createdAt: new Date(b.created_at),
        },
        update: {},
      });
      stats.bookmarks++;
    } catch (err) {
      console.warn(`   ⚠️  Bookmark import error:`, (err as Error).message);
    }
  }

  // ─── 9. Import Q&A ───────────────────────────────────────────────────────────
  const questionIdMap = new Map<string, string>();
  for (const q of sbQuestions) {
    const moduleId = resolveModuleId(q.module_id);
    if (!moduleId) continue;

    try {
      const created = await prisma.ojtQuestion.create({
        data: {
          employeeId: q.trainee_id,
          moduleId,
          stepId: q.step_id ?? null,
          question: q.question,
          status: q.status as 'pending' | 'answered',
          createdAt: new Date(q.created_at),
        },
      });
      questionIdMap.set(q.id, created.id);
      stats.questions++;
    } catch (err) {
      console.warn(`   ⚠️  Question import error:`, (err as Error).message);
    }
  }

  for (const a of sbAnswers) {
    const newQuestionId = questionIdMap.get(a.question_id);
    if (!newQuestionId) continue;

    try {
      await prisma.ojtAnswer.create({
        data: {
          questionId: newQuestionId,
          adminId: a.admin_id,
          answer: a.answer,
          createdAt: new Date(a.created_at),
        },
      });
      stats.answers++;
    } catch (err) {
      console.warn(`   ⚠️  Answer import error:`, (err as Error).message);
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────────────────
  console.log('✅ Import complete!\n');
  console.log('📊 Imported:');
  Object.entries(stats).forEach(([key, count]) => {
    console.log(`   ${key}: ${count}`);
  });

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('❌ Import failed:', err);
  process.exit(1);
});
