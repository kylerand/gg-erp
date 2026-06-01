ALTER TABLE inventory.inventory_ledger_entries
  DROP CONSTRAINT IF EXISTS inventory_ledger_movement_type_ck;

ALTER TABLE inventory.inventory_ledger_entries
  ADD CONSTRAINT inventory_ledger_movement_type_ck
  CHECK (
    movement_type in (
      'RECEIPT',
      'RESERVATION',
      'ALLOCATION',
      'RELEASE',
      'ISSUE',
      'RETURN',
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'ADJUSTMENT',
      'CYCLE_COUNT',
      'REVERSAL'
    )
  );

CREATE TABLE IF NOT EXISTS inventory.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  adjustment_number text not null,
  adjustment_type text not null
    check (adjustment_type in ('MANUAL', 'CYCLE_COUNT', 'DAMAGE', 'LOSS', 'FOUND', 'CORRECTION')),
  adjustment_status text not null default 'DRAFT'
    check (adjustment_status in ('DRAFT', 'POSTED', 'CANCELLED')),
  stock_location_id uuid not null references inventory.stock_locations(id),
  reason_code text not null,
  notes text,
  counted_at timestamptz,
  posted_at timestamptz,
  actor_user_id uuid references identity.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  version integer not null default 0 check (version >= 0),
  constraint inventory_adjustments_posted_window_ck
    check (posted_at is null or posted_at >= created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_adjustments_number_uk
  ON inventory.inventory_adjustments (adjustment_number);

CREATE INDEX IF NOT EXISTS inventory_adjustments_type_status_idx
  ON inventory.inventory_adjustments (adjustment_type, adjustment_status);

CREATE INDEX IF NOT EXISTS inventory_adjustments_location_status_idx
  ON inventory.inventory_adjustments (stock_location_id, adjustment_status);

CREATE TABLE IF NOT EXISTS inventory.inventory_adjustment_lines (
  id uuid primary key default gen_random_uuid(),
  inventory_adjustment_id uuid not null
    references inventory.inventory_adjustments(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  part_id uuid not null references inventory.parts(id),
  stock_lot_id uuid references inventory.stock_lots(id) on delete set null,
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  expected_quantity numeric(14,3) check (expected_quantity is null or expected_quantity >= 0),
  counted_quantity numeric(14,3) check (counted_quantity is null or counted_quantity >= 0),
  ledger_entry_id uuid unique references inventory.inventory_ledger_entries(id) on delete set null,
  reason_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  version integer not null default 0 check (version >= 0),
  constraint inventory_adjustment_lines_unique_line_uk
    unique (inventory_adjustment_id, line_number),
  constraint inventory_adjustment_lines_expected_counted_ck
    check (
      (expected_quantity is null and counted_quantity is null)
      or (expected_quantity is not null and counted_quantity is not null)
    )
);

CREATE INDEX IF NOT EXISTS inventory_adjustment_lines_part_idx
  ON inventory.inventory_adjustment_lines (part_id, stock_lot_id);

CREATE TABLE IF NOT EXISTS inventory.inventory_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_number text not null,
  transfer_status text not null default 'DRAFT'
    check (transfer_status in ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED')),
  from_stock_location_id uuid not null references inventory.stock_locations(id),
  to_stock_location_id uuid not null references inventory.stock_locations(id),
  shipped_at timestamptz,
  received_at timestamptz,
  shipped_by_user_id uuid references identity.users(id),
  received_by_user_id uuid references identity.users(id),
  reason_code text,
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
  constraint inventory_transfers_location_ck
    check (from_stock_location_id <> to_stock_location_id),
  constraint inventory_transfers_received_window_ck
    check (received_at is null or shipped_at is null or received_at >= shipped_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_transfers_number_uk
  ON inventory.inventory_transfers (transfer_number);

CREATE INDEX IF NOT EXISTS inventory_transfers_route_status_idx
  ON inventory.inventory_transfers (from_stock_location_id, to_stock_location_id, transfer_status);

CREATE INDEX IF NOT EXISTS inventory_transfers_status_shipped_idx
  ON inventory.inventory_transfers (transfer_status, shipped_at);

CREATE TABLE IF NOT EXISTS inventory.inventory_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  inventory_transfer_id uuid not null references inventory.inventory_transfers(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  part_id uuid not null references inventory.parts(id),
  from_stock_lot_id uuid references inventory.stock_lots(id) on delete set null,
  to_stock_lot_id uuid references inventory.stock_lots(id) on delete set null,
  transfer_uom_id uuid not null references inventory.units_of_measure(id),
  quantity_shipped numeric(14,3) not null check (quantity_shipped > 0),
  quantity_received numeric(14,3) not null default 0 check (quantity_received >= 0),
  transfer_out_ledger_entry_id uuid unique
    references inventory.inventory_ledger_entries(id) on delete set null,
  transfer_in_ledger_entry_id uuid unique
    references inventory.inventory_ledger_entries(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  version integer not null default 0 check (version >= 0),
  constraint inventory_transfer_lines_unique_line_uk
    unique (inventory_transfer_id, line_number),
  constraint inventory_transfer_lines_received_ck
    check (quantity_received <= quantity_shipped)
);

CREATE INDEX IF NOT EXISTS inventory_transfer_lines_part_idx
  ON inventory.inventory_transfer_lines (part_id);

CREATE TABLE IF NOT EXISTS inventory.cycle_counts (
  id uuid primary key default gen_random_uuid(),
  cycle_count_number text not null,
  stock_location_id uuid not null references inventory.stock_locations(id),
  cycle_count_status text not null default 'SCHEDULED'
    check (cycle_count_status in ('SCHEDULED', 'IN_PROGRESS', 'RECONCILING', 'POSTED', 'CANCELLED')),
  scheduled_for date not null,
  started_at timestamptz,
  completed_at timestamptz,
  counted_by_user_id uuid references identity.users(id),
  approved_by_user_id uuid references identity.users(id),
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
  constraint cycle_counts_completed_window_ck
    check (completed_at is null or started_at is null or completed_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS cycle_counts_number_uk
  ON inventory.cycle_counts (cycle_count_number);

CREATE INDEX IF NOT EXISTS cycle_counts_location_status_idx
  ON inventory.cycle_counts (stock_location_id, cycle_count_status, scheduled_for);

CREATE TABLE IF NOT EXISTS inventory.cycle_count_lines (
  id uuid primary key default gen_random_uuid(),
  cycle_count_id uuid not null references inventory.cycle_counts(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  part_id uuid not null references inventory.parts(id),
  stock_lot_id uuid references inventory.stock_lots(id) on delete set null,
  expected_quantity numeric(14,3) not null default 0 check (expected_quantity >= 0),
  counted_quantity numeric(14,3) not null check (counted_quantity >= 0),
  variance_quantity numeric(14,3) not null,
  adjustment_line_id uuid references inventory.inventory_adjustment_lines(id) on delete set null,
  reason_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  version integer not null default 0 check (version >= 0),
  constraint cycle_count_lines_unique_line_uk
    unique (cycle_count_id, line_number),
  constraint cycle_count_lines_variance_ck
    check (variance_quantity = counted_quantity - expected_quantity)
);

CREATE INDEX IF NOT EXISTS cycle_count_lines_part_idx
  ON inventory.cycle_count_lines (part_id, stock_lot_id);

CREATE INDEX IF NOT EXISTS cycle_count_lines_variance_idx
  ON inventory.cycle_count_lines (cycle_count_id, part_id)
  WHERE variance_quantity <> 0;
