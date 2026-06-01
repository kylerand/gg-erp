create schema if not exists reporting;

create table if not exists reporting.blocked_alert_triage_events (
  id uuid primary key default gen_random_uuid(),
  alert_id text not null,
  source_type text not null,
  source_id text not null,
  action text not null check (action in ('ACKNOWLEDGE', 'ESCALATE')),
  actor_id uuid,
  owner_role text,
  note text,
  correlation_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists blocked_alert_triage_alert_created_idx
  on reporting.blocked_alert_triage_events (alert_id, created_at desc);

create index if not exists blocked_alert_triage_action_created_idx
  on reporting.blocked_alert_triage_events (action, created_at desc);
