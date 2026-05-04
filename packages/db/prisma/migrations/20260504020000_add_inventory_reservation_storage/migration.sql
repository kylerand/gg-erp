CREATE TABLE IF NOT EXISTS inventory.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null,
  stock_location_id uuid not null,
  stock_lot_id uuid,
  work_order_id uuid,
  work_order_part_id uuid,
  work_order_operation_id uuid,
  reservation_status text not null default 'ACTIVE',
  reserved_quantity numeric(14,3) not null,
  consumed_quantity numeric(14,3) not null default 0,
  allocated_quantity numeric(14,3) not null default 0,
  reservation_priority integer not null default 100,
  shortage_reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid,
  updated_by_user_id uuid,
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  version integer not null default 0,
  constraint inventory_reservations_status_ck
    check (reservation_status in ('ACTIVE', 'PARTIALLY_CONSUMED', 'CONSUMED', 'RELEASED', 'CANCELLED', 'EXPIRED')),
  constraint inventory_reservations_reserved_quantity_ck
    check (reserved_quantity > 0),
  constraint inventory_reservations_consumed_quantity_ck
    check (consumed_quantity >= 0),
  constraint inventory_reservations_allocated_quantity_nonnegative_ck
    check (allocated_quantity >= 0),
  constraint inventory_reservations_quantity_ck
    check (consumed_quantity <= reserved_quantity),
  constraint inventory_reservations_allocated_quantity_ck
    check (allocated_quantity <= reserved_quantity),
  constraint inventory_reservations_priority_ck
    check (reservation_priority >= 0),
  constraint inventory_reservations_version_ck
    check (version >= 0)
);

ALTER TABLE inventory.inventory_reservations
  ADD COLUMN IF NOT EXISTS work_order_operation_id uuid;

ALTER TABLE inventory.inventory_reservations
  ADD COLUMN IF NOT EXISTS allocated_quantity numeric(14,3) not null default 0;

ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_status_ck
  CHECK (reservation_status in ('ACTIVE', 'PARTIALLY_CONSUMED', 'CONSUMED', 'RELEASED', 'CANCELLED', 'EXPIRED'));

ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_reserved_quantity_ck
  CHECK (reserved_quantity > 0);

ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_consumed_quantity_ck
  CHECK (consumed_quantity >= 0);

ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_allocated_quantity_nonnegative_ck
  CHECK (allocated_quantity >= 0);

ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_quantity_ck
  CHECK (consumed_quantity <= reserved_quantity);

ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_allocated_quantity_ck
  CHECK (allocated_quantity <= reserved_quantity);

ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_priority_ck
  CHECK (reservation_priority >= 0);

ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_version_ck
  CHECK (version >= 0);

CREATE TABLE IF NOT EXISTS inventory.inventory_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null,
  stock_location_id uuid not null,
  stock_lot_id uuid,
  reservation_id uuid,
  work_order_id uuid,
  movement_type text not null,
  quantity_delta numeric(14,3) not null,
  unit_cost numeric(14,4),
  value_delta numeric(14,4),
  reason_code text not null,
  source_document_type text,
  source_document_id text,
  actor_user_id uuid,
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  reversed_entry_id uuid,
  created_at timestamptz not null default now(),
  constraint inventory_ledger_movement_type_ck
    check (movement_type in ('RECEIPT', 'RESERVATION', 'RELEASE', 'ISSUE', 'RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT', 'REVERSAL')),
  constraint inventory_ledger_quantity_delta_ck
    check (quantity_delta <> 0),
  constraint inventory_ledger_unit_cost_ck
    check (unit_cost is null or unit_cost >= 0),
  constraint inventory_ledger_reversal_ck
    check (movement_type <> 'REVERSAL' or reversed_entry_id is not null)
);

CREATE TABLE IF NOT EXISTS inventory.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null,
  stock_location_id uuid not null,
  stock_lot_id uuid,
  quantity_on_hand numeric(14,3) not null default 0,
  quantity_reserved numeric(14,3) not null default 0,
  quantity_allocated numeric(14,3) not null default 0,
  quantity_consumed numeric(14,3) not null default 0,
  last_ledger_entry_id uuid,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid,
  last_correlation_id text,
  last_request_id text,
  version integer not null default 0,
  constraint inventory_balances_on_hand_ck
    check (quantity_on_hand >= 0),
  constraint inventory_balances_reserved_nonnegative_ck
    check (quantity_reserved >= 0),
  constraint inventory_balances_allocated_nonnegative_ck
    check (quantity_allocated >= 0),
  constraint inventory_balances_consumed_nonnegative_ck
    check (quantity_consumed >= 0),
  constraint inventory_balances_reserved_ck
    check (quantity_reserved <= quantity_on_hand),
  constraint inventory_balances_allocated_quantity_ck
    check (quantity_allocated <= quantity_reserved),
  constraint inventory_balances_version_ck
    check (version >= 0)
);

ALTER TABLE inventory.inventory_balances
  ADD COLUMN IF NOT EXISTS quantity_allocated numeric(14,3) not null default 0;

ALTER TABLE inventory.inventory_balances
  ADD COLUMN IF NOT EXISTS quantity_consumed numeric(14,3) not null default 0;

ALTER TABLE inventory.inventory_balances
  ADD CONSTRAINT inventory_balances_allocated_nonnegative_ck
  CHECK (quantity_allocated >= 0);

ALTER TABLE inventory.inventory_balances
  ADD CONSTRAINT inventory_balances_consumed_nonnegative_ck
  CHECK (quantity_consumed >= 0);

ALTER TABLE inventory.inventory_balances
  ADD CONSTRAINT inventory_balances_allocated_quantity_ck
  CHECK (quantity_allocated <= quantity_reserved);

CREATE INDEX IF NOT EXISTS inventory_reservations_status_idx
  ON inventory.inventory_reservations (reservation_status, expires_at);

CREATE INDEX IF NOT EXISTS inventory_reservations_work_order_idx
  ON inventory.inventory_reservations (work_order_id);

CREATE INDEX IF NOT EXISTS inventory_reservations_work_order_part_idx
  ON inventory.inventory_reservations (work_order_part_id, reservation_status)
  WHERE work_order_part_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_reservations_operation_idx
  ON inventory.inventory_reservations (work_order_operation_id, reservation_status)
  WHERE work_order_operation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_ledger_part_location_created_idx
  ON inventory.inventory_ledger_entries (part_id, stock_location_id, created_at);

CREATE INDEX IF NOT EXISTS inventory_ledger_correlation_idx
  ON inventory.inventory_ledger_entries (correlation_id);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_balances_dimension_uk
  ON inventory.inventory_balances (
    part_id,
    stock_location_id,
    coalesce(stock_lot_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS inventory_balances_part_location_idx
  ON inventory.inventory_balances (part_id, stock_location_id);

CREATE INDEX IF NOT EXISTS inventory_balances_allocated_idx
  ON inventory.inventory_balances (stock_location_id, quantity_allocated);

ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_part_id_fkey
  FOREIGN KEY (part_id) REFERENCES inventory.parts(id);

ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_stock_location_id_fkey
  FOREIGN KEY (stock_location_id) REFERENCES inventory.stock_locations(id);

ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_stock_lot_id_fkey
  FOREIGN KEY (stock_lot_id) REFERENCES inventory.stock_lots(id);

ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_work_order_id_fkey
  FOREIGN KEY (work_order_id) REFERENCES work_orders.work_orders(id) ON DELETE SET NULL;

ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_work_order_part_id_fkey
  FOREIGN KEY (work_order_part_id) REFERENCES work_orders.work_order_parts(id) ON DELETE SET NULL;

ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_work_order_operation_id_fkey
  FOREIGN KEY (work_order_operation_id) REFERENCES work_orders.work_order_operations(id) ON DELETE SET NULL;

ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES identity.users(id);

ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_updated_by_user_id_fkey
  FOREIGN KEY (updated_by_user_id) REFERENCES identity.users(id);

ALTER TABLE inventory.inventory_ledger_entries
  ADD CONSTRAINT inventory_ledger_entries_part_id_fkey
  FOREIGN KEY (part_id) REFERENCES inventory.parts(id);

ALTER TABLE inventory.inventory_ledger_entries
  ADD CONSTRAINT inventory_ledger_entries_stock_location_id_fkey
  FOREIGN KEY (stock_location_id) REFERENCES inventory.stock_locations(id);

ALTER TABLE inventory.inventory_ledger_entries
  ADD CONSTRAINT inventory_ledger_entries_stock_lot_id_fkey
  FOREIGN KEY (stock_lot_id) REFERENCES inventory.stock_lots(id);

ALTER TABLE inventory.inventory_ledger_entries
  ADD CONSTRAINT inventory_ledger_entries_reservation_id_fkey
  FOREIGN KEY (reservation_id) REFERENCES inventory.inventory_reservations(id) ON DELETE SET NULL;

ALTER TABLE inventory.inventory_ledger_entries
  ADD CONSTRAINT inventory_ledger_entries_work_order_id_fkey
  FOREIGN KEY (work_order_id) REFERENCES work_orders.work_orders(id) ON DELETE SET NULL;

ALTER TABLE inventory.inventory_ledger_entries
  ADD CONSTRAINT inventory_ledger_entries_actor_user_id_fkey
  FOREIGN KEY (actor_user_id) REFERENCES identity.users(id);

ALTER TABLE inventory.inventory_ledger_entries
  ADD CONSTRAINT inventory_ledger_entries_reversed_entry_id_fkey
  FOREIGN KEY (reversed_entry_id) REFERENCES inventory.inventory_ledger_entries(id);

ALTER TABLE inventory.inventory_balances
  ADD CONSTRAINT inventory_balances_part_id_fkey
  FOREIGN KEY (part_id) REFERENCES inventory.parts(id);

ALTER TABLE inventory.inventory_balances
  ADD CONSTRAINT inventory_balances_stock_location_id_fkey
  FOREIGN KEY (stock_location_id) REFERENCES inventory.stock_locations(id);

ALTER TABLE inventory.inventory_balances
  ADD CONSTRAINT inventory_balances_stock_lot_id_fkey
  FOREIGN KEY (stock_lot_id) REFERENCES inventory.stock_lots(id);

ALTER TABLE inventory.inventory_balances
  ADD CONSTRAINT inventory_balances_last_ledger_entry_id_fkey
  FOREIGN KEY (last_ledger_entry_id) REFERENCES inventory.inventory_ledger_entries(id);

ALTER TABLE inventory.inventory_balances
  ADD CONSTRAINT inventory_balances_updated_by_user_id_fkey
  FOREIGN KEY (updated_by_user_id) REFERENCES identity.users(id);
