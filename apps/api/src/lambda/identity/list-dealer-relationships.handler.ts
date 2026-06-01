import { PrismaClient } from '@prisma/client';
import { wrapHandler, jsonResponse } from '../../shared/lambda/index.js';

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
