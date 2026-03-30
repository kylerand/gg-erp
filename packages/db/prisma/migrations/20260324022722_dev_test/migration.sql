-- DropForeignKey
ALTER TABLE "identity"."role_permissions" DROP CONSTRAINT "role_permissions_permission_id_fkey";

-- DropForeignKey
ALTER TABLE "identity"."role_permissions" DROP CONSTRAINT "role_permissions_role_id_fkey";

-- DropForeignKey
ALTER TABLE "planning"."planning_constraints" DROP CONSTRAINT "planning_constraints_scenario_id_fkey";

-- DropForeignKey
ALTER TABLE "sop_ojt"."inspection_template_items" DROP CONSTRAINT "inspection_template_items_inspection_template_id_fkey";

-- DropForeignKey
ALTER TABLE "sop_ojt"."module_progress" DROP CONSTRAINT "module_progress_module_id_fkey";

-- DropForeignKey
ALTER TABLE "sop_ojt"."ojt_answers" DROP CONSTRAINT "ojt_answers_question_id_fkey";

-- DropForeignKey
ALTER TABLE "sop_ojt"."ojt_bookmarks" DROP CONSTRAINT "ojt_bookmarks_module_id_fkey";

-- DropForeignKey
ALTER TABLE "sop_ojt"."ojt_notes" DROP CONSTRAINT "ojt_notes_module_id_fkey";

-- DropForeignKey
ALTER TABLE "sop_ojt"."ojt_questions" DROP CONSTRAINT "ojt_questions_module_id_fkey";

-- DropForeignKey
ALTER TABLE "sop_ojt"."quiz_attempts" DROP CONSTRAINT "quiz_attempts_module_id_fkey";

-- DropForeignKey
ALTER TABLE "sop_ojt"."step_progress" DROP CONSTRAINT "step_progress_module_id_fkey";

-- DropIndex
DROP INDEX "identity"."permissions_permission_code_key";

-- DropIndex
DROP INDEX "identity"."roles_role_code_key";

-- DropIndex
DROP INDEX "inventory"."stock_locations_location_code_key";

-- AlterTable
ALTER TABLE "sop_ojt"."module_progress" ALTER COLUMN "status" SET DATA TYPE TEXT,
ALTER COLUMN "current_step" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "sop_ojt"."ojt_answers" ALTER COLUMN "admin_name" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "sop_ojt"."ojt_bookmarks" ALTER COLUMN "step_id" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "sop_ojt"."ojt_notes" ALTER COLUMN "step_id" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "sop_ojt"."ojt_questions" ALTER COLUMN "employee_name" SET DATA TYPE TEXT,
ALTER COLUMN "step_id" SET DATA TYPE TEXT,
ALTER COLUMN "status" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "sop_ojt"."step_progress" ALTER COLUMN "step_id" SET DATA TYPE TEXT,
ALTER COLUMN "status" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "sop_ojt"."training_modules" ALTER COLUMN "steps" DROP NOT NULL,
ALTER COLUMN "knowledge_checks" DROP NOT NULL,
ALTER COLUMN "estimated_time" SET DATA TYPE TEXT;

-- CreateIndex
CREATE INDEX "permissions_permission_code_idx" ON "identity"."permissions"("permission_code");

-- CreateIndex
CREATE INDEX "roles_role_code_idx" ON "identity"."roles"("role_code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "labor_entries_task_idx" ON "tickets"."labor_time_entries"("technician_task_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "qc_gates_task_idx" ON "work_orders"."work_order_qc_gates"("task_id");

-- AddForeignKey
ALTER TABLE "planning"."planning_constraints" ADD CONSTRAINT "planning_constraints_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "planning"."planning_scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "identity"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "identity"."permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_ojt"."module_progress" ADD CONSTRAINT "module_progress_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "sop_ojt"."training_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_ojt"."step_progress" ADD CONSTRAINT "step_progress_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "sop_ojt"."training_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_ojt"."quiz_attempts" ADD CONSTRAINT "quiz_attempts_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "sop_ojt"."training_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_ojt"."ojt_notes" ADD CONSTRAINT "ojt_notes_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "sop_ojt"."training_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_ojt"."ojt_bookmarks" ADD CONSTRAINT "ojt_bookmarks_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "sop_ojt"."training_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_ojt"."ojt_questions" ADD CONSTRAINT "ojt_questions_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "sop_ojt"."training_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_ojt"."ojt_answers" ADD CONSTRAINT "ojt_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "sop_ojt"."ojt_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_ojt"."inspection_template_items" ADD CONSTRAINT "inspection_template_items_inspection_template_id_fkey" FOREIGN KEY ("inspection_template_id") REFERENCES "sop_ojt"."inspection_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "sop_ojt"."idx_module_progress_employee" RENAME TO "module_progress_employee_id_idx";

-- RenameIndex
ALTER INDEX "sop_ojt"."idx_ojt_bookmarks_employee" RENAME TO "ojt_bookmarks_employee_id_idx";

-- RenameIndex
ALTER INDEX "sop_ojt"."idx_ojt_notes_employee" RENAME TO "ojt_notes_employee_id_idx";

-- RenameIndex
ALTER INDEX "sop_ojt"."idx_ojt_questions_module" RENAME TO "ojt_questions_module_id_idx";

-- RenameIndex
ALTER INDEX "sop_ojt"."idx_ojt_questions_status" RENAME TO "ojt_questions_status_idx";

-- RenameIndex
ALTER INDEX "sop_ojt"."idx_quiz_attempts_employee" RENAME TO "quiz_attempts_employee_id_idx";

-- RenameIndex
ALTER INDEX "sop_ojt"."idx_step_progress_employee" RENAME TO "step_progress_employee_id_idx";
