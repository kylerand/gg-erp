CREATE TABLE IF NOT EXISTS planning.capacity_slots (
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

CREATE UNIQUE INDEX IF NOT EXISTS capacity_slots_dimension_uk
  ON planning.capacity_slots (stock_location_id, coalesce(bay_code, ''), slot_start, slot_end);

CREATE INDEX IF NOT EXISTS capacity_slots_start_status_idx
  ON planning.capacity_slots (slot_start, slot_status);

CREATE INDEX IF NOT EXISTS capacity_slots_location_start_idx
  ON planning.capacity_slots (stock_location_id, slot_start);
