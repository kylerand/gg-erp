CREATE TABLE IF NOT EXISTS tickets.labor_time_entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_task_id    UUID,
  work_order_id         UUID NOT NULL,
  technician_id         TEXT NOT NULL,
  started_at            TIMESTAMPTZ NOT NULL,
  ended_at              TIMESTAMPTZ,
  manual_hours          NUMERIC(6,2),
  description           TEXT,
  source                TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (source IN ('AUTO','MANUAL','ADJUSTED')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT labor_hours_positive
    CHECK (manual_hours IS NULL OR manual_hours > 0),
  CONSTRAINT labor_time_range_valid
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS labor_entries_wo_tech_idx
  ON tickets.labor_time_entries (work_order_id, technician_id);

CREATE INDEX IF NOT EXISTS labor_entries_task_idx
  ON tickets.labor_time_entries (technician_task_id);
