CREATE TABLE IF NOT EXISTS "accounting"."invoice_document_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_sync_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "customer_id" UUID,
    "provider" TEXT NOT NULL DEFAULT 'QUICKBOOKS',
    "document_number" TEXT NOT NULL,
    "external_reference" TEXT,
    "document_status" TEXT NOT NULL,
    "document_date" TIMESTAMPTZ(6) NOT NULL,
    "currency_code" TEXT NOT NULL DEFAULT 'USD',
    "amount_cents" INTEGER,
    "work_order_number" TEXT,
    "customer_name" TEXT,
    "sync_state" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "document_summary" JSONB NOT NULL DEFAULT '{}',
    "document_payload" JSONB NOT NULL DEFAULT '{}',
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlation_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoice_document_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "accounting"."payment_document_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_sync_id" UUID NOT NULL,
    "invoice_sync_id" UUID,
    "work_order_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'QUICKBOOKS',
    "document_number" TEXT NOT NULL,
    "external_reference" TEXT,
    "qb_invoice_id" TEXT,
    "document_status" TEXT NOT NULL,
    "document_date" TIMESTAMPTZ(6) NOT NULL,
    "currency_code" TEXT NOT NULL DEFAULT 'USD',
    "amount_cents" INTEGER NOT NULL,
    "payment_method" TEXT,
    "work_order_number" TEXT,
    "customer_name" TEXT,
    "sync_state" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "document_summary" JSONB NOT NULL DEFAULT '{}',
    "document_payload" JSONB NOT NULL DEFAULT '{}',
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlation_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_document_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "invoice_document_snapshots_sync_captured_idx"
  ON "accounting"."invoice_document_snapshots"("invoice_sync_id", "captured_at");
CREATE INDEX IF NOT EXISTS "invoice_document_snapshots_work_order_idx"
  ON "accounting"."invoice_document_snapshots"("work_order_id");
CREATE INDEX IF NOT EXISTS "invoice_document_snapshots_customer_idx"
  ON "accounting"."invoice_document_snapshots"("customer_id");
CREATE INDEX IF NOT EXISTS "invoice_document_snapshots_document_date_idx"
  ON "accounting"."invoice_document_snapshots"("document_date");
CREATE INDEX IF NOT EXISTS "invoice_document_snapshots_status_idx"
  ON "accounting"."invoice_document_snapshots"("document_status");

CREATE INDEX IF NOT EXISTS "payment_document_snapshots_sync_captured_idx"
  ON "accounting"."payment_document_snapshots"("payment_sync_id", "captured_at");
CREATE INDEX IF NOT EXISTS "payment_document_snapshots_invoice_sync_idx"
  ON "accounting"."payment_document_snapshots"("invoice_sync_id");
CREATE INDEX IF NOT EXISTS "payment_document_snapshots_work_order_idx"
  ON "accounting"."payment_document_snapshots"("work_order_id");
CREATE INDEX IF NOT EXISTS "payment_document_snapshots_customer_idx"
  ON "accounting"."payment_document_snapshots"("customer_id");
CREATE INDEX IF NOT EXISTS "payment_document_snapshots_document_date_idx"
  ON "accounting"."payment_document_snapshots"("document_date");
CREATE INDEX IF NOT EXISTS "payment_document_snapshots_status_idx"
  ON "accounting"."payment_document_snapshots"("document_status");

INSERT INTO "accounting"."invoice_document_snapshots" (
    "invoice_sync_id",
    "work_order_id",
    "customer_id",
    "provider",
    "document_number",
    "external_reference",
    "document_status",
    "document_date",
    "work_order_number",
    "customer_name",
    "sync_state",
    "attempt_count",
    "error_code",
    "error_message",
    "document_summary",
    "document_payload",
    "captured_at",
    "correlation_id",
    "created_at"
)
SELECT
    s."id",
    s."work_order_id",
    NULL,
    s."provider",
    s."invoice_number",
    s."external_reference",
    CASE
      WHEN s."state"::text = 'SYNCED' THEN 'EXPORTED'
      WHEN s."state"::text IN ('FAILED', 'CANCELLED') THEN 'NEEDS_REVIEW'
      ELSE 'QUEUED'
    END,
    COALESCE(s."synced_at", s."created_at"),
    wo."work_order_number",
    NULL,
    s."state"::text,
    s."attempt_count",
    s."last_error_code",
    s."last_error_message",
    jsonb_build_object(
      'source', 'backfill',
      'invoiceNumber', s."invoice_number",
      'workOrderNumber', wo."work_order_number",
      'customerName', NULL
    ),
    jsonb_build_object(
      'syncRecordId', s."id",
      'state', s."state"::text,
      'externalReference', s."external_reference"
    ),
    COALESCE(s."updated_at", s."created_at"),
    s."correlation_id",
    CURRENT_TIMESTAMP
FROM "accounting"."invoice_sync_records" s
LEFT JOIN "planning"."work_orders" wo
  ON wo."id" = s."work_order_id"
WHERE NOT EXISTS (
    SELECT 1
    FROM "accounting"."invoice_document_snapshots" existing
    WHERE existing."invoice_sync_id" = s."id"
      AND existing."sync_state" = s."state"::text
      AND existing."captured_at" = COALESCE(s."updated_at", s."created_at")
);

INSERT INTO "accounting"."payment_document_snapshots" (
    "payment_sync_id",
    "invoice_sync_id",
    "work_order_id",
    "customer_id",
    "document_number",
    "external_reference",
    "qb_invoice_id",
    "document_status",
    "document_date",
    "amount_cents",
    "payment_method",
    "work_order_number",
    "customer_name",
    "sync_state",
    "attempt_count",
    "error_message",
    "document_summary",
    "document_payload",
    "captured_at",
    "created_at"
)
SELECT
    p."id",
    p."invoice_sync_id",
    p."work_order_id",
    p."customer_id",
    COALESCE(p."qb_payment_id", p."qb_invoice_id", p."id"::text),
    p."qb_payment_id",
    p."qb_invoice_id",
    CASE
      WHEN p."state"::text = 'RECONCILED' THEN 'RECONCILED'
      WHEN p."state"::text = 'SYNCED' THEN 'MATCHED'
      WHEN p."state"::text IN ('FAILED', 'MISMATCH') THEN 'NEEDS_REVIEW'
      ELSE 'QUEUED'
    END,
    COALESCE((p."payment_date"::timestamp AT TIME ZONE 'UTC'), p."updated_at", p."created_at"),
    p."amount_cents",
    p."payment_method",
    wo."work_order_number",
    COALESCE(NULLIF(c."company_name", ''), c."full_name"),
    p."state"::text,
    p."attempt_count",
    p."error_message",
    jsonb_build_object(
      'source', 'backfill',
      'qbPaymentId', p."qb_payment_id",
      'qbInvoiceId', p."qb_invoice_id",
      'workOrderNumber', wo."work_order_number",
      'customerName', COALESCE(NULLIF(c."company_name", ''), c."full_name")
    ),
    jsonb_build_object(
      'syncRecordId', p."id",
      'state', p."state"::text,
      'qbPaymentId', p."qb_payment_id",
      'qbInvoiceId', p."qb_invoice_id"
    ),
    COALESCE(p."updated_at", p."created_at"),
    CURRENT_TIMESTAMP
FROM "integrations"."payment_sync_records" p
LEFT JOIN "planning"."work_orders" wo
  ON wo."id" = p."work_order_id"
LEFT JOIN "customers"."customers" c
  ON c."id" = p."customer_id"
WHERE NOT EXISTS (
    SELECT 1
    FROM "accounting"."payment_document_snapshots" existing
    WHERE existing."payment_sync_id" = p."id"
      AND existing."sync_state" = p."state"::text
      AND existing."captured_at" = COALESCE(p."updated_at", p."created_at")
);
