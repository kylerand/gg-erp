ALTER TABLE sop_ojt.inspection_templates ALTER COLUMN name DROP NOT NULL;
ALTER TABLE sop_ojt.inspection_template_items ALTER COLUMN name DROP NOT NULL;
ALTER TABLE sop_ojt.inspection_template_items ALTER COLUMN ordinal TYPE BIGINT USING ordinal::BIGINT;
