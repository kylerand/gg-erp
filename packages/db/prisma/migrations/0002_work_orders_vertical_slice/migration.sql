create schema if not exists planning;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'work_order_status'
      and n.nspname = 'planning'
  ) then
    create type planning.work_order_status as enum (
      'PLANNED',
      'RELEASED',
      'IN_PROGRESS',
      'BLOCKED',
      'COMPLETED',
      'CANCELLED'
    );
  end if;
end $$;

alter table planning.work_orders
  add column if not exists vehicle_id text,
  add column if not exists build_configuration_id text,
  add column if not exists bom_id text,
  add column if not exists scheduled_start_at timestamptz,
  add column if not exists scheduled_end_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists created_by_user_id uuid,
  add column if not exists updated_by_user_id uuid,
  add column if not exists last_correlation_id text,
  add column if not exists last_request_id text;

alter table planning.work_orders
  alter column state type planning.work_order_status
  using upper(state)::planning.work_order_status,
  alter column state set default 'PLANNED'::planning.work_order_status;

create index if not exists work_orders_state_idx on planning.work_orders (state);
create index if not exists work_orders_vehicle_idx on planning.work_orders (vehicle_id);
create index if not exists work_orders_created_idx on planning.work_orders (created_at);
