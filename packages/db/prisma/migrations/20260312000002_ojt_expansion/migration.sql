-- OJT Expansion Migration
-- Expands training_modules with full content fields and adds 6 new tracking tables.

-- Expand training_modules with OJT content fields
ALTER TABLE sop_ojt.training_modules
  ADD COLUMN IF NOT EXISTS steps             JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS knowledge_checks  JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS estimated_time    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS prerequisites     TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS job_roles         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS requires_supervisor_signoff BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS thumbnail_url     TEXT,
  ADD COLUMN IF NOT EXISTS sort_order        INTEGER NOT NULL DEFAULT 0;

-- Module-level progress per employee
CREATE TABLE IF NOT EXISTS sop_ojt.module_progress (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID NOT NULL,
  module_id    UUID NOT NULL REFERENCES sop_ojt.training_modules(id) ON DELETE CASCADE,
  status       VARCHAR(20) NOT NULL DEFAULT 'not-started',
  current_step VARCHAR(100),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, module_id)
);
CREATE INDEX IF NOT EXISTS idx_module_progress_employee ON sop_ojt.module_progress(employee_id);

-- Step-level progress per employee
CREATE TABLE IF NOT EXISTS sop_ojt.step_progress (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    UUID NOT NULL,
  module_id      UUID NOT NULL REFERENCES sop_ojt.training_modules(id) ON DELETE CASCADE,
  step_id        VARCHAR(100) NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'not-started',
  video_watched  BOOLEAN NOT NULL DEFAULT false,
  video_progress DECIMAL(5,2) NOT NULL DEFAULT 0,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, module_id, step_id)
);
CREATE INDEX IF NOT EXISTS idx_step_progress_employee ON sop_ojt.step_progress(employee_id);

-- Quiz attempts
CREATE TABLE IF NOT EXISTS sop_ojt.quiz_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL,
  module_id       UUID NOT NULL REFERENCES sop_ojt.training_modules(id) ON DELETE CASCADE,
  score           INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  passed          BOOLEAN NOT NULL,
  answers         JSONB NOT NULL DEFAULT '[]',
  attempted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_employee ON sop_ojt.quiz_attempts(employee_id);

-- Trainee notes per step
CREATE TABLE IF NOT EXISTS sop_ojt.ojt_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL,
  module_id   UUID NOT NULL REFERENCES sop_ojt.training_modules(id) ON DELETE CASCADE,
  step_id     VARCHAR(100),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ojt_notes_employee ON sop_ojt.ojt_notes(employee_id);

-- Bookmarks
CREATE TABLE IF NOT EXISTS sop_ojt.ojt_bookmarks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL,
  module_id   UUID NOT NULL REFERENCES sop_ojt.training_modules(id) ON DELETE CASCADE,
  step_id     VARCHAR(100) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, module_id, step_id)
);
CREATE INDEX IF NOT EXISTS idx_ojt_bookmarks_employee ON sop_ojt.ojt_bookmarks(employee_id);

-- Q&A questions
CREATE TABLE IF NOT EXISTS sop_ojt.ojt_questions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL,
  employee_name VARCHAR(255) NOT NULL DEFAULT '',
  module_id     UUID NOT NULL REFERENCES sop_ojt.training_modules(id) ON DELETE CASCADE,
  step_id       VARCHAR(100),
  question      TEXT NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ojt_questions_module ON sop_ojt.ojt_questions(module_id);
CREATE INDEX IF NOT EXISTS idx_ojt_questions_status ON sop_ojt.ojt_questions(status);

-- Q&A answers
CREATE TABLE IF NOT EXISTS sop_ojt.ojt_answers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES sop_ojt.ojt_questions(id) ON DELETE CASCADE,
  admin_id    UUID NOT NULL,
  admin_name  VARCHAR(255) NOT NULL DEFAULT '',
  answer      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
