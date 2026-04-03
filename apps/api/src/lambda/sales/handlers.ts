import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';

// ---------------------------------------------------------------------------
// Prisma singleton
// ---------------------------------------------------------------------------

let salesPrisma: PrismaClient | undefined;

function getSalesPrisma(): PrismaClient {
  salesPrisma ??= new PrismaClient();
  return salesPrisma;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAGE_PROBABILITY: Record<string, number> = {
  PROSPECT: 10,
  QUALIFIED: 25,
  PROPOSAL: 50,
  NEGOTIATION: 75,
  CLOSED_WON: 100,
  CLOSED_LOST: 0,
};

const STAGE_ORDER = [
  'PROSPECT',
  'QUALIFIED',
  'PROPOSAL',
  'NEGOTIATION',
  'CLOSED_WON',
  'CLOSED_LOST',
] as const;

/** Forward-only transitions; CLOSED_LOST reachable from any non-closed stage. */
const VALID_STAGE_TRANSITIONS: Record<string, string[]> = {
  PROSPECT: ['QUALIFIED', 'CLOSED_LOST'],
  QUALIFIED: ['PROPOSAL', 'CLOSED_LOST'],
  PROPOSAL: ['NEGOTIATION', 'CLOSED_LOST'],
  NEGOTIATION: ['CLOSED_WON', 'CLOSED_LOST'],
  CLOSED_WON: [],
  CLOSED_LOST: [],
};

// ---------------------------------------------------------------------------
// Response mappers
// ---------------------------------------------------------------------------

function toOpportunityResponse(r: Record<string, unknown>) {
  return {
    ...r,
    estimatedValue: r.estimatedValue != null ? Number(r.estimatedValue) : null,
  };
}

function toQuoteResponse(r: Record<string, unknown>) {
  return {
    ...r,
    subtotal: Number(r.subtotal),
    taxRate: Number(r.taxRate),
    taxAmount: Number(r.taxAmount),
    total: Number(r.total),
    ...(Array.isArray(r.lines)
      ? {
          lines: (r.lines as Record<string, unknown>[]).map(toQuoteLineResponse),
        }
      : {}),
  };
}

function toQuoteLineResponse(l: Record<string, unknown>) {
  return {
    ...l,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    discountPercent: Number(l.discountPercent),
    lineTotal: Number(l.lineTotal),
  };
}

// ---------------------------------------------------------------------------
// Opportunity handlers
// ---------------------------------------------------------------------------

export const listOpportunitiesHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const limit = Math.min(parseInt(qs.limit ?? '50', 10), 200);
    const offset = parseInt(qs.offset ?? '0', 10);

    const where: Record<string, unknown> = {};
    if (qs.stage) where.stage = qs.stage;
    if (qs.assignedToUserId) where.assignedToUserId = qs.assignedToUserId;
    if (qs.customerId) where.customerId = qs.customerId;
    if (qs.search) {
      where.title = { contains: qs.search, mode: 'insensitive' as const };
    }

    const prisma = getSalesPrisma();
    const [items, total] = await Promise.all([
      prisma.salesOpportunity.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.salesOpportunity.count({ where }),
    ]);

    return jsonResponse(200, {
      items: items.map(toOpportunityResponse),
      total,
      limit,
      offset,
    });
  },
  { requireAuth: false },
);

export const getOpportunityHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Opportunity ID is required.' });

    const opp = await getSalesPrisma().salesOpportunity.findUnique({
      where: { id },
      include: { quotes: true, activities: { orderBy: { createdAt: 'desc' } } },
    });
    if (!opp) return jsonResponse(404, { message: `Opportunity not found: ${id}` });

    const mapped = toOpportunityResponse(opp as unknown as Record<string, unknown>);
    if (Array.isArray(opp.quotes)) {
      (mapped as Record<string, unknown>).quotes = opp.quotes.map((q) =>
        toQuoteResponse(q as unknown as Record<string, unknown>),
      );
    }

    return jsonResponse(200, { opportunity: mapped });
  },
  { requireAuth: false },
);

interface CreateOpportunityBody {
  customerId: string;
  title: string;
  description?: string;
  stage?: string;
  estimatedValue?: number;
  expectedCloseDate?: string;
  assignedToUserId?: string;
  source?: string;
}

export const createOpportunityHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<CreateOpportunityBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const { customerId, title, description, stage, estimatedValue, expectedCloseDate, assignedToUserId, source } =
      body.value;

    if (!customerId?.trim()) return jsonResponse(422, { message: 'customerId is required.' });
    if (!title?.trim()) return jsonResponse(422, { message: 'title is required.' });

    const resolvedStage = stage ?? 'PROSPECT';
    if (!(resolvedStage in STAGE_PROBABILITY)) {
      return jsonResponse(422, { message: `Invalid stage: ${resolvedStage}` });
    }

    const now = new Date();
    const opp = await getSalesPrisma().salesOpportunity.create({
      data: {
        id: randomUUID(),
        customerId: customerId.trim(),
        title: title.trim(),
        description: description?.trim() ?? null,
        stage: resolvedStage as 'PROSPECT',
        probability: STAGE_PROBABILITY[resolvedStage],
        estimatedValue: estimatedValue ?? null,
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
        assignedToUserId: assignedToUserId ?? null,
        source: (source ?? 'OTHER') as 'OTHER',
        createdAt: now,
        updatedAt: now,
      },
    });

    return jsonResponse(201, { opportunity: toOpportunityResponse(opp as unknown as Record<string, unknown>) });
  },
  { requireAuth: true },
);

interface UpdateOpportunityBody {
  title?: string;
  description?: string;
  estimatedValue?: number;
  expectedCloseDate?: string;
  assignedToUserId?: string | null;
  source?: string;
}

export const updateOpportunityHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Opportunity ID is required.' });

    const body = parseBody<UpdateOpportunityBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const existing = await getSalesPrisma().salesOpportunity.findUnique({ where: { id } });
    if (!existing) return jsonResponse(404, { message: `Opportunity not found: ${id}` });

    const { title, description, estimatedValue, expectedCloseDate, assignedToUserId, source } = body.value;
    const data: Record<string, unknown> = { updatedAt: new Date(), version: { increment: 1 } };

    if (title !== undefined) data.title = title.trim();
    if (description !== undefined) data.description = description?.trim() ?? null;
    if (estimatedValue !== undefined) data.estimatedValue = estimatedValue;
    if (expectedCloseDate !== undefined) {
      data.expectedCloseDate = expectedCloseDate ? new Date(expectedCloseDate) : null;
    }
    if (assignedToUserId !== undefined) data.assignedToUserId = assignedToUserId;
    if (source !== undefined) data.source = source as 'OTHER';

    const updated = await getSalesPrisma().salesOpportunity.update({ where: { id }, data });
    return jsonResponse(200, { opportunity: toOpportunityResponse(updated as unknown as Record<string, unknown>) });
  },
  { requireAuth: true },
);

interface TransitionStageBody {
  stage: string;
  lostReason?: string;
  wonWorkOrderId?: string;
}

export const transitionOpportunityStageHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Opportunity ID is required.' });

    const body = parseBody<TransitionStageBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const { stage: nextStage, lostReason, wonWorkOrderId } = body.value;
    if (!nextStage) return jsonResponse(422, { message: 'stage is required.' });

    if (!(nextStage in STAGE_PROBABILITY)) {
      return jsonResponse(422, { message: `Invalid stage: ${nextStage}` });
    }

    const prisma = getSalesPrisma();
    const existing = await prisma.salesOpportunity.findUnique({ where: { id } });
    if (!existing) return jsonResponse(404, { message: `Opportunity not found: ${id}` });

    const allowed = VALID_STAGE_TRANSITIONS[existing.stage] ?? [];
    if (!allowed.includes(nextStage)) {
      return jsonResponse(409, {
        message: `Cannot transition from ${existing.stage} to ${nextStage}.`,
        allowedTransitions: allowed,
      });
    }

    const now = new Date();
    const data: Record<string, unknown> = {
      stage: nextStage as 'PROSPECT',
      probability: STAGE_PROBABILITY[nextStage],
      updatedAt: now,
      version: { increment: 1 },
    };

    if (nextStage === 'CLOSED_LOST' && lostReason) data.lostReason = lostReason;
    if (nextStage === 'CLOSED_WON' && wonWorkOrderId) data.wonWorkOrderId = wonWorkOrderId;

    const [updated] = await Promise.all([
      prisma.salesOpportunity.update({ where: { id }, data }),
      prisma.salesActivity.create({
        data: {
          id: randomUUID(),
          opportunityId: id,
          customerId: existing.customerId,
          activityType: 'STAGE_CHANGE' as const,
          subject: `Stage changed from ${existing.stage} to ${nextStage}`,
          createdByUserId: ctx.actorUserId ?? null,
          createdAt: now,
        },
      }),
    ]);

    return jsonResponse(200, { opportunity: toOpportunityResponse(updated as unknown as Record<string, unknown>) });
  },
  { requireAuth: true },
);

// ---------------------------------------------------------------------------
// Quote helpers
// ---------------------------------------------------------------------------

function generateQuoteNumber(): string {
  const d = new Date();
  const ymd = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('');
  const hex = randomUUID().replace(/-/g, '').slice(0, 4);
  return `Q-${ymd}-${hex}`;
}

function computeLineTotal(qty: number, price: number, discountPct: number): number {
  return qty * price * (1 - discountPct / 100);
}

// ---------------------------------------------------------------------------
// Quote handlers
// ---------------------------------------------------------------------------

export const listQuotesHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const limit = Math.min(parseInt(qs.limit ?? '50', 10), 200);
    const offset = parseInt(qs.offset ?? '0', 10);

    const where: Record<string, unknown> = {};
    if (qs.status) where.status = qs.status;
    if (qs.customerId) where.customerId = qs.customerId;
    if (qs.opportunityId) where.opportunityId = qs.opportunityId;

    const prisma = getSalesPrisma();
    const [items, total] = await Promise.all([
      prisma.quote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.quote.count({ where }),
    ]);

    return jsonResponse(200, {
      items: items.map((q) => toQuoteResponse(q as unknown as Record<string, unknown>)),
      total,
      limit,
      offset,
    });
  },
  { requireAuth: false },
);

export const getQuoteHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Quote ID is required.' });

    const quote = await getSalesPrisma().quote.findUnique({
      where: { id },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!quote) return jsonResponse(404, { message: `Quote not found: ${id}` });

    return jsonResponse(200, { quote: toQuoteResponse(quote as unknown as Record<string, unknown>) });
  },
  { requireAuth: false },
);

interface CreateQuoteBody {
  customerId: string;
  opportunityId?: string;
  notes?: string;
  termsAndConditions?: string;
  validUntil?: string;
  lines?: Array<{
    partId?: string;
    description: string;
    quantity: number;
    unitPrice: number;
    discountPercent?: number;
  }>;
}

export const createQuoteHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<CreateQuoteBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const { customerId, opportunityId, notes, termsAndConditions, validUntil, lines } = body.value;
    if (!customerId?.trim()) return jsonResponse(422, { message: 'customerId is required.' });

    // Validate opportunity exists if provided
    if (opportunityId) {
      const opp = await getSalesPrisma().salesOpportunity.findUnique({ where: { id: opportunityId } });
      if (!opp) return jsonResponse(404, { message: `Opportunity not found: ${opportunityId}` });
    }

    const quoteLines = (lines ?? []).map((l, idx) => {
      const discPct = l.discountPercent ?? 0;
      const lineTotal = computeLineTotal(l.quantity, l.unitPrice, discPct);
      return {
        id: randomUUID(),
        partId: l.partId ?? null,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: discPct,
        lineTotal,
        sortOrder: idx,
      };
    });

    const subtotal = quoteLines.reduce((sum, l) => sum + l.lineTotal, 0);
    const taxRate = 0;
    const taxAmount = subtotal * taxRate;
    const total = subtotal + taxAmount;
    const now = new Date();

    const quote = await getSalesPrisma().quote.create({
      data: {
        id: randomUUID(),
        quoteNumber: generateQuoteNumber(),
        opportunityId: opportunityId ?? null,
        customerId: customerId.trim(),
        status: 'DRAFT' as const,
        subtotal,
        taxRate,
        taxAmount,
        total,
        validUntil: validUntil ? new Date(validUntil) : null,
        notes: notes ?? null,
        termsAndConditions: termsAndConditions ?? null,
        createdByUserId: ctx.actorUserId ?? null,
        createdAt: now,
        updatedAt: now,
        lines: { create: quoteLines },
      },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });

    return jsonResponse(201, { quote: toQuoteResponse(quote as unknown as Record<string, unknown>) });
  },
  { requireAuth: true },
);

interface UpdateQuoteBody {
  notes?: string;
  termsAndConditions?: string;
  validUntil?: string;
  taxRate?: number;
}

export const updateQuoteHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Quote ID is required.' });

    const body = parseBody<UpdateQuoteBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const existing = await getSalesPrisma().quote.findUnique({ where: { id } });
    if (!existing) return jsonResponse(404, { message: `Quote not found: ${id}` });
    if (existing.status !== 'DRAFT') {
      return jsonResponse(409, { message: 'Only DRAFT quotes can be updated.' });
    }

    const { notes, termsAndConditions, validUntil, taxRate } = body.value;
    const data: Record<string, unknown> = { updatedAt: new Date(), version: { increment: 1 } };

    if (notes !== undefined) data.notes = notes;
    if (termsAndConditions !== undefined) data.termsAndConditions = termsAndConditions;
    if (validUntil !== undefined) data.validUntil = validUntil ? new Date(validUntil) : null;

    if (taxRate !== undefined) {
      const subtotalNum = Number(existing.subtotal);
      data.taxRate = taxRate;
      data.taxAmount = subtotalNum * taxRate;
      data.total = subtotalNum + subtotalNum * taxRate;
    }

    const updated = await getSalesPrisma().quote.update({ where: { id }, data });
    return jsonResponse(200, { quote: toQuoteResponse(updated as unknown as Record<string, unknown>) });
  },
  { requireAuth: true },
);

interface UpdateQuoteLinesBody {
  lines: Array<{
    partId?: string;
    description: string;
    quantity: number;
    unitPrice: number;
    discountPercent?: number;
  }>;
}

export const updateQuoteLinesHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Quote ID is required.' });

    const body = parseBody<UpdateQuoteLinesBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    if (!Array.isArray(body.value.lines)) {
      return jsonResponse(422, { message: 'lines array is required.' });
    }

    const prisma = getSalesPrisma();
    const existing = await prisma.quote.findUnique({ where: { id } });
    if (!existing) return jsonResponse(404, { message: `Quote not found: ${id}` });
    if (existing.status !== 'DRAFT') {
      return jsonResponse(409, { message: 'Only DRAFT quotes can have lines updated.' });
    }

    const newLines = body.value.lines.map((l, idx) => {
      const discPct = l.discountPercent ?? 0;
      const lineTotal = computeLineTotal(l.quantity, l.unitPrice, discPct);
      return {
        id: randomUUID(),
        quoteId: id,
        partId: l.partId ?? null,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: discPct,
        lineTotal,
        sortOrder: idx,
      };
    });

    const subtotal = newLines.reduce((sum, l) => sum + l.lineTotal, 0);
    const taxRateNum = Number(existing.taxRate);
    const taxAmount = subtotal * taxRateNum;
    const total = subtotal + taxAmount;

    const quote = await prisma.$transaction(async (tx) => {
      await tx.quoteLine.deleteMany({ where: { quoteId: id } });
      await tx.quoteLine.createMany({ data: newLines });
      return tx.quote.update({
        where: { id },
        data: { subtotal, taxAmount, total, updatedAt: new Date(), version: { increment: 1 } },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    return jsonResponse(200, { quote: toQuoteResponse(quote as unknown as Record<string, unknown>) });
  },
  { requireAuth: true },
);

export const sendQuoteHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Quote ID is required.' });

    const prisma = getSalesPrisma();
    const existing = await prisma.quote.findUnique({ where: { id } });
    if (!existing) return jsonResponse(404, { message: `Quote not found: ${id}` });
    if (existing.status !== 'DRAFT') {
      return jsonResponse(409, { message: 'Only DRAFT quotes can be sent.' });
    }

    const now = new Date();
    const validUntil = existing.validUntil ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [updated] = await Promise.all([
      prisma.quote.update({
        where: { id },
        data: { status: 'SENT' as const, validUntil, updatedAt: now, version: { increment: 1 } },
      }),
      existing.opportunityId
        ? prisma.salesActivity.create({
            data: {
              id: randomUUID(),
              opportunityId: existing.opportunityId,
              customerId: existing.customerId,
              activityType: 'QUOTE_SENT' as const,
              subject: `Quote ${existing.quoteNumber} sent`,
              createdByUserId: ctx.actorUserId ?? null,
              createdAt: now,
            },
          })
        : Promise.resolve(null),
    ]);

    return jsonResponse(200, { quote: toQuoteResponse(updated as unknown as Record<string, unknown>) });
  },
  { requireAuth: true },
);

export const acceptQuoteHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Quote ID is required.' });

    const prisma = getSalesPrisma();
    const existing = await prisma.quote.findUnique({ where: { id } });
    if (!existing) return jsonResponse(404, { message: `Quote not found: ${id}` });
    if (existing.status !== 'SENT') {
      return jsonResponse(409, { message: 'Only SENT quotes can be accepted.' });
    }

    const now = new Date();
    const updated = await prisma.quote.update({
      where: { id },
      data: { status: 'ACCEPTED' as const, approvedByUserId: ctx.actorUserId ?? null, updatedAt: now, version: { increment: 1 } },
    });

    // Auto-transition linked opportunity to CLOSED_WON
    if (existing.opportunityId) {
      const opp = await prisma.salesOpportunity.findUnique({ where: { id: existing.opportunityId } });
      if (opp && opp.stage !== 'CLOSED_WON' && opp.stage !== 'CLOSED_LOST') {
        await Promise.all([
          prisma.salesOpportunity.update({
            where: { id: existing.opportunityId },
            data: {
              stage: 'CLOSED_WON' as const,
              probability: 100,
              updatedAt: now,
              version: { increment: 1 },
            },
          }),
          prisma.salesActivity.create({
            data: {
              id: randomUUID(),
              opportunityId: existing.opportunityId,
              customerId: existing.customerId,
              activityType: 'STAGE_CHANGE' as const,
              subject: `Stage changed to CLOSED_WON (quote ${existing.quoteNumber} accepted)`,
              createdByUserId: ctx.actorUserId ?? null,
              createdAt: now,
            },
          }),
        ]);
      }
    }

    return jsonResponse(200, { quote: toQuoteResponse(updated as unknown as Record<string, unknown>) });
  },
  { requireAuth: true },
);

interface RejectQuoteBody {
  reason?: string;
}

export const rejectQuoteHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Quote ID is required.' });

    const body = parseBody<RejectQuoteBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const prisma = getSalesPrisma();
    const existing = await prisma.quote.findUnique({ where: { id } });
    if (!existing) return jsonResponse(404, { message: `Quote not found: ${id}` });
    if (existing.status !== 'SENT') {
      return jsonResponse(409, { message: 'Only SENT quotes can be rejected.' });
    }

    const now = new Date();
    const updated = await prisma.quote.update({
      where: { id },
      data: { status: 'REJECTED' as const, updatedAt: now, version: { increment: 1 } },
    });

    if (existing.opportunityId) {
      await prisma.salesActivity.create({
        data: {
          id: randomUUID(),
          opportunityId: existing.opportunityId,
          customerId: existing.customerId,
          activityType: 'NOTE' as const,
          subject: `Quote ${existing.quoteNumber} rejected${body.value.reason ? `: ${body.value.reason}` : ''}`,
          createdByUserId: ctx.actorUserId ?? null,
          createdAt: now,
        },
      });
    }

    return jsonResponse(200, { quote: toQuoteResponse(updated as unknown as Record<string, unknown>) });
  },
  { requireAuth: true },
);

// ---------------------------------------------------------------------------
// Activity handlers
// ---------------------------------------------------------------------------

export const listActivitiesHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const limit = Math.min(parseInt(qs.limit ?? '50', 10), 200);
    const offset = parseInt(qs.offset ?? '0', 10);

    const where: Record<string, unknown> = {};
    if (qs.opportunityId) where.opportunityId = qs.opportunityId;
    if (qs.customerId) where.customerId = qs.customerId;
    if (qs.activityType) where.activityType = qs.activityType;

    const prisma = getSalesPrisma();
    const [items, total] = await Promise.all([
      prisma.salesActivity.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.salesActivity.count({ where }),
    ]);

    return jsonResponse(200, { items, total, limit, offset });
  },
  { requireAuth: false },
);

interface CreateActivityBody {
  opportunityId?: string;
  customerId?: string;
  activityType: string;
  subject: string;
  body?: string;
  dueDate?: string;
}

export const createActivityHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<CreateActivityBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const { opportunityId, customerId, activityType, subject, body: bodyText, dueDate } = body.value;

    if (!activityType) return jsonResponse(422, { message: 'activityType is required.' });
    if (!subject?.trim()) return jsonResponse(422, { message: 'subject is required.' });

    const validTypes = ['NOTE', 'CALL', 'EMAIL', 'MEETING', 'QUOTE_SENT', 'FOLLOW_UP', 'STAGE_CHANGE'];
    if (!validTypes.includes(activityType)) {
      return jsonResponse(422, { message: `Invalid activityType: ${activityType}` });
    }

    const now = new Date();
    const activity = await getSalesPrisma().salesActivity.create({
      data: {
        id: randomUUID(),
        opportunityId: opportunityId ?? null,
        customerId: customerId ?? null,
        activityType: activityType as 'NOTE',
        subject: subject.trim(),
        body: bodyText ?? null,
        dueDate: dueDate ? new Date(dueDate) : null,
        createdByUserId: ctx.actorUserId ?? null,
        createdAt: now,
      },
    });

    return jsonResponse(201, { activity });
  },
  { requireAuth: true },
);

// ---------------------------------------------------------------------------
// Dashboard / pipeline handlers
// ---------------------------------------------------------------------------

export const getPipelineStatsHandler = wrapHandler(
  async (_ctx) => {
    const prisma = getSalesPrisma();

    const openStages = ['PROSPECT', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION'] as const;
    const allOpps = await prisma.salesOpportunity.findMany({
      select: { stage: true, estimatedValue: true, probability: true },
    });

    const openOpps = allOpps.filter((o) => (openStages as readonly string[]).includes(o.stage));
    const closedWon = allOpps.filter((o) => o.stage === 'CLOSED_WON');
    const closedLost = allOpps.filter((o) => o.stage === 'CLOSED_LOST');

    const totalValue = openOpps.reduce((s, o) => s + Number(o.estimatedValue ?? 0), 0);
    const weightedForecast = openOpps.reduce(
      (s, o) => s + Number(o.estimatedValue ?? 0) * (o.probability / 100),
      0,
    );
    const avgDealSize = openOpps.length > 0 ? totalValue / openOpps.length : 0;
    const closedTotal = closedWon.length + closedLost.length;
    const winRate = closedTotal > 0 ? closedWon.length / closedTotal : 0;

    const byStageMap = new Map<string, { count: number; value: number }>();
    for (const stage of STAGE_ORDER) {
      byStageMap.set(stage, { count: 0, value: 0 });
    }
    for (const o of allOpps) {
      const entry = byStageMap.get(o.stage) ?? { count: 0, value: 0 };
      entry.count += 1;
      entry.value += Number(o.estimatedValue ?? 0);
      byStageMap.set(o.stage, entry);
    }

    const byStage = STAGE_ORDER.map((stage) => ({
      stage,
      ...byStageMap.get(stage)!,
    }));

    return jsonResponse(200, {
      totalOpportunities: openOpps.length,
      totalValue,
      weightedForecast,
      avgDealSize,
      winRate,
      byStage,
    });
  },
  { requireAuth: false },
);

export const getSalesForecastHandler = wrapHandler(
  async (_ctx) => {
    const prisma = getSalesPrisma();

    const openStages = ['PROSPECT', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION'] as const;
    const opps = await prisma.salesOpportunity.findMany({
      where: {
        stage: { in: [...openStages] },
        expectedCloseDate: { not: null },
      },
      select: { stage: true, estimatedValue: true, probability: true, expectedCloseDate: true },
    });

    const buckets = new Map<
      string,
      { weightedValue: number; dealCount: number; byStage: Record<string, number> }
    >();

    for (const o of opps) {
      if (!o.expectedCloseDate) continue;
      const d = new Date(o.expectedCloseDate);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const entry = buckets.get(month) ?? { weightedValue: 0, dealCount: 0, byStage: {} };
      const val = Number(o.estimatedValue ?? 0);
      entry.weightedValue += val * (o.probability / 100);
      entry.dealCount += 1;
      entry.byStage[o.stage] = (entry.byStage[o.stage] ?? 0) + 1;
      buckets.set(month, entry);
    }

    const forecast = Array.from(buckets.entries())
      .map(([month, data]) => ({ month, ...data }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return jsonResponse(200, { forecast });
  },
  { requireAuth: false },
);

export const getSalesDashboardHandler = wrapHandler(
  async (_ctx) => {
    const prisma = getSalesPrisma();

    const openStages = ['PROSPECT', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION'] as const;

    const [allOpps, recentActivities, topOpportunities] = await Promise.all([
      prisma.salesOpportunity.findMany({
        select: { stage: true, estimatedValue: true, probability: true },
      }),
      prisma.salesActivity.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.salesOpportunity.findMany({
        where: { stage: { in: [...openStages] } },
        orderBy: { estimatedValue: 'desc' },
        take: 5,
      }),
    ]);

    // Compute pipeline stats inline
    const openOpps = allOpps.filter((o) => (openStages as readonly string[]).includes(o.stage));
    const closedWon = allOpps.filter((o) => o.stage === 'CLOSED_WON');
    const closedLost = allOpps.filter((o) => o.stage === 'CLOSED_LOST');

    const totalValue = openOpps.reduce((s, o) => s + Number(o.estimatedValue ?? 0), 0);
    const weightedForecast = openOpps.reduce(
      (s, o) => s + Number(o.estimatedValue ?? 0) * (o.probability / 100),
      0,
    );
    const avgDealSize = openOpps.length > 0 ? totalValue / openOpps.length : 0;
    const closedTotal = closedWon.length + closedLost.length;
    const winRate = closedTotal > 0 ? closedWon.length / closedTotal : 0;

    const byStageMap = new Map<string, { count: number; value: number }>();
    for (const stage of STAGE_ORDER) {
      byStageMap.set(stage, { count: 0, value: 0 });
    }
    for (const o of allOpps) {
      const entry = byStageMap.get(o.stage) ?? { count: 0, value: 0 };
      entry.count += 1;
      entry.value += Number(o.estimatedValue ?? 0);
      byStageMap.set(o.stage, entry);
    }

    const pipelineStats = {
      totalOpportunities: openOpps.length,
      totalValue,
      weightedForecast,
      avgDealSize,
      winRate,
      byStage: STAGE_ORDER.map((stage) => ({ stage, ...byStageMap.get(stage)! })),
    };

    return jsonResponse(200, {
      pipelineStats,
      recentActivities,
      topOpportunities: topOpportunities.map((o) =>
        toOpportunityResponse(o as unknown as Record<string, unknown>),
      ),
    });
  },
  { requireAuth: false },
);
