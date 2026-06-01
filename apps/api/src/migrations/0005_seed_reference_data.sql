-- Production reference-data seed.
-- Idempotent by natural keys because several target tables use partial unique indexes.

insert into identity.roles (
  id,
  role_code,
  role_name,
  description,
  is_system,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  seed.role_code,
  seed.role_name,
  seed.description,
  true,
  now(),
  now()
from (
  values
    ('ERP_ADMIN', 'ERP Admin', 'Full administrative access for ERP operations.'),
    ('SHOP_MANAGER', 'Shop Manager', 'Runs daily shop operations, dispatch, blockers, and throughput.'),
    ('DISPATCH_PLANNER', 'Dispatch Planner', 'Plans capacity, publishes schedules, and assigns work.'),
    ('TECHNICIAN', 'Technician', 'Executes assigned work orders, tasks, SOPs, and material actions.'),
    ('PARTS_COORDINATOR', 'Parts Coordinator', 'Manages inventory availability, reservations, and stock corrections.'),
    ('TRAINING_COORDINATOR', 'Training Coordinator', 'Assigns and maintains SOP/OJT training content.'),
    ('ACCOUNTING_OPERATOR', 'Accounting Operator', 'Reviews accounting sync, AR, payment, and payable workflows.'),
    ('INTEGRATION_OPERATOR', 'Integration Operator', 'Manages integration health, retries, and migration support.')
) as seed(role_code, role_name, description)
where not exists (
  select 1
  from identity.roles existing
  where existing.role_code = seed.role_code
    and existing.deleted_at is null
);

insert into identity.permissions (
  id,
  permission_code,
  permission_name,
  description,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  seed.permission_code,
  seed.permission_name,
  seed.description,
  now(),
  now()
from (
  values
    ('identity.users.read', 'Read Users', 'View ERP users, employees, roles, and active assignments.'),
    ('identity.users.manage_roles', 'Manage User Roles', 'Assign or revoke ERP access roles.'),
    ('customers.read', 'Read Customers', 'View customer, dealer, and cart ownership records.'),
    ('customers.write', 'Manage Customers', 'Create and update customer/dealer operating records.'),
    ('work_orders.read', 'Read Work Orders', 'View work orders, dispatch queues, tasks, and shop status.'),
    ('work_orders.write', 'Manage Work Orders', 'Create and update work orders, tasks, QC, labor, and notes.'),
    ('work_orders.assign', 'Assign Work Orders', 'Assign work orders, technicians, and execution operations.'),
    ('inventory.read', 'Read Inventory', 'View parts, lots, reservations, ledgers, vendors, and POs.'),
    ('inventory.reserve', 'Reserve Inventory', 'Reserve, release, and issue inventory for work orders.'),
    ('inventory.adjust', 'Adjust Inventory', 'Post stock adjustments, transfers, cycle counts, and receiving variance.'),
    ('planning.read', 'Read Planning', 'View build packages, planning masters, capacity, and schedules.'),
    ('planning.run', 'Run Planning', 'Run planning projections and schedule previews.'),
    ('planning.publish', 'Publish Planning', 'Publish schedules and capacity assignments.'),
    ('sop_ojt.read', 'Read SOP/OJT', 'View SOP, OJT, modules, assignments, and inspection templates.'),
    ('sop_ojt.assign_training', 'Assign Training', 'Create and complete team training assignments.'),
    ('sop_ojt.manage_content', 'Manage SOP/OJT Content', 'Create, publish, and retire SOP/OJT content.'),
    ('sales.read', 'Read Sales', 'View opportunities, quotes, forecasts, and customer sales context.'),
    ('sales.write', 'Manage Sales', 'Create and update opportunities, quotes, and quote conversion workflows.'),
    ('accounting.read', 'Read Accounting', 'View accounting sync, AR, payables, mappings, and reconciliation.'),
    ('accounting.sync.manage', 'Manage Accounting Sync', 'Retry, repair, and reconcile QuickBooks sync records.'),
    ('integrations.read', 'Read Integrations', 'View integration account health and migration status.'),
    ('integrations.manage', 'Manage Integrations', 'Manage integration connections, retries, and repair actions.'),
    ('audit.read', 'Read Audit', 'View audit events and privileged action history.'),
    ('ops.retry_dead_letter', 'Retry Dead Letters', 'Retry failed outbox, migration, and integration jobs.')
) as seed(permission_code, permission_name, description)
where not exists (
  select 1
  from identity.permissions existing
  where existing.permission_code = seed.permission_code
    and existing.deleted_at is null
);

insert into identity.role_permissions (
  role_id,
  permission_id,
  correlation_id,
  created_at
)
select
  roles.id,
  permissions.id,
  'seed-reference-data',
  now()
from (
  values
    ('ERP_ADMIN', 'identity.users.read'),
    ('ERP_ADMIN', 'identity.users.manage_roles'),
    ('ERP_ADMIN', 'customers.read'),
    ('ERP_ADMIN', 'customers.write'),
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
    ('ERP_ADMIN', 'sales.read'),
    ('ERP_ADMIN', 'sales.write'),
    ('ERP_ADMIN', 'accounting.read'),
    ('ERP_ADMIN', 'accounting.sync.manage'),
    ('ERP_ADMIN', 'integrations.read'),
    ('ERP_ADMIN', 'integrations.manage'),
    ('ERP_ADMIN', 'audit.read'),
    ('ERP_ADMIN', 'ops.retry_dead_letter'),
    ('SHOP_MANAGER', 'customers.read'),
    ('SHOP_MANAGER', 'customers.write'),
    ('SHOP_MANAGER', 'work_orders.read'),
    ('SHOP_MANAGER', 'work_orders.write'),
    ('SHOP_MANAGER', 'work_orders.assign'),
    ('SHOP_MANAGER', 'inventory.read'),
    ('SHOP_MANAGER', 'inventory.reserve'),
    ('SHOP_MANAGER', 'planning.read'),
    ('SHOP_MANAGER', 'planning.run'),
    ('SHOP_MANAGER', 'planning.publish'),
    ('SHOP_MANAGER', 'sop_ojt.read'),
    ('SHOP_MANAGER', 'sop_ojt.assign_training'),
    ('SHOP_MANAGER', 'sales.read'),
    ('SHOP_MANAGER', 'accounting.read'),
    ('SHOP_MANAGER', 'audit.read'),
    ('DISPATCH_PLANNER', 'customers.read'),
    ('DISPATCH_PLANNER', 'work_orders.read'),
    ('DISPATCH_PLANNER', 'work_orders.assign'),
    ('DISPATCH_PLANNER', 'inventory.read'),
    ('DISPATCH_PLANNER', 'planning.read'),
    ('DISPATCH_PLANNER', 'planning.run'),
    ('DISPATCH_PLANNER', 'planning.publish'),
    ('TECHNICIAN', 'work_orders.read'),
    ('TECHNICIAN', 'work_orders.write'),
    ('TECHNICIAN', 'inventory.read'),
    ('TECHNICIAN', 'inventory.reserve'),
    ('TECHNICIAN', 'sop_ojt.read'),
    ('PARTS_COORDINATOR', 'work_orders.read'),
    ('PARTS_COORDINATOR', 'inventory.read'),
    ('PARTS_COORDINATOR', 'inventory.reserve'),
    ('PARTS_COORDINATOR', 'inventory.adjust'),
    ('PARTS_COORDINATOR', 'planning.read'),
    ('TRAINING_COORDINATOR', 'identity.users.read'),
    ('TRAINING_COORDINATOR', 'work_orders.read'),
    ('TRAINING_COORDINATOR', 'sop_ojt.read'),
    ('TRAINING_COORDINATOR', 'sop_ojt.assign_training'),
    ('TRAINING_COORDINATOR', 'sop_ojt.manage_content'),
    ('ACCOUNTING_OPERATOR', 'customers.read'),
    ('ACCOUNTING_OPERATOR', 'work_orders.read'),
    ('ACCOUNTING_OPERATOR', 'accounting.read'),
    ('ACCOUNTING_OPERATOR', 'accounting.sync.manage'),
    ('ACCOUNTING_OPERATOR', 'integrations.read'),
    ('INTEGRATION_OPERATOR', 'accounting.read'),
    ('INTEGRATION_OPERATOR', 'accounting.sync.manage'),
    ('INTEGRATION_OPERATOR', 'integrations.read'),
    ('INTEGRATION_OPERATOR', 'integrations.manage'),
    ('INTEGRATION_OPERATOR', 'audit.read'),
    ('INTEGRATION_OPERATOR', 'ops.retry_dead_letter')
) as seed(role_code, permission_code)
join identity.roles roles
  on roles.role_code = seed.role_code
 and roles.deleted_at is null
join identity.permissions permissions
  on permissions.permission_code = seed.permission_code
 and permissions.deleted_at is null
where not exists (
  select 1
  from identity.role_permissions existing
  where existing.role_id = roles.id
    and existing.permission_id = permissions.id
);

insert into inventory.stock_locations (
  id,
  location_code,
  location_name,
  location_type,
  is_pickable,
  timezone_name,
  created_at,
  updated_at,
  last_correlation_id
)
select
  gen_random_uuid(),
  seed.location_code,
  seed.location_name,
  seed.location_type,
  seed.is_pickable,
  'America/New_York',
  now(),
  now(),
  'seed-reference-data'
from (
  values
    ('HQ-WH', 'Golfin Garage Main Warehouse', 'WAREHOUSE', true),
    ('HQ-STAGE', 'Golfin Garage Receiving and Inspection Stage', 'STAGING', false),
    ('HQ-BAY-01', 'Build Bay 1', 'BAY', false),
    ('HQ-BAY-02', 'Build Bay 2', 'BAY', false)
) as seed(location_code, location_name, location_type, is_pickable)
where not exists (
  select 1
  from inventory.stock_locations existing
  where existing.location_code = seed.location_code
    and existing.deleted_at is null
);

insert into inventory.stock_bins (
  id,
  stock_location_id,
  bin_code,
  bin_name,
  bin_type,
  bin_state,
  is_pickable,
  created_at,
  updated_at,
  last_correlation_id
)
select
  gen_random_uuid(),
  locations.id,
  seed.bin_code,
  seed.bin_name,
  seed.bin_type,
  'ACTIVE',
  seed.is_pickable,
  now(),
  now(),
  'seed-reference-data'
from (
  values
    ('HQ-WH', 'GENERAL', 'General Pick Face', 'STORAGE', true),
    ('HQ-STAGE', 'INBOUND', 'Inbound Inspection', 'STAGING', false),
    ('HQ-BAY-01', 'WIP', 'Bay 1 Work in Process', 'CONSUMPTION', false),
    ('HQ-BAY-02', 'WIP', 'Bay 2 Work in Process', 'CONSUMPTION', false)
) as seed(location_code, bin_code, bin_name, bin_type, is_pickable)
join inventory.stock_locations locations
  on locations.location_code = seed.location_code
 and locations.deleted_at is null
where not exists (
  select 1
  from inventory.stock_bins existing
  where existing.stock_location_id = locations.id
    and existing.bin_code = seed.bin_code
    and existing.deleted_at is null
);

insert into planning.planning_scenarios (
  id,
  scenario_name,
  scenario_status,
  horizon_start,
  horizon_end,
  objective_weights,
  notes,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  'MVP_BASELINE',
  'ACTIVE',
  current_date,
  current_date + 14,
  '{"dueDate": 3, "priority": 2, "materialReadiness": 4, "skillMatch": 2}'::jsonb,
  'Baseline production planning scenario seeded for first-run ERP operations.',
  now(),
  now()
where not exists (
  select 1
  from planning.planning_scenarios existing
  where existing.scenario_name = 'MVP_BASELINE'
    and existing.deleted_at is null
);

insert into planning.planning_constraints (
  id,
  scenario_id,
  constraint_key,
  constraint_type,
  constraint_payload,
  weight,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  scenario.id,
  seed.constraint_key,
  seed.constraint_type,
  seed.constraint_payload::jsonb,
  seed.weight,
  now(),
  now()
from (
  values
    ('SKILL_REQUIRED', 'HARD', '{"enforce": true}', 1.0000),
    ('MATERIAL_READY_REQUIRED', 'HARD', '{"enforce": true}', 1.0000),
    ('DUE_DATE_WEIGHT', 'SOFT', '{"sort": "earliest_due_date"}', 3.0000),
    ('MAX_SHIFT_MINUTES', 'HARD', '{"minutes": 480}', 1.0000)
) as seed(constraint_key, constraint_type, constraint_payload, weight)
join planning.planning_scenarios scenario
  on scenario.scenario_name = 'MVP_BASELINE'
 and scenario.deleted_at is null
where not exists (
  select 1
  from planning.planning_constraints existing
  where existing.scenario_id = scenario.id
    and existing.constraint_key = seed.constraint_key
);
