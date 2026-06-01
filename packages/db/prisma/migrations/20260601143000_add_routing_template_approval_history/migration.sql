CREATE TYPE planning."RoutingTemplateChangeKind" AS ENUM (
  'CREATED',
  'ACTIVATED',
  'RETIRED',
  'AUTO_RETIRED'
);

CREATE TABLE IF NOT EXISTS planning.routing_template_change_events (
  id uuid primary key default gen_random_uuid(),
  routing_template_id uuid not null references planning.routing_templates(id) on delete cascade,
  route_code text not null,
  route_version integer not null check (route_version > 0),
  change_kind planning."RoutingTemplateChangeKind" not null,
  previous_status planning."RoutingTemplateStatus",
  new_status planning."RoutingTemplateStatus" not null,
  change_summary text not null,
  approval_note text,
  approved_by_user_id uuid references identity.users(id),
  approved_by_ref text,
  approved_at timestamptz,
  applied_by_user_id uuid references identity.users(id),
  applied_by_ref text,
  last_correlation_id text,
  last_request_id text,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS routing_template_change_events_template_time_idx
  ON planning.routing_template_change_events (routing_template_id, created_at DESC);

CREATE INDEX IF NOT EXISTS routing_template_change_events_kind_idx
  ON planning.routing_template_change_events (change_kind);

INSERT INTO planning.routing_template_change_events (
  routing_template_id,
  route_code,
  route_version,
  change_kind,
  previous_status,
  new_status,
  change_summary,
  approval_note,
  approved_by_user_id,
  approved_by_ref,
  approved_at,
  applied_by_user_id,
  applied_by_ref,
  last_correlation_id,
  last_request_id,
  created_at
)
SELECT
  rt.id,
  rt.route_code,
  rt.route_version,
  CASE
    WHEN rt.template_status = 'ACTIVE' THEN 'ACTIVATED'::planning."RoutingTemplateChangeKind"
    WHEN rt.template_status = 'RETIRED' THEN 'RETIRED'::planning."RoutingTemplateChangeKind"
    ELSE 'CREATED'::planning."RoutingTemplateChangeKind"
  END,
  NULL::planning."RoutingTemplateStatus",
  rt.template_status,
  CASE
    WHEN rt.template_status = 'ACTIVE' THEN 'Backfilled activation history for existing active route version.'
    WHEN rt.template_status = 'RETIRED' THEN 'Backfilled retirement history for existing retired route version.'
    ELSE 'Backfilled creation history for existing route version.'
  END,
  CASE
    WHEN rt.template_status IN ('ACTIVE', 'RETIRED') THEN 'Backfilled during approval-history migration.'
    ELSE NULL
  END,
  rt.updated_by_user_id,
  NULL,
  CASE
    WHEN rt.template_status = 'ACTIVE' THEN rt.activated_at
    WHEN rt.template_status = 'RETIRED' THEN rt.retired_at
    ELSE NULL
  END,
  rt.updated_by_user_id,
  NULL,
  rt.last_correlation_id,
  rt.last_request_id,
  rt.created_at
FROM planning.routing_templates rt
WHERE NOT EXISTS (
  SELECT 1
  FROM planning.routing_template_change_events existing
  WHERE existing.routing_template_id = rt.id
);
