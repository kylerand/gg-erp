-- Create routing_sop_steps table (with execution tracking columns included)
CREATE TABLE IF NOT EXISTS planning.routing_sop_steps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id     UUID NOT NULL,
  step_code         TEXT NOT NULL,
  step_name         TEXT NOT NULL,
  sequence_no       INT NOT NULL,
  description       TEXT,
  estimated_minutes INT,
  execution_state   TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (execution_state IN ('PENDING','IN_PROGRESS','COMPLETE','FAILED')),
  completed_by      TEXT,
  completed_at      TIMESTAMPTZ,
  failed_reason     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS routing_sop_steps_work_order_id_idx
  ON planning.routing_sop_steps (work_order_id);

-- Evidence attachments for SOP steps
CREATE TABLE IF NOT EXISTS tickets.step_evidence_attachments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routing_step_id     UUID NOT NULL REFERENCES planning.routing_sop_steps(id) ON DELETE CASCADE,
  file_attachment_id  UUID NOT NULL REFERENCES tickets.file_attachments(id) ON DELETE CASCADE,
  uploaded_by         TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS step_evidence_routing_step_idx
  ON tickets.step_evidence_attachments (routing_step_id);
