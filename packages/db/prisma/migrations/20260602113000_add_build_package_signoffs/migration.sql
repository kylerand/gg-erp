CREATE TABLE IF NOT EXISTS planning.build_package_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_configuration_id uuid NOT NULL REFERENCES planning.build_configurations(id) ON DELETE RESTRICT,
  bom_id uuid NOT NULL REFERENCES planning.build_boms(id) ON DELETE RESTRICT,
  signoff_note text NOT NULL,
  signed_off_by_user_id uuid,
  signed_off_by_ref text,
  signed_off_at timestamptz NOT NULL DEFAULT now(),
  review_pack_generated_at timestamptz NOT NULL DEFAULT now(),
  approval_count integer NOT NULL DEFAULT 0,
  change_count integer NOT NULL DEFAULT 0,
  route_count integer NOT NULL DEFAULT 0,
  route_step_count integer NOT NULL DEFAULT 0,
  route_template_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_correlation_id text,
  last_request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT build_package_signoffs_note_ck CHECK (length(trim(signoff_note)) > 0),
  CONSTRAINT build_package_signoffs_counts_ck CHECK (
    approval_count >= 0
    AND change_count >= 0
    AND route_count >= 0
    AND route_step_count >= 0
  ),
  CONSTRAINT build_package_signoffs_route_ids_ck CHECK (jsonb_typeof(route_template_ids) = 'array'),
  CONSTRAINT build_package_signoffs_configuration_bom_key UNIQUE (build_configuration_id, bom_id)
);

CREATE INDEX IF NOT EXISTS build_package_signoffs_configuration_idx
  ON planning.build_package_signoffs(build_configuration_id, signed_off_at DESC);

CREATE INDEX IF NOT EXISTS build_package_signoffs_bom_idx
  ON planning.build_package_signoffs(bom_id, signed_off_at DESC);
