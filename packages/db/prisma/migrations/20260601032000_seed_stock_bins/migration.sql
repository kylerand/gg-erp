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
  last_correlation_id,
  last_request_id
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
  'seed-stock-bins',
  '20260601032000_seed_stock_bins'
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
