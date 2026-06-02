import { Prisma, PrismaClient } from '@prisma/client';
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';

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

type DealerAccountState = 'ACTIVE' | 'INACTIVE';
const DEALER_ACCOUNT_STATES = new Set<DealerAccountState>(['ACTIVE', 'INACTIVE']);

interface CreateDealerAccountBody {
  customerId?: string;
  dealerCode?: string | null;
  territory?: string | null;
  serviceRelationship?: string;
  accountOwner?: string | null;
  notes?: string | null;
}

interface UpdateDealerAccountBody {
  dealerCode?: string | null;
  territory?: string | null;
  serviceRelationship?: string;
  accountOwner?: string | null;
  notes?: string | null;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function trimmed(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function nullableTrimmed(value: unknown): string | null {
  return trimmed(value) ?? null;
}

function normalizeDealerAccountState(value: unknown): DealerAccountState | undefined {
  const candidate = trimmed(value)?.toUpperCase() as DealerAccountState | undefined;
  return candidate && DEALER_ACCOUNT_STATES.has(candidate) ? candidate : undefined;
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
  { requireAuth: false },
);

export const createDealerAccountHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<CreateDealerAccountBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const customerId = trimmed(body.value.customerId);
    const serviceRelationship =
      normalizeDealerAccountState(body.value.serviceRelationship) ?? 'ACTIVE';

    if (!customerId) {
      return jsonResponse(422, { message: 'customerId is required.' });
    }
    if (
      'serviceRelationship' in body.value &&
      !normalizeDealerAccountState(body.value.serviceRelationship)
    ) {
      return jsonResponse(422, {
        message: 'serviceRelationship must be ACTIVE or INACTIVE.',
      });
    }

    const customer = await getPrisma().customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) return jsonResponse(404, { message: `Customer not found: ${customerId}` });
    if (customer.archivedAt) {
      return jsonResponse(422, { message: 'Archived customers cannot become dealer accounts.' });
    }
    if (customer.state !== 'ACTIVE') {
      return jsonResponse(422, { message: 'Only active customers can become dealer accounts.' });
    }

    const now = new Date();
    try {
      const created = await getPrisma().dealerAccount.create({
        data: {
          customerId,
          dealerCode: nullableTrimmed(body.value.dealerCode),
          territory: nullableTrimmed(body.value.territory),
          serviceRelationship,
          accountOwner: nullableTrimmed(body.value.accountOwner),
          notes: nullableTrimmed(body.value.notes),
          updatedAt: now,
        },
        include: { customer: true },
      });

      return jsonResponse(201, { dealer: toDealerResponse(created as DealerAccountRecord) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return jsonResponse(409, {
          message: 'This customer already has a dealer account.',
        });
      }
      throw err;
    }
  },
  { requireAuth: false },
);

export const updateDealerAccountHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Dealer account ID is required.' });

    const body = parseBody<UpdateDealerAccountBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const existing = await getPrisma().dealerAccount.findFirst({
      where: { id, archivedAt: null },
      include: { customer: true },
    });
    if (!existing) return jsonResponse(404, { message: `Dealer account not found: ${id}` });

    const patch: Record<string, unknown> = {};
    if ('dealerCode' in body.value) patch.dealerCode = nullableTrimmed(body.value.dealerCode);
    if ('territory' in body.value) patch.territory = nullableTrimmed(body.value.territory);
    if ('accountOwner' in body.value) patch.accountOwner = nullableTrimmed(body.value.accountOwner);
    if ('notes' in body.value) patch.notes = nullableTrimmed(body.value.notes);
    if ('serviceRelationship' in body.value) {
      const serviceRelationship = normalizeDealerAccountState(body.value.serviceRelationship);
      if (!serviceRelationship) {
        return jsonResponse(422, {
          message: 'serviceRelationship must be ACTIVE or INACTIVE.',
        });
      }
      patch.serviceRelationship = serviceRelationship;
    }

    if (Object.keys(patch).length === 0) {
      return jsonResponse(422, {
        message:
          'Provide at least one dealer account field to update: dealerCode, territory, serviceRelationship, accountOwner, or notes.',
      });
    }

    const updated = await getPrisma().dealerAccount.update({
      where: { id },
      data: { ...patch, updatedAt: new Date(), version: { increment: 1 } },
      include: { customer: true },
    });

    return jsonResponse(200, { dealer: toDealerResponse(updated as DealerAccountRecord) });
  },
  { requireAuth: false },
);
