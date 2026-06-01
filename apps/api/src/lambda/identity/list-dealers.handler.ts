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

interface DealerAccountRecord {
  id: string;
  dealerCode: string | null;
  territory: string | null;
  serviceRelationship: 'ACTIVE' | 'INACTIVE';
  accountOwner: string | null;
  notes: string | null;
  updatedAt: Date;
  customer: DealerCustomerRecord;
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

function toDealerResponse(record: DealerAccountRecord) {
  const customer = record.customer;
  return {
    id: record.id,
    customerId: customer.id,
    dealerCode: record.dealerCode ?? undefined,
    name: customer.companyName?.trim() || customer.fullName,
    primaryContact: customer.companyName?.trim() ? customer.fullName : undefined,
    contactEmail: customer.email,
    phone: customer.phone ?? undefined,
    territory: record.territory ?? territoryFromAddress(customer),
    serviceRelationship: record.serviceRelationship,
    customerState: customer.state,
    accountOwner: record.accountOwner ?? undefined,
    notes: record.notes ?? undefined,
    source: 'dealer-account',
    updatedAt: record.updatedAt.toISOString(),
  };
}

export const handler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const search = qs.search?.trim();
    const limit = Math.min(parsePositiveInteger(qs.limit, 100), 500);
    const offset = parsePositiveInteger(qs.offset, 0);

    const activeAccountWhere = {
      archivedAt: null,
    };
    const searchWhere = search
      ? {
          OR: [
            { dealerCode: { contains: search, mode: 'insensitive' as const } },
            { territory: { contains: search, mode: 'insensitive' as const } },
            { accountOwner: { contains: search, mode: 'insensitive' as const } },
            { customer: { is: { fullName: { contains: search, mode: 'insensitive' as const } } } },
            { customer: { is: { companyName: { contains: search, mode: 'insensitive' as const } } } },
            { customer: { is: { email: { contains: search, mode: 'insensitive' as const } } } },
            { customer: { is: { phone: { contains: search, mode: 'insensitive' as const } } } },
            { customer: { is: { billingAddress: { contains: search, mode: 'insensitive' as const } } } },
            { customer: { is: { shippingAddress: { contains: search, mode: 'insensitive' as const } } } },
          ],
        }
      : undefined;
    const where = searchWhere ? { AND: [activeAccountWhere, searchWhere] } : activeAccountWhere;

    const [items, total] = await Promise.all([
      getPrisma().dealerAccount.findMany({
        where,
        include: { customer: true },
        orderBy: [{ serviceRelationship: 'asc' }, { updatedAt: 'desc' }],
        take: limit,
        skip: offset,
      }),
      getPrisma().dealerAccount.count({ where }),
    ]);

    return jsonResponse(200, {
      items: (items as DealerAccountRecord[]).map(toDealerResponse),
      total,
      limit,
      offset,
    });
  },
  { requireAuth: false }
);
