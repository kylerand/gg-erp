-- Canonical ERP domain schema (MVP)
-- Expands the minimal 0001 placeholder into an auditable, event-driven domain model.
-- Aurora PostgreSQL-compatible.

create extension if not exists pgcrypto;

-- keep the migration chain coherent by replacing 0001 placeholder tables
-- with the canonical domain model defined in architecture docs.
drop table if exists migration.migration_errors cascade;
drop table if exists migration.shopmonkey_import_batches cascade;
drop table if exists accounting.qb_sync_jobs cascade;
drop table if exists planning.slot_plans cascade;
drop table if exists tickets.tickets cascade;
drop table if exists inventory.stock_levels cascade;
drop table if exists audit.audit_logs cascade;
drop table if exists inventory.parts cascade;
drop table if exists identity.users cascade;

create schema if not exists identity;
create schema if not exists hr;
create schema if not exists inventory;
create schema if not exists work_orders;
create schema if not exists planning;
create schema if not exists sop_ojt;
create schema if not exists integrations;
create schema if not exists audit;
create schema if not exists ops;
create schema if not exists obs;
create schema if not exists events;

-- =====================================================
-- identity
-- =====================================================
create table if not exists identity.users (
  id uuid primary key default gen_random_uuid(),
  cognito_subject text not null unique,
  email text not null,
  display_name text not null,
  status text not null default 'ACTIVE'
    check (status in ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED')),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  last_correlation_id text,
  last_request_id text,
  deleted_at timestamptz,
  deleted_by_user_id uuid references identity.users(id),
  delete_reason text,
  version integer not null default 0 check (version >= 0),
  constraint users_delete_reason_ck check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists users_email_active_uk
  on identity.users (lower(email))
  where deleted_at is null;
create index if not exists users_status_idx on identity.users (status);

create table if not exists identity.roles (
  id uuid primary key default gen_random_uuid(),
  role_code text not null,
  role_name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  deleted_at timestamptz,
  deleted_by_user_id uuid references identity.users(id),
  delete_reason text,
  version integer not null default 0 check (version >= 0),
  constraint roles_delete_reason_ck check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists roles_code_active_uk
  on identity.roles (role_code)
  where deleted_at is null;

create table if not exists identity.permissions (
  id uuid primary key default gen_random_uuid(),
  permission_code text not null,
  permission_name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  deleted_at timestamptz,
  deleted_by_user_id uuid references identity.users(id),
  delete_reason text,
  version integer not null default 0 check (version >= 0),
  constraint permissions_delete_reason_ck check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists permissions_code_active_uk
  on identity.permissions (permission_code)
  where deleted_at is null;

create table if not exists identity.role_permissions (
  role_id uuid not null references identity.roles(id) on delete cascade,
  permission_id uuid not null references identity.permissions(id) on delete cascade,
  granted_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create index if not exists role_permissions_permission_idx
  on identity.role_permissions (permission_id);

create table if not exists identity.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references identity.users(id),
  role_id uuid not null references identity.roles(id),
  assignment_status text not null default 'ACTIVE'
    check (assignment_status in ('ACTIVE', 'REVOKED', 'EXPIRED')),
  assigned_by_user_id uuid references identity.users(id),
  revoked_by_user_id uuid references identity.users(id),
  assignment_reason text,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  correlation_id text not null,
  request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0),
  constraint user_roles_effective_window_ck check (
    effective_to is null or effective_to > effective_from
  )
);

create unique index if not exists user_roles_active_uk
  on identity.user_roles (user_id, role_id)
  where assignment_status = 'ACTIVE';

create index if not exists user_roles_role_status_idx
  on identity.user_roles (role_id, assignment_status);

create table if not exists identity.user_role_history (
  id uuid primary key default gen_random_uuid(),
  user_role_id uuid references identity.user_roles(id),
  user_id uuid not null references identity.users(id),
  role_id uuid not null references identity.roles(id),
  action text not null check (action in ('GRANTED', 'REVOKED', 'EXPIRED')),
  reason text,
  actor_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  created_at timestamptz not null default now()
);

create index if not exists user_role_history_user_created_idx
  on identity.user_role_history (user_id, created_at);

-- =====================================================
-- inventory master data
-- =====================================================
create table if not exists inventory.parts (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  name text not null,
  description text,
  unit_of_measure text not null default 'EA',
  part_state text not null default 'ACTIVE'
    check (part_state in ('ACTIVE', 'INACTIVE', 'DISCONTINUED')),
  reorder_point numeric(14,3) not null default 0 check (reorder_point >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  last_correlation_id text,
  last_request_id text,
  deleted_at timestamptz,
  deleted_by_user_id uuid references identity.users(id),
  delete_reason text,
  version integer not null default 0 check (version >= 0),
  constraint parts_delete_reason_ck check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists parts_sku_active_uk
  on inventory.parts (sku)
  where deleted_at is null;

create table if not exists inventory.stock_locations (
  id uuid primary key default gen_random_uuid(),
  location_code text not null,
  location_name text not null,
  location_type text not null
    check (location_type in ('WAREHOUSE', 'BAY', 'VAN', 'STAGING')),
  parent_location_id uuid references inventory.stock_locations(id),
  is_pickable boolean not null default true,
  timezone_name text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  last_correlation_id text,
  last_request_id text,
  deleted_at timestamptz,
  deleted_by_user_id uuid references identity.users(id),
  delete_reason text,
  version integer not null default 0 check (version >= 0),
  constraint stock_locations_delete_reason_ck
    check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists stock_locations_code_active_uk
  on inventory.stock_locations (location_code)
  where deleted_at is null;

create table if not exists inventory.stock_lots (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references inventory.parts(id),
  stock_location_id uuid not null references inventory.stock_locations(id),
  lot_number text,
  serial_number text,
  lot_state text not null default 'AVAILABLE'
    check (lot_state in ('AVAILABLE', 'QUARANTINED', 'CONSUMED', 'CLOSED')),
  manufactured_at date,
  received_at timestamptz not null default now(),
  expires_at date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  version integer not null default 0 check (version >= 0),
  constraint stock_lots_identity_ck check (lot_number is not null or serial_number is not null),
  constraint stock_lots_expiry_window_ck check (
    expires_at is null or manufactured_at is null or expires_at >= manufactured_at
  )
);

create unique index if not exists stock_lots_location_lot_uk
  on inventory.stock_lots (stock_location_id, part_id, lot_number)
  where lot_number is not null;

create unique index if not exists stock_lots_serial_uk
  on inventory.stock_lots (serial_number)
  where serial_number is not null;

create index if not exists stock_lots_part_state_idx
  on inventory.stock_lots (part_id, lot_state);

-- =====================================================
-- hr
-- =====================================================
create table if not exists hr.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references identity.users(id) on delete set null,
  employee_number text not null,
  first_name text not null,
  last_name text not null,
  employment_state text not null default 'ACTIVE'
    check (employment_state in ('ACTIVE', 'ON_LEAVE', 'TERMINATED')),
  hire_date date not null,
  termination_date date,
  supervisor_employee_id uuid references hr.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  last_correlation_id text,
  last_request_id text,
  deleted_at timestamptz,
  deleted_by_user_id uuid references identity.users(id),
  delete_reason text,
  version integer not null default 0 check (version >= 0),
  constraint employees_delete_reason_ck check (deleted_at is null or delete_reason is not null),
  constraint employees_termination_window_ck
    check (termination_date is null or termination_date >= hire_date)
);

create unique index if not exists employees_number_active_uk
  on hr.employees (employee_number)
  where deleted_at is null;

create index if not exists employees_state_idx on hr.employees (employment_state);

create table if not exists hr.employee_locations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees(id) on delete cascade,
  stock_location_id uuid not null references inventory.stock_locations(id),
  bay_code text,
  allocation_percent numeric(5,2) not null default 100
    check (allocation_percent > 0 and allocation_percent <= 100),
  is_primary boolean not null default false,
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  deleted_at timestamptz,
  deleted_by_user_id uuid references identity.users(id),
  delete_reason text,
  version integer not null default 0 check (version >= 0),
  constraint employee_locations_delete_reason_ck
    check (deleted_at is null or delete_reason is not null),
  constraint employee_locations_effective_window_ck
    check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists employee_locations_primary_uk
  on hr.employee_locations (employee_id)
  where is_primary and deleted_at is null;

create index if not exists employee_locations_location_idx
  on hr.employee_locations (stock_location_id);

create table if not exists hr.employee_skills (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees(id) on delete cascade,
  skill_code text not null,
  proficiency_level integer not null check (proficiency_level between 1 and 5),
  is_certified boolean not null default false,
  last_validated_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by_user_id uuid references identity.users(id),
  delete_reason text,
  version integer not null default 0 check (version >= 0),
  constraint employee_skills_delete_reason_ck
    check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists employee_skills_active_uk
  on hr.employee_skills (employee_id, skill_code)
  where deleted_at is null;

create table if not exists hr.employee_availability_windows (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees(id) on delete cascade,
  window_start timestamptz not null,
  window_end timestamptz not null,
  availability_type text not null default 'AVAILABLE'
    check (availability_type in ('AVAILABLE', 'UNAVAILABLE', 'ON_CALL')),
  recurrence_rule text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0),
  constraint employee_availability_window_ck check (window_end > window_start)
);

create index if not exists employee_availability_employee_start_idx
  on hr.employee_availability_windows (employee_id, window_start);

create table if not exists hr.employee_certifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees(id) on delete cascade,
  certification_code text not null,
  certification_name text not null,
  certification_status text not null default 'ACTIVE'
    check (certification_status in ('ACTIVE', 'EXPIRED', 'REVOKED')),
  issued_at date,
  expires_at date,
  issuer text,
  evidence_uri text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by_user_id uuid references identity.users(id),
  delete_reason text,
  version integer not null default 0 check (version >= 0),
  constraint employee_certifications_delete_reason_ck
    check (deleted_at is null or delete_reason is not null),
  constraint employee_certifications_expiry_ck
    check (expires_at is null or issued_at is null or expires_at >= issued_at)
);

create unique index if not exists employee_certifications_active_uk
  on hr.employee_certifications (employee_id, certification_code)
  where deleted_at is null;

-- =====================================================
-- work orders
-- =====================================================
create table if not exists work_orders.work_orders (
  id uuid primary key default gen_random_uuid(),
  work_order_number text not null,
  customer_reference text,
  asset_reference text,
  title text not null,
  description text,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'READY', 'SCHEDULED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED')),
  priority smallint not null default 3 check (priority between 1 and 5),
  stock_location_id uuid references inventory.stock_locations(id),
  opened_at timestamptz not null default now(),
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid not null references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  version integer not null default 0 check (version >= 0),
  constraint work_orders_completed_window_ck
    check (completed_at is null or completed_at >= opened_at)
);

create unique index if not exists work_orders_number_uk
  on work_orders.work_orders (work_order_number);

create index if not exists work_orders_status_due_idx
  on work_orders.work_orders (status, due_at);

create table if not exists work_orders.work_order_operations (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders.work_orders(id) on delete cascade,
  operation_code text not null,
  sequence_no integer not null check (sequence_no > 0),
  operation_name text not null,
  required_skill_code text,
  estimated_minutes integer not null check (estimated_minutes > 0),
  operation_status text not null default 'PENDING'
    check (operation_status in ('PENDING', 'READY', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'SKIPPED', 'CANCELLED')),
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  blocking_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  correlation_id text,
  request_id text,
  version integer not null default 0 check (version >= 0),
  constraint work_order_operations_planned_window_ck
    check (planned_end_at is null or planned_start_at is null or planned_end_at > planned_start_at),
  constraint work_order_operations_actual_window_ck
    check (actual_end_at is null or actual_start_at is null or actual_end_at > actual_start_at)
);

create unique index if not exists work_order_operations_sequence_uk
  on work_orders.work_order_operations (work_order_id, sequence_no);

create index if not exists work_order_operations_status_idx
  on work_orders.work_order_operations (operation_status);

create table if not exists work_orders.work_order_operation_dependencies (
  work_order_operation_id uuid not null
    references work_orders.work_order_operations(id) on delete cascade,
  depends_on_operation_id uuid not null
    references work_orders.work_order_operations(id) on delete cascade,
  dependency_type text not null default 'FINISH_TO_START'
    check (dependency_type in ('FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH')),
  created_at timestamptz not null default now(),
  primary key (work_order_operation_id, depends_on_operation_id),
  constraint work_order_operation_dependencies_no_self_ck
    check (work_order_operation_id <> depends_on_operation_id)
);

create table if not exists work_orders.work_order_parts (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders.work_orders(id) on delete cascade,
  work_order_operation_id uuid references work_orders.work_order_operations(id) on delete set null,
  part_id uuid not null references inventory.parts(id),
  requested_quantity numeric(14,3) not null check (requested_quantity > 0),
  reserved_quantity numeric(14,3) not null default 0 check (reserved_quantity >= 0),
  consumed_quantity numeric(14,3) not null default 0 check (consumed_quantity >= 0),
  part_status text not null default 'REQUESTED'
    check (part_status in ('REQUESTED', 'RESERVED', 'PARTIALLY_CONSUMED', 'CONSUMED', 'SHORT', 'CANCELLED')),
  shortage_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  version integer not null default 0 check (version >= 0),
  constraint work_order_parts_quantities_ck
    check (reserved_quantity <= requested_quantity and consumed_quantity <= requested_quantity)
);

create index if not exists work_order_parts_work_order_idx
  on work_orders.work_order_parts (work_order_id);

create index if not exists work_order_parts_part_status_idx
  on work_orders.work_order_parts (part_id, part_status);

create table if not exists work_orders.work_order_assignments (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders.work_orders(id) on delete cascade,
  work_order_operation_id uuid not null references work_orders.work_order_operations(id) on delete cascade,
  employee_id uuid not null references hr.employees(id),
  assignment_status text not null default 'ASSIGNED'
    check (assignment_status in ('ASSIGNED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED')),
  assignment_source text not null default 'PLANNER'
    check (assignment_source in ('PLANNER', 'MANUAL', 'OVERRIDE')),
  assigned_start_at timestamptz,
  assigned_end_at timestamptz,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  version integer not null default 0 check (version >= 0),
  constraint work_order_assignments_assigned_window_ck
    check (assigned_end_at is null or assigned_start_at is null or assigned_end_at > assigned_start_at),
  constraint work_order_assignments_actual_window_ck
    check (actual_end_at is null or actual_start_at is null or actual_end_at > actual_start_at)
);

create index if not exists work_order_assignments_employee_status_idx
  on work_orders.work_order_assignments (employee_id, assignment_status);

create index if not exists work_order_assignments_operation_idx
  on work_orders.work_order_assignments (work_order_operation_id);

create table if not exists work_orders.work_order_status_history (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders.work_orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason_code text,
  reason_note text,
  actor_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  created_at timestamptz not null default now()
);

create index if not exists work_order_status_history_work_order_idx
  on work_orders.work_order_status_history (work_order_id, created_at);

-- =====================================================
-- inventory transactions (mutable balances + immutable ledger)
-- =====================================================
create table if not exists inventory.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references inventory.parts(id),
  stock_location_id uuid not null references inventory.stock_locations(id),
  stock_lot_id uuid references inventory.stock_lots(id),
  work_order_id uuid references work_orders.work_orders(id) on delete set null,
  work_order_part_id uuid references work_orders.work_order_parts(id) on delete set null,
  reservation_status text not null default 'ACTIVE'
    check (reservation_status in ('ACTIVE', 'PARTIALLY_CONSUMED', 'CONSUMED', 'RELEASED', 'CANCELLED', 'EXPIRED')),
  reserved_quantity numeric(14,3) not null check (reserved_quantity > 0),
  consumed_quantity numeric(14,3) not null default 0 check (consumed_quantity >= 0),
  reservation_priority integer not null default 100 check (reservation_priority >= 0),
  shortage_reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  version integer not null default 0 check (version >= 0),
  constraint inventory_reservations_quantity_ck
    check (consumed_quantity <= reserved_quantity)
);

create index if not exists inventory_reservations_status_idx
  on inventory.inventory_reservations (reservation_status, expires_at);

create index if not exists inventory_reservations_work_order_idx
  on inventory.inventory_reservations (work_order_id);

create table if not exists inventory.inventory_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references inventory.parts(id),
  stock_location_id uuid not null references inventory.stock_locations(id),
  stock_lot_id uuid references inventory.stock_lots(id),
  reservation_id uuid references inventory.inventory_reservations(id) on delete set null,
  work_order_id uuid references work_orders.work_orders(id) on delete set null,
  movement_type text not null
    check (movement_type in (
      'RECEIPT',
      'RESERVATION',
      'RELEASE',
      'ISSUE',
      'RETURN',
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'ADJUSTMENT',
      'REVERSAL'
    )),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  unit_cost numeric(14,4) check (unit_cost is null or unit_cost >= 0),
  value_delta numeric(14,4),
  reason_code text not null,
  source_document_type text,
  source_document_id text,
  actor_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  reversed_entry_id uuid references inventory.inventory_ledger_entries(id),
  created_at timestamptz not null default now(),
  constraint inventory_ledger_reversal_ck
    check (movement_type <> 'REVERSAL' or reversed_entry_id is not null)
);

create index if not exists inventory_ledger_part_location_created_idx
  on inventory.inventory_ledger_entries (part_id, stock_location_id, created_at);

create index if not exists inventory_ledger_correlation_idx
  on inventory.inventory_ledger_entries (correlation_id);

create table if not exists inventory.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references inventory.parts(id),
  stock_location_id uuid not null references inventory.stock_locations(id),
  stock_lot_id uuid references inventory.stock_lots(id),
  quantity_on_hand numeric(14,3) not null default 0 check (quantity_on_hand >= 0),
  quantity_reserved numeric(14,3) not null default 0 check (quantity_reserved >= 0),
  last_ledger_entry_id uuid references inventory.inventory_ledger_entries(id),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references identity.users(id),
  last_correlation_id text,
  last_request_id text,
  version integer not null default 0 check (version >= 0),
  constraint inventory_balances_reserved_ck
    check (quantity_reserved <= quantity_on_hand)
);

create unique index if not exists inventory_balances_dimension_uk
  on inventory.inventory_balances (
    part_id,
    stock_location_id,
    coalesce(stock_lot_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists inventory_balances_part_location_idx
  on inventory.inventory_balances (part_id, stock_location_id);

-- =====================================================
-- planning / scheduling
-- =====================================================
create table if not exists planning.planning_scenarios (
  id uuid primary key default gen_random_uuid(),
  scenario_name text not null,
  scenario_status text not null default 'DRAFT'
    check (scenario_status in ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  horizon_start date not null,
  horizon_end date not null,
  objective_weights jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  deleted_at timestamptz,
  deleted_by_user_id uuid references identity.users(id),
  delete_reason text,
  version integer not null default 0 check (version >= 0),
  constraint planning_scenarios_horizon_ck check (horizon_end >= horizon_start),
  constraint planning_scenarios_weights_ck check (jsonb_typeof(objective_weights) = 'object'),
  constraint planning_scenarios_delete_reason_ck
    check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists planning_scenarios_name_active_uk
  on planning.planning_scenarios (scenario_name)
  where deleted_at is null;

create table if not exists planning.planning_constraints (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references planning.planning_scenarios(id) on delete cascade,
  constraint_key text not null,
  constraint_type text not null default 'HARD'
    check (constraint_type in ('HARD', 'SOFT')),
  constraint_payload jsonb not null,
  weight numeric(12,4) not null default 1 check (weight > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  version integer not null default 0 check (version >= 0),
  constraint planning_constraints_payload_ck
    check (jsonb_typeof(constraint_payload) in ('object', 'array'))
);

create unique index if not exists planning_constraints_scenario_key_uk
  on planning.planning_constraints (scenario_id, constraint_key);

create table if not exists planning.planner_runs (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references planning.planning_scenarios(id),
  run_status text not null default 'QUEUED'
    check (run_status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT')),
  algorithm_version text not null,
  input_hash text not null,
  deterministic_seed bigint,
  started_at timestamptz,
  completed_at timestamptz,
  runtime_ms bigint,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  version integer not null default 0 check (version >= 0),
  constraint planner_runs_runtime_ck check (runtime_ms is null or runtime_ms >= 0)
);

create index if not exists planner_runs_scenario_status_idx
  on planning.planner_runs (scenario_id, run_status, created_at);

create table if not exists planning.capacity_slots (
  id uuid primary key default gen_random_uuid(),
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  stock_location_id uuid not null references inventory.stock_locations(id),
  bay_code text,
  team_code text,
  slot_status text not null default 'OPEN'
    check (slot_status in ('OPEN', 'LOCKED', 'EXECUTING', 'CLOSED', 'CANCELLED')),
  capacity_minutes integer not null check (capacity_minutes > 0),
  allocated_minutes integer not null default 0 check (allocated_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references identity.users(id),
  correlation_id text,
  request_id text,
  version integer not null default 0 check (version >= 0),
  constraint capacity_slots_window_ck check (slot_end > slot_start),
  constraint capacity_slots_allocated_ck check (allocated_minutes <= capacity_minutes)
);

create unique index if not exists capacity_slots_dimension_uk
  on planning.capacity_slots (stock_location_id, coalesce(bay_code, ''), slot_start, slot_end);

create table if not exists planning.plan_assignments (
  id uuid primary key default gen_random_uuid(),
  planner_run_id uuid not null references planning.planner_runs(id) on delete cascade,
  work_order_operation_id uuid not null references work_orders.work_order_operations(id),
  capacity_slot_id uuid not null references planning.capacity_slots(id),
  proposed_employee_id uuid references hr.employees(id),
  assignment_state text not null default 'PROPOSED'
    check (assignment_state in ('PROPOSED', 'PUBLISHED', 'DISPATCHED', 'REJECTED', 'SUPERSEDED')),
  score numeric(12,4),
  rationale jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  version integer not null default 0 check (version >= 0),
  constraint plan_assignments_rationale_ck check (jsonb_typeof(rationale) = 'object')
);

create index if not exists plan_assignments_run_state_idx
  on planning.plan_assignments (planner_run_id, assignment_state);

create index if not exists plan_assignments_operation_idx
  on planning.plan_assignments (work_order_operation_id);

create table if not exists planning.schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  plan_assignment_id uuid references planning.plan_assignments(id) on delete set null,
  work_order_operation_id uuid not null references work_orders.work_order_operations(id),
  overridden_employee_id uuid references hr.employees(id),
  overridden_capacity_slot_id uuid references planning.capacity_slots(id),
  override_status text not null default 'PENDING'
    check (override_status in ('PENDING', 'APPLIED', 'REVERTED', 'REJECTED')),
  override_reason text not null,
  created_by_user_id uuid not null references identity.users(id),
  approved_by_user_id uuid references identity.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  correlation_id text not null,
  request_id text,
  version integer not null default 0 check (version >= 0)
);

create index if not exists schedule_overrides_status_idx
  on planning.schedule_overrides (override_status, created_at);

create table if not exists planning.plan_publications (
  id uuid primary key default gen_random_uuid(),
  publication_key text not null,
  planner_run_id uuid not null references planning.planner_runs(id),
  publication_status text not null default 'DRAFT'
    check (publication_status in ('DRAFT', 'PUBLISHED', 'ROLLED_BACK', 'SUPERSEDED')),
  effective_at timestamptz not null default now(),
  supersedes_publication_id uuid references planning.plan_publications(id),
  notes text,
  published_by_user_id uuid references identity.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0)
);

create unique index if not exists plan_publications_key_uk
  on planning.plan_publications (publication_key);

create unique index if not exists plan_publications_active_published_uk
  on planning.plan_publications ((publication_status = 'PUBLISHED'))
  where publication_status = 'PUBLISHED';

-- =====================================================
-- sop + ojt
-- =====================================================
create table if not exists sop_ojt.sop_documents (
  id uuid primary key default gen_random_uuid(),
  document_code text not null,
  title text not null,
  document_status text not null default 'DRAFT'
    check (document_status in ('DRAFT', 'PUBLISHED', 'RETIRED')),
  category text,
  owner_employee_id uuid references hr.employees(id),
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  deleted_at timestamptz,
  deleted_by_user_id uuid references identity.users(id),
  delete_reason text,
  version integer not null default 0 check (version >= 0),
  constraint sop_documents_delete_reason_ck
    check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists sop_documents_code_active_uk
  on sop_ojt.sop_documents (document_code)
  where deleted_at is null;

create table if not exists sop_ojt.sop_document_versions (
  id uuid primary key default gen_random_uuid(),
  sop_document_id uuid not null references sop_ojt.sop_documents(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  content_markdown text not null,
  content_hash text not null,
  change_summary text,
  approved_by_user_id uuid references identity.users(id),
  effective_at timestamptz,
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists sop_document_versions_unique_uk
  on sop_ojt.sop_document_versions (sop_document_id, version_number);

create table if not exists sop_ojt.training_modules (
  id uuid primary key default gen_random_uuid(),
  module_code text not null,
  sop_document_id uuid references sop_ojt.sop_documents(id) on delete set null,
  module_name text not null,
  description text,
  module_status text not null default 'ACTIVE'
    check (module_status in ('ACTIVE', 'INACTIVE', 'RETIRED')),
  pass_score integer check (pass_score between 0 and 100),
  validity_days integer check (validity_days is null or validity_days > 0),
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  deleted_at timestamptz,
  deleted_by_user_id uuid references identity.users(id),
  delete_reason text,
  version integer not null default 0 check (version >= 0),
  constraint training_modules_delete_reason_ck
    check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists training_modules_code_active_uk
  on sop_ojt.training_modules (module_code)
  where deleted_at is null;

create table if not exists sop_ojt.training_assignments (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references sop_ojt.training_modules(id),
  employee_id uuid not null references hr.employees(id),
  assignment_status text not null default 'ASSIGNED'
    check (assignment_status in ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'EXEMPT', 'CANCELLED')),
  assigned_by_user_id uuid references identity.users(id),
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  score numeric(5,2) check (score is null or (score >= 0 and score <= 100)),
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0),
  constraint training_assignments_completion_window_ck
    check (completed_at is null or completed_at >= created_at)
);

create index if not exists training_assignments_employee_status_idx
  on sop_ojt.training_assignments (employee_id, assignment_status);

create table if not exists sop_ojt.training_progress_events (
  id uuid primary key default gen_random_uuid(),
  training_assignment_id uuid not null
    references sop_ojt.training_assignments(id) on delete cascade,
  event_type text not null
    check (event_type in ('STARTED', 'STEP_COMPLETED', 'QUIZ_PASSED', 'QUIZ_FAILED', 'COMPLETED', 'RESET')),
  event_payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  created_at timestamptz not null default now()
);

create index if not exists training_progress_events_assignment_idx
  on sop_ojt.training_progress_events (training_assignment_id, created_at);

create table if not exists sop_ojt.operation_training_requirements (
  id uuid primary key default gen_random_uuid(),
  operation_code text not null,
  module_id uuid not null references sop_ojt.training_modules(id),
  requirement_type text not null default 'MANDATORY'
    check (requirement_type in ('MANDATORY', 'RECOMMENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  version integer not null default 0 check (version >= 0)
);

create unique index if not exists operation_training_requirements_uk
  on sop_ojt.operation_training_requirements (operation_code, module_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sop_documents_current_version_fk'
      and conrelid = 'sop_ojt.sop_documents'::regclass
  ) then
    alter table sop_ojt.sop_documents
      add constraint sop_documents_current_version_fk
      foreign key (current_version_id)
      references sop_ojt.sop_document_versions(id);
  end if;
end $$;

-- =====================================================
-- integrations
-- =====================================================
create table if not exists integrations.integration_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('QUICKBOOKS', 'SHOPMONKEY', 'GENERIC')),
  account_key text not null,
  display_name text not null,
  account_status text not null default 'ACTIVE'
    check (account_status in ('ACTIVE', 'PAUSED', 'ERROR', 'DISCONNECTED')),
  configuration jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  deleted_at timestamptz,
  deleted_by_user_id uuid references identity.users(id),
  delete_reason text,
  version integer not null default 0 check (version >= 0),
  constraint integration_accounts_configuration_ck
    check (jsonb_typeof(configuration) = 'object'),
  constraint integration_accounts_delete_reason_ck
    check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists integration_accounts_provider_key_active_uk
  on integrations.integration_accounts (provider, account_key)
  where deleted_at is null;

create table if not exists integrations.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  integration_account_id uuid not null references integrations.integration_accounts(id),
  job_type text not null,
  direction text not null check (direction in ('INBOUND', 'OUTBOUND', 'BIDIRECTIONAL')),
  job_status text not null default 'QUEUED'
    check (job_status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED')),
  started_at timestamptz,
  completed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  last_error_code text,
  last_error_message text,
  triggered_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0)
);

create index if not exists sync_jobs_account_status_idx
  on integrations.sync_jobs (integration_account_id, job_status, created_at);

create table if not exists integrations.sync_job_items (
  id uuid primary key default gen_random_uuid(),
  sync_job_id uuid not null references integrations.sync_jobs(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  external_id text,
  item_status text not null default 'PENDING'
    check (item_status in ('PENDING', 'SYNCED', 'FAILED', 'SKIPPED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_code text,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0)
);

create index if not exists sync_job_items_job_status_idx
  on integrations.sync_job_items (sync_job_id, item_status);

create table if not exists integrations.external_id_mappings (
  id uuid primary key default gen_random_uuid(),
  integration_account_id uuid not null references integrations.integration_accounts(id),
  entity_type text not null,
  entity_id uuid not null,
  external_id text not null,
  namespace text not null default 'default',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  version integer not null default 0 check (version >= 0)
);

create unique index if not exists external_id_mappings_entity_uk
  on integrations.external_id_mappings (integration_account_id, entity_type, entity_id, namespace);

create unique index if not exists external_id_mappings_external_uk
  on integrations.external_id_mappings (integration_account_id, entity_type, external_id, namespace);

create table if not exists integrations.webhook_inbox_events (
  id uuid primary key default gen_random_uuid(),
  integration_account_id uuid not null references integrations.integration_accounts(id),
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  processing_status text not null default 'RECEIVED'
    check (processing_status in ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  version integer not null default 0 check (version >= 0)
);

create unique index if not exists webhook_inbox_events_provider_event_uk
  on integrations.webhook_inbox_events (integration_account_id, provider_event_id);

create index if not exists webhook_inbox_events_status_idx
  on integrations.webhook_inbox_events (processing_status, received_at);

create table if not exists integrations.integration_error_events (
  id uuid primary key default gen_random_uuid(),
  integration_account_id uuid references integrations.integration_accounts(id) on delete set null,
  sync_job_id uuid references integrations.sync_jobs(id) on delete set null,
  severity text not null default 'ERROR'
    check (severity in ('INFO', 'WARN', 'ERROR', 'CRITICAL')),
  error_code text,
  error_message text not null,
  error_context jsonb not null default '{}'::jsonb,
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  created_at timestamptz not null default now()
);

create index if not exists integration_error_events_severity_idx
  on integrations.integration_error_events (severity, created_at);

-- =====================================================
-- audit
-- =====================================================
create table if not exists audit.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references identity.users(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  outcome text not null default 'SUCCESS'
    check (outcome in ('SUCCESS', 'FAILURE', 'DENIED')),
  source_module text,
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_entity_idx
  on audit.audit_events (entity_type, entity_id, created_at);

create index if not exists audit_events_correlation_idx
  on audit.audit_events (correlation_id);

create table if not exists audit.entity_change_sets (
  id uuid primary key default gen_random_uuid(),
  audit_event_id uuid not null references audit.audit_events(id) on delete cascade,
  table_name text not null,
  record_primary_key text not null,
  before_state jsonb,
  after_state jsonb,
  changed_fields text[] not null default '{}',
  sensitive_fields text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists entity_change_sets_audit_event_idx
  on audit.entity_change_sets (audit_event_id);

create table if not exists audit.access_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references identity.users(id),
  access_action text not null check (access_action in ('READ', 'EXPORT', 'DOWNLOAD', 'SEARCH')),
  resource_type text not null,
  resource_id text,
  data_classification text,
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists access_audit_events_actor_created_idx
  on audit.access_audit_events (actor_user_id, created_at);

-- =====================================================
-- ops + observability
-- =====================================================
create table if not exists ops.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  request_hash text not null,
  actor_user_id uuid references identity.users(id),
  key_status text not null default 'IN_PROGRESS'
    check (key_status in ('IN_PROGRESS', 'COMPLETED', 'FAILED', 'EXPIRED')),
  response_code integer,
  response_body jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  locked_until timestamptz,
  correlation_id text,
  request_id text,
  trace_id text,
  span_id text,
  version integer not null default 0 check (version >= 0)
);

create index if not exists idempotency_keys_status_expiry_idx
  on ops.idempotency_keys (key_status, expires_at);

create table if not exists ops.async_job_executions (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  job_key text not null,
  job_status text not null default 'QUEUED'
    check (job_status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'DEAD_LETTERED')),
  priority integer not null default 100,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  worker_id text,
  payload jsonb,
  result_payload jsonb,
  last_error text,
  created_by_user_id uuid references identity.users(id),
  correlation_id text,
  request_id text,
  trace_id text,
  span_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0)
);

create unique index if not exists async_job_executions_job_key_uk
  on ops.async_job_executions (job_type, job_key);

create index if not exists async_job_executions_status_schedule_idx
  on ops.async_job_executions (job_status, scheduled_at);

create table if not exists ops.dead_letter_records (
  id uuid primary key default gen_random_uuid(),
  source_type text not null
    check (source_type in ('OUTBOX', 'INBOX', 'ASYNC_JOB', 'SYNC_JOB', 'WEBHOOK')),
  source_id uuid not null,
  reason_code text,
  reason_message text,
  payload jsonb not null default '{}'::jsonb,
  first_failed_at timestamptz not null default now(),
  latest_failed_at timestamptz not null default now(),
  retry_after timestamptz,
  resolution_status text not null default 'OPEN'
    check (resolution_status in ('OPEN', 'REQUEUED', 'RESOLVED', 'IGNORED')),
  resolved_by_user_id uuid references identity.users(id),
  resolved_at timestamptz,
  correlation_id text,
  request_id text,
  trace_id text,
  span_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0)
);

create index if not exists dead_letter_records_resolution_idx
  on ops.dead_letter_records (resolution_status, latest_failed_at);

create table if not exists obs.correlation_context (
  id uuid primary key default gen_random_uuid(),
  correlation_id text not null unique,
  request_id text,
  trace_id text,
  root_span_id text,
  actor_user_id uuid references identity.users(id),
  source_module text,
  primary_entity_type text,
  primary_entity_id text,
  attributes jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  event_count integer not null default 1 check (event_count > 0)
);

create index if not exists correlation_context_trace_idx
  on obs.correlation_context (trace_id);

-- =====================================================
-- outbox + eventing
-- =====================================================
create table if not exists events.outbox_events (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id text not null,
  event_name text not null,
  event_version integer not null default 1 check (event_version > 0),
  payload jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  publish_status text not null default 'PENDING'
    check (publish_status in ('PENDING', 'PUBLISHED', 'FAILED', 'DEAD_LETTERED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  published_at timestamptz,
  last_error text,
  actor_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0)
);

create index if not exists outbox_events_status_available_idx
  on events.outbox_events (publish_status, available_at);

create index if not exists outbox_events_correlation_idx
  on events.outbox_events (correlation_id);

create table if not exists events.outbox_publish_attempts (
  id uuid primary key default gen_random_uuid(),
  outbox_event_id uuid not null references events.outbox_events(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  publisher text not null,
  destination text,
  attempt_status text not null check (attempt_status in ('SUCCESS', 'FAILED')),
  response_status text,
  response_body jsonb,
  error_message text,
  attempted_at timestamptz not null default now(),
  correlation_id text,
  trace_id text,
  span_id text
);

create unique index if not exists outbox_publish_attempts_unique_uk
  on events.outbox_publish_attempts (outbox_event_id, attempt_number);

create table if not exists events.event_consumer_inbox (
  id uuid primary key default gen_random_uuid(),
  consumer_name text not null,
  source_system text not null,
  source_event_id text not null,
  event_name text not null,
  payload_hash text not null,
  payload jsonb not null,
  processing_status text not null default 'RECEIVED'
    check (processing_status in ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  version integer not null default 0 check (version >= 0)
);

create unique index if not exists event_consumer_inbox_dedupe_uk
  on events.event_consumer_inbox (consumer_name, source_system, source_event_id);

create index if not exists event_consumer_inbox_status_idx
  on events.event_consumer_inbox (processing_status, received_at);

create table if not exists events.event_replay_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by_user_id uuid references identity.users(id),
  request_reason text not null,
  source_system text,
  replay_status text not null default 'REQUESTED'
    check (replay_status in ('REQUESTED', 'APPROVED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  criteria jsonb not null,
  from_timestamp timestamptz,
  to_timestamp timestamptz,
  dry_run boolean not null default false,
  approved_by_user_id uuid references identity.users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0),
  constraint event_replay_requests_criteria_ck
    check (jsonb_typeof(criteria) in ('object', 'array')),
  constraint event_replay_requests_window_ck
    check (to_timestamp is null or from_timestamp is null or to_timestamp >= from_timestamp)
);

create index if not exists event_replay_requests_status_idx
  on events.event_replay_requests (replay_status, created_at);

-- =====================================================
-- append-only enforcement
-- =====================================================
create or replace function ops.prevent_append_only_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Table %.% is append-only; write a compensating record instead', tg_table_schema, tg_table_name;
end;
$$;

drop trigger if exists trg_identity_user_role_history_immutable on identity.user_role_history;
create trigger trg_identity_user_role_history_immutable
before update or delete on identity.user_role_history
for each row execute function ops.prevent_append_only_mutation();

drop trigger if exists trg_inventory_ledger_entries_immutable on inventory.inventory_ledger_entries;
create trigger trg_inventory_ledger_entries_immutable
before update or delete on inventory.inventory_ledger_entries
for each row execute function ops.prevent_append_only_mutation();

drop trigger if exists trg_work_order_status_history_immutable on work_orders.work_order_status_history;
create trigger trg_work_order_status_history_immutable
before update or delete on work_orders.work_order_status_history
for each row execute function ops.prevent_append_only_mutation();

drop trigger if exists trg_sop_document_versions_immutable on sop_ojt.sop_document_versions;
create trigger trg_sop_document_versions_immutable
before update or delete on sop_ojt.sop_document_versions
for each row execute function ops.prevent_append_only_mutation();

drop trigger if exists trg_training_progress_events_immutable on sop_ojt.training_progress_events;
create trigger trg_training_progress_events_immutable
before update or delete on sop_ojt.training_progress_events
for each row execute function ops.prevent_append_only_mutation();

drop trigger if exists trg_integration_error_events_immutable on integrations.integration_error_events;
create trigger trg_integration_error_events_immutable
before update or delete on integrations.integration_error_events
for each row execute function ops.prevent_append_only_mutation();

drop trigger if exists trg_audit_events_immutable on audit.audit_events;
create trigger trg_audit_events_immutable
before update or delete on audit.audit_events
for each row execute function ops.prevent_append_only_mutation();

drop trigger if exists trg_entity_change_sets_immutable on audit.entity_change_sets;
create trigger trg_entity_change_sets_immutable
before update or delete on audit.entity_change_sets
for each row execute function ops.prevent_append_only_mutation();

drop trigger if exists trg_access_audit_events_immutable on audit.access_audit_events;
create trigger trg_access_audit_events_immutable
before update or delete on audit.access_audit_events
for each row execute function ops.prevent_append_only_mutation();

drop trigger if exists trg_outbox_publish_attempts_immutable on events.outbox_publish_attempts;
create trigger trg_outbox_publish_attempts_immutable
before update or delete on events.outbox_publish_attempts
for each row execute function ops.prevent_append_only_mutation();
