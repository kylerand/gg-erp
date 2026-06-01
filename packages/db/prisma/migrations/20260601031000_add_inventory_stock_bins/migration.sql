create table if not exists inventory.stock_bins (
  id uuid primary key default gen_random_uuid(),
  stock_location_id uuid not null references inventory.stock_locations(id),
  bin_code text not null,
  bin_name text not null,
  bin_type text not null default 'STORAGE'
    check (bin_type in ('STORAGE', 'STAGING', 'QUARANTINE', 'RETURN', 'CONSUMPTION')),
  bin_state text not null default 'ACTIVE'
    check (bin_state in ('ACTIVE', 'INACTIVE', 'CLOSED')),
  is_pickable boolean not null default true,
  capacity_quantity numeric(14,3) check (capacity_quantity is null or capacity_quantity >= 0),
  capacity_uom_id uuid references inventory.units_of_measure(id),
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
  constraint stock_bins_delete_reason_ck
    check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists stock_bins_location_code_active_uk
  on inventory.stock_bins (stock_location_id, bin_code)
  where deleted_at is null;

create index if not exists stock_bins_location_state_idx
  on inventory.stock_bins (stock_location_id, bin_state)
  where deleted_at is null;

create index if not exists stock_bins_pickable_idx
  on inventory.stock_bins (stock_location_id, is_pickable)
  where deleted_at is null;
