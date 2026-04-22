import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';

let inventoryPrisma: PrismaClient | undefined;

function getInventoryPrisma(): PrismaClient {
  inventoryPrisma ??= new PrismaClient();
  return inventoryPrisma;
}

export const inventoryLotQueries = {
  listAvailableLots() {
    return getInventoryPrisma().$queryRaw<Array<{
      id: string;
      lotNumber: string | null;
      quantityOnHand: number | string;
      quantityReserved: number | string;
    }>>`
      SELECT
        lots.id::text AS "id",
        lots.lot_number AS "lotNumber",
        COALESCE(SUM(balances.quantity_on_hand), 0) AS "quantityOnHand",
        COALESCE(SUM(balances.quantity_reserved), 0) AS "quantityReserved"
      FROM inventory.stock_lots AS lots
      LEFT JOIN inventory.inventory_balances AS balances
        ON balances.stock_lot_id = lots.id
      WHERE lots.lot_state = 'AVAILABLE'
      GROUP BY lots.id, lots.lot_number, lots.received_at, lots.created_at
      ORDER BY lots.received_at DESC, lots.created_at DESC
    `;
  },

  async listLots(filters?: {
    partNumber?: string;
    warehouseId?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(filters?.page ?? 1, 1);
    const pageSize = Math.min(Math.max(filters?.pageSize ?? 50, 1), 200);

    const where = {
      ...(filters?.partNumber
        ? { part: { sku: { contains: filters.partNumber, mode: 'insensitive' as const } } }
        : {}),
      ...(filters?.warehouseId ? { stockLocationId: filters.warehouseId } : {}),
      ...(filters?.status
        ? { lotState: filters.status as 'AVAILABLE' | 'QUARANTINED' | 'CONSUMED' | 'CLOSED' }
        : {}),
    };

    const prisma = getInventoryPrisma();

    const [items, total] = await Promise.all([
      prisma.stockLot.findMany({
        where,
        include: {
          part: { select: { sku: true, name: true } },
          stockLocation: { select: { locationName: true } },
        },
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.stockLot.count({ where }),
    ]);

    return { items, total, page, pageSize };
  },
};

export const inventoryPurchaseOrderQueries = {
  async listPurchaseOrders(filters?: {
    status?: string;
    supplierId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(filters?.page ?? 1, 1);
    const pageSize = Math.min(Math.max(filters?.pageSize ?? 50, 1), 200);

    const where = {
      ...(filters?.status
        ? {
            purchaseOrderState: filters.status as
              | 'DRAFT'
              | 'APPROVED'
              | 'SENT'
              | 'PARTIALLY_RECEIVED'
              | 'RECEIVED'
              | 'CANCELLED',
          }
        : {}),
      ...(filters?.supplierId ? { vendorId: filters.supplierId } : {}),
    };

    const prisma = getInventoryPrisma();

    const [items, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: {
          vendor: { select: { vendorName: true, vendorCode: true } },
          lines: true,
        },
        orderBy: { orderedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    return { items, total, page, pageSize };
  },
};

// ─── List Parts ───────────────────────────────────────────────────────────────

const PART_INCLUDE = {
  stockLots: {
    where: { lotState: 'AVAILABLE' as const },
    include: { stockLocation: { select: { locationName: true } } },
  },
  manufacturer: { select: { manufacturerName: true } },
  defaultVendor: { select: { vendorName: true } },
  defaultLocation: { select: { locationName: true } },
} as const;

export const listPartsHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const search = qs.search;
  const partState = qs.partState as string | undefined;
  const category = qs.category as string | undefined;
  const installStage = qs.installStage as string | undefined;
  const lifecycleLevel = qs.lifecycleLevel as string | undefined;
  const manufacturerId = qs.manufacturerId as string | undefined;
  const defaultVendorId = qs.defaultVendorId as string | undefined;
  const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);
  const offset = parseInt(qs.offset ?? '0', 10);

  const where = {
    ...(partState ? { partState: partState as 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED' } : {}),
    ...(category
      ? {
          category: category as
            | 'ELECTRONICS' | 'AUDIO' | 'FABRICATION' | 'HARDWARE' | 'SMALL_PARTS' | 'DRIVE_TRAIN',
        }
      : {}),
    ...(installStage
      ? {
          installStage: installStage as
            | 'FABRICATION' | 'FRAME' | 'WIRING' | 'PARTS_PREP' | 'FINAL_ASSEMBLY',
        }
      : {}),
    ...(lifecycleLevel
      ? {
          lifecycleLevel: lifecycleLevel as
            | 'RAW_MATERIAL' | 'RAW_COMPONENT' | 'PREPARED_COMPONENT' | 'ASSEMBLED_COMPONENT',
        }
      : {}),
    ...(manufacturerId ? { manufacturerId } : {}),
    ...(defaultVendorId ? { defaultVendorId } : {}),
    ...(search
      ? {
          OR: [
            { sku: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
            { variant: { contains: search, mode: 'insensitive' as const } },
            { description: { contains: search, mode: 'insensitive' as const } },
            { manufacturerPartNumber: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
    deletedAt: null,
  };

  const [items, total] = await Promise.all([
    getInventoryPrisma().part.findMany({
      where,
      orderBy: { sku: 'asc' },
      take: limit,
      skip: offset,
      include: PART_INCLUDE,
    }),
    getInventoryPrisma().part.count({ where }),
  ]);

  return jsonResponse(200, { items: items.map(toPartResponse), total, limit, offset });
}, { requireAuth: false });

// ─── Get Part Transformation Chain ───────────────────────────────────────────

export const getPartChainHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Part ID is required.' });

  const prisma = getInventoryPrisma();
  const part = await prisma.part.findFirst({
    where: { id, deletedAt: null },
    include: PART_INCLUDE,
  });
  if (!part) return jsonResponse(404, { message: `Part not found: ${id}` });

  const ancestors: Array<typeof part> = [];
  let cursorId = part.producedFromPartId;
  while (cursorId) {
    const next = await prisma.part.findFirst({
      where: { id: cursorId, deletedAt: null },
      include: PART_INCLUDE,
    });
    if (!next) break;
    ancestors.unshift(next);
    cursorId = next.producedFromPartId;
  }

  const descendants: Array<typeof part> = [];
  const toVisit: string[] = [part.id];
  while (toVisit.length > 0) {
    const currentId = toVisit.shift()!;
    const children = await prisma.part.findMany({
      where: { producedFromPartId: currentId, deletedAt: null },
      include: PART_INCLUDE,
      orderBy: { lifecycleLevel: 'asc' },
    });
    for (const child of children) {
      descendants.push(child);
      toVisit.push(child.id);
    }
  }

  return jsonResponse(200, {
    ancestors: ancestors.map((p) => ({ part: toPartResponse(p), producedViaStage: p.producedViaStage ?? undefined })),
    part: toPartResponse(part),
    descendants: descendants.map((p) => ({ part: toPartResponse(p), producedViaStage: p.producedViaStage ?? undefined })),
  });
}, { requireAuth: false });

// ─── Material Plan by Install Stage ──────────────────────────────────────────

export const planMaterialByStageHandler = wrapHandler(async () => {
  const prisma = getInventoryPrisma();
  const parts = await prisma.part.findMany({
    where: { deletedAt: null, partState: 'ACTIVE' },
    orderBy: { sku: 'asc' },
    include: PART_INCLUDE,
  });

  const STAGE_ORDER = ['FABRICATION', 'FRAME', 'WIRING', 'PARTS_PREP', 'FINAL_ASSEMBLY'] as const;
  type Stage = (typeof STAGE_ORDER)[number];

  const toLine = (part: (typeof parts)[number]) => {
    const onHand = (part.stockLots ?? []).length;
    const reorderPoint = Number(part.reorderPoint);
    return {
      part: toPartResponse(part),
      onHand,
      reorderPoint,
      shortfall: Math.max(reorderPoint - onHand, 0),
    };
  };

  const byStage = new Map<Stage, ReturnType<typeof toLine>[]>();
  const unassigned: ReturnType<typeof toLine>[] = [];
  for (const p of parts) {
    const line = toLine(p);
    if (!p.installStage) {
      unassigned.push(line);
      continue;
    }
    const arr = byStage.get(p.installStage as Stage) ?? [];
    arr.push(line);
    byStage.set(p.installStage as Stage, arr);
  }

  const groups = STAGE_ORDER.filter((s) => byStage.has(s)).map((stage) => {
    const lines = (byStage.get(stage) ?? []).sort((a, b) => b.shortfall - a.shortfall || a.part.sku.localeCompare(b.part.sku));
    return {
      installStage: stage,
      lines,
      totalShortfall: lines.reduce((sum, l) => sum + l.shortfall, 0),
    };
  });

  return jsonResponse(200, { generatedAt: new Date().toISOString(), groups, unassigned });
}, { requireAuth: false });

// ─── List Manufacturers ──────────────────────────────────────────────────────

export const listManufacturersHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const state = qs.state as string | undefined;
  const limit = Math.min(parseInt(qs.limit ?? '200', 10), 500);
  const offset = parseInt(qs.offset ?? '0', 10);

  const where = {
    ...(state ? { manufacturerState: state as 'ACTIVE' | 'INACTIVE' } : {}),
    deletedAt: null,
  };

  const [items, total] = await Promise.all([
    getInventoryPrisma().manufacturer.findMany({
      where,
      orderBy: { manufacturerName: 'asc' },
      take: limit,
      skip: offset,
    }),
    getInventoryPrisma().manufacturer.count({ where }),
  ]);

  return jsonResponse(200, { items: items.map(toManufacturerResponse), total, limit, offset });
}, { requireAuth: false });

// ─── Create Manufacturer ─────────────────────────────────────────────────────

interface CreateManufacturerBody {
  manufacturerCode: string;
  name: string;
  website?: string;
  notes?: string;
}

export const createManufacturerHandler = wrapHandler(async (ctx) => {
  const body = parseBody<CreateManufacturerBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { manufacturerCode, name, website, notes } = body.value;
  if (!manufacturerCode?.trim()) return jsonResponse(422, { message: 'manufacturerCode is required.' });
  if (!name?.trim()) return jsonResponse(422, { message: 'name is required.' });

  const code = manufacturerCode.trim().toUpperCase();
  const prisma = getInventoryPrisma();
  const duplicate = await prisma.manufacturer.findFirst({
    where: {
      deletedAt: null,
      OR: [
        { manufacturerCode: code },
        { manufacturerName: { equals: name.trim(), mode: 'insensitive' } },
      ],
    },
  });
  if (duplicate) {
    return jsonResponse(409, { message: `Manufacturer already exists: ${duplicate.manufacturerName}` });
  }

  const now = new Date();
  const created = await prisma.manufacturer.create({
    data: {
      id: randomUUID(),
      manufacturerCode: code,
      manufacturerName: name.trim(),
      manufacturerState: 'ACTIVE',
      website: website?.trim() || null,
      notes: notes?.trim() || null,
      createdAt: now,
      updatedAt: now,
    },
  });

  return jsonResponse(201, { manufacturer: toManufacturerResponse(created) });
}, { requireAuth: false });

// ─── List Inventory Lots ─────────────────────────────────────────────────────

export const listLotsHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const page = parseInt(qs.page ?? '1', 10);
  const pageSize = parseInt(qs.pageSize ?? '50', 10);

  const result = await inventoryLotQueries.listLots({
    partNumber: qs.partNumber,
    warehouseId: qs.warehouseId,
    status: qs.status,
    page,
    pageSize,
  });

  return jsonResponse(200, {
    items: result.items.map(toLotDetailResponse),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  });
}, { requireAuth: false });

// ─── List Purchase Orders ────────────────────────────────────────────────────

export const listPurchaseOrdersHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const page = parseInt(qs.page ?? '1', 10);
  const pageSize = parseInt(qs.pageSize ?? '50', 10);

  const result = await inventoryPurchaseOrderQueries.listPurchaseOrders({
    status: qs.status,
    supplierId: qs.supplierId,
    page,
    pageSize,
  });

  return jsonResponse(200, {
    items: result.items.map(toPurchaseOrderResponse),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  });
}, { requireAuth: false });

// ─── Get Part ─────────────────────────────────────────────────────────────────

export const getPartHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Part ID is required.' });

  const part = await getInventoryPrisma().part.findFirst({
    where: { id, deletedAt: null },
    include: PART_INCLUDE,
  });
  if (!part) return jsonResponse(404, { message: `Part not found: ${id}` });

  return jsonResponse(200, { part: toPartResponse(part) });
}, { requireAuth: false });

// ─── Create Part SKU ──────────────────────────────────────────────────────────

interface CreatePartBody {
  sku: string;
  name: string;
  description?: string;
  unitOfMeasure: string;
  reorderPoint?: number;
}

export const createPartHandler = wrapHandler(async (ctx) => {
  const body = parseBody<CreatePartBody>(ctx.event);
  if (!body.ok) return jsonResponse(400, { message: body.error });

  const { sku, name, description, unitOfMeasure, reorderPoint } = body.value;

  if (!sku?.trim()) return jsonResponse(422, { message: 'sku is required.' });
  if (!name?.trim()) return jsonResponse(422, { message: 'name is required.' });
  if (!unitOfMeasure?.trim()) return jsonResponse(422, { message: 'unitOfMeasure is required.' });

  const normalizedSku = sku.trim().toUpperCase();
  const existing = await getInventoryPrisma().part.findFirst({ where: { sku: normalizedSku, deletedAt: null } });
  if (existing) {
    return jsonResponse(409, { message: `Part SKU already exists: ${normalizedSku}` });
  }

  const now = new Date();
  const part = await getInventoryPrisma().part.create({
    data: {
      id: randomUUID(),
      sku: normalizedSku,
      name: name.trim(),
      description: description?.trim() ?? null,
      unitOfMeasure: unitOfMeasure.trim(),
      partState: 'ACTIVE',
      reorderPoint: reorderPoint ?? 0,
      createdAt: now,
      updatedAt: now,
    },
  });

  return jsonResponse(201, { part: toPartResponse(part) });
}, { requireAuth: false });

// ─── List Vendors ─────────────────────────────────────────────────────────────

export const listVendorsHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const vendorState = qs.state as string | undefined;
  const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);
  const offset = parseInt(qs.offset ?? '0', 10);

  const where = {
    ...(vendorState ? { state: vendorState as 'ACTIVE' | 'ON_HOLD' | 'INACTIVE' } : {}),
    deletedAt: null,
  };

  const [items, total] = await Promise.all([
    getInventoryPrisma().vendor.findMany({ where, orderBy: { vendorName: 'asc' }, take: limit, skip: offset }),
    getInventoryPrisma().vendor.count({ where }),
  ]);

  return jsonResponse(200, { items: items.map(toVendorResponse), total, limit, offset });
}, { requireAuth: false });

// ─── Response mappers ─────────────────────────────────────────────────────────

function toPartResponse(r: {
  id: string; sku: string; name: string; description: string | null;
  variant?: string | null;
  color?: string | null;
  category?: string | null;
  lifecycleLevel?: string | null;
  installStage?: string | null;
  manufacturerId?: string | null;
  manufacturerPartNumber?: string | null;
  defaultVendorId?: string | null;
  defaultLocationId?: string | null;
  producedFromPartId?: string | null;
  producedViaStage?: string | null;
  unitOfMeasure: string; partState: string; reorderPoint: unknown;
  createdAt: Date; updatedAt: Date;
  stockLots?: Array<{ lotState: string; stockLocation?: { locationName: string } | null }>;
  manufacturer?: { manufacturerName: string } | null;
  defaultVendor?: { vendorName: string } | null;
  defaultLocation?: { locationName: string } | null;
}) {
  const availableLots = r.stockLots?.filter(l => l.lotState === 'AVAILABLE') ?? [];
  const location = r.defaultLocation?.locationName ?? availableLots[0]?.stockLocation?.locationName ?? undefined;
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    description: r.description ?? undefined,
    variant: r.variant ?? undefined,
    color: r.color ?? undefined,
    category: r.category ?? undefined,
    lifecycleLevel: r.lifecycleLevel ?? undefined,
    installStage: r.installStage ?? undefined,
    manufacturerId: r.manufacturerId ?? undefined,
    manufacturerName: r.manufacturer?.manufacturerName ?? undefined,
    manufacturerPartNumber: r.manufacturerPartNumber ?? undefined,
    defaultVendorId: r.defaultVendorId ?? undefined,
    defaultVendorName: r.defaultVendor?.vendorName ?? undefined,
    defaultLocationId: r.defaultLocationId ?? undefined,
    defaultLocationName: r.defaultLocation?.locationName ?? undefined,
    producedFromPartId: r.producedFromPartId ?? undefined,
    producedViaStage: r.producedViaStage ?? undefined,
    unitOfMeasure: r.unitOfMeasure,
    partState: r.partState,
    reorderPoint: Number(r.reorderPoint),
    quantityOnHand: availableLots.length,
    location,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toManufacturerResponse(r: {
  id: string;
  manufacturerCode: string;
  manufacturerName: string;
  manufacturerState: string;
  website: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    manufacturerCode: r.manufacturerCode,
    name: r.manufacturerName,
    state: r.manufacturerState,
    website: r.website ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toVendorResponse(r: {
  id: string; vendorCode: string; vendorName: string; vendorState: string;
  email: string | null; phone: string | null; leadTimeDays: number | null;
  paymentTerms: string | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: r.id,
    vendorCode: r.vendorCode,
    vendorName: r.vendorName,
    vendorState: r.vendorState,
    email: r.email ?? undefined,
    phone: r.phone ?? undefined,
    leadTimeDays: r.leadTimeDays ?? undefined,
    paymentTerms: r.paymentTerms ?? undefined,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toLotDetailResponse(r: {
  id: string;
  lotNumber: string | null;
  serialNumber: string | null;
  lotState: string;
  receivedAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  part: { sku: string; name: string };
  stockLocation: { locationName: string };
}) {
  return {
    id: r.id,
    lotNumber: r.lotNumber ?? r.id,
    serialNumber: r.serialNumber ?? undefined,
    lotState: r.lotState,
    partSku: r.part.sku,
    partName: r.part.name,
    locationName: r.stockLocation.locationName,
    receivedAt: r.receivedAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPurchaseOrderResponse(r: {
  id: string;
  poNumber: string;
  vendorId: string;
  purchaseOrderState: string;
  orderedAt: Date;
  expectedAt: Date | null;
  sentAt: Date | null;
  closedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  vendor: { vendorName: string; vendorCode: string };
  lines: Array<{
    id: string;
    lineNumber: number;
    partId: string;
    orderedQuantity: unknown;
    receivedQuantity: unknown;
    rejectedQuantity: unknown;
    unitCost: unknown;
    lineState: string;
  }>;
}) {
  return {
    id: r.id,
    poNumber: r.poNumber,
    vendorId: r.vendorId,
    vendorName: r.vendor.vendorName,
    vendorCode: r.vendor.vendorCode,
    purchaseOrderState: r.purchaseOrderState,
    orderedAt: r.orderedAt.toISOString(),
    expectedAt: r.expectedAt?.toISOString(),
    sentAt: r.sentAt?.toISOString(),
    closedAt: r.closedAt?.toISOString(),
    notes: r.notes ?? undefined,
    lineCount: r.lines.length,
    lines: r.lines.map((l) => ({
      id: l.id,
      lineNumber: l.lineNumber,
      partId: l.partId,
      orderedQuantity: Number(l.orderedQuantity),
      receivedQuantity: Number(l.receivedQuantity),
      rejectedQuantity: Number(l.rejectedQuantity),
      unitCost: Number(l.unitCost),
      lineState: l.lineState,
    })),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
