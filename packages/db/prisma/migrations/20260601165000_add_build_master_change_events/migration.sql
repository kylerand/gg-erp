CREATE TYPE planning."BuildConfigurationChangeKind" AS ENUM (
  'CREATED',
  'LOCKED',
  'RELEASED',
  'SUPERSEDED'
);

CREATE TYPE planning."BomChangeKind" AS ENUM (
  'CREATED',
  'APPROVED',
  'OBSOLETED'
);

CREATE TABLE planning.build_configuration_change_events (
  id uuid primary key default gen_random_uuid(),
  build_configuration_id uuid not null references planning.build_configurations(id) on delete cascade,
  configuration_code text not null,
  configuration_version integer not null,
  change_kind planning."BuildConfigurationChangeKind" not null,
  previous_status planning."BuildConfigurationStatus",
  new_status planning."BuildConfigurationStatus" not null,
  change_summary text not null,
  approval_note text,
  approved_by_user_id uuid,
  approved_by_ref text,
  approved_at timestamptz,
  applied_by_user_id uuid,
  applied_by_ref text,
  last_correlation_id text,
  last_request_id text,
  created_at timestamptz not null default now()
);

CREATE INDEX build_config_change_events_config_time_idx
  ON planning.build_configuration_change_events(build_configuration_id, created_at DESC);

CREATE INDEX build_config_change_events_kind_idx
  ON planning.build_configuration_change_events(change_kind);

CREATE TABLE planning.build_bom_change_events (
  id uuid primary key default gen_random_uuid(),
  bom_id uuid not null references planning.build_boms(id) on delete cascade,
  bom_code text not null,
  build_configuration_id uuid not null,
  revision integer not null,
  change_kind planning."BomChangeKind" not null,
  previous_status planning."BomStatus",
  new_status planning."BomStatus" not null,
  change_summary text not null,
  approval_note text,
  approved_by_user_id uuid,
  approved_by_ref text,
  approved_at timestamptz,
  applied_by_user_id uuid,
  applied_by_ref text,
  last_correlation_id text,
  last_request_id text,
  created_at timestamptz not null default now()
);

CREATE INDEX build_bom_change_events_bom_time_idx
  ON planning.build_bom_change_events(bom_id, created_at DESC);

CREATE INDEX build_bom_change_events_configuration_idx
  ON planning.build_bom_change_events(build_configuration_id);

CREATE INDEX build_bom_change_events_kind_idx
  ON planning.build_bom_change_events(change_kind);

INSERT INTO planning.build_configuration_change_events (
  build_configuration_id,
  configuration_code,
  configuration_version,
  change_kind,
  new_status,
  change_summary,
  applied_by_user_id,
  last_correlation_id,
  last_request_id,
  created_at
)
SELECT
  bc.id,
  bc.configuration_code,
  bc.configuration_version,
  'CREATED'::planning."BuildConfigurationChangeKind",
  'DRAFT'::planning."BuildConfigurationStatus",
  'Build configuration draft created for engineering review.',
  bc.created_by_user_id,
  bc.last_correlation_id,
  bc.last_request_id,
  bc.created_at
FROM planning.build_configurations bc;

INSERT INTO planning.build_configuration_change_events (
  build_configuration_id,
  configuration_code,
  configuration_version,
  change_kind,
  previous_status,
  new_status,
  change_summary,
  approved_by_user_id,
  approved_at,
  applied_by_user_id,
  last_correlation_id,
  last_request_id,
  created_at
)
SELECT
  bc.id,
  bc.configuration_code,
  bc.configuration_version,
  CASE
    WHEN bc.configuration_status = 'LOCKED' THEN 'LOCKED'::planning."BuildConfigurationChangeKind"
    WHEN bc.configuration_status = 'RELEASED' THEN 'RELEASED'::planning."BuildConfigurationChangeKind"
    ELSE 'SUPERSEDED'::planning."BuildConfigurationChangeKind"
  END,
  'DRAFT'::planning."BuildConfigurationStatus",
  bc.configuration_status,
  CASE
    WHEN bc.configuration_status = 'LOCKED' THEN 'Build configuration locked before production release.'
    WHEN bc.configuration_status = 'RELEASED' THEN 'Build configuration released to production.'
    ELSE 'Build configuration was already superseded before change history was enabled.'
  END,
  bc.updated_by_user_id,
  coalesce(bc.released_at, bc.updated_at),
  bc.updated_by_user_id,
  bc.last_correlation_id,
  bc.last_request_id,
  coalesce(bc.released_at, bc.updated_at)
FROM planning.build_configurations bc
WHERE bc.configuration_status <> 'DRAFT';

INSERT INTO planning.build_bom_change_events (
  bom_id,
  bom_code,
  build_configuration_id,
  revision,
  change_kind,
  new_status,
  change_summary,
  applied_by_user_id,
  last_correlation_id,
  last_request_id,
  created_at
)
SELECT
  b.id,
  b.bom_code,
  b.build_configuration_id,
  b.revision,
  'CREATED'::planning."BomChangeKind",
  'DRAFT'::planning."BomStatus",
  'BOM revision created for engineering review.',
  b.created_by_user_id,
  b.last_correlation_id,
  b.last_request_id,
  b.created_at
FROM planning.build_boms b;

INSERT INTO planning.build_bom_change_events (
  bom_id,
  bom_code,
  build_configuration_id,
  revision,
  change_kind,
  previous_status,
  new_status,
  change_summary,
  approved_by_user_id,
  approved_at,
  applied_by_user_id,
  last_correlation_id,
  last_request_id,
  created_at
)
SELECT
  b.id,
  b.bom_code,
  b.build_configuration_id,
  b.revision,
  CASE
    WHEN b.bom_status = 'APPROVED' THEN 'APPROVED'::planning."BomChangeKind"
    ELSE 'OBSOLETED'::planning."BomChangeKind"
  END,
  'DRAFT'::planning."BomStatus",
  b.bom_status,
  CASE
    WHEN b.bom_status = 'APPROVED' THEN 'BOM revision approved for production.'
    ELSE 'BOM revision was already obsolete before change history was enabled.'
  END,
  b.approved_by_user_id,
  coalesce(b.approved_at, b.updated_at),
  b.updated_by_user_id,
  b.last_correlation_id,
  b.last_request_id,
  coalesce(b.approved_at, b.updated_at)
FROM planning.build_boms b
WHERE b.bom_status <> 'DRAFT';
