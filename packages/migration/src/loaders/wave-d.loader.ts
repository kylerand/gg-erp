import type { PrismaClient } from '@prisma/client';
import type { SanitizedCustomer, SanitizedVehicle } from '../sanitize/sanitize-export.js';
import { readShopMonkeySource } from './shopmonkey-source.js';
import { isAlreadyImported, recordImportMapping } from './idempotency.js';
import { createBatch, completeBatch, recordRawRecord, recordError } from './loader.js';
import type { LoadResult } from './loader.js';

/** Derive a stable VIN placeholder when the vehicle has no real VIN. */
function resolvedVin(v: SanitizedVehicle): string {
  return v.vin || `IMPORT-${v.smId}`;
}

/** Derive a stable serial placeholder when the vehicle has no real serial. */
function resolvedSerial(v: SanitizedVehicle): string {
  return v.vin ? `VIN-${v.vin}` : `IMPORT-${v.smId}`;
}

function primaryEmail(c: SanitizedCustomer): string {
  return c.email || `noemail+${c.smId}@noemail.local`;
}

function buildValueCounts(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function uniquifyIfDuplicate(value: string, sourceId: string, counts: ReadonlyMap<string, number>): string {
  return (counts.get(value) ?? 0) > 1 ? `${value}-SM-${sourceId.slice(0, 8)}` : value;
}

export async function runWaveD(
  prisma: PrismaClient,
  exportJsonPath: string,
  _unused?: string,
  dryRun = false,
): Promise<{ customers: LoadResult; vehicles: LoadResult }> {
  const { report } = await readShopMonkeySource(exportJsonPath);
  const smCustomers = report.customers.filter((customer) => !customer.skip);
  const smVehicles = report.vehicles.filter((vehicle) => !vehicle.skip);
  const vinCounts = buildValueCounts(smVehicles.map(resolvedVin));
  const serialCounts = buildValueCounts(smVehicles.map(resolvedSerial));

  // Build vehicle → customer map from the vehicle owner field, then fill gaps
  // from work orders. Sanitized reports already carry both references.
  const vehicleCustomerMap = new Map<string, string>();
  for (const vehicle of report.vehicles) {
    if (vehicle.smCustomerId) {
      vehicleCustomerMap.set(vehicle.smId, vehicle.smCustomerId);
    }
  }
  for (const order of report.orders) {
    if (order.smVehicleId && order.smCustomerId && !vehicleCustomerMap.has(order.smVehicleId)) {
      vehicleCustomerMap.set(order.smVehicleId, order.smCustomerId);
    }
  }

  // ── Wave D-1: Customers ──────────────────────────────────────────────────
  const custBatchId = await createBatch(prisma, 'D', exportJsonPath);
  let custInserted = 0, custSkipped = 0, custErrors = 0;

  for (const cust of smCustomers) {
    try {
      if (await isAlreadyImported(prisma, 'CUSTOMER', cust.smId)) { custSkipped++; continue; }
      await recordRawRecord(prisma, custBatchId, 'CUSTOMER', cust.smId, cust);

      if (!dryRun) {
        const fullName = cust.fullName || cust.companyName || 'Unknown';
        const email = primaryEmail(cust);
        const phone = cust.phone ?? null;
        const contactMethod = phone ? 'PHONE' : 'EMAIL';

        const result = await prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO customers.customers
            (full_name, company_name, email, phone, billing_address,
             external_reference, preferred_contact_method,
             state, created_at, updated_at, version)
          VALUES (
            ${fullName}, ${cust.companyName || null}, ${email}, ${phone}, ${null},
            ${cust.smId}, ${contactMethod},
            'ACTIVE', NOW(), NOW(), 0
          )
          ON CONFLICT DO NOTHING
          RETURNING id
        `;
        if (result[0]) {
          await recordImportMapping(prisma, 'CUSTOMER', cust.smId, result[0].id);
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
      if (await isAlreadyImported(prisma, 'ASSET', veh.smId)) { vehSkipped++; continue; }

      const smCustomerId = veh.smCustomerId ?? vehicleCustomerMap.get(veh.smId);
      if (!smCustomerId) {
        // Vehicle not linked to any order — skip quietly
        vehSkipped++;
        continue;
      }

      if (!veh.year || !veh.model) {
        await recordError(prisma, vehBatchId, 'LOAD', 'MISSING_DATA',
          `Vehicle ${veh.smId} missing year or model — skipping`);
        vehErrors++;
        continue;
      }

      await recordRawRecord(prisma, vehBatchId, 'ASSET', veh.smId, veh);

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

        const vin = uniquifyIfDuplicate(resolvedVin(veh), veh.smId, vinCounts);
        const serial = uniquifyIfDuplicate(resolvedSerial(veh), veh.smId, serialCounts);
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
          await recordImportMapping(prisma, 'ASSET', veh.smId, result[0].id);
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
