import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';

let prisma: PrismaClient | undefined;

function getPrisma(): PrismaClient {
  prisma ??= new PrismaClient();
  return prisma;
}

export function setWarrantyClaimsPrismaForTests(next: PrismaClient): void {
  prisma = next;
}

export async function disconnectWarrantyClaimsHandlerDependencies(): Promise<void> {
  await prisma?.$disconnect?.();
  prisma = undefined;
}

const CLAIM_STATUSES = new Set([
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REIMBURSEMENT_PENDING',
  'REIMBURSED',
  'DENIED',
  'CLOSED',
]);
type WarrantyClaimStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REIMBURSEMENT_PENDING'
  | 'REIMBURSED'
  | 'DENIED'
  | 'CLOSED';

interface WarrantyClaimCustomerRecord {
  id: string;
  fullName: string;
  companyName: string | null;
  email: string;
  phone: string | null;
  state: string;
}

interface WarrantyClaimDealerAccountRecord {
  id: string;
  dealerCode: string | null;
  territory: string | null;
  serviceRelationship: string;
  customer: WarrantyClaimCustomerRecord;
}

interface WarrantyClaimDealerRelationshipRecord {
  id: string;
  relationshipType: string;
  relationshipState: string;
  escalationOwner: string | null;
  dealerAccount: WarrantyClaimDealerAccountRecord;
}

interface WarrantyClaimVehicleRecord {
  id: string;
  vin: string;
  serialNumber: string;
  modelCode: string;
  modelYear: number;
  customerId: string;
  state: string;
}

interface WarrantyClaimWorkOrderRecord {
  id: string;
  workOrderNumber: string;
  customerReference: string | null;
  assetReference: string | null;
  title: string;
  status: string;
  dueAt: Date | null;
}

interface WarrantyClaimRecord {
  id: string;
  claimNumber: string;
  customerId: string;
  dealerAccountId: string | null;
  dealerRelationshipId: string | null;
  cartVehicleId: string | null;
  workOrderId: string | null;
  claimStatus: WarrantyClaimStatus;
  requestedAmountCents: number;
  approvedAmountCents: number | null;
  reimbursedAmountCents: number | null;
  externalReference: string | null;
  claimReason: string;
  ownerUserId: string | null;
  notes: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  reimbursedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  customer: WarrantyClaimCustomerRecord;
  dealerAccount: WarrantyClaimDealerAccountRecord | null;
  dealerRelationship: WarrantyClaimDealerRelationshipRecord | null;
  cartVehicle: WarrantyClaimVehicleRecord | null;
  workOrder: WarrantyClaimWorkOrderRecord | null;
}

interface CreateWarrantyClaimBody {
  customerId?: string;
  dealerId?: string | null;
  dealerAccountId?: string | null;
  dealerRelationshipId?: string | null;
  cartVehicleId?: string | null;
  workOrderId?: string | null;
  claimStatus?: string;
  requestedAmountCents?: number;
  approvedAmountCents?: number | null;
  reimbursedAmountCents?: number | null;
  externalReference?: string | null;
  claimReason?: string | null;
  ownerUserId?: string | null;
  notes?: string | null;
}

interface UpdateWarrantyClaimBody {
  claimStatus?: string;
  requestedAmountCents?: number;
  approvedAmountCents?: number | null;
  reimbursedAmountCents?: number | null;
  externalReference?: string | null;
  claimReason?: string | null;
  ownerUserId?: string | null;
  notes?: string | null;
}

const CLAIM_INCLUDE = {
  customer: true,
  dealerAccount: { include: { customer: true } },
  dealerRelationship: {
    include: {
      dealerAccount: { include: { customer: true } },
    },
  },
  cartVehicle: true,
  workOrder: true,
};

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function trimmed(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function normalizeClaimStatus(value: unknown): WarrantyClaimStatus | undefined {
  const candidate = trimmed(value)
    ?.toUpperCase()
    .replace(/[\s-]+/g, '_') as WarrantyClaimStatus | undefined;
  return candidate && CLAIM_STATUSES.has(candidate) ? candidate : undefined;
}

function amountCents(value: unknown, fallback?: number): number | undefined {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed);
}

function customerDisplayName(customer: WarrantyClaimCustomerRecord): string {
  return customer.companyName?.trim() || customer.fullName || customer.email;
}

function dealerDisplayName(dealer: WarrantyClaimDealerAccountRecord | null): string | undefined {
  return dealer ? customerDisplayName(dealer.customer) : undefined;
}

function cartDisplayName(vehicle: WarrantyClaimVehicleRecord | null): string | undefined {
  if (!vehicle) return undefined;
  return `${vehicle.modelYear} ${vehicle.modelCode}`;
}

function iso(value: Date | null): string | undefined {
  return value?.toISOString();
}

function generateClaimNumber(): string {
  const now = new Date();
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `WCLM-${yyyymmdd}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function toClaimResponse(record: WarrantyClaimRecord) {
  const dealer = record.dealerAccount ?? record.dealerRelationship?.dealerAccount ?? null;
  return {
    id: record.id,
    claimNumber: record.claimNumber,
    customerId: record.customerId,
    customerName: customerDisplayName(record.customer),
    customerEmail: record.customer.email,
    customerPhone: record.customer.phone ?? undefined,
    dealerId: dealer?.id,
    dealerCode: dealer?.dealerCode ?? undefined,
    dealerName: dealerDisplayName(dealer),
    dealerRelationshipId: record.dealerRelationshipId ?? undefined,
    relationshipType: record.dealerRelationship?.relationshipType,
    relationshipState: record.dealerRelationship?.relationshipState,
    escalationOwner: record.dealerRelationship?.escalationOwner ?? undefined,
    cartVehicleId: record.cartVehicleId ?? undefined,
    cartDisplayName: cartDisplayName(record.cartVehicle),
    vin: record.cartVehicle?.vin,
    serialNumber: record.cartVehicle?.serialNumber,
    cartState: record.cartVehicle?.state,
    workOrderId: record.workOrderId ?? undefined,
    workOrderNumber: record.workOrder?.workOrderNumber,
    workOrderTitle: record.workOrder?.title,
    workOrderStatus: record.workOrder?.status,
    claimStatus: record.claimStatus,
    requestedAmountCents: record.requestedAmountCents,
    approvedAmountCents: record.approvedAmountCents ?? undefined,
    reimbursedAmountCents: record.reimbursedAmountCents ?? undefined,
    externalReference: record.externalReference ?? undefined,
    claimReason: record.claimReason,
    ownerUserId: record.ownerUserId ?? undefined,
    notes: record.notes ?? undefined,
    source: 'warranty-claim',
    submittedAt: iso(record.submittedAt),
    approvedAt: iso(record.approvedAt),
    reimbursedAt: iso(record.reimbursedAt),
    closedAt: iso(record.closedAt),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    version: record.version,
  };
}

async function findWarrantyRelationship(input: {
  customerId: string;
  cartVehicleId?: string;
  dealerRelationshipId?: string;
}) {
  if (input.dealerRelationshipId) {
    return getPrisma().dealerRelationship.findUnique({
      where: { id: input.dealerRelationshipId },
      include: {
        dealerAccount: { include: { customer: true } },
        cartVehicle: true,
      },
    });
  }

  return getPrisma().dealerRelationship.findFirst({
    where: {
      customerId: input.customerId,
      relationshipType: 'WARRANTY_PROVIDER',
      relationshipState: 'ACTIVE',
      OR: [
        ...(input.cartVehicleId ? [{ cartVehicleId: input.cartVehicleId }] : []),
        { cartVehicleId: null },
      ],
    },
    include: {
      dealerAccount: { include: { customer: true } },
      cartVehicle: true,
    },
    orderBy: [{ cartVehicleId: 'desc' }, { updatedAt: 'desc' }],
  });
}

export const handler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const search = qs.search?.trim();
    const customerId = qs.customerId?.trim();
    const dealerId = qs.dealerId?.trim() ?? qs.dealerAccountId?.trim();
    const workOrderId = qs.workOrderId?.trim();
    const status = normalizeClaimStatus(qs.status);
    const limit = Math.min(parsePositiveInteger(qs.limit, 100), 500);
    const offset = parsePositiveInteger(qs.offset, 0);

    const baseWhere = {
      ...(customerId ? { customerId } : {}),
      ...(dealerId ? { dealerAccountId: dealerId } : {}),
      ...(workOrderId ? { workOrderId } : {}),
      ...(status ? { claimStatus: status } : {}),
    };
    const searchWhere = search
      ? {
          OR: [
            { claimNumber: { contains: search, mode: 'insensitive' as const } },
            { externalReference: { contains: search, mode: 'insensitive' as const } },
            { claimReason: { contains: search, mode: 'insensitive' as const } },
            { notes: { contains: search, mode: 'insensitive' as const } },
            { customer: { is: { fullName: { contains: search, mode: 'insensitive' as const } } } },
            {
              customer: { is: { companyName: { contains: search, mode: 'insensitive' as const } } },
            },
            { customer: { is: { email: { contains: search, mode: 'insensitive' as const } } } },
            {
              dealerAccount: {
                is: { dealerCode: { contains: search, mode: 'insensitive' as const } },
              },
            },
            {
              dealerAccount: {
                is: {
                  customer: {
                    is: { companyName: { contains: search, mode: 'insensitive' as const } },
                  },
                },
              },
            },
            { cartVehicle: { is: { vin: { contains: search, mode: 'insensitive' as const } } } },
            {
              cartVehicle: {
                is: { serialNumber: { contains: search, mode: 'insensitive' as const } },
              },
            },
            {
              workOrder: {
                is: { workOrderNumber: { contains: search, mode: 'insensitive' as const } },
              },
            },
          ],
        }
      : undefined;
    const where = searchWhere ? { AND: [baseWhere, searchWhere] } : baseWhere;

    const [items, total] = await Promise.all([
      getPrisma().warrantyClaim.findMany({
        where,
        include: CLAIM_INCLUDE,
        orderBy: [{ claimStatus: 'asc' }, { updatedAt: 'desc' }],
        take: limit,
        skip: offset,
      }),
      getPrisma().warrantyClaim.count({ where }),
    ]);

    return jsonResponse(200, {
      items: (items as WarrantyClaimRecord[]).map(toClaimResponse),
      total,
      limit,
      offset,
    });
  },
  { requireAuth: false },
);

export const createWarrantyClaimHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<CreateWarrantyClaimBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const customerId = trimmed(body.value.customerId);
    const cartVehicleId = trimmed(body.value.cartVehicleId);
    const workOrderId = trimmed(body.value.workOrderId);
    const dealerRelationshipId = trimmed(body.value.dealerRelationshipId);
    const explicitDealerId = trimmed(body.value.dealerId) ?? trimmed(body.value.dealerAccountId);
    const claimStatus = normalizeClaimStatus(body.value.claimStatus) ?? 'SUBMITTED';
    const requestedAmountCents = amountCents(body.value.requestedAmountCents, 0);
    const approvedAmountCents = amountCents(body.value.approvedAmountCents);
    const reimbursedAmountCents = amountCents(body.value.reimbursedAmountCents);
    const claimReason = nullableText(body.value.claimReason) ?? 'Warranty service';

    if (!customerId) return jsonResponse(422, { message: 'customerId is required.' });
    if (requestedAmountCents === undefined) {
      return jsonResponse(422, { message: 'requestedAmountCents must be a non-negative integer.' });
    }
    if (approvedAmountCents !== undefined && approvedAmountCents > requestedAmountCents) {
      return jsonResponse(422, {
        message: 'approvedAmountCents cannot exceed requestedAmountCents.',
      });
    }
    if (
      reimbursedAmountCents !== undefined &&
      approvedAmountCents !== undefined &&
      reimbursedAmountCents > approvedAmountCents
    ) {
      return jsonResponse(422, {
        message: 'reimbursedAmountCents cannot exceed approvedAmountCents.',
      });
    }

    const [customer, cartVehicle, workOrder] = await Promise.all([
      getPrisma().customer.findUnique({ where: { id: customerId } }),
      cartVehicleId
        ? getPrisma().cartVehicle.findUnique({ where: { id: cartVehicleId } })
        : Promise.resolve(null),
      workOrderId
        ? getPrisma().woOrder.findUnique({ where: { id: workOrderId } })
        : Promise.resolve(null),
    ]);
    if (!customer) return jsonResponse(404, { message: `Customer not found: ${customerId}` });
    if (cartVehicleId && !cartVehicle)
      return jsonResponse(404, { message: `Cart vehicle not found: ${cartVehicleId}` });
    if (cartVehicle && cartVehicle.customerId !== customerId) {
      return jsonResponse(422, { message: 'Selected cart belongs to a different customer.' });
    }
    if (workOrderId && !workOrder)
      return jsonResponse(404, { message: `Work order not found: ${workOrderId}` });
    if (workOrder?.customerReference && workOrder.customerReference !== customerId) {
      return jsonResponse(422, { message: 'Selected work order belongs to a different customer.' });
    }

    const relationship = await findWarrantyRelationship({
      customerId,
      cartVehicleId,
      dealerRelationshipId,
    });
    if (dealerRelationshipId && !relationship) {
      return jsonResponse(404, {
        message: `Warranty relationship not found: ${dealerRelationshipId}`,
      });
    }
    if (relationship && relationship.customerId !== customerId) {
      return jsonResponse(422, {
        message: 'Warranty provider relationship belongs to a different customer.',
      });
    }
    if (relationship && relationship.relationshipType !== 'WARRANTY_PROVIDER') {
      return jsonResponse(422, {
        message: 'Warranty claims must use a WARRANTY_PROVIDER relationship.',
      });
    }
    if (relationship && relationship.relationshipState !== 'ACTIVE' && claimStatus !== 'DRAFT') {
      return jsonResponse(422, {
        message: 'Warranty provider relationship must be active before submitting a claim.',
      });
    }
    if (
      relationship?.cartVehicleId &&
      cartVehicleId &&
      relationship.cartVehicleId !== cartVehicleId
    ) {
      return jsonResponse(422, {
        message: 'Warranty provider relationship covers a different cart.',
      });
    }

    const dealerAccountId = relationship?.dealerAccountId ?? explicitDealerId ?? null;
    if (explicitDealerId && relationship && explicitDealerId !== relationship.dealerAccountId) {
      return jsonResponse(422, {
        message: 'dealerId does not match the warranty provider relationship.',
      });
    }
    if (claimStatus !== 'DRAFT' && !dealerAccountId) {
      return jsonResponse(422, {
        message:
          'An active warranty provider relationship or dealer account is required before submitting a claim.',
      });
    }
    if (dealerAccountId && !relationship) {
      const dealer = await getPrisma().dealerAccount.findUnique({ where: { id: dealerAccountId } });
      if (!dealer)
        return jsonResponse(404, { message: `Dealer account not found: ${dealerAccountId}` });
    }

    const now = new Date();
    const created = await getPrisma().warrantyClaim.create({
      data: {
        claimNumber: generateClaimNumber(),
        customerId,
        dealerAccountId,
        dealerRelationshipId: relationship?.id ?? null,
        cartVehicleId: cartVehicleId ?? relationship?.cartVehicleId ?? null,
        workOrderId: workOrderId ?? null,
        claimStatus,
        requestedAmountCents,
        approvedAmountCents: approvedAmountCents ?? null,
        reimbursedAmountCents: reimbursedAmountCents ?? null,
        externalReference: nullableText(body.value.externalReference),
        claimReason,
        ownerUserId: trimmed(body.value.ownerUserId) ?? null,
        notes: nullableText(body.value.notes),
        submittedAt: claimStatus === 'DRAFT' ? null : now,
        approvedAt:
          claimStatus === 'APPROVED' ||
          claimStatus === 'REIMBURSEMENT_PENDING' ||
          claimStatus === 'REIMBURSED'
            ? now
            : null,
        reimbursedAt: claimStatus === 'REIMBURSED' ? now : null,
        closedAt: claimStatus === 'DENIED' || claimStatus === 'CLOSED' ? now : null,
        correlationId: ctx.correlationId,
        updatedAt: now,
      },
      include: CLAIM_INCLUDE,
    });

    return jsonResponse(201, {
      claim: toClaimResponse(created as WarrantyClaimRecord),
    });
  },
  { requireAuth: false },
);

export const updateWarrantyClaimHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Warranty claim ID is required.' });

    const body = parseBody<UpdateWarrantyClaimBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const existing = await getPrisma().warrantyClaim.findUnique({
      where: { id },
      include: CLAIM_INCLUDE,
    });
    if (!existing) return jsonResponse(404, { message: `Warranty claim not found: ${id}` });

    const patch: Record<string, unknown> = {};
    const now = new Date();
    let nextStatus = (existing as WarrantyClaimRecord).claimStatus;

    if ('claimStatus' in body.value) {
      const status = normalizeClaimStatus(body.value.claimStatus);
      if (!status) {
        return jsonResponse(422, {
          message:
            'claimStatus must be DRAFT, SUBMITTED, APPROVED, REIMBURSEMENT_PENDING, REIMBURSED, DENIED, or CLOSED.',
        });
      }
      nextStatus = status;
      patch.claimStatus = status;
      if (status !== 'DRAFT' && !(existing as WarrantyClaimRecord).submittedAt)
        patch.submittedAt = now;
      if (
        (status === 'APPROVED' || status === 'REIMBURSEMENT_PENDING' || status === 'REIMBURSED') &&
        !(existing as WarrantyClaimRecord).approvedAt
      ) {
        patch.approvedAt = now;
      }
      if (status === 'REIMBURSED' && !(existing as WarrantyClaimRecord).reimbursedAt)
        patch.reimbursedAt = now;
      if (
        (status === 'DENIED' || status === 'CLOSED') &&
        !(existing as WarrantyClaimRecord).closedAt
      ) {
        patch.closedAt = now;
      }
    }

    if ('requestedAmountCents' in body.value) {
      const requested = amountCents(body.value.requestedAmountCents);
      if (requested === undefined) {
        return jsonResponse(422, {
          message: 'requestedAmountCents must be a non-negative integer.',
        });
      }
      patch.requestedAmountCents = requested;
    }
    if ('approvedAmountCents' in body.value) {
      const approved = amountCents(body.value.approvedAmountCents);
      patch.approvedAmountCents = approved ?? null;
    }
    if ('reimbursedAmountCents' in body.value) {
      const reimbursed = amountCents(body.value.reimbursedAmountCents);
      patch.reimbursedAmountCents = reimbursed ?? null;
    }
    if ('externalReference' in body.value) {
      patch.externalReference = nullableText(body.value.externalReference);
    }
    if ('claimReason' in body.value) {
      patch.claimReason = nullableText(body.value.claimReason) ?? 'Warranty service';
    }
    if ('ownerUserId' in body.value) {
      patch.ownerUserId = trimmed(body.value.ownerUserId) ?? null;
    }
    if ('notes' in body.value) {
      patch.notes = nullableText(body.value.notes);
    }

    if (Object.keys(patch).length === 0) {
      return jsonResponse(422, { message: 'At least one warranty claim field is required.' });
    }

    const requestedAmountCents =
      typeof patch.requestedAmountCents === 'number'
        ? patch.requestedAmountCents
        : (existing as WarrantyClaimRecord).requestedAmountCents;
    const approvedAmountCents =
      'approvedAmountCents' in patch
        ? (patch.approvedAmountCents as number | null)
        : (existing as WarrantyClaimRecord).approvedAmountCents;
    const reimbursedAmountCents =
      'reimbursedAmountCents' in patch
        ? (patch.reimbursedAmountCents as number | null)
        : (existing as WarrantyClaimRecord).reimbursedAmountCents;
    if (approvedAmountCents !== null && approvedAmountCents > requestedAmountCents) {
      return jsonResponse(422, {
        message: 'approvedAmountCents cannot exceed requestedAmountCents.',
      });
    }
    if (
      reimbursedAmountCents !== null &&
      approvedAmountCents !== null &&
      reimbursedAmountCents > approvedAmountCents
    ) {
      return jsonResponse(422, {
        message: 'reimbursedAmountCents cannot exceed approvedAmountCents.',
      });
    }
    if (nextStatus === 'REIMBURSED' && reimbursedAmountCents === null) {
      return jsonResponse(422, {
        message: 'reimbursedAmountCents is required before marking a claim reimbursed.',
      });
    }

    try {
      const updated = await getPrisma().warrantyClaim.update({
        where: { id },
        data: {
          ...patch,
          updatedAt: now,
          version: { increment: 1 },
        },
        include: CLAIM_INCLUDE,
      });

      return jsonResponse(200, {
        claim: toClaimResponse(updated as WarrantyClaimRecord),
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return jsonResponse(409, {
          message: 'A warranty claim with this claim number already exists.',
        });
      }
      throw err;
    }
  },
  { requireAuth: false },
);
