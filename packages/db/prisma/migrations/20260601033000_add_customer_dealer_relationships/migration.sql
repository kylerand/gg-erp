-- CreateEnum
CREATE TYPE "customers"."DealerAccountState" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "customers"."DealerRelationshipType" AS ENUM ('ACCOUNT_OWNER', 'SERVICING_DEALER', 'BILLING_ACCOUNT', 'WARRANTY_PROVIDER');

-- CreateEnum
CREATE TYPE "customers"."DealerRelationshipState" AS ENUM ('ACTIVE', 'INACTIVE', 'ENDED');

-- CreateTable
CREATE TABLE IF NOT EXISTS customers.dealer_accounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers.customers(id) on delete restrict,
  dealer_code text,
  territory text,
  service_relationship customers."DealerAccountState" not null default 'ACTIVE',
  account_owner text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  version integer not null default 0 check (version >= 0)
);

-- CreateTable
CREATE TABLE IF NOT EXISTS customers.customer_dealer_relationships (
  id uuid primary key default gen_random_uuid(),
  dealer_account_id uuid not null references customers.dealer_accounts(id) on delete restrict,
  customer_id uuid not null references customers.customers(id) on delete restrict,
  cart_vehicle_id uuid references planning.cart_vehicles(id) on delete set null,
  relationship_type customers."DealerRelationshipType" not null default 'SERVICING_DEALER',
  relationship_state customers."DealerRelationshipState" not null default 'ACTIVE',
  escalation_owner text,
  notes text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 0 check (version >= 0),
  constraint customer_dealer_relationships_effective_window_ck
    check (ended_at is null or ended_at >= started_at)
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS dealer_accounts_customer_active_uk
  ON customers.dealer_accounts(customer_id);

-- CreateIndex
CREATE INDEX IF NOT EXISTS dealer_accounts_relationship_idx
  ON customers.dealer_accounts(service_relationship, updated_at DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS dealer_accounts_territory_idx
  ON customers.dealer_accounts(territory)
  WHERE archived_at IS NULL AND territory IS NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS customer_dealer_relationships_dealer_state_idx
  ON customers.customer_dealer_relationships(dealer_account_id, relationship_state);

-- CreateIndex
CREATE INDEX IF NOT EXISTS customer_dealer_relationships_customer_state_idx
  ON customers.customer_dealer_relationships(customer_id, relationship_state);

-- CreateIndex
CREATE INDEX IF NOT EXISTS customer_dealer_relationships_vehicle_idx
  ON customers.customer_dealer_relationships(cart_vehicle_id)
  WHERE cart_vehicle_id IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS customer_dealer_relationships_active_vehicle_uk
  ON customers.customer_dealer_relationships(dealer_account_id, customer_id, cart_vehicle_id, relationship_type)
  WHERE relationship_state = 'ACTIVE' AND cart_vehicle_id IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS customer_dealer_relationships_active_customer_uk
  ON customers.customer_dealer_relationships(dealer_account_id, customer_id, relationship_type)
  WHERE relationship_state = 'ACTIVE' AND cart_vehicle_id IS NULL;
