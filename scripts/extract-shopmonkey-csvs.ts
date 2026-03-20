#!/usr/bin/env tsx
/**
 * Extracts the Shop Monkey JSON export into individual CSV files
 * that match the format expected by the migration parsers.
 *
 * Usage:
 *   npx tsx scripts/extract-shopmonkey-csvs.ts <export.json> [output-dir]
 *
 * Defaults:
 *   export.json  → shopmonkey-export-*.json (auto-detected in cwd)
 *   output-dir   → ./data
 */

import { createWriteStream, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function sanitizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  // Replace newlines with a space so readline-based CSV parsers don't split rows
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

function escapeCsv(value: unknown): string {
  const str = sanitizeText(value);
  if (str.includes(',') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function writeCsv(outPath: string, headers: string[], rows: Record<string, unknown>[]): void {
  const stream = createWriteStream(outPath, { encoding: 'utf-8' });
  stream.write(headers.join(',') + '\n');
  for (const row of rows) {
    stream.write(headers.map(h => escapeCsv(row[h])).join(',') + '\n');
  }
  stream.end();
  console.log(`  ✅ ${outPath.split('/').pop()} — ${rows.length} rows`);
}

// ---------------------------------------------------------------------------
// Extractors
// ---------------------------------------------------------------------------

function extractCustomers(customers: Record<string, any>[]): Record<string, unknown>[] {
  return customers
    .filter(c => !c.deleted)
    .map(c => ({
      id:        c.id,
      firstName: c.firstName ?? '',
      lastName:  c.lastName ?? '',
      email:     c.emails?.find((e: any) => e.primary)?.email ?? c.emails?.[0]?.email ?? '',
      phone:     c.phoneNumbers?.find((p: any) => p.primary)?.number ?? c.phoneNumbers?.[0]?.number ?? '',
      address:   c.address1 ?? '',
      city:      c.city ?? '',
      state:     c.state ?? '',
      zip:       c.postalCode ?? '',
      createdAt: c.createdDate ?? '',
    }));
}

function extractAssets(
  vehicles: Record<string, any>[],
  orders: Record<string, any>[],
): Record<string, unknown>[] {
  // Build vehicleId → customerId map from orders (use most recent order per vehicle)
  const vehicleCustomerMap = new Map<string, string>();
  const sorted = [...orders].sort(
    (a, b) => new Date(b.createdDate ?? 0).getTime() - new Date(a.createdDate ?? 0).getTime(),
  );
  for (const o of sorted) {
    if (o.vehicleId && o.customerId && !vehicleCustomerMap.has(o.vehicleId)) {
      vehicleCustomerMap.set(o.vehicleId, o.customerId);
    }
  }

  return vehicles
    .filter(v => !v.deleted)
    .map(v => ({
      id:           v.id,
      customerId:   vehicleCustomerMap.get(v.id) ?? '',
      vin:          v.vin ?? '',
      year:         v.year ?? '',
      make:         (v.make ?? '').trim(),
      model:        (v.model ?? '').trim(),
      color:        v.color ?? '',
      licensePlate: v.licensePlate ?? '',
      mileage:      v.mileage ?? v.odometer ?? '',
    }));
}

function extractEmployees(users: Record<string, any>[]): Record<string, unknown>[] {
  return users
    .filter(u => u.active !== false)
    .map(u => ({
      id:        u.id,
      firstName: u.firstName ?? '',
      lastName:  u.lastName ?? '',
      email:     u.email ?? '',
      role:      u.userRoles?.[0]?.role?.name ?? 'TECHNICIAN',
      phone:     u.phone ?? '',
      hireDate:  u.createdDate ?? '',
      active:    String(u.active ?? true),
    }));
}

function extractWorkOrders(orders: Record<string, any>[]): Record<string, unknown>[] {
  return orders
    .filter(o => !o.deleted)
    .map(o => ({
      id:                 o.id,
      customerId:         o.customerId ?? '',
      assetId:            o.vehicleId ?? '',
      assignedEmployeeId: o.serviceWriterId ?? o.assignedTechnicianIds?.[0] ?? '',
      title:              o.coalescedName ?? o.generatedName ?? o.name ?? `Work Order #${o.number}`,
      description:        o.complaint ?? o.recommendation ?? '',
      status:             o.status ?? 'Estimate',
      priority:           '',
      laborTotal:         o.laborCents != null ? (o.laborCents / 100).toFixed(2) : '',
      partsTotal:         o.partsCents != null ? (o.partsCents / 100).toFixed(2) : '',
      createdAt:          o.createdDate ?? '',
      completedAt:        o.completedDate ?? '',
    }));
}

function extractVendors(vendors: Record<string, any>[]): Record<string, unknown>[] {
  return vendors
    .filter(v => !v.deleted)
    .map(v => ({
      id:            v.id,
      name:          v.name ?? '',
      contactName:   [v.contactFirstName, v.contactLastName].filter(Boolean).join(' '),
      email:         v.contactEmail ?? '',
      phone:         v.contactPhone ?? '',
      address:       v.address1 ?? '',
      accountNumber: v.accountNumber ?? '',
    }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Auto-detect JSON export if not specified
  let exportPath = args[0];
  if (!exportPath) {
    const cwd = process.cwd();
    const match = readdirSync(cwd).find(f => f.startsWith('shopmonkey-export') && f.endsWith('.json'));
    if (!match) {
      console.error('❌ No shopmonkey-export-*.json found. Pass path as first argument.');
      process.exit(1);
    }
    exportPath = join(cwd, match);
  }

  const outputDir = resolve(args[1] ?? './data');
  mkdirSync(outputDir, { recursive: true });

  console.log(`\n📦 Loading: ${exportPath}`);
  const raw = await import(resolve(exportPath), { assert: { type: 'json' } });
  const data = raw.default ?? raw;

  console.log(`\n🔄 Extracting to: ${outputDir}\n`);

  writeCsv(
    join(outputDir, 'customers.csv'),
    ['id', 'firstName', 'lastName', 'email', 'phone', 'address', 'city', 'state', 'zip', 'createdAt'],
    extractCustomers(data.customers ?? []),
  );

  writeCsv(
    join(outputDir, 'assets.csv'),
    ['id', 'customerId', 'vin', 'year', 'make', 'model', 'color', 'licensePlate', 'mileage'],
    extractAssets(data.vehicles ?? [], data.orders ?? []),
  );

  writeCsv(
    join(outputDir, 'employees.csv'),
    ['id', 'firstName', 'lastName', 'email', 'role', 'phone', 'hireDate', 'active'],
    extractEmployees(data.users ?? []),
  );

  writeCsv(
    join(outputDir, 'work_orders.csv'),
    ['id', 'customerId', 'assetId', 'assignedEmployeeId', 'title', 'description', 'status', 'priority', 'laborTotal', 'partsTotal', 'createdAt', 'completedAt'],
    extractWorkOrders(data.orders ?? []),
  );

  writeCsv(
    join(outputDir, 'vendors.csv'),
    ['id', 'name', 'contactName', 'email', 'phone', 'address', 'accountNumber'],
    extractVendors(data.vendors ?? []),
  );

  // Create empty stub CSVs for files with no source data in this export
  for (const [name, headers] of [
    ['parts.csv',                 'id,sku,name,description,category,unitPrice,costPrice,unitOfMeasure,vendorId'],
    ['work_order_operations.csv', 'id,workOrderId,name,description,laborHours,laborRate,technicianId'],
    ['work_order_parts.csv',      'id,workOrderId,partId,quantity,unitPrice,notes'],
  ] as [string, string][]) {
    const stubPath = join(outputDir, name);
    const stub = createWriteStream(stubPath, { encoding: 'utf-8' });
    stub.write(headers + '\n');
    stub.end();
    console.log(`  ✅ ${name} — 0 rows (stub, no data in export)`);
  }

  console.log(`\n✅ Extraction complete. Run the dry-run next:\n`);
  console.log(`   npm run migrate:shopmonkey -- dry-run ./data\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
