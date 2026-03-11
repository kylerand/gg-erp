create extension if not exists pgcrypto;

create schema if not exists planning;
create schema if not exists audit;
create schema if not exists obs;

create table if not exists planning.work_orders (
  id uuid primary key default gen_random_uuid(),
  work_order_number text not null unique,
  state text not null,
  updated_at timestamptz not null default now()
);

create table if not exists audit.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  correlation_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_entity_idx on audit.audit_events (entity_type, entity_id);
create index if not exists audit_events_correlation_idx on audit.audit_events (correlation_id);

create table if not exists obs.event_outbox (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  correlation_id text not null,
  payload jsonb not null,
  state text not null default 'PENDING' check (state in ('PENDING', 'PUBLISHED', 'FAILED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists event_outbox_state_created_idx on obs.event_outbox (state, created_at);
