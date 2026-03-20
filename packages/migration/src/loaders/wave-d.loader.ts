import { readFileSync } from 'fs';
import type { PrismaClient } from '@prisma/client';
import { isAlreadyImported, recordImportMapping } from './idempotency.js';
import { createBatch, completeBatch, recordRawRecord, recordError } from './loader.js';
import type { LoadResult } from './loader.js';

interface SmCustomer {
  id: string;
  firstName: string;
  lastName: string;
  companyName: string;
  emails: Array<{ address: string; primary?: boolean }>;
  phoneNumbers: Array<{ number: string; primary?: boolean }>;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  customerType?: string;
}

interface SmVehicle {
  id: string;
  vin?: string | null;
  serial?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
}

interface SmOrder {
  customerId?: string | null;
  vehicleId?: string | null;
}

interface SmExport {
  customers: SmCustomer[];
  vehicles: SmVehicle[];
  orders: SmOrder[];
}

function buildFullName(c: SmCustomer): string {
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : (c.companyName || 'Unknown');
}

function primaryEmail(c: SmCustomer, fallbackId: string): string {
  const primary = c.emails?.find(e => e.primary) ?? c.emails?.[0];
  return primary?.address || `noemail+${fallbackId}@noemail.local`;
}

function primaryPhone(c: SmCustomer): string | null {
  const primary = c.phoneNumbers?.find(p => p.primary) ?? c.phoneNumbers?.[0];
  return primary?.number ?? null;
}

function billingAddress(c: SmCustomer): string | null {
  const parts = [c.address1, c.city, c.state, c.postalCode].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Derive a stable VIN placeholder when the vehicle has no real VIN. */
function resolvedVin(v: SmVehicle): string {
  return v.vin || (v.serial ? `SER-${v.serial}` : `IMPORT-${v.id}`);
}

/** Derive a stable serial placeholder when the vehicle has no real serial. */
function resolvedSerial(v: SmVehicle): string {
  return v.serial || (v.vin ? `VIN-${v.vin}` : `IMPORT-${v.id}`);
}

export async function runWaveD(
  prisma: PrismaClient,
  exportJsonPath: string,
  _unused?: string,
  dryRun = false,
): Promise<{ customers: LoadResult; vehicles: LoadResult }> {
  const raw = JSON.parse(readFileSync(exportJsonPath, 'utf-8')) as SmExport;
  const smCustomers = raw.customers ?? [];
  const smVehicles = raw.vehicles ?? [];

  // Build vehicle → customer map from orders (most reliable link in ShopMonkey)
  const vehicleCustomerMap = new Map<string, string>();
  for (const order of raw.orders ?? []) {
    if (order.vehicleId && order.customerId && !vehicleCustomerMap.has(order.vehicleId)) {
      vehicleCustomerMap.set(order.vehicleId, order.customerId);
    }
  }

  // ── Wave D-1: Customers ──────────────────────────────────────────────────
  const custBatchId = await createBatch(prisma, 'D', exportJsonPath);
  let custInserted = 0, custSkipped = 0, custErrors = 0;

  for (const cust of smCustomers) {
    try {
      if (await isAlreadyImported(prisma, 'CUSTOMER', cust.id)) { custSkipped++; continue; }
      await recordRawRecord(prisma, custBatchId, 'CUSTOMER', cust.id, cust as unknown as Record<string, unknown>);

      if (!dryRun) {
        const fullName = buildFullName(cust);
        const email = primaryEmail(cust, cust.id);
        const phone = primaryPhone(cust);
        const address = billingAddress(cust);
        const contactMethod = phone ? 'PHONE' : 'EMAIL';

        const result = await prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO customers.customers
            (full_name, company_name, email, phone, billing_address,
             external_reference, preferred_contact_method,
             state, created_at, updated_at, version)
          VALUES (
            ${fullName}, ${cust.companyName || null}, ${email}, ${phone}, ${address},
            ${cust.id}, ${contactMethod},
            'ACTIVE', NOW(), NOW(), 0
          )
          ON CONFLICT DO NOTHING
          RETURNING id
        `;
        if (result[0]) {
          await recordImportMapping(prisma, 'CUSTOMER', cust.id, result[0].id);
          custInserted++;
        } else {
          custSkipped++;
        }
      } else {
        custInserted++;
      }
    } catch (err) {
      custErrors++;
      await recordError(prisma, custBatchId, 'LOAD', 'INSERT_FAILED', err instanceof Error ? err.message : String(err));
    }
  }

  await completeBatch(prisma, custBatchId, smCustomers.length, custErrors, custErrors === 0 ? 'COMPLETED' : 'FAILED');

  // ── Wave D-2: Vehicles (cart_vehicles) ──────────────────────────────────
  const vehBatchId = await createBatch(prisma, 'D', exportJsonPath);
  let vehInserted = 0, vehSkipped = 0, vehErrors = 0;

  for (const veh of smVehicles) {
    try {
      if (await isAlreadyImported(prisma, 'ASSET', veh.id)) { vehSkipped++; continue; }

      const smCustomerId = vehicleCustomerMap.get(veh.id);
      if (!smCustomerId) {
        // Vehicle not linked to any order — skip quietly
        vehSkipped++;
        continue;
      }

      if (!veh.year || !veh.model) {
        await recordError(prisma, vehBatchId, 'LOAD', 'MISSING_DATA',
          `Vehicle ${veh.id} missing year or model — skipping`);
        vehErrors++;
        continue;
      }

      await recordRawRecord(prisma, vehBatchId, 'ASSET', veh.id, veh as unknown as Record<string, unknown>);

      if (!dryRun) {
        const custRow = await prisma.$queryRaw<Array<{ entity_id: string }>>`
          SELECT entity_id FROM integrations.external_id_mappings
          WHERE namespace = 'shopmonkey:v1'
            AND entity_type = 'CUSTOMER'
            AND external_id = ${smCustomerId}
            AND integration_account_id = CAST(${'00000000-0000-0000-0000-000000000003'} AS uuid)
        `;
        if (!custRow[0]) {
          await recordError(prisma, vehBatchId, 'LOAD', 'MISSING_FK',
            `Customer mapping not found for sm:${smCustomerId}`);
          vehErrors++;
          continue;
        }

        const vin = resolvedVin(veh);
        const serial = resolvedSerial(veh);
        const modelCode = [veh.make, veh.model].filter(Boolean).join(' ') || 'UNKNOWN';

        const result = await prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO planning.cart_vehicles
            (vin, serial_number, model_code, model_year, customer_id, state, created_at, updated_at)
          VALUES (
            ${vin}, ${serial}, ${modelCode}, ${veh.year},
            CAST(${custRow[0].entity_id} AS uuid),
            'REGISTERED', NOW(), NOW()
          )
          ON CONFLICT DO NOTHING
          RETURNING id
        `;
        if (result[0]) {
          await recordImportMapping(prisma, 'ASSET', veh.id, result[0].id);
          vehInserted++;
        } else {
          vehSkipped++;
        }
      } else {
        vehInserted++;
      }
    } catch (err) {
      vehErrors++;
      await recordError(prisma, vehBatchId, 'LOAD', 'INSERT_FAILED', err instanceof Error ? err.message : String(err));
    }
  }

  await completeBatch(prisma, vehBatchId, smVehicles.length, vehErrors, vehErrors === 0 ? 'COMPLETED' : 'FAILED');

  return {
    customers: { batchId: custBatchId, wave: 'D', inserted: custInserted, skipped: custSkipped, errors: custErrors },
    vehicles: { batchId: vehBatchId, wave: 'D', inserted: vehInserted, skipped: vehSkipped, errors: vehErrors },
  };
}
