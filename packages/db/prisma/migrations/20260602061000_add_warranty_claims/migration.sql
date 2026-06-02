-- CreateEnum
CREATE TYPE "customers"."WarrantyClaimStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REIMBURSEMENT_PENDING',
  'REIMBURSED',
  'DENIED',
  'CLOSED'
);

-- CreateTable
CREATE TABLE IF NOT EXISTS customers.warranty_claims (
  id uuid primary key default gen_random_uuid(),
  claim_number text not null,
  customer_id uuid not null references customers.customers(id) on delete restrict,
  dealer_account_id uuid references customers.dealer_accounts(id) on delete set null,
  dealer_relationship_id uuid references customers.customer_dealer_relationships(id) on delete set null,
  cart_vehicle_id uuid references planning.cart_vehicles(id) on delete set null,
  work_order_id uuid references work_orders.work_orders(id) on delete set null,
  claim_status customers."WarrantyClaimStatus" not null default 'DRAFT',
  requested_amount_cents integer not null default 0 check (requested_amount_cents >= 0),
  approved_amount_cents integer check (approved_amount_cents is null or approved_amount_cents >= 0),
  reimbursed_amount_cents integer check (reimbursed_amount_cents is null or reimbursed_amount_cents >= 0),
  external_reference text,
  claim_reason text not null default 'Warranty service',
  owner_user_id uuid,
  notes text,
  submitted_at timestamptz,
  approved_at timestamptz,
  reimbursed_at timestamptz,
  closed_at timestamptz,
  correlation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0),
  constraint warranty_claims_amount_order_ck
    check (
      approved_amount_cents is null
      or approved_amount_cents <= requested_amount_cents
    ),
  constraint warranty_claims_reimbursement_order_ck
    check (
      reimbursed_amount_cents is null
      or approved_amount_cents is null
      or reimbursed_amount_cents <= approved_amount_cents
    )
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS warranty_claims_claim_number_uk
  ON customers.warranty_claims(claim_number);

-- CreateIndex
CREATE INDEX IF NOT EXISTS warranty_claims_customer_status_idx
  ON customers.warranty_claims(customer_id, claim_status);

-- CreateIndex
CREATE INDEX IF NOT EXISTS warranty_claims_dealer_status_idx
  ON customers.warranty_claims(dealer_account_id, claim_status)
  WHERE dealer_account_id IS NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS warranty_claims_relationship_idx
  ON customers.warranty_claims(dealer_relationship_id)
  WHERE dealer_relationship_id IS NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS warranty_claims_cart_vehicle_idx
  ON customers.warranty_claims(cart_vehicle_id)
  WHERE cart_vehicle_id IS NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS warranty_claims_work_order_idx
  ON customers.warranty_claims(work_order_id)
  WHERE work_order_id IS NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS warranty_claims_status_updated_idx
  ON customers.warranty_claims(claim_status, updated_at DESC);
