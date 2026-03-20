-- CreateEnum
CREATE TYPE "planning"."PlanningScenarioStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "planning"."PlanPublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "identity"."permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "permission_code" TEXT NOT NULL,
    "permission_name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "granted_by_user_id" UUID,
    "correlation_id" TEXT NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id")
);

-- CreateTable
CREATE TABLE "planning"."planning_scenarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scenario_name" TEXT NOT NULL,
    "scenario_status" "planning"."PlanningScenarioStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "planning_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planning"."planning_constraints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scenario_id" UUID NOT NULL,
    "constraint_key" TEXT NOT NULL,
    "constraint_value" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "planning_constraints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planning"."plan_publications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "publication_key" TEXT NOT NULL,
    "scenario_id" UUID,
    "publication_status" "planning"."PlanPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "plan_publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_role_code_key" ON "identity"."roles"("role_code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_locations_location_code_key" ON "inventory"."stock_locations"("location_code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_permission_code_key" ON "identity"."permissions"("permission_code");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "identity"."role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "planning_scenarios_scenario_name_key" ON "planning"."planning_scenarios"("scenario_name");

-- CreateIndex
CREATE UNIQUE INDEX "planning_constraints_scenario_id_constraint_key_key" ON "planning"."planning_constraints"("scenario_id", "constraint_key");

-- CreateIndex
CREATE UNIQUE INDEX "plan_publications_publication_key_key" ON "planning"."plan_publications"("publication_key");

-- AddForeignKey
ALTER TABLE "identity"."role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "identity"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "identity"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."role_permissions" ADD CONSTRAINT "role_permissions_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "identity"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planning"."planning_constraints" ADD CONSTRAINT "planning_constraints_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "planning"."planning_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planning"."plan_publications" ADD CONSTRAINT "plan_publications_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "planning"."planning_scenarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "identity"."roles" ("role_code", "role_name", "description", "is_system")
VALUES
    ('ERP_ADMIN', 'ERP Admin', 'Full operational and emergency access across the ERP.', true),
    ('SHOP_MANAGER', 'Shop Manager', 'Supervises work orders, bays, and escalation queues.', true),
    ('DISPATCH_PLANNER', 'Dispatch Planner', 'Plans schedules, routing, and work-order assignments.', true),
    ('TECHNICIAN', 'Technician', 'Executes assigned work, time capture, and ticket updates.', true),
    ('PARTS_COORDINATOR', 'Parts Coordinator', 'Maintains inventory, reservations, and receiving.', true),
    ('TRAINING_COORDINATOR', 'Training Coordinator', 'Manages SOP and OJT assignments.', true),
    ('ACCOUNTING_OPERATOR', 'Accounting Operator', 'Monitors invoice sync and accounting exceptions.', true),
    ('INTEGRATION_OPERATOR', 'Integration Operator', 'Monitors imports, exports, and integration health.', true)
ON CONFLICT ("role_code") DO UPDATE
SET
    "role_name" = EXCLUDED."role_name",
    "description" = EXCLUDED."description",
    "is_system" = EXCLUDED."is_system",
    "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "identity"."permissions" ("permission_code", "permission_name", "description")
VALUES
    ('identity.users.read', 'Read users', 'View user accounts and assigned roles.'),
    ('identity.users.manage_roles', 'Manage user roles', 'Grant and revoke ERP role assignments.'),
    ('work_orders.read', 'Read work orders', 'View work-order and ticket state.'),
    ('work_orders.write', 'Write work orders', 'Create and update work-order level data.'),
    ('work_orders.assign', 'Assign work orders', 'Assign work orders and technician tasks.'),
    ('inventory.read', 'Read inventory', 'View inventory, locations, and stock status.'),
    ('inventory.reserve', 'Reserve inventory', 'Reserve and consume parts against work orders.'),
    ('inventory.adjust', 'Adjust inventory', 'Perform inventory adjustments and reconciliations.'),
    ('planning.read', 'Read planning', 'View planning scenarios and publications.'),
    ('planning.run', 'Run planning', 'Generate and update planning scenarios.'),
    ('planning.publish', 'Publish planning', 'Promote a planning publication to active use.'),
    ('sop_ojt.read', 'Read SOP and OJT', 'View SOP content and training progress.'),
    ('sop_ojt.assign_training', 'Assign training', 'Assign SOP and OJT training work.'),
    ('sop_ojt.manage_content', 'Manage SOP content', 'Create and publish SOP or OJT content.'),
    ('integrations.read', 'Read integrations', 'View integration and migration status.'),
    ('integrations.manage', 'Manage integrations', 'Retry, pause, or reconfigure integration flows.'),
    ('audit.read', 'Read audit', 'View audit trails and operational access history.'),
    ('ops.retry_dead_letter', 'Retry dead letters', 'Retry failed asynchronous processing work.')
ON CONFLICT ("permission_code") DO UPDATE
SET
    "permission_name" = EXCLUDED."permission_name",
    "description" = EXCLUDED."description",
    "updated_at" = CURRENT_TIMESTAMP;

WITH mappings (role_code, permission_code) AS (
    VALUES
        ('ERP_ADMIN', 'identity.users.read'),
        ('ERP_ADMIN', 'identity.users.manage_roles'),
        ('ERP_ADMIN', 'work_orders.read'),
        ('ERP_ADMIN', 'work_orders.write'),
        ('ERP_ADMIN', 'work_orders.assign'),
        ('ERP_ADMIN', 'inventory.read'),
        ('ERP_ADMIN', 'inventory.reserve'),
        ('ERP_ADMIN', 'inventory.adjust'),
        ('ERP_ADMIN', 'planning.read'),
        ('ERP_ADMIN', 'planning.run'),
        ('ERP_ADMIN', 'planning.publish'),
        ('ERP_ADMIN', 'sop_ojt.read'),
        ('ERP_ADMIN', 'sop_ojt.assign_training'),
        ('ERP_ADMIN', 'sop_ojt.manage_content'),
        ('ERP_ADMIN', 'integrations.read'),
        ('ERP_ADMIN', 'integrations.manage'),
        ('ERP_ADMIN', 'audit.read'),
        ('ERP_ADMIN', 'ops.retry_dead_letter'),
        ('SHOP_MANAGER', 'work_orders.read'),
        ('SHOP_MANAGER', 'work_orders.write'),
        ('SHOP_MANAGER', 'work_orders.assign'),
        ('SHOP_MANAGER', 'inventory.read'),
        ('SHOP_MANAGER', 'planning.read'),
        ('SHOP_MANAGER', 'audit.read'),
        ('DISPATCH_PLANNER', 'work_orders.read'),
        ('DISPATCH_PLANNER', 'work_orders.assign'),
        ('DISPATCH_PLANNER', 'planning.read'),
        ('DISPATCH_PLANNER', 'planning.run'),
        ('DISPATCH_PLANNER', 'planning.publish'),
        ('TECHNICIAN', 'work_orders.read'),
        ('TECHNICIAN', 'sop_ojt.read'),
        ('PARTS_COORDINATOR', 'inventory.read'),
        ('PARTS_COORDINATOR', 'inventory.reserve'),
        ('PARTS_COORDINATOR', 'inventory.adjust'),
        ('PARTS_COORDINATOR', 'work_orders.read'),
        ('TRAINING_COORDINATOR', 'sop_ojt.read'),
        ('TRAINING_COORDINATOR', 'sop_ojt.assign_training'),
        ('TRAINING_COORDINATOR', 'sop_ojt.manage_content'),
        ('ACCOUNTING_OPERATOR', 'work_orders.read'),
        ('ACCOUNTING_OPERATOR', 'integrations.read'),
        ('ACCOUNTING_OPERATOR', 'audit.read'),
        ('INTEGRATION_OPERATOR', 'integrations.read'),
        ('INTEGRATION_OPERATOR', 'integrations.manage'),
        ('INTEGRATION_OPERATOR', 'ops.retry_dead_letter')
)
INSERT INTO "identity"."role_permissions" (
    "role_id",
    "permission_id",
    "correlation_id",
    "request_id"
)
SELECT
    roles."id",
    permissions."id",
    'migration:20260320000001_seed_reference_data',
    '20260320000001_seed_reference_data'
FROM mappings
JOIN "identity"."roles" AS roles ON roles."role_code" = mappings.role_code
JOIN "identity"."permissions" AS permissions ON permissions."permission_code" = mappings.permission_code
ON CONFLICT ("role_id", "permission_id") DO UPDATE
SET
    "correlation_id" = EXCLUDED."correlation_id",
    "request_id" = EXCLUDED."request_id";

INSERT INTO "inventory"."stock_locations" (
    "location_code",
    "location_name",
    "location_type",
    "parent_location_id",
    "is_pickable",
    "timezone_name"
)
VALUES
    ('HQ-WH', 'Headquarters Warehouse', 'WAREHOUSE', NULL, true, 'America/New_York'),
    ('HQ-STAGE', 'Headquarters Staging', 'STAGING', NULL, false, 'America/New_York')
ON CONFLICT ("location_code") DO UPDATE
SET
    "location_name" = EXCLUDED."location_name",
    "location_type" = EXCLUDED."location_type",
    "parent_location_id" = EXCLUDED."parent_location_id",
    "is_pickable" = EXCLUDED."is_pickable",
    "timezone_name" = EXCLUDED."timezone_name",
    "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "inventory"."stock_locations" (
    "location_code",
    "location_name",
    "location_type",
    "parent_location_id",
    "is_pickable",
    "timezone_name"
)
SELECT
    seed."location_code",
    seed."location_name",
    seed."location_type"::"inventory"."StockLocationType",
    parent."id",
    seed."is_pickable",
    seed."timezone_name"
FROM (
    VALUES
        ('HQ-BAY-01', 'Headquarters Bay 01', 'BAY', 'HQ-WH', true, 'America/New_York'),
        ('HQ-BAY-02', 'Headquarters Bay 02', 'BAY', 'HQ-WH', true, 'America/New_York')
) AS seed ("location_code", "location_name", "location_type", "parent_location_code", "is_pickable", "timezone_name")
JOIN "inventory"."stock_locations" AS parent ON parent."location_code" = seed."parent_location_code"
ON CONFLICT ("location_code") DO UPDATE
SET
    "location_name" = EXCLUDED."location_name",
    "location_type" = EXCLUDED."location_type",
    "parent_location_id" = EXCLUDED."parent_location_id",
    "is_pickable" = EXCLUDED."is_pickable",
    "timezone_name" = EXCLUDED."timezone_name",
    "updated_at" = CURRENT_TIMESTAMP;

WITH seeded_scenario AS (
    INSERT INTO "planning"."planning_scenarios" (
        "scenario_name",
        "scenario_status",
        "description"
    )
    VALUES (
        'MVP_BASELINE',
        'ACTIVE',
        'Baseline operating scenario for MVP scheduling and slot planning.'
    )
    ON CONFLICT ("scenario_name") DO UPDATE
    SET
        "scenario_status" = EXCLUDED."scenario_status",
        "description" = EXCLUDED."description",
        "updated_at" = CURRENT_TIMESTAMP
    RETURNING "id"
)
INSERT INTO "planning"."planning_constraints" (
    "scenario_id",
    "constraint_key",
    "constraint_value",
    "is_enabled"
)
SELECT
    seeded_scenario."id",
    constraints."constraint_key",
    constraints."constraint_value",
    true
FROM seeded_scenario
JOIN (
    VALUES
        ('SKILL_REQUIRED', '{"required": true}'::jsonb),
        ('DUE_DATE_WEIGHT', '{"weight": 100}'::jsonb),
        ('MAX_SHIFT_MINUTES', '{"minutes": 480}'::jsonb)
) AS constraints ("constraint_key", "constraint_value") ON true
ON CONFLICT ("scenario_id", "constraint_key") DO UPDATE
SET
    "constraint_value" = EXCLUDED."constraint_value",
    "is_enabled" = EXCLUDED."is_enabled",
    "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "planning"."plan_publications" (
    "publication_key",
    "scenario_id",
    "publication_status"
)
SELECT
    'ACTIVE_MVP_SCHEDULE',
    scenarios."id",
    'DRAFT'
FROM "planning"."planning_scenarios" AS scenarios
WHERE scenarios."scenario_name" = 'MVP_BASELINE'
ON CONFLICT ("publication_key") DO UPDATE
SET
    "scenario_id" = EXCLUDED."scenario_id",
    "publication_status" = EXCLUDED."publication_status",
    "updated_at" = CURRENT_TIMESTAMP;