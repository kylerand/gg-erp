import { Prisma, PrismaClient } from '@prisma/client';
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';

let prisma: PrismaClient | undefined;

function getPrisma(): PrismaClient {
  prisma ??= new PrismaClient();
  return prisma;
}

export function setListDealerRelationshipsPrismaForTests(next: PrismaClient): void {
  prisma = next;
}

export async function disconnectListDealerRelationshipsHandlerDependencies(): Promise<void> {
  await prisma?.$disconnect?.();
  prisma = undefined;
}

interface RelationshipCustomerRecord {
  id: string;
  fullName: string;
  companyName: string | null;
  email: string;
  phone: string | null;
  state: string;
}

interface RelationshipVehicleRecord {
  id: string;
  vin: string;
  serialNumber: string;
  modelCode: string;
  modelYear: number;
  state: string;
}

interface RelationshipDealerAccountRecord {
  id: string;
  dealerCode: string | null;
  territory: string | null;
  serviceRelationship: 'ACTIVE' | 'INACTIVE';
  customer: RelationshipCustomerRecord;
}

interface DealerRelationshipRecord {
  id: string;
  relationshipType: string;
  relationshipState: string;
  escalationOwner: string | null;
  notes: string | null;
  startedAt: Date;
  endedAt: Date | null;
  updatedAt: Date;
  dealerAccount: RelationshipDealerAccountRecord;
  customer: RelationshipCustomerRecord;
  cartVehicle: RelationshipVehicleRecord | null;
}

const RELATIONSHIP_TYPES = new Set([
  'ACCOUNT_OWNER',
  'SERVICING_DEALER',
  'BILLING_ACCOUNT',
  'WARRANTY_PROVIDER',
]);
const RELATIONSHIP_STATES = new Set(['ACTIVE', 'INACTIVE', 'ENDED']);
const UPDATEABLE_RELATIONSHIP_STATES = new Set(['ACTIVE', 'INACTIVE', 'ENDED']);

interface UpdateDealerRelationshipBody {
  relationshipState?: string;
  escalationOwner?: string | null;
  notes?: string | null;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function customerDisplayName(customer: RelationshipCustomerRecord): string {
  return customer.companyName?.trim() || customer.fullName || customer.email;
}

function cartDisplayName(vehicle: RelationshipVehicleRecord | null): string | undefined {
  if (!vehicle) return undefined;
  return `${vehicle.modelYear} ${vehicle.modelCode}`;
}

function toRelationshipResponse(record: DealerRelationshipRecord) {
  const dealerCustomer = record.dealerAccount.customer;
  return {
    id: record.id,
    dealerId: record.dealerAccount.id,
    dealerCustomerId: dealerCustomer.id,
    dealerCode: record.dealerAccount.dealerCode ?? undefined,
    dealerName: customerDisplayName(dealerCustomer),
    serviceRelationship: record.dealerAccount.serviceRelationship,
    territory: record.dealerAccount.territory ?? undefined,
    customerId: record.customer.id,
    customerName: customerDisplayName(record.customer),
    customerEmail: record.customer.email,
    customerPhone: record.customer.phone ?? undefined,
    customerState: record.customer.state,
    cartVehicleId: record.cartVehicle?.id,
    cartDisplayName: cartDisplayName(record.cartVehicle),
    vin: record.cartVehicle?.vin,
    serialNumber: record.cartVehicle?.serialNumber,
    cartState: record.cartVehicle?.state,
    relationshipType: record.relationshipType,
    relationshipState: record.relationshipState,
    escalationOwner: record.escalationOwner ?? undefined,
    notes: record.notes ?? undefined,
    source: 'dealer-relationship',
    startedAt: record.startedAt.toISOString(),
    endedAt: record.endedAt?.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export const handler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const search = qs.search?.trim();
    const state = qs.state?.trim().toUpperCase();
    const limit = Math.min(parsePositiveInteger(qs.limit, 100), 500);
    const offset = parsePositiveInteger(qs.offset, 0);
    const relationshipTypeQuery = search?.toUpperCase().replace(/[\s-]+/g, '_');

    const activeRelationshipWhere = {
      ...(state && RELATIONSHIP_STATES.has(state)
        ? { relationshipState: state as 'ACTIVE' | 'INACTIVE' | 'ENDED' }
        : {}),
    };
    const searchWhere = search
      ? {
          OR: [
            ...(relationshipTypeQuery && RELATIONSHIP_TYPES.has(relationshipTypeQuery)
              ? [{ relationshipType: relationshipTypeQuery as 'ACCOUNT_OWNER' }]
              : []),
            { escalationOwner: { contains: search, mode: 'insensitive' as const } },
            { notes: { contains: search, mode: 'insensitive' as const } },
            { customer: { is: { fullName: { contains: search, mode: 'insensitive' as const } } } },
            { customer: { is: { companyName: { contains: search, mode: 'insensitive' as const } } } },
            { customer: { is: { email: { contains: search, mode: 'insensitive' as const } } } },
            { dealerAccount: { is: { dealerCode: { contains: search, mode: 'insensitive' as const } } } },
            { dealerAccount: { is: { territory: { contains: search, mode: 'insensitive' as const } } } },
            {
              dealerAccount: {
                is: {
                  customer: {
                    is: { fullName: { contains: search, mode: 'insensitive' as const } },
                  },
                },
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
              cartVehicle: {
                is: { modelCode: { contains: search, mode: 'insensitive' as const } },
              },
            },
          ],
        }
      : undefined;
    const where = searchWhere ? { AND: [activeRelationshipWhere, searchWhere] } : activeRelationshipWhere;

    const [items, total] = await Promise.all([
      getPrisma().dealerRelationship.findMany({
        where,
        include: {
          dealerAccount: { include: { customer: true } },
          customer: true,
          cartVehicle: true,
        },
        orderBy: [{ relationshipState: 'asc' }, { updatedAt: 'desc' }],
        take: limit,
        skip: offset,
      }),
      getPrisma().dealerRelationship.count({ where }),
    ]);

    return jsonResponse(200, {
      items: (items as DealerRelationshipRecord[]).map(toRelationshipResponse),
      total,
      limit,
      offset,
    });
  },
  { requireAuth: false },
);

export const updateDealerRelationshipHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Dealer relationship ID is required.' });

    const body = parseBody<UpdateDealerRelationshipBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const existing = await getPrisma().dealerRelationship.findUnique({
      where: { id },
      include: {
        dealerAccount: { include: { customer: true } },
        customer: true,
        cartVehicle: true,
      },
    });
    if (!existing) return jsonResponse(404, { message: `Dealer relationship not found: ${id}` });

    const patch: Record<string, unknown> = {};
    const now = new Date();

    if ('relationshipState' in body.value) {
      const state = body.value.relationshipState?.trim().toUpperCase();
      if (!state || !UPDATEABLE_RELATIONSHIP_STATES.has(state)) {
        return jsonResponse(422, {
          message: 'relationshipState must be ACTIVE, INACTIVE, or ENDED.',
        });
      }
      patch.relationshipState = state;
      patch.endedAt = state === 'ENDED' ? now : null;
    }

    if ('escalationOwner' in body.value) {
      const owner = body.value.escalationOwner?.trim();
      patch.escalationOwner = owner || null;
    }

    if ('notes' in body.value) {
      const notes = body.value.notes?.trim();
      patch.notes = notes || null;
    }

    if (Object.keys(patch).length === 0) {
      return jsonResponse(422, {
        message: 'At least one relationship field is required.',
      });
    }

    try {
      const updated = await getPrisma().dealerRelationship.update({
        where: { id },
        data: {
          ...patch,
          updatedAt: now,
          version: { increment: 1 },
        },
        include: {
          dealerAccount: { include: { customer: true } },
          customer: true,
          cartVehicle: true,
        },
      });

      return jsonResponse(200, {
        relationship: toRelationshipResponse(updated as DealerRelationshipRecord),
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return jsonResponse(409, {
          message: 'An active dealer relationship already exists for this dealer, customer, cart, and type.',
        });
      }
      throw err;
    }
  },
  { requireAuth: false },
);
