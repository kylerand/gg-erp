import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';

const prisma = new PrismaClient();

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
    prisma.part.findMany({ where, orderBy: { sku: 'asc' }, take: limit, skip: offset }),
    prisma.part.count({ where }),
  ]);

  return jsonResponse(200, { items: items.map(toPartResponse), total, limit, offset });
}, { requireAuth: false });

// ─── Get Part ─────────────────────────────────────────────────────────────────

export const getPartHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id;
  if (!id) return jsonResponse(400, { message: 'Part ID is required.' });

  const part = await prisma.part.findFirst({ where: { id, deletedAt: null } });
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
  const existing = await prisma.part.findFirst({ where: { sku: normalizedSku, deletedAt: null } });
  if (existing) {
    return jsonResponse(409, { message: `Part SKU already exists: ${normalizedSku}` });
  }

  const now = new Date();
  const part = await prisma.part.create({
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
    prisma.vendor.findMany({ where, orderBy: { vendorName: 'asc' }, take: limit, skip: offset }),
    prisma.vendor.count({ where }),
  ]);

  return jsonResponse(200, { items: items.map(toVendorResponse), total, limit, offset });
}, { requireAuth: false });

// ─── Response mappers ─────────────────────────────────────────────────────────

function toPartResponse(r: {
  id: string; sku: string; name: string; description: string | null;
  unitOfMeasure: string; partState: string; reorderPoint: unknown;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    description: r.description ?? undefined,
    unitOfMeasure: r.unitOfMeasure,
    partState: r.partState,
    reorderPoint: Number(r.reorderPoint),
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
