-- QC gate results table
CREATE TABLE IF NOT EXISTS work_orders.work_order_qc_gates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   UUID NOT NULL,
  task_id         UUID,
  gate_label      TEXT NOT NULL,
  is_critical     BOOLEAN NOT NULL DEFAULT false,
  result          TEXT CHECK (result IN ('PASS','FAIL','NA')),
  failure_note    TEXT,
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qc_gates_work_order_idx
  ON work_orders.work_order_qc_gates (work_order_id);

CREATE INDEX IF NOT EXISTS qc_gates_task_idx
  ON work_orders.work_order_qc_gates (task_id)
  WHERE task_id IS NOT NULL;

-- Extend work_orders with rework loop tracking
ALTER TABLE planning.work_orders
  ADD COLUMN IF NOT EXISTS active_rework_loop_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qc_gate_state TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (qc_gate_state IN ('PENDING','IN_REVIEW','PASSED','FAILED'));
