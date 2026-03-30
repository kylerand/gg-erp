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

export const listPartsHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const search = qs.search;
  const partState = qs.partState as string | undefined;
  const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);
  const offset = parseInt(qs.offset ?? '0', 10);

  const where = {
    ...(partState ? { partState: partState as 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED' } : {}),
    ...(search
      ? {
          OR: [
            { sku: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
            { description: { contains: search, mode: 'insensitive' as const } },
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
      include: {
        stockLots: {
          where: { lotState: 'AVAILABLE' },
          include: { stockLocation: { select: { locationName: true } } },
        },
      },
    }),
    getInventoryPrisma().part.count({ where }),
  ]);

  return jsonResponse(200, { items: items.map(toPartResponse), total, limit, offset });
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

  const part = await getInventoryPrisma().part.findFirst({ where: { id, deletedAt: null } });
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
  unitOfMeasure: string; partState: string; reorderPoint: unknown;
  createdAt: Date; updatedAt: Date;
  stockLots?: Array<{ lotState: string; stockLocation?: { locationName: string } | null }>;
}) {
  const availableLots = r.stockLots?.filter(l => l.lotState === 'AVAILABLE') ?? [];
  const location = availableLots[0]?.stockLocation?.locationName ?? undefined;
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    description: r.description ?? undefined,
    unitOfMeasure: r.unitOfMeasure,
    partState: r.partState,
    reorderPoint: Number(r.reorderPoint),
    quantityOnHand: availableLots.length,
    location,
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
