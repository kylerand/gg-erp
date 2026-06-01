ALTER TABLE accounting.journal_entries
  ADD COLUMN reversal_of_journal_id uuid,
  ADD COLUMN reversed_at timestamptz,
  ADD COLUMN reversed_by text,
  ADD COLUMN reversal_reason text;

ALTER TABLE accounting.journal_entries
  ADD CONSTRAINT journal_entries_reversal_of_fk
  FOREIGN KEY (reversal_of_journal_id)
  REFERENCES accounting.journal_entries(id);

CREATE INDEX journal_entries_reversal_of_idx
  ON accounting.journal_entries(reversal_of_journal_id);

CREATE TABLE accounting.period_locks (
  id uuid primary key default gen_random_uuid(),
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'LOCKED',
  reason text not null,
  locked_at timestamptz not null default now(),
  locked_by text,
  correlation_id text,
  created_at timestamptz not null default now(),
  version integer not null default 0,
  constraint period_locks_range_chk check (period_start <= period_end),
  constraint period_locks_status_chk check (status in ('LOCKED')),
  constraint period_locks_range_uk unique (period_start, period_end)
);

CREATE INDEX period_locks_range_idx
  ON accounting.period_locks(period_start, period_end);

CREATE INDEX period_locks_locked_at_idx
  ON accounting.period_locks(locked_at desc);
