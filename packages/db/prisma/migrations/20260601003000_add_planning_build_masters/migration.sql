DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'planning'
      AND t.typname = 'BuildConfigurationStatus'
  ) THEN
    CREATE TYPE planning."BuildConfigurationStatus" AS ENUM (
      'DRAFT',
      'LOCKED',
      'RELEASED',
      'SUPERSEDED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'planning'
      AND t.typname = 'BomStatus'
  ) THEN
    CREATE TYPE planning."BomStatus" AS ENUM (
      'DRAFT',
      'APPROVED',
      'OBSOLETE'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS planning.build_configurations (
  id uuid primary key default gen_random_uuid(),
  configuration_code text not null unique,
  vehicle_id uuid not null references planning.cart_vehicles(id),
  configuration_version integer not null default 1 check (configuration_version > 0),
  configuration_status planning."BuildConfigurationStatus" not null default 'DRAFT',
  selected_options jsonb not null default '[]'::jsonb,
  notes text,
  released_at timestamptz,
  superseded_by_id uuid references planning.build_configurations(id),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  last_correlation_id text,
  last_request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0),
  constraint build_configurations_vehicle_version_key unique (vehicle_id, configuration_version),
  constraint build_configurations_release_ck check (
    (configuration_status = 'RELEASED' AND released_at IS NOT NULL)
    OR configuration_status <> 'RELEASED'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS build_configurations_one_released_vehicle_uk
  ON planning.build_configurations (vehicle_id)
  WHERE configuration_status = 'RELEASED';

CREATE INDEX IF NOT EXISTS build_configurations_status_idx
  ON planning.build_configurations (configuration_status);

CREATE INDEX IF NOT EXISTS build_configurations_vehicle_idx
  ON planning.build_configurations (vehicle_id);

CREATE TABLE IF NOT EXISTS planning.build_boms (
  id uuid primary key default gen_random_uuid(),
  bom_code text not null unique,
  build_configuration_id uuid not null references planning.build_configurations(id),
  revision integer not null default 1 check (revision > 0),
  bom_status planning."BomStatus" not null default 'DRAFT',
  notes text,
  approved_at timestamptz,
  approved_by_user_id uuid references identity.users(id),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  last_correlation_id text,
  last_request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0),
  constraint build_boms_configuration_revision_key unique (build_configuration_id, revision),
  constraint build_boms_approval_ck check (
    (bom_status = 'APPROVED' AND approved_at IS NOT NULL)
    OR bom_status <> 'APPROVED'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS build_boms_one_approved_configuration_uk
  ON planning.build_boms (build_configuration_id)
  WHERE bom_status = 'APPROVED';

CREATE INDEX IF NOT EXISTS build_boms_status_idx
  ON planning.build_boms (bom_status);

CREATE INDEX IF NOT EXISTS build_boms_configuration_idx
  ON planning.build_boms (build_configuration_id);

CREATE TABLE IF NOT EXISTS planning.build_bom_lines (
  id uuid primary key default gen_random_uuid(),
  bom_id uuid not null references planning.build_boms(id) on delete cascade,
  part_id uuid not null references inventory.parts(id),
  quantity_per_unit numeric(14, 4) not null check (quantity_per_unit > 0),
  scrap_factor numeric(8, 4) not null default 0 check (scrap_factor >= 0),
  line_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint build_bom_lines_bom_part_key unique (bom_id, part_id)
);

CREATE INDEX IF NOT EXISTS build_bom_lines_part_idx
  ON planning.build_bom_lines (part_id);
