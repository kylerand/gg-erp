CREATE TYPE planning."RoutingTemplateStatus" AS ENUM (
  'DRAFT',
  'ACTIVE',
  'RETIRED'
);

CREATE TABLE IF NOT EXISTS planning.routing_templates (
  id uuid primary key default gen_random_uuid(),
  route_code text not null,
  route_name text not null,
  route_version integer not null default 1 check (route_version > 0),
  build_configuration_id uuid references planning.build_configurations(id) on delete set null,
  template_status planning."RoutingTemplateStatus" not null default 'DRAFT',
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  notes text,
  activated_at timestamptz,
  retired_at timestamptz,
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  last_correlation_id text,
  last_request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0),
  constraint routing_templates_code_version_key unique (route_code, route_version),
  constraint routing_templates_effective_window_ck check (
    effective_to is null OR effective_to > effective_from
  ),
  constraint routing_templates_activation_ck check (
    (template_status = 'ACTIVE' AND activated_at IS NOT NULL)
    OR template_status <> 'ACTIVE'
  ),
  constraint routing_templates_retirement_ck check (
    (template_status = 'RETIRED' AND retired_at IS NOT NULL)
    OR template_status <> 'RETIRED'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS routing_templates_one_active_code_uk
  ON planning.routing_templates (route_code)
  WHERE template_status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS routing_templates_status_idx
  ON planning.routing_templates (template_status);

CREATE INDEX IF NOT EXISTS routing_templates_build_configuration_idx
  ON planning.routing_templates (build_configuration_id);

CREATE INDEX IF NOT EXISTS routing_templates_code_status_idx
  ON planning.routing_templates (route_code, template_status);

CREATE TABLE IF NOT EXISTS planning.routing_template_steps (
  id uuid primary key default gen_random_uuid(),
  routing_template_id uuid not null references planning.routing_templates(id) on delete cascade,
  sequence_no integer not null check (sequence_no > 0),
  operation_code text not null,
  operation_name text not null,
  workstation_code text,
  estimated_minutes integer not null check (estimated_minutes > 0),
  required_skill_code text,
  job_card_title text,
  job_card_instructions text,
  qc_required boolean not null default false,
  evidence_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint routing_template_steps_sequence_key unique (routing_template_id, sequence_no),
  constraint routing_template_steps_operation_key unique (routing_template_id, operation_code)
);

CREATE INDEX IF NOT EXISTS routing_template_steps_workstation_idx
  ON planning.routing_template_steps (workstation_code);
