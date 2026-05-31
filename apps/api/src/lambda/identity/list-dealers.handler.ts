import { PrismaClient } from '@prisma/client';
import { wrapHandler, jsonResponse } from '../../shared/lambda/index.js';

let prisma: PrismaClient | undefined;

function getPrisma(): PrismaClient {
  prisma ??= new PrismaClient();
  return prisma;
}

export function setListDealersPrismaForTests(next: PrismaClient): void {
  prisma = next;
}

export async function disconnectListDealersHandlerDependencies(): Promise<void> {
  await prisma?.$disconnect?.();
  prisma = undefined;
}

interface DealerCustomerRecord {
  id: string;
  fullName: string;
  companyName: string | null;
  email: string;
  phone: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  state: string;
  updatedAt: Date;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function territoryFromAddress(record: DealerCustomerRecord): string | undefined {
  const address = record.shippingAddress ?? record.billingAddress;
  if (!address) return undefined;
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join(', ');
  return parts[0];
}

function toDealerResponse(record: DealerCustomerRecord) {
  return {
    id: record.id,
    customerId: record.id,
    name: record.companyName?.trim() || record.fullName,
    primaryContact: record.companyName?.trim() ? record.fullName : undefined,
    contactEmail: record.email,
    phone: record.phone ?? undefined,
    territory: territoryFromAddress(record),
    serviceRelationship: record.state === 'ACTIVE' || record.state === 'LEAD' ? 'ACTIVE' : 'INACTIVE',
    customerState: record.state,
    source: 'customer-company',
    updatedAt: record.updatedAt.toISOString(),
  };
}

export const handler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const search = qs.search?.trim();
    const limit = Math.min(parsePositiveInteger(qs.limit, 100), 500);
    const offset = parsePositiveInteger(qs.offset, 0);

    const dealerAccountWhere = {
      state: { not: 'ARCHIVED' as const },
      OR: [
        { companyName: { not: null } },
        { fullName: { contains: 'dealer', mode: 'insensitive' as const } },
        { email: { contains: 'dealer', mode: 'insensitive' as const } },
        { externalReference: { contains: 'dealer', mode: 'insensitive' as const } },
      ],
    };
    const searchWhere = search
      ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' as const } },
            { companyName: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search, mode: 'insensitive' as const } },
            { billingAddress: { contains: search, mode: 'insensitive' as const } },
            { shippingAddress: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : undefined;
    const where = searchWhere ? { AND: [dealerAccountWhere, searchWhere] } : dealerAccountWhere;

    const [items, total] = await Promise.all([
      getPrisma().customer.findMany({
        where,
        orderBy: [{ state: 'asc' }, { companyName: 'asc' }, { fullName: 'asc' }],
        take: limit,
        skip: offset,
      }),
      getPrisma().customer.count({ where }),
    ]);

    return jsonResponse(200, {
      items: items.map(toDealerResponse),
      total,
      limit,
      offset,
    });
  },
  { requireAuth: false }
);
