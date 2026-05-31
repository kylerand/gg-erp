ALTER TYPE "sop_ojt"."TrainingAssignmentStatus" ADD VALUE IF NOT EXISTS 'PENDING_SIGNOFF';

ALTER TABLE "sop_ojt"."training_assignments"
  ADD COLUMN IF NOT EXISTS "supervisor_employee_id" UUID,
  ADD COLUMN IF NOT EXISTS "supervisor_signoff_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "supervisor_signoff_note" TEXT;

CREATE INDEX IF NOT EXISTS "training_assignments_pending_signoff_idx"
  ON "sop_ojt"."training_assignments" ("assignment_status", "due_at");
