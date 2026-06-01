create schema if not exists reporting;

create table if not exists reporting.report_subscriptions (
  id uuid primary key default gen_random_uuid(),
  view_key text not null,
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),
  timezone text not null default 'America/New_York',
  format text not null default 'CSV' check (format in ('CSV')),
  enabled boolean not null default true,
  created_by_user_id uuid,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_run_status text check (last_run_status in ('RUNNING', 'SUCCEEDED', 'FAILED')),
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (view_key, cadence, created_by_user_id)
);

create index if not exists report_subscriptions_enabled_next_run_idx
  on reporting.report_subscriptions (enabled, next_run_at);

create index if not exists report_subscriptions_view_enabled_idx
  on reporting.report_subscriptions (view_key, enabled);

create table if not exists reporting.report_export_runs (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references reporting.report_subscriptions(id) on delete set null,
  view_key text not null,
  status text not null check (status in ('RUNNING', 'SUCCEEDED', 'FAILED')),
  format text not null default 'CSV' check (format in ('CSV')),
  requested_by_user_id uuid,
  scheduled_for timestamptz not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  row_count integer not null default 0,
  filename text not null,
  csv_text text,
  failure_message text,
  correlation_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists report_export_runs_view_created_idx
  on reporting.report_export_runs (view_key, created_at desc);

create index if not exists report_export_runs_subscription_created_idx
  on reporting.report_export_runs (subscription_id, created_at desc);

create index if not exists report_export_runs_status_scheduled_idx
  on reporting.report_export_runs (status, scheduled_for);
