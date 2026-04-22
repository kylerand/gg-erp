import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import {
  PrismaClient,
  type InstallStage,
  type LifecycleLevel,
  type PartCategory,
  type PartColor,
  type Prisma,
} from '@prisma/client';
import * as XLSX from 'xlsx';
import { resolveDatabaseUrl } from '../src/client.js';

/*
 * Reads `data/inventory-master.xlsx` and upserts manufacturers, vendors,
 * stock locations, and parts (including the produced-from transformation chain).
 *
 * Run with: npm run seed:inventory
 * Override the file with SEED_INVENTORY_FILE=/abs/path/to.xlsx
 *
 * Exported `runSeed()` is also consumed by the `seed-inventory-master` Lambda
 * so prod seeding works from inside the VPC without a jumpbox.
 */

let prisma: PrismaClient;

type RawRow = {
  partName?: string;
  partDetail?: string;
  color?: string;
  namingConvention?: string;
  category?: string;
  mfr?: string;
  mfrPartNumber?: string;
  vendor?: string;
  ggPartNumber?: string;
  installStage?: string;
  partLocation?: string;
  minQty?: number | string;
  currentQty?: number | string;
};

const LIFECYCLE_MAP: Record<string, LifecycleLevel> = {
  'Raw Material': 'RAW_MATERIAL',
  'Raw Component': 'RAW_COMPONENT',
  'Prepared Component': 'PREPARED_COMPONENT',
  'Assembled Component': 'ASSEMBLED_COMPONENT',
};

const CATEGORY_MAP: Record<string, PartCategory> = {
  Electronics: 'ELECTRONICS',
  Audio: 'AUDIO',
  Fabrication: 'FABRICATION',
  Hardware: 'HARDWARE',
  'Small Parts': 'SMALL_PARTS',
  'Drive Train': 'DRIVE_TRAIN',
};

const INSTALL_STAGE_MAP: Record<string, InstallStage> = {
  Fabrication: 'FABRICATION',
  Frame: 'FRAME',
  Wiring: 'WIRING',
  'Parts Prep': 'PARTS_PREP',
  'Final Assembly': 'FINAL_ASSEMBLY',
  'Finaly Assembly': 'FINAL_ASSEMBLY', // typo tolerance from xlsx drop-down
};

const COLOR_MAP: Record<string, PartColor> = {
  Black: 'BLACK',
  White: 'WHITE',
  Chrome: 'CHROME',
  'Raw Steel': 'RAW_STEEL',
  'Powder Coated': 'POWDER_COATED',
  Amber: 'AMBER',
  Red: 'RED',
  Grey: 'GREY',
  Brown: 'BROWN',
  'Raw Aluminum': 'RAW_ALUMINUM',
  'Stainless Steel': 'STAINLESS_STEEL',
};

const MANUFACTURER_NAME_CANONICAL: Record<string, string> = {
  'Disruptive Rest Mods': 'Disruptive Resto Mods',
  'Great Pacifc': 'Great Pacific',
};

function trim(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s.length > 0 ? s : undefined;
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : undefined;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function makeCode(name: string, prefix: string): string {
  const base = slug(name).toUpperCase();
  if (base) return `${prefix}-${base}`;
  const hash = createHash('sha1').update(name).digest('hex').slice(0, 8).toUpperCase();
  return `${prefix}-${hash}`;
}

function generateSkuIfMissing(row: RawRow, category?: PartCategory, lifecycle?: LifecycleLevel): string {
  const existing = trim(row.ggPartNumber);
  if (existing) return existing;
  const name = trim(row.partName) ?? 'UNKNOWN';
  const variant = trim(row.partDetail);
  const parts = [
    'GG',
    category ? category.replace(/_/g, '').slice(0, 4) : 'GEN',
    lifecycle ? lifecycle.split('_').map((w) => w[0]).join('') : '',
    slug(name).toUpperCase(),
    variant ? slug(variant).toUpperCase() : '',
  ].filter(Boolean);
  return parts.join('-');
}

function canonicalManufacturerName(raw: string): string {
  const trimmed = raw.trim();
  return MANUFACTURER_NAME_CANONICAL[trimmed] ?? trimmed;
}

function readRows(filePath: string): RawRow[] {
  const buffer = readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets['Inventory Master'];
  if (!sheet) throw new Error('Sheet "Inventory Master" not found');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
  return rows.map((row) => ({
    partName: trim(row['Part Name']),
    partDetail: trim(row['Part Detail']),
    color: trim(row['Color']),
    namingConvention: trim(row['Naming Convention']),
    category: trim(row['Catagory']),
    mfr: trim(row['MFR']),
    mfrPartNumber: trim(row['MFR Part #']),
    vendor: trim(row['Vendor']),
    ggPartNumber: trim(row['GG Part #']),
    installStage: trim(row['Instal Stage']),
    partLocation: trim(row['Part Location']),
    minQty: row['Min. QTY'] as number | string | null ?? undefined,
    currentQty: row['Currrent QTY'] as number | string | null ?? undefined,
  }));
}

async function upsertManufacturer(name: string): Promise<string> {
  const canonical = canonicalManufacturerName(name);
  const existing = await prisma.manufacturer.findFirst({
    where: { manufacturerName: { equals: canonical, mode: 'insensitive' }, deletedAt: null },
  });
  if (existing) return existing.id;

  const code = makeCode(canonical, 'MFR');
  const created = await prisma.manufacturer.create({
    data: {
      manufacturerCode: code,
      manufacturerName: canonical,
      manufacturerState: 'ACTIVE',
      notes: canonical !== name.trim() ? `Alternate spelling in source: ${name.trim()}` : null,
    },
  });
  return created.id;
}

async function upsertVendor(name: string): Promise<string> {
  const existing = await prisma.vendor.findFirst({
    where: { vendorName: { equals: name, mode: 'insensitive' }, deletedAt: null },
  });
  if (existing) return existing.id;

  const code = makeCode(name, 'VEN');
  const created = await prisma.vendor.create({
    data: {
      vendorCode: code,
      vendorName: name,
      vendorState: 'ACTIVE',
    },
  });
  return created.id;
}

async function upsertLocation(name: string): Promise<string> {
  const code = makeCode(name, 'LOC');
  const existing = await prisma.stockLocation.findFirst({
    where: { locationCode: code, deletedAt: null },
  });
  if (existing) return existing.id;
  const created = await prisma.stockLocation.create({
    data: {
      locationCode: code,
      locationName: name,
      locationType: 'WAREHOUSE',
      isPickable: true,
    },
  });
  return created.id;
}

type PartUpsertInput = {
  row: RawRow;
  sku: string;
  name: string;
  variant?: string;
  color?: PartColor;
  category?: PartCategory;
  lifecycleLevel: LifecycleLevel;
  installStage?: InstallStage;
  manufacturerId?: string;
  manufacturerPartNumber?: string;
  defaultVendorId?: string;
  defaultLocationId?: string;
  minQty: number;
};

async function upsertPart(input: PartUpsertInput): Promise<string> {
  const existing = await prisma.part.findFirst({
    where: {
      name: input.name,
      variant: input.variant ?? null,
      lifecycleLevel: input.lifecycleLevel,
      deletedAt: null,
    },
  });

  const data: Prisma.PartUpsertArgs['update'] & Prisma.PartUpsertArgs['create'] = {
    sku: input.sku,
    name: input.name,
    description: null,
    variant: input.variant ?? null,
    color: input.color ?? null,
    category: input.category ?? null,
    lifecycleLevel: input.lifecycleLevel,
    installStage: input.installStage ?? null,
    manufacturerId: input.manufacturerId ?? null,
    manufacturerPartNumber: input.manufacturerPartNumber ?? null,
    defaultVendorId: input.defaultVendorId ?? null,
    defaultLocationId: input.defaultLocationId ?? null,
    unitOfMeasure: 'EA',
    partState: 'ACTIVE',
    reorderPoint: input.minQty,
  };

  if (existing) {
    await prisma.part.update({
      where: { id: existing.id },
      data: { ...data, version: { increment: 1 } },
    });
    return existing.id;
  }
  const created = await prisma.part.create({
    data: { id: randomUUID(), ...data },
  });
  return created.id;
}

async function linkLifecycleChain(): Promise<number> {
  let linkedCount = 0;
  const PREDECESSOR: Record<LifecycleLevel, LifecycleLevel | null> = {
    RAW_MATERIAL: null,
    RAW_COMPONENT: null,
    PREPARED_COMPONENT: 'RAW_COMPONENT',
    ASSEMBLED_COMPONENT: 'PREPARED_COMPONENT',
  };

  const downstream = await prisma.part.findMany({
    where: {
      deletedAt: null,
      OR: [{ lifecycleLevel: 'PREPARED_COMPONENT' }, { lifecycleLevel: 'ASSEMBLED_COMPONENT' }],
    },
  });

  for (const part of downstream) {
    const prevLevel = PREDECESSOR[part.lifecycleLevel];
    if (!prevLevel) continue;
    const predecessor = await prisma.part.findFirst({
      where: {
        name: part.name,
        variant: part.variant ?? null,
        lifecycleLevel: prevLevel,
        deletedAt: null,
      },
    });
    if (!predecessor) continue;
    if (part.producedFromPartId === predecessor.id && part.producedViaStage === predecessor.installStage) {
      continue;
    }
    await prisma.part.update({
      where: { id: part.id },
      data: {
        producedFromPartId: predecessor.id,
        producedViaStage: predecessor.installStage ?? null,
      },
    });
    linkedCount += 1;
  }
  return linkedCount;
}

export interface SeedResult {
  manufacturersUpserted: number;
  vendorsUpserted: number;
  locationsUpserted: number;
  partsUpserted: number;
  chainLinksSet: number;
  rowsReadFromFile: number;
}

export async function runSeed(filePath: string): Promise<SeedResult> {
  if (!existsSync(filePath)) {
    throw new Error(`Inventory master file not found at ${filePath}`);
  }
  if (!prisma) {
    prisma = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } });
  }
  console.info(`Seeding inventory master from ${filePath}`);
  const rows = readRows(filePath).filter((r) => r.partName);
  console.info(`  • ${rows.length} non-empty rows`);

  // Collect unique reference values first so we upsert them once per name.
  const mfrCache = new Map<string, string>();
  const vendorCache = new Map<string, string>();
  const locationCache = new Map<string, string>();

  let mfrCount = 0;
  let vendorCount = 0;
  let locationCount = 0;
  let partCount = 0;

  for (const row of rows) {
    if (row.mfr && !mfrCache.has(canonicalManufacturerName(row.mfr))) {
      const id = await upsertManufacturer(row.mfr);
      mfrCache.set(canonicalManufacturerName(row.mfr), id);
      mfrCount += 1;
    }
    if (row.vendor && !vendorCache.has(row.vendor)) {
      const id = await upsertVendor(row.vendor);
      vendorCache.set(row.vendor, id);
      vendorCount += 1;
    }
    if (row.partLocation && !locationCache.has(row.partLocation)) {
      const id = await upsertLocation(row.partLocation);
      locationCache.set(row.partLocation, id);
      locationCount += 1;
    }
  }

  for (const row of rows) {
    const name = row.partName!;
    const variant = row.partDetail;
    const category = row.category ? CATEGORY_MAP[row.category] : undefined;
    const color = row.color ? COLOR_MAP[row.color] : undefined;
    const installStage = row.installStage ? INSTALL_STAGE_MAP[row.installStage] : undefined;
    const lifecycleLevel =
      (row.namingConvention && LIFECYCLE_MAP[row.namingConvention]) || 'RAW_COMPONENT';
    const manufacturerId = row.mfr ? mfrCache.get(canonicalManufacturerName(row.mfr)) : undefined;
    const defaultVendorId = row.vendor ? vendorCache.get(row.vendor) : undefined;
    const defaultLocationId = row.partLocation ? locationCache.get(row.partLocation) : undefined;
    const minQty = toNumber(row.minQty) ?? 0;

    const sku = generateSkuIfMissing(row, category, lifecycleLevel);

    await upsertPart({
      row,
      sku,
      name,
      variant,
      color,
      category,
      lifecycleLevel,
      installStage,
      manufacturerId,
      manufacturerPartNumber: row.mfrPartNumber,
      defaultVendorId,
      defaultLocationId,
      minQty,
    });
    partCount += 1;
  }

  const linked = await linkLifecycleChain();

  console.info(`  ✓ Manufacturers upserted: ${mfrCount}`);
  console.info(`  ✓ Vendors upserted:      ${vendorCount}`);
  console.info(`  ✓ Locations upserted:    ${locationCount}`);
  console.info(`  ✓ Parts upserted:        ${partCount}`);
  console.info(`  ✓ Chain links set:       ${linked}`);

  return {
    manufacturersUpserted: mfrCount,
    vendorsUpserted: vendorCount,
    locationsUpserted: locationCount,
    partsUpserted: partCount,
    chainLinksSet: linked,
    rowsReadFromFile: rows.length,
  };
}

function resolveDefaultFilePath(): string {
  if (process.env.SEED_INVENTORY_FILE) return resolve(process.env.SEED_INVENTORY_FILE);
  const cwdFile = resolve(process.cwd(), 'data', 'inventory-master.xlsx');
  if (existsSync(cwdFile)) return cwdFile;
  return resolve(process.cwd(), '../../data/inventory-master.xlsx');
}

// CLI entrypoint: only runs when invoked directly (not when imported by a Lambda handler).
const isCli = Boolean(process.argv[1] && process.argv[1].endsWith('seed-inventory-master.ts') ||
                     process.argv[1]?.endsWith('seed-inventory-master.js'));
if (isCli) {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_FORCE !== '1') {
    throw new Error('Refusing to run inventory seed in production without SEED_FORCE=1');
  }
  runSeed(resolveDefaultFilePath())
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error(error);
      if (prisma) await prisma.$disconnect();
      process.exit(1);
    });
}
