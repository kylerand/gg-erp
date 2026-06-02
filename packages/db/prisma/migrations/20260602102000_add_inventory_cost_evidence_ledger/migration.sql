ALTER TABLE inventory.inventory_ledger_entries
  DROP CONSTRAINT IF EXISTS inventory_ledger_movement_type_ck;

ALTER TABLE inventory.inventory_ledger_entries
  ADD CONSTRAINT inventory_ledger_movement_type_ck
  CHECK (
    movement_type in (
      'RECEIPT',
      'RESERVATION',
      'ALLOCATION',
      'RELEASE',
      'ISSUE',
      'RETURN',
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'ADJUSTMENT',
      'CYCLE_COUNT',
      'COST_EVIDENCE',
      'REVERSAL'
    )
  );

ALTER TABLE inventory.inventory_ledger_entries
  DROP CONSTRAINT IF EXISTS inventory_ledger_quantity_delta_ck;

ALTER TABLE inventory.inventory_ledger_entries
  ADD CONSTRAINT inventory_ledger_quantity_delta_ck
  CHECK (
    quantity_delta <> 0
    OR (
      movement_type = 'COST_EVIDENCE'
      AND unit_cost IS NOT NULL
      AND value_delta IS NOT NULL
    )
  );
