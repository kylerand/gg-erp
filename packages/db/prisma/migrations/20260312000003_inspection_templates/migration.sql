-- Migration: 20260312000003_inspection_templates
-- Adds InspectionTemplate and InspectionTemplateItem tables for ShopMonkey SOP import

CREATE TABLE sop_ojt.inspection_templates (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sm_id            TEXT        NOT NULL UNIQUE,
  name             TEXT        NOT NULL,
  category         TEXT,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  sm_created_date  TIMESTAMPTZ,
  sm_updated_date  TIMESTAMPTZ,
  imported_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sop_ojt.inspection_template_items (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sm_id                    TEXT        NOT NULL UNIQUE,
  inspection_template_id   UUID        NOT NULL REFERENCES sop_ojt.inspection_templates(id) ON DELETE CASCADE,
  name                     TEXT        NOT NULL,
  message                  TEXT,
  ordinal                  INT         NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX inspection_template_items_template_idx
  ON sop_ojt.inspection_template_items(inspection_template_id);
