CREATE TYPE accounting."AccountingJournalSourceType" AS ENUM (
  'PAYABLE_RECEIPT',
  'CUSTOMER_PAYMENT',
  'RECONCILIATION_VARIANCE'
);

CREATE TYPE accounting."AccountingJournalStatus" AS ENUM (
  'POSTED',
  'REVERSED'
);

CREATE TABLE accounting.journal_entries (
  id uuid primary key default gen_random_uuid(),
  journal_number text not null unique,
  source_type accounting."AccountingJournalSourceType" not null,
  source_id text not null,
  source_ledger_entry_id text not null unique,
  source_document_number text not null,
  counterparty text,
  ledger_date timestamptz not null,
  currency_code text not null default 'USD',
  status accounting."AccountingJournalStatus" not null default 'POSTED',
  total_debit_cents integer not null,
  total_credit_cents integer not null,
  memo text,
  posted_at timestamptz not null default now(),
  posted_by text,
  correlation_id text,
  created_at timestamptz not null default now(),
  version integer not null default 0,
  constraint journal_entries_balanced_chk check (total_debit_cents = total_credit_cents),
  constraint journal_entries_positive_chk check (total_debit_cents > 0 and total_credit_cents > 0),
  constraint journal_entries_source_uk unique (source_type, source_id)
);

CREATE INDEX journal_entries_ledger_date_idx
  ON accounting.journal_entries(ledger_date desc);

CREATE INDEX journal_entries_status_idx
  ON accounting.journal_entries(status);

CREATE INDEX journal_entries_source_date_idx
  ON accounting.journal_entries(source_type, ledger_date desc);

CREATE TABLE accounting.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references accounting.journal_entries(id) on delete cascade,
  line_number integer not null,
  account_name text not null,
  account_code text,
  debit_cents integer not null default 0,
  credit_cents integer not null default 0,
  memo text,
  dimension_type text,
  dimension_id text,
  created_at timestamptz not null default now(),
  constraint journal_lines_one_sided_chk check (
    (debit_cents > 0 and credit_cents = 0)
    or (credit_cents > 0 and debit_cents = 0)
  ),
  constraint journal_lines_line_uk unique (journal_entry_id, line_number)
);

CREATE INDEX journal_lines_account_name_idx
  ON accounting.journal_lines(account_name);
