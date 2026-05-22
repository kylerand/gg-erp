CREATE TABLE IF NOT EXISTS "planning"."planner_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scenario_id" UUID,
    "run_status" TEXT NOT NULL DEFAULT 'QUEUED',
    "algorithm_version" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "deterministic_seed" BIGINT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "runtime_ms" BIGINT,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "correlation_id" TEXT NOT NULL,
    "request_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "planner_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "planner_runs_status_ck" CHECK ("run_status" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT')),
    CONSTRAINT "planner_runs_runtime_ck" CHECK ("runtime_ms" IS NULL OR "runtime_ms" >= 0),
    CONSTRAINT "planner_runs_version_ck" CHECK ("version" >= 0)
);

ALTER TABLE "planning"."planner_runs"
    ALTER COLUMN "scenario_id" DROP NOT NULL;

ALTER TABLE "planning"."planner_runs"
    ADD COLUMN IF NOT EXISTS "request_id" TEXT;

ALTER TABLE "planning"."planner_runs"
    ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "planning"."planner_runs"
    ADD CONSTRAINT "planner_runs_scenario_id_fkey"
    FOREIGN KEY ("scenario_id") REFERENCES "planning"."planning_scenarios"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "planner_runs_status_created_idx"
    ON "planning"."planner_runs"("run_status", "created_at");

CREATE INDEX IF NOT EXISTS "planner_runs_input_hash_idx"
    ON "planning"."planner_runs"("input_hash");

CREATE TABLE IF NOT EXISTS "planning"."plan_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "planner_run_id" UUID NOT NULL,
    "work_order_operation_id" UUID NOT NULL,
    "capacity_slot_id" UUID NOT NULL,
    "proposed_employee_id" UUID,
    "assignment_state" TEXT NOT NULL DEFAULT 'PROPOSED',
    "planned_start_at" TIMESTAMPTZ(6) NOT NULL,
    "planned_end_at" TIMESTAMPTZ(6) NOT NULL,
    "slot_sequence_no" INTEGER NOT NULL DEFAULT 1,
    "score" NUMERIC(12,4),
    "rationale" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "correlation_id" TEXT NOT NULL,
    "request_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "plan_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "plan_assignments_state_ck" CHECK ("assignment_state" IN ('PROPOSED', 'PUBLISHED', 'DISPATCHED', 'REJECTED', 'SUPERSEDED')),
    CONSTRAINT "plan_assignments_window_ck" CHECK ("planned_end_at" > "planned_start_at"),
    CONSTRAINT "plan_assignments_sequence_ck" CHECK ("slot_sequence_no" > 0),
    CONSTRAINT "plan_assignments_rationale_ck" CHECK (jsonb_typeof("rationale") = 'object'),
    CONSTRAINT "plan_assignments_version_ck" CHECK ("version" >= 0)
);

ALTER TABLE "planning"."plan_assignments"
    ADD COLUMN IF NOT EXISTS "planned_start_at" TIMESTAMPTZ(6);

ALTER TABLE "planning"."plan_assignments"
    ADD COLUMN IF NOT EXISTS "planned_end_at" TIMESTAMPTZ(6);

ALTER TABLE "planning"."plan_assignments"
    ADD COLUMN IF NOT EXISTS "slot_sequence_no" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "planning"."plan_assignments"
    ADD COLUMN IF NOT EXISTS "request_id" TEXT;

ALTER TABLE "planning"."plan_assignments"
    ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "planning"."plan_assignments"
    ADD CONSTRAINT "plan_assignments_planner_run_id_fkey"
    FOREIGN KEY ("planner_run_id") REFERENCES "planning"."planner_runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "planning"."plan_assignments"
    ADD CONSTRAINT "plan_assignments_work_order_operation_id_fkey"
    FOREIGN KEY ("work_order_operation_id") REFERENCES "work_orders"."work_order_operations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "planning"."plan_assignments"
    ADD CONSTRAINT "plan_assignments_capacity_slot_id_fkey"
    FOREIGN KEY ("capacity_slot_id") REFERENCES "planning"."capacity_slots"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "plan_assignments_run_state_idx"
    ON "planning"."plan_assignments"("planner_run_id", "assignment_state");

CREATE INDEX IF NOT EXISTS "plan_assignments_operation_state_idx"
    ON "planning"."plan_assignments"("work_order_operation_id", "assignment_state");

CREATE INDEX IF NOT EXISTS "plan_assignments_slot_state_idx"
    ON "planning"."plan_assignments"("capacity_slot_id", "assignment_state");

CREATE INDEX IF NOT EXISTS "plan_assignments_planned_start_idx"
    ON "planning"."plan_assignments"("planned_start_at");

CREATE UNIQUE INDEX IF NOT EXISTS "plan_assignments_active_operation_uk"
    ON "planning"."plan_assignments"("work_order_operation_id")
    WHERE "assignment_state" IN ('PROPOSED', 'PUBLISHED', 'DISPATCHED');
