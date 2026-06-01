ALTER TABLE planning.routing_template_steps
  ADD COLUMN labor_rate_cents integer,
  ADD CONSTRAINT routing_template_steps_labor_rate_ck
    CHECK (labor_rate_cents IS NULL OR labor_rate_cents >= 0);

ALTER TABLE work_orders.work_order_operations
  ADD COLUMN routing_template_step_id uuid
    REFERENCES planning.routing_template_steps(id) ON DELETE SET NULL,
  ADD COLUMN standard_labor_cost_cents integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT work_order_operations_standard_labor_cost_ck
    CHECK (standard_labor_cost_cents >= 0);

CREATE INDEX IF NOT EXISTS work_order_operations_routing_template_step_idx
  ON work_orders.work_order_operations (routing_template_step_id);
