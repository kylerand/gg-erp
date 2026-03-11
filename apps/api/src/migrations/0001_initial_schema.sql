-- Initial ERP schema baseline (MVP)

create schema if not exists identity;
create schema if not exists inventory;
create schema if not exists tickets;
create schema if not exists sop_ojt;
create schema if not exists planning;
create schema if not exists accounting;
create schema if not exists migration;
create schema if not exists audit;
create schema if not exists obs;

create table if not exists identity.users (
  id uuid primary key,
  email text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists inventory.parts (
  id uuid primary key,
  sku text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists inventory.stock_levels (
  part_id uuid primary key references inventory.parts(id),
  quantity_on_hand integer not null,
  quantity_reserved integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists tickets.tickets (
  id uuid primary key,
  title text not null,
  status text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists planning.slot_plans (
  id uuid primary key,
  run_reference text not null unique,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists accounting.qb_sync_jobs (
  id uuid primary key,
  direction text not null,
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists migration.shopmonkey_import_batches (
  id uuid primary key,
  source_reference text not null,
  status text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists migration.migration_errors (
  id uuid primary key,
  batch_id uuid not null references migration.shopmonkey_import_batches(id),
  record_reference text not null,
  reason_code text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists audit.audit_logs (
  id uuid primary key,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  correlation_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
