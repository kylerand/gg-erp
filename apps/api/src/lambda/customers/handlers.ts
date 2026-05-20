import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  wrapHandler,
  parseBody,
  jsonResponse,
  type LambdaEvent,
  type LambdaResult,
} from '../../shared/lambda/index.js';

let prisma: PrismaClient | undefined;

function getPrisma(): PrismaClient {
  prisma ??= new PrismaClient();
  return prisma;
}

export function setCustomersHandlerPrismaForTests(next: PrismaClient): void {
  prisma = next;
}

export async function disconnectCustomersHandlerDependencies(): Promise<void> {
  await prisma?.$disconnect?.();
  prisma = undefined;
}

// ─── List Customers ───────────────────────────────────────────────────────────

export const listCustomersHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const state = qs.state as string | undefined;
    const search = qs.search;
    const limit = Math.min(parseInt(qs.limit ?? '100', 10), 500);
    const offset = parseInt(qs.offset ?? '0', 10);

    const where = {
      ...(state ? { state: state as 'LEAD' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { companyName: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search, mode: 'insensitive' as const } },
              { externalReference: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      getPrisma().customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      getPrisma().customer.count({ where }),
    ]);

    return jsonResponse(200, { items: items.map(toCustomerResponse), total, limit, offset });
  },
  { requireAuth: false },
);

// ─── Get Customer ─────────────────────────────────────────────────────────────

export const getCustomerHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Customer ID is required.' });

    const customer = await getPrisma().customer.findUnique({ where: { id } });
    if (!customer) return jsonResponse(404, { message: `Customer not found: ${id}` });

    return jsonResponse(200, { customer: toCustomerResponse(customer) });
  },
  { requireAuth: false },
);

// ─── Create Customer ──────────────────────────────────────────────────────────

interface CreateCustomerBody {
  fullName: string;
  email: string;
  companyName?: string;
  phone?: string;
  preferredContactMethod?: string;
  billingAddress?: string;
  shippingAddress?: string;
}

export const createCustomerHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<CreateCustomerBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const {
      fullName,
      email,
      companyName,
      phone,
      preferredContactMethod,
      billingAddress,
      shippingAddress,
    } = body.value;

    if (!fullName?.trim()) return jsonResponse(422, { message: 'fullName is required.' });
    if (!email?.trim()) return jsonResponse(422, { message: 'email is required.' });

    const normalizedEmail = email.trim().toLowerCase();
    const duplicate = await getPrisma().customer.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        state: { not: 'ARCHIVED' },
      },
    });
    if (duplicate) {
      return jsonResponse(409, {
        message: `Customer with email ${normalizedEmail} already exists.`,
      });
    }

    const now = new Date();
    const customer = await getPrisma().customer.create({
      data: {
        id: randomUUID(),
        fullName: fullName.trim(),
        email: normalizedEmail,
        companyName: companyName?.trim() ?? null,
        phone: phone?.trim() ?? null,
        billingAddress: billingAddress?.trim() ?? null,
        shippingAddress: shippingAddress?.trim() ?? null,
        preferredContactMethod: preferredContactMethod ?? 'EMAIL',
        state: 'LEAD',
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
    });

    return jsonResponse(201, { customer: toCustomerResponse(customer) });
  },
  { requireAuth: false },
);

// ─── Update Customer Profile ─────────────────────────────────────────────────

const CONTACT_METHODS = new Set(['EMAIL', 'PHONE', 'SMS']);

interface UpdateCustomerBody {
  fullName?: string;
  email?: string;
  companyName?: string | null;
  phone?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  preferredContactMethod?: string;
  externalReference?: string | null;
}

export const updateCustomerHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Customer ID is required.' });

    const body = parseBody<UpdateCustomerBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const existing = await getPrisma().customer.findUnique({ where: { id } });
    if (!existing) return jsonResponse(404, { message: `Customer not found: ${id}` });

    const patch: Record<string, unknown> = {};

    if ('fullName' in body.value) {
      const fullName = body.value.fullName?.trim();
      if (!fullName) return jsonResponse(422, { message: 'fullName cannot be empty.' });
      patch.fullName = fullName;
    }

    if ('email' in body.value) {
      const email = body.value.email?.trim().toLowerCase();
      if (!email) return jsonResponse(422, { message: 'email cannot be empty.' });
      const duplicate = await getPrisma().customer.findFirst({
        where: {
          id: { not: id },
          email: { equals: email, mode: 'insensitive' },
          state: { not: 'ARCHIVED' },
        },
      });
      if (duplicate) {
        return jsonResponse(409, {
          message: `Customer with email ${email} already exists.`,
        });
      }
      patch.email = email;
    }

    if ('preferredContactMethod' in body.value) {
      const preferredContactMethod = body.value.preferredContactMethod?.trim().toUpperCase();
      if (!preferredContactMethod || !CONTACT_METHODS.has(preferredContactMethod)) {
        return jsonResponse(422, {
          message: 'preferredContactMethod must be EMAIL, PHONE, or SMS.',
        });
      }
      patch.preferredContactMethod = preferredContactMethod;
    }

    copyOptionalStringPatch(patch, body.value, 'companyName');
    copyOptionalStringPatch(patch, body.value, 'phone');
    copyOptionalStringPatch(patch, body.value, 'billingAddress');
    copyOptionalStringPatch(patch, body.value, 'shippingAddress');
    copyOptionalStringPatch(patch, body.value, 'externalReference');

    if (Object.keys(patch).length === 0) {
      return jsonResponse(422, { message: 'At least one profile field is required.' });
    }

    const updated = await getPrisma().customer.update({
      where: { id },
      data: {
        ...patch,
        updatedAt: new Date(),
        version: { increment: 1 },
      },
    });

    return jsonResponse(200, { customer: toCustomerResponse(updated) });
  },
  { requireAuth: false },
);

// ─── Transition Customer State ────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  LEAD: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['INACTIVE', 'ARCHIVED'],
  INACTIVE: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

export const transitionCustomerStateHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Customer ID is required.' });

    const body = parseBody<{ state: string }>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const { state: nextState } = body.value;
    if (!nextState) return jsonResponse(422, { message: 'state is required in body.' });

    const existing = await getPrisma().customer.findUnique({ where: { id } });
    if (!existing) return jsonResponse(404, { message: `Customer not found: ${id}` });

    const allowed = VALID_TRANSITIONS[existing.state as string] ?? [];
    if (!allowed.includes(nextState)) {
      return jsonResponse(409, {
        message: `Cannot transition from ${existing.state} to ${nextState}.`,
        allowedTransitions: allowed,
      });
    }

    const updated = await getPrisma().customer.update({
      where: { id },
      data: {
        state: nextState as 'LEAD' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED',
        updatedAt: new Date(),
        ...(nextState === 'ARCHIVED' ? { archivedAt: new Date() } : {}),
        version: { increment: 1 },
      },
    });

    return jsonResponse(200, { customer: toCustomerResponse(updated) });
  },
  { requireAuth: false },
);

// ─── Response mapper ──────────────────────────────────────────────────────────

function toCustomerResponse(r: {
  id: string;
  state: string;
  fullName: string;
  companyName: string | null;
  email: string;
  phone: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  preferredContactMethod: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date | null;
  externalReference?: string | null;
}) {
  return {
    id: r.id,
    state: r.state,
    fullName: r.fullName,
    companyName: r.companyName ?? undefined,
    email: r.email,
    phone: r.phone ?? undefined,
    billingAddress: r.billingAddress ?? undefined,
    shippingAddress: r.shippingAddress ?? undefined,
    preferredContactMethod: r.preferredContactMethod,
    externalReference: (r.externalReference as string | null) ?? undefined,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    archivedAt: r.archivedAt?.toISOString(),
  };
}

function copyOptionalStringPatch(
  patch: Record<string, unknown>,
  body: UpdateCustomerBody,
  field: keyof Pick<
    UpdateCustomerBody,
    'companyName' | 'phone' | 'billingAddress' | 'shippingAddress' | 'externalReference'
  >,
): void {
  if (!(field in body)) return;
  const value = body[field];
  patch[field] = value?.trim() ? value.trim() : null;
}

// ─── Entry-point type ─────────────────────────────────────────────────────────

export type Handler = (event: LambdaEvent) => Promise<LambdaResult>;
