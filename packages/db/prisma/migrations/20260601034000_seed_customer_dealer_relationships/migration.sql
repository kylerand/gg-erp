-- Seed dealer accounts from existing live commercial customer records.
INSERT INTO customers.dealer_accounts (
  customer_id,
  dealer_code,
  territory,
  service_relationship,
  account_owner,
  notes,
  created_at,
  updated_at,
  version
)
SELECT
  c.id,
  concat('DEALER-', substring(c.id::text from 1 for 8)),
  nullif(trim(coalesce(c.shipping_address, c.billing_address, '')), ''),
  CASE
    WHEN c.state IN ('ACTIVE', 'LEAD') THEN 'ACTIVE'::customers."DealerAccountState"
    ELSE 'INACTIVE'::customers."DealerAccountState"
  END,
  c.full_name,
  'Seeded from existing commercial customer profile.',
  now(),
  now(),
  0
FROM customers.customers c
WHERE NOT EXISTS (
    SELECT 1
    FROM customers.dealer_accounts existing
    WHERE existing.customer_id = c.id
      AND existing.archived_at IS NULL
  )
  AND c.state <> 'ARCHIVED'
  AND (
    c.company_name IS NOT NULL
    OR c.full_name ILIKE '%dealer%'
    OR c.email ILIKE '%dealer%'
    OR coalesce(c.external_reference, '') ILIKE '%dealer%'
  );

-- Seed explicit cart/account links for dealer-owned carts already present in live data.
INSERT INTO customers.customer_dealer_relationships (
  dealer_account_id,
  customer_id,
  cart_vehicle_id,
  relationship_type,
  relationship_state,
  escalation_owner,
  notes,
  started_at,
  created_at,
  updated_at,
  version
)
SELECT
  da.id,
  cv.customer_id,
  cv.id,
  'ACCOUNT_OWNER'::customers."DealerRelationshipType",
  CASE
    WHEN da.service_relationship = 'ACTIVE' THEN 'ACTIVE'::customers."DealerRelationshipState"
    ELSE 'INACTIVE'::customers."DealerRelationshipState"
  END,
  da.account_owner,
  'Seeded from existing cart ownership and dealer account data.',
  now(),
  now(),
  now(),
  0
FROM customers.dealer_accounts da
JOIN planning.cart_vehicles cv
  ON cv.customer_id = da.customer_id
WHERE NOT EXISTS (
    SELECT 1
    FROM customers.customer_dealer_relationships existing
    WHERE existing.dealer_account_id = da.id
      AND existing.customer_id = cv.customer_id
      AND existing.cart_vehicle_id = cv.id
      AND existing.relationship_type = 'ACCOUNT_OWNER'
      AND existing.relationship_state = 'ACTIVE'
  )
  AND da.archived_at IS NULL;
