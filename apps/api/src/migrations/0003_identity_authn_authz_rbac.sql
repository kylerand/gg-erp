-- Identity authn/authz additive extension:
-- org/shop/team scoping with explicit role grants and user assignments.

create schema if not exists identity;

create table if not exists identity.organizations (
  id uuid primary key default gen_random_uuid(),
  org_code text not null,
  org_name text not null,
  org_status text not null default 'ACTIVE'
    check (org_status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  deleted_at timestamptz,
  deleted_by_user_id uuid references identity.users(id),
  delete_reason text,
  version integer not null default 0 check (version >= 0),
  constraint organizations_delete_reason_ck
    check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists organizations_code_active_uk
  on identity.organizations (org_code)
  where deleted_at is null;

create table if not exists identity.shops (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references identity.organizations(id),
  shop_code text not null,
  shop_name text not null,
  shop_status text not null default 'ACTIVE'
    check (shop_status in ('ACTIVE', 'INACTIVE')),
  timezone_name text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  deleted_at timestamptz,
  deleted_by_user_id uuid references identity.users(id),
  delete_reason text,
  version integer not null default 0 check (version >= 0),
  constraint shops_delete_reason_ck check (deleted_at is null or delete_reason is not null)
);

create unique index if not exists shops_org_code_active_uk
  on identity.shops (organization_id, shop_code)
  where deleted_at is null;

create unique index if not exists shops_id_org_uk
  on identity.shops (id, organization_id);

create index if not exists shops_org_status_idx
  on identity.shops (organization_id, shop_status)
  where deleted_at is null;

create table if not exists identity.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references identity.organizations(id),
  shop_id uuid not null,
  team_code text not null,
  team_name text not null,
  team_status text not null default 'ACTIVE'
    check (team_status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references identity.users(id),
  updated_by_user_id uuid references identity.users(id),
  deleted_at timestamptz,
  deleted_by_user_id uuid references identity.users(id),
  delete_reason text,
  version integer not null default 0 check (version >= 0),
  constraint teams_delete_reason_ck check (deleted_at is null or delete_reason is not null),
  foreign key (shop_id, organization_id)
    references identity.shops(id, organization_id)
);

create unique index if not exists teams_shop_code_active_uk
  on identity.teams (shop_id, team_code)
  where deleted_at is null;

create unique index if not exists teams_id_shop_org_uk
  on identity.teams (id, shop_id, organization_id);

create index if not exists teams_org_shop_status_idx
  on identity.teams (organization_id, shop_id, team_status)
  where deleted_at is null;

create table if not exists identity.role_scope_grants (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references identity.roles(id) on delete cascade,
  scope_level text not null check (scope_level in ('ORG', 'SHOP', 'TEAM')),
  organization_id uuid not null references identity.organizations(id),
  shop_id uuid,
  team_id uuid,
  grant_status text not null default 'ACTIVE'
    check (grant_status in ('ACTIVE', 'REVOKED')),
  grant_reason text,
  granted_by_user_id uuid references identity.users(id),
  revoked_by_user_id uuid references identity.users(id),
  correlation_id text not null,
  request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0),
  constraint role_scope_grants_dimension_ck check (
    (scope_level = 'ORG' and shop_id is null and team_id is null)
    or (scope_level = 'SHOP' and shop_id is not null and team_id is null)
    or (scope_level = 'TEAM' and shop_id is not null and team_id is not null)
  ),
  foreign key (shop_id, organization_id)
    references identity.shops(id, organization_id),
  foreign key (team_id, shop_id, organization_id)
    references identity.teams(id, shop_id, organization_id)
);

create unique index if not exists role_scope_grants_active_uk
  on identity.role_scope_grants (
    role_id,
    scope_level,
    organization_id,
    coalesce(shop_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where grant_status = 'ACTIVE';

create index if not exists role_scope_grants_scope_status_idx
  on identity.role_scope_grants (organization_id, shop_id, team_id, grant_status);

create table if not exists identity.user_scope_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  role_scope_grant_id uuid not null references identity.role_scope_grants(id) on delete cascade,
  assignment_status text not null default 'ACTIVE'
    check (assignment_status in ('ACTIVE', 'REVOKED', 'EXPIRED')),
  assignment_reason text,
  assigned_by_user_id uuid references identity.users(id),
  revoked_by_user_id uuid references identity.users(id),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  correlation_id text not null,
  request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0),
  constraint user_scope_assignments_effective_window_ck
    check (effective_to is null or effective_to > effective_from)
);

create unique index if not exists user_scope_assignments_active_uk
  on identity.user_scope_assignments (user_id, role_scope_grant_id)
  where assignment_status = 'ACTIVE';

create index if not exists user_scope_assignments_user_status_idx
  on identity.user_scope_assignments (user_id, assignment_status, effective_from);

create index if not exists user_scope_assignments_grant_status_idx
  on identity.user_scope_assignments (role_scope_grant_id, assignment_status);
