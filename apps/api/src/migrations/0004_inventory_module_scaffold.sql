-- Inventory module scaffold (additive)
-- Extends canonical schema with inventory-centric procurement and warehouse controls.

create schema if not exists inventory;

-- =====================================================
-- units of measure + conversion scaffolding
-- =====================================================
create table if not exists inventory.units_of_measure (
  id uuid primary key default gen_random_uuid(),
  uom_code text not null,
  uom_name text not null,
  uom_category text not null default 'COUNT'
    check (uom_category in ('COUNT', 'LENGTH', 'WEIGHT', 'VOLUME', 'TIME', 'OTHER')),
  decimal_scale smallint not null default 3 check (decimal_scale between 0 and 6),
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
  constraint units_of_measure_delete_reason_ck
    check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists units_of_measure_code_active_uk
  on inventory.units_of_measure (lower(uom_code))
  where deleted_at is null;

create index if not exists units_of_measure_category_idx
  on inventory.units_of_measure (uom_category)
  where deleted_at is null;

create table if not exists inventory.unit_of_measure_conversions (
  id uuid primary key default gen_random_uuid(),
  part_id uuid references inventory.parts(id) on delete cascade,
  from_uom_id uuid not null references inventory.units_of_measure(id),
  to_uom_id uuid not null references inventory.units_of_measure(id),
  conversion_factor numeric(18,6) not null check (conversion_factor > 0),
  rounding_scale smallint check (rounding_scale is null or rounding_scale between 0 and 6),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  conversion_note text,
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
  constraint unit_of_measure_conversions_no_self_ck check (from_uom_id <> to_uom_id),
  constraint unit_of_measure_conversions_effective_window_ck
    check (effective_to is null or effective_to > effective_from),
  constraint unit_of_measure_conversions_delete_reason_ck
    check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists unit_of_measure_conversions_active_uk
  on inventory.unit_of_measure_conversions (
    coalesce(part_id, '00000000-0000-0000-0000-000000000000'::uuid),
    from_uom_id,
    to_uom_id
  )
  where deleted_at is null and effective_to is null;

create index if not exists unit_of_measure_conversions_route_idx
  on inventory.unit_of_measure_conversions (from_uom_id, to_uom_id)
  where deleted_at is null;

create index if not exists unit_of_measure_conversions_part_idx
  on inventory.unit_of_measure_conversions (part_id, from_uom_id, to_uom_id)
  where deleted_at is null and part_id is not null;

insert into inventory.units_of_measure (
  id,
  uom_code,
  uom_name,
  uom_category,
  decimal_scale,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  seed.uom_code,
  seed.uom_name,
  seed.uom_category,
  seed.decimal_scale,
  now(),
  now()
from (
  values
    ('EA', 'Each', 'COUNT', 3),
    ('BOX', 'Box', 'COUNT', 3),
    ('KIT', 'Kit', 'COUNT', 3),
    ('KG', 'Kilogram', 'WEIGHT', 3),
    ('L', 'Liter', 'VOLUME', 3)
) as seed(uom_code, uom_name, uom_category, decimal_scale)
where not exists (
  select 1
  from inventory.units_of_measure existing
  where lower(existing.uom_code) = lower(seed.uom_code)
    and existing.deleted_at is null
);

insert into inventory.units_of_measure (
  id,
  uom_code,
  uom_name,
  uom_category,
  decimal_scale,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  existing_parts.unit_of_measure,
  existing_parts.unit_of_measure,
  'COUNT',
  3,
  now(),
  now()
from (
  select distinct unit_of_measure
  from inventory.parts
  where unit_of_measure is not null
) as existing_parts
where not exists (
  select 1
  from inventory.units_of_measure existing
  where lower(existing.uom_code) = lower(existing_parts.unit_of_measure)
    and existing.deleted_at is null
);

-- =====================================================
-- parts catalog extensions + substitutions
-- =====================================================
alter table inventory.parts
  add column if not exists manufacturer_name text,
  add column if not exists manufacturer_part_number text,
  add column if not exists part_category text,
  add column if not exists is_stocked boolean not null default true,
  add column if not exists stock_uom_id uuid,
  add column if not exists purchase_uom_id uuid,
  add column if not exists default_vendor_id uuid;

update inventory.parts part
set stock_uom_id = uom.id
from inventory.units_of_measure uom
where part.stock_uom_id is null
  and part.unit_of_measure is not null
  and lower(uom.uom_code) = lower(part.unit_of_measure)
  and uom.deleted_at is null;

update inventory.parts part
set stock_uom_id = uom.id
from inventory.units_of_measure uom
where part.stock_uom_id is null
  and lower(uom.uom_code) = 'ea'
  and uom.deleted_at is null;

update inventory.parts
set purchase_uom_id = stock_uom_id
where purchase_uom_id is null;

create index if not exists parts_stock_uom_idx
  on inventory.parts (stock_uom_id);

create index if not exists parts_purchase_uom_idx
  on inventory.parts (purchase_uom_id);

create index if not exists parts_default_vendor_idx
  on inventory.parts (default_vendor_id)
  where deleted_at is null and default_vendor_id is not null;

create index if not exists parts_manufacturer_part_number_idx
  on inventory.parts (manufacturer_part_number)
  where deleted_at is null and manufacturer_part_number is not null;

create index if not exists parts_category_state_idx
  on inventory.parts (part_category, part_state)
  where deleted_at is null;

create table if not exists inventory.part_substitutions (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references inventory.parts(id),
  substitute_part_id uuid not null references inventory.parts(id),
  substitution_type text not null default 'ALTERNATE'
    check (substitution_type in ('ALTERNATE', 'SUPERSESSION', 'EQUIVALENT')),
  priority integer not null default 100 check (priority > 0),
  conversion_factor numeric(18,6) check (conversion_factor is null or conversion_factor > 0),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  substitution_reason text,
  approval_status text not null default 'APPROVED'
    check (approval_status in ('PENDING', 'APPROVED', 'REVOKED')),
  approved_by_user_id uuid references identity.users(id),
  approved_at timestamptz,
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
  constraint part_substitutions_no_self_ck check (part_id <> substitute_part_id),
  constraint part_substitutions_effective_window_ck
    check (effective_to is null or effective_to > effective_from),
  constraint part_substitutions_approval_ck
    check (approval_status <> 'APPROVED' or approved_at is not null),
  constraint part_substitutions_delete_reason_ck
    check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists part_substitutions_active_uk
  on inventory.part_substitutions (part_id, substitute_part_id, substitution_type)
  where deleted_at is null and approval_status = 'APPROVED';

create index if not exists part_substitutions_primary_priority_idx
  on inventory.part_substitutions (part_id, priority)
  where deleted_at is null;

create index if not exists part_substitutions_substitute_idx
  on inventory.part_substitutions (substitute_part_id)
  where deleted_at is null;

-- =====================================================
-- bin/location tracking + quantity model support
-- =====================================================
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

alter table inventory.stock_lots
  add column if not exists stock_bin_id uuid,
  add column if not exists origin_purchase_order_line_id uuid,
  add column if not exists received_uom_id uuid;

create index if not exists stock_lots_stock_bin_idx
  on inventory.stock_lots (stock_bin_id)
  where stock_bin_id is not null;

create index if not exists stock_lots_origin_purchase_order_line_idx
  on inventory.stock_lots (origin_purchase_order_line_id)
  where origin_purchase_order_line_id is not null;

create index if not exists stock_lots_part_location_bin_idx
  on inventory.stock_lots (part_id, stock_location_id, stock_bin_id);

alter table inventory.inventory_reservations
  add column if not exists stock_bin_id uuid,
  add column if not exists work_order_operation_id uuid,
  add column if not exists allocated_quantity numeric(14,3) not null default 0
    check (allocated_quantity >= 0);

create index if not exists inventory_reservations_part_location_bin_status_idx
  on inventory.inventory_reservations (part_id, stock_location_id, stock_bin_id, reservation_status);

create index if not exists inventory_reservations_work_order_part_idx
  on inventory.inventory_reservations (work_order_part_id, reservation_status)
  where work_order_part_id is not null;

create index if not exists inventory_reservations_operation_idx
  on inventory.inventory_reservations (work_order_operation_id, reservation_status)
  where work_order_operation_id is not null;

alter table inventory.inventory_balances
  add column if not exists quantity_allocated numeric(14,3) not null default 0
    check (quantity_allocated >= 0),
  add column if not exists quantity_consumed numeric(14,3) not null default 0
    check (quantity_consumed >= 0);

create index if not exists inventory_balances_allocated_idx
  on inventory.inventory_balances (stock_location_id, quantity_allocated);

create table if not exists inventory.inventory_bin_balances (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references inventory.parts(id),
  stock_location_id uuid not null references inventory.stock_locations(id),
  stock_bin_id uuid not null references inventory.stock_bins(id),
  stock_lot_id uuid references inventory.stock_lots(id),
  quantity_on_hand numeric(14,3) not null default 0 check (quantity_on_hand >= 0),
  quantity_reserved numeric(14,3) not null default 0 check (quantity_reserved >= 0),
  quantity_allocated numeric(14,3) not null default 0 check (quantity_allocated >= 0),
  quantity_consumed numeric(14,3) not null default 0 check (quantity_consumed >= 0),
  last_ledger_entry_id uuid references inventory.inventory_ledger_entries(id),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references identity.users(id),
  last_correlation_id text,
  last_request_id text,
  version integer not null default 0 check (version >= 0),
  constraint inventory_bin_balances_reserved_ck check (quantity_reserved <= quantity_on_hand),
  constraint inventory_bin_balances_allocated_ck check (quantity_allocated <= quantity_reserved)
);

create unique index if not exists inventory_bin_balances_dimension_uk
  on inventory.inventory_bin_balances (
    part_id,
    stock_location_id,
    stock_bin_id,
    coalesce(stock_lot_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists inventory_bin_balances_part_location_bin_idx
  on inventory.inventory_bin_balances (part_id, stock_location_id, stock_bin_id);

-- =====================================================
-- procurement linkage (vendors + purchase orders)
-- =====================================================
create table if not exists inventory.vendors (
  id uuid primary key default gen_random_uuid(),
  vendor_code text not null,
  vendor_name text not null,
  vendor_state text not null default 'ACTIVE'
    check (vendor_state in ('ACTIVE', 'ON_HOLD', 'INACTIVE')),
  email text,
  phone text,
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  payment_terms text,
  notes text,
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
  constraint vendors_delete_reason_ck
    check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists vendors_code_active_uk
  on inventory.vendors (lower(vendor_code))
  where deleted_at is null;

create index if not exists vendors_state_idx
  on inventory.vendors (vendor_state)
  where deleted_at is null;

create table if not exists inventory.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null,
  vendor_id uuid not null references inventory.vendors(id),
  purchase_order_state text not null default 'DRAFT'
    check (purchase_order_state in (
      'DRAFT',
      'APPROVED',
      'SENT',
      'PARTIALLY_RECEIVED',
      'RECEIVED',
      'CANCELLED'
    )),
  ordered_at timestamptz not null default now(),
  expected_at timestamptz,
  sent_at timestamptz,
  closed_at timestamptz,
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
  constraint purchase_orders_closed_window_ck check (
    closed_at is null or closed_at >= ordered_at
  )
);

create unique index if not exists purchase_orders_number_uk
  on inventory.purchase_orders (po_number);

create index if not exists purchase_orders_vendor_state_idx
  on inventory.purchase_orders (vendor_id, purchase_order_state);

create index if not exists purchase_orders_expected_state_idx
  on inventory.purchase_orders (expected_at, purchase_order_state)
  where purchase_order_state in ('APPROVED', 'SENT', 'PARTIALLY_RECEIVED');

create table if not exists inventory.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references inventory.purchase_orders(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  part_id uuid not null references inventory.parts(id),
  ordered_quantity numeric(14,3) not null check (ordered_quantity > 0),
  received_quantity numeric(14,3) not null default 0 check (received_quantity >= 0),
  rejected_quantity numeric(14,3) not null default 0 check (rejected_quantity >= 0),
  unit_of_measure_id uuid not null references inventory.units_of_measure(id),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  promised_at timestamptz,
  line_state text not null default 'OPEN'
    check (line_state in ('OPEN', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  version integer not null default 0 check (version >= 0),
  constraint purchase_order_lines_quantities_ck
    check (received_quantity + rejected_quantity <= ordered_quantity),
  constraint purchase_order_lines_state_qty_ck
    check (
      line_state <> 'RECEIVED'
      or received_quantity + rejected_quantity = ordered_quantity
    )
);

create unique index if not exists purchase_order_lines_order_line_uk
  on inventory.purchase_order_lines (purchase_order_id, line_number);

create index if not exists purchase_order_lines_part_state_idx
  on inventory.purchase_order_lines (part_id, line_state);

create index if not exists purchase_order_lines_order_state_idx
  on inventory.purchase_order_lines (purchase_order_id, line_state);

-- =====================================================
-- receiving transactions
-- =====================================================
create table if not exists inventory.receiving_transactions (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null,
  purchase_order_id uuid references inventory.purchase_orders(id) on delete set null,
  receipt_status text not null default 'DRAFT'
    check (receipt_status in ('DRAFT', 'RECEIVED', 'POSTED', 'CANCELLED')),
  receipt_source text not null default 'PURCHASE_ORDER'
    check (receipt_source in ('PURCHASE_ORDER', 'RETURN', 'MANUAL')),
  stock_location_id uuid not null references inventory.stock_locations(id),
  stock_bin_id uuid references inventory.stock_bins(id),
  received_at timestamptz not null default now(),
  supplier_document_number text,
  notes text,
  actor_user_id uuid references identity.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  version integer not null default 0 check (version >= 0)
);

create unique index if not exists receiving_transactions_number_uk
  on inventory.receiving_transactions (receipt_number);

create index if not exists receiving_transactions_po_status_idx
  on inventory.receiving_transactions (purchase_order_id, receipt_status);

create index if not exists receiving_transactions_location_status_idx
  on inventory.receiving_transactions (stock_location_id, receipt_status, received_at);

create table if not exists inventory.receiving_transaction_lines (
  id uuid primary key default gen_random_uuid(),
  receiving_transaction_id uuid not null
    references inventory.receiving_transactions(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  part_id uuid not null references inventory.parts(id),
  purchase_order_line_id uuid references inventory.purchase_order_lines(id) on delete set null,
  stock_lot_id uuid references inventory.stock_lots(id) on delete set null,
  stock_bin_id uuid references inventory.stock_bins(id) on delete set null,
  received_uom_id uuid not null references inventory.units_of_measure(id),
  quantity_received numeric(14,3) not null check (quantity_received > 0),
  quantity_in_stock_uom numeric(14,3) not null check (quantity_in_stock_uom > 0),
  unit_cost numeric(14,4) check (unit_cost is null or unit_cost >= 0),
  quality_status text not null default 'ACCEPTED'
    check (quality_status in ('ACCEPTED', 'QUARANTINED', 'REJECTED')),
  reason_code text,
  ledger_entry_id uuid unique references inventory.inventory_ledger_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  version integer not null default 0 check (version >= 0),
  constraint receiving_transaction_lines_unique_line_uk
    unique (receiving_transaction_id, line_number)
);

create index if not exists receiving_transaction_lines_part_quality_idx
  on inventory.receiving_transaction_lines (part_id, quality_status);

create index if not exists receiving_transaction_lines_po_line_idx
  on inventory.receiving_transaction_lines (purchase_order_line_id)
  where purchase_order_line_id is not null;

-- =====================================================
-- adjustments
-- =====================================================
create table if not exists inventory.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  adjustment_number text not null,
  adjustment_type text not null
    check (adjustment_type in ('MANUAL', 'CYCLE_COUNT', 'DAMAGE', 'LOSS', 'FOUND', 'CORRECTION')),
  adjustment_status text not null default 'DRAFT'
    check (adjustment_status in ('DRAFT', 'POSTED', 'CANCELLED')),
  stock_location_id uuid not null references inventory.stock_locations(id),
  stock_bin_id uuid references inventory.stock_bins(id),
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

create unique index if not exists inventory_adjustments_number_uk
  on inventory.inventory_adjustments (adjustment_number);

create index if not exists inventory_adjustments_type_status_idx
  on inventory.inventory_adjustments (adjustment_type, adjustment_status);

create index if not exists inventory_adjustments_location_status_idx
  on inventory.inventory_adjustments (stock_location_id, stock_bin_id, adjustment_status);

create table if not exists inventory.inventory_adjustment_lines (
  id uuid primary key default gen_random_uuid(),
  inventory_adjustment_id uuid not null
    references inventory.inventory_adjustments(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  part_id uuid not null references inventory.parts(id),
  stock_lot_id uuid references inventory.stock_lots(id) on delete set null,
  stock_bin_id uuid references inventory.stock_bins(id) on delete set null,
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

create index if not exists inventory_adjustment_lines_part_idx
  on inventory.inventory_adjustment_lines (part_id, stock_lot_id);

-- =====================================================
-- transfers
-- =====================================================
create table if not exists inventory.inventory_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_number text not null,
  transfer_status text not null default 'DRAFT'
    check (transfer_status in ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED')),
  from_stock_location_id uuid not null references inventory.stock_locations(id),
  to_stock_location_id uuid not null references inventory.stock_locations(id),
  from_stock_bin_id uuid references inventory.stock_bins(id),
  to_stock_bin_id uuid references inventory.stock_bins(id),
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

create unique index if not exists inventory_transfers_number_uk
  on inventory.inventory_transfers (transfer_number);

create index if not exists inventory_transfers_route_status_idx
  on inventory.inventory_transfers (from_stock_location_id, to_stock_location_id, transfer_status);

create index if not exists inventory_transfers_status_shipped_idx
  on inventory.inventory_transfers (transfer_status, shipped_at);

create table if not exists inventory.inventory_transfer_lines (
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

create index if not exists inventory_transfer_lines_part_idx
  on inventory.inventory_transfer_lines (part_id);

-- =====================================================
-- cycle counts
-- =====================================================
create table if not exists inventory.cycle_counts (
  id uuid primary key default gen_random_uuid(),
  cycle_count_number text not null,
  stock_location_id uuid not null references inventory.stock_locations(id),
  stock_bin_id uuid references inventory.stock_bins(id),
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

create unique index if not exists cycle_counts_number_uk
  on inventory.cycle_counts (cycle_count_number);

create index if not exists cycle_counts_location_status_idx
  on inventory.cycle_counts (stock_location_id, stock_bin_id, cycle_count_status, scheduled_for);

create table if not exists inventory.cycle_count_lines (
  id uuid primary key default gen_random_uuid(),
  cycle_count_id uuid not null references inventory.cycle_counts(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  part_id uuid not null references inventory.parts(id),
  stock_lot_id uuid references inventory.stock_lots(id) on delete set null,
  stock_bin_id uuid references inventory.stock_bins(id) on delete set null,
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

create index if not exists cycle_count_lines_part_idx
  on inventory.cycle_count_lines (part_id, stock_lot_id);

create index if not exists cycle_count_lines_variance_idx
  on inventory.cycle_count_lines (cycle_count_id, part_id)
  where variance_quantity <> 0;

-- =====================================================
-- work-order consumption linkage
-- =====================================================
create table if not exists inventory.work_order_consumptions (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders.work_orders(id),
  work_order_operation_id uuid references work_orders.work_order_operations(id) on delete set null,
  work_order_part_id uuid references work_orders.work_order_parts(id) on delete set null,
  reservation_id uuid references inventory.inventory_reservations(id) on delete set null,
  inventory_ledger_entry_id uuid not null unique references inventory.inventory_ledger_entries(id),
  part_id uuid not null references inventory.parts(id),
  stock_location_id uuid not null references inventory.stock_locations(id),
  stock_bin_id uuid references inventory.stock_bins(id),
  stock_lot_id uuid references inventory.stock_lots(id),
  consumed_uom_id uuid not null references inventory.units_of_measure(id),
  consumed_quantity numeric(14,3) not null check (consumed_quantity > 0),
  consumed_at timestamptz not null default now(),
  consumed_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  trace_id text,
  span_id text,
  created_at timestamptz not null default now()
);

create index if not exists work_order_consumptions_work_order_idx
  on inventory.work_order_consumptions (work_order_id, consumed_at);

create index if not exists work_order_consumptions_work_order_part_idx
  on inventory.work_order_consumptions (work_order_part_id, consumed_at)
  where work_order_part_id is not null;

create index if not exists work_order_consumptions_part_location_idx
  on inventory.work_order_consumptions (part_id, stock_location_id, consumed_at);

-- =====================================================
-- immutable transaction ledger extensions
-- =====================================================
alter table inventory.inventory_ledger_entries
  add column if not exists stock_bin_id uuid,
  add column if not exists work_order_part_id uuid,
  add column if not exists work_order_operation_id uuid,
  add column if not exists purchase_order_id uuid,
  add column if not exists purchase_order_line_id uuid,
  add column if not exists ledger_metadata jsonb not null default '{}'::jsonb,
  add column if not exists effective_at timestamptz not null default now();

create index if not exists inventory_ledger_work_order_part_created_idx
  on inventory.inventory_ledger_entries (work_order_part_id, created_at)
  where work_order_part_id is not null;

create index if not exists inventory_ledger_work_order_operation_created_idx
  on inventory.inventory_ledger_entries (work_order_operation_id, created_at)
  where work_order_operation_id is not null;

create index if not exists inventory_ledger_purchase_order_created_idx
  on inventory.inventory_ledger_entries (purchase_order_id, created_at)
  where purchase_order_id is not null;

create index if not exists inventory_ledger_stock_bin_created_idx
  on inventory.inventory_ledger_entries (stock_bin_id, created_at)
  where stock_bin_id is not null;

create index if not exists inventory_ledger_source_document_idx
  on inventory.inventory_ledger_entries (source_document_type, source_document_id, created_at)
  where source_document_id is not null;

create index if not exists inventory_ledger_effective_idx
  on inventory.inventory_ledger_entries (effective_at, id);

-- =====================================================
-- additive constraints (idempotent)
-- =====================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'parts_stock_uom_id_fk') then
    alter table inventory.parts
      add constraint parts_stock_uom_id_fk
      foreign key (stock_uom_id) references inventory.units_of_measure(id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'parts_purchase_uom_id_fk') then
    alter table inventory.parts
      add constraint parts_purchase_uom_id_fk
      foreign key (purchase_uom_id) references inventory.units_of_measure(id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'parts_default_vendor_id_fk') then
    alter table inventory.parts
      add constraint parts_default_vendor_id_fk
      foreign key (default_vendor_id) references inventory.vendors(id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'stock_lots_stock_bin_id_fk') then
    alter table inventory.stock_lots
      add constraint stock_lots_stock_bin_id_fk
      foreign key (stock_bin_id) references inventory.stock_bins(id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'stock_lots_origin_purchase_order_line_id_fk') then
    alter table inventory.stock_lots
      add constraint stock_lots_origin_purchase_order_line_id_fk
      foreign key (origin_purchase_order_line_id) references inventory.purchase_order_lines(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'stock_lots_received_uom_id_fk') then
    alter table inventory.stock_lots
      add constraint stock_lots_received_uom_id_fk
      foreign key (received_uom_id) references inventory.units_of_measure(id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'inventory_reservations_stock_bin_id_fk') then
    alter table inventory.inventory_reservations
      add constraint inventory_reservations_stock_bin_id_fk
      foreign key (stock_bin_id) references inventory.stock_bins(id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'inventory_reservations_work_order_operation_id_fk') then
    alter table inventory.inventory_reservations
      add constraint inventory_reservations_work_order_operation_id_fk
      foreign key (work_order_operation_id) references work_orders.work_order_operations(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'inventory_ledger_stock_bin_id_fk') then
    alter table inventory.inventory_ledger_entries
      add constraint inventory_ledger_stock_bin_id_fk
      foreign key (stock_bin_id) references inventory.stock_bins(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'inventory_ledger_work_order_part_id_fk') then
    alter table inventory.inventory_ledger_entries
      add constraint inventory_ledger_work_order_part_id_fk
      foreign key (work_order_part_id) references work_orders.work_order_parts(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'inventory_ledger_work_order_operation_id_fk') then
    alter table inventory.inventory_ledger_entries
      add constraint inventory_ledger_work_order_operation_id_fk
      foreign key (work_order_operation_id) references work_orders.work_order_operations(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'inventory_ledger_purchase_order_id_fk') then
    alter table inventory.inventory_ledger_entries
      add constraint inventory_ledger_purchase_order_id_fk
      foreign key (purchase_order_id) references inventory.purchase_orders(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'inventory_ledger_purchase_order_line_id_fk') then
    alter table inventory.inventory_ledger_entries
      add constraint inventory_ledger_purchase_order_line_id_fk
      foreign key (purchase_order_line_id) references inventory.purchase_order_lines(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'inventory_reservations_allocated_quantity_ck') then
    alter table inventory.inventory_reservations
      add constraint inventory_reservations_allocated_quantity_ck
      check (allocated_quantity <= reserved_quantity);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'inventory_balances_allocated_quantity_ck') then
    alter table inventory.inventory_balances
      add constraint inventory_balances_allocated_quantity_ck
      check (quantity_allocated <= quantity_reserved);
  end if;
end
$$;

-- keep immutable ledgers immutable
drop trigger if exists trg_inventory_ledger_entries_immutable on inventory.inventory_ledger_entries;
create trigger trg_inventory_ledger_entries_immutable
before update or delete on inventory.inventory_ledger_entries
for each row execute function ops.prevent_append_only_mutation();

drop trigger if exists trg_work_order_consumptions_immutable on inventory.work_order_consumptions;
create trigger trg_work_order_consumptions_immutable
before update or delete on inventory.work_order_consumptions
for each row execute function ops.prevent_append_only_mutation();
