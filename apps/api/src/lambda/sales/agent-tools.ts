/**
 * Tool definitions and executors for the Sales AI Copilot.
 * Each tool calls the ERP database directly (same VPC) rather than going through API Gateway.
 */
import { PrismaClient, Prisma } from '@prisma/client';

// Re-use singleton across warm Lambda invocations
let db: PrismaClient | undefined;
function getDb(): PrismaClient {
  db ??= new PrismaClient();
  return db;
}

// ---------------------------------------------------------------------------
// Tool specification for Bedrock Converse API
// ---------------------------------------------------------------------------

export const TOOL_CONFIG = {
  tools: [
    {
      toolSpec: {
        name: 'search_customers',
        description:
          'Search customers by name, email, or phone. Returns matching customers with their basic info and spend totals.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search term (name, email, or phone fragment)',
              },
            },
            required: ['query'],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'get_customer_history',
        description:
          'Get a customer\'s full history: work orders, quotes, opportunities, total spend, and last visit date.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              customer_id: { type: 'string', description: 'Customer UUID' },
            },
            required: ['customer_id'],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'search_inventory',
        description:
          'Search parts/inventory by name, SKU, or description. Returns stock levels and pricing.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search term (part name, SKU, or description)',
              },
            },
            required: ['query'],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'check_stock',
        description: 'Check current stock level, bin location, and reorder status for a specific part.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              part_id: { type: 'string', description: 'Part UUID' },
            },
            required: ['part_id'],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'get_opportunity',
        description: 'Get full details of a sales opportunity including activities, quotes, and customer info.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              opportunity_id: { type: 'string', description: 'Opportunity UUID' },
            },
            required: ['opportunity_id'],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'get_pipeline_overview',
        description:
          'Get sales pipeline statistics: counts and values by stage, win rate, average deal size, weighted forecast.',
        inputSchema: {
          json: { type: 'object', properties: {} },
        },
      },
    },
    {
      toolSpec: {
        name: 'create_draft_quote',
        description:
          'Create a new draft quote for a customer with line items. Returns the quote with a quote number.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              customer_id: { type: 'string', description: 'Customer UUID' },
              opportunity_id: {
                type: 'string',
                description: 'Optional opportunity UUID to link the quote to',
              },
              lines: {
                type: 'array',
                description: 'Line items for the quote',
                items: {
                  type: 'object',
                  properties: {
                    part_id: { type: 'string', description: 'Part UUID (optional)' },
                    description: { type: 'string', description: 'Line item description' },
                    quantity: { type: 'number', description: 'Quantity' },
                    unit_price: { type: 'number', description: 'Price per unit in dollars' },
                    discount_percent: { type: 'number', description: 'Discount percentage (0-100)' },
                  },
                  required: ['description', 'quantity', 'unit_price'],
                },
              },
              valid_days: {
                type: 'number',
                description: 'Number of days the quote is valid (default 30)',
              },
            },
            required: ['customer_id', 'lines'],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'log_activity',
        description:
          'Log a sales activity (note, call, email, meeting, follow-up) on an opportunity or customer.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              opportunity_id: { type: 'string', description: 'Opportunity UUID (optional)' },
              customer_id: { type: 'string', description: 'Customer UUID (optional)' },
              type: {
                type: 'string',
                enum: ['NOTE', 'CALL', 'EMAIL', 'MEETING', 'FOLLOW_UP'],
                description: 'Activity type',
              },
              subject: { type: 'string', description: 'Brief subject line' },
              body: { type: 'string', description: 'Detailed notes' },
            },
            required: ['type', 'subject'],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'suggest_pricing',
        description:
          'Get pricing suggestions for a part based on list price, recent quote history, and customer loyalty.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              part_id: { type: 'string', description: 'Part UUID' },
              quantity: { type: 'number', description: 'Quantity being quoted' },
              customer_id: { type: 'string', description: 'Customer UUID for loyalty-based pricing' },
            },
            required: ['part_id', 'quantity'],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'draft_follow_up_email',
        description:
          'Draft a follow-up email for a customer based on their recent activity and opportunity status.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              customer_id: { type: 'string', description: 'Customer UUID' },
              opportunity_id: { type: 'string', description: 'Opportunity UUID (optional)' },
              tone: {
                type: 'string',
                enum: ['friendly', 'professional', 'urgent'],
                description: 'Email tone',
              },
              context: { type: 'string', description: 'Additional context for the email' },
            },
            required: ['customer_id'],
          },
        },
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Tool executors
// ---------------------------------------------------------------------------

type ToolInput = Record<string, unknown>;

export async function executeTool(
  name: string,
  input: ToolInput,
  userId: string
): Promise<unknown> {
  switch (name) {
    case 'search_customers':
      return searchCustomers(input.query as string);
    case 'get_customer_history':
      return getCustomerHistory(input.customer_id as string);
    case 'search_inventory':
      return searchInventory(input.query as string);
    case 'check_stock':
      return checkStock(input.part_id as string);
    case 'get_opportunity':
      return getOpportunity(input.opportunity_id as string);
    case 'get_pipeline_overview':
      return getPipelineOverview();
    case 'create_draft_quote':
      return createDraftQuote(input, userId);
    case 'log_activity':
      return logActivity(input, userId);
    case 'suggest_pricing':
      return suggestPricing(input);
    case 'draft_follow_up_email':
      return draftFollowUpEmail(input);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// Individual tool implementations
// ---------------------------------------------------------------------------

async function searchCustomers(query: string) {
  const prisma = getDb();
  const customers = await prisma.customer.findMany({
    where: {
      OR: [
        { firstName: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
        { lastName: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
        { email: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
        { phone: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
        { companyName: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
      ],
    },
    take: 10,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      companyName: true,
      customerType: true,
      lifecycleStatus: true,
    },
  });

  return {
    count: customers.length,
    customers: customers.map((c) => ({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`.trim(),
      email: c.email,
      phone: c.phone,
      company: c.companyName,
      type: c.customerType,
      status: c.lifecycleStatus,
    })),
  };
}

async function getCustomerHistory(customerId: string) {
  const prisma = getDb();
  const [customer, opportunities, quotes, workOrders] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        companyName: true,
        customerType: true,
        lifecycleStatus: true,
        createdAt: true,
      },
    }),
    prisma.salesOpportunity.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        stage: true,
        estimatedValue: true,
        createdAt: true,
      },
    }),
    prisma.quote.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        quoteNumber: true,
        status: true,
        total: true,
        createdAt: true,
      },
    }),
    prisma.workOrder.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        workOrderNumber: true,
        state: true,
        createdAt: true,
      },
    }),
  ]);

  if (!customer) return { error: 'Customer not found' };

  const totalQuoteValue = quotes.reduce(
    (sum, q) => sum + (q.total ? Number(q.total) : 0),
    0
  );

  return {
    customer: {
      ...customer,
      name: `${customer.firstName} ${customer.lastName}`.trim(),
    },
    summary: {
      totalOpportunities: opportunities.length,
      totalQuotes: quotes.length,
      totalWorkOrders: workOrders.length,
      totalQuoteValue,
    },
    recentOpportunities: opportunities,
    recentQuotes: quotes,
    recentWorkOrders: workOrders,
  };
}

async function searchInventory(query: string) {
  const prisma = getDb();
  const parts = await prisma.part.findMany({
    where: {
      OR: [
        { partName: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
        { sku: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
        { description: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
      ],
    },
    take: 15,
    select: {
      id: true,
      sku: true,
      partName: true,
      description: true,
      quantityOnHand: true,
      retailPrice: true,
      costPrice: true,
      binLocation: true,
      partState: true,
    },
  });

  return {
    count: parts.length,
    parts: parts.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.partName,
      description: p.description,
      inStock: p.quantityOnHand ?? 0,
      retailPrice: p.retailPrice ? Number(p.retailPrice) : null,
      costPrice: p.costPrice ? Number(p.costPrice) : null,
      bin: p.binLocation,
      state: p.partState,
    })),
  };
}

async function checkStock(partId: string) {
  const prisma = getDb();
  const part = await prisma.part.findUnique({
    where: { id: partId },
    select: {
      id: true,
      sku: true,
      partName: true,
      quantityOnHand: true,
      reorderPoint: true,
      reorderQuantity: true,
      binLocation: true,
      retailPrice: true,
      costPrice: true,
      partState: true,
    },
  });

  if (!part) return { error: 'Part not found' };

  const onHand = part.quantityOnHand ?? 0;
  const reorderPt = part.reorderPoint ?? 0;

  return {
    ...part,
    retailPrice: part.retailPrice ? Number(part.retailPrice) : null,
    costPrice: part.costPrice ? Number(part.costPrice) : null,
    needsReorder: onHand <= reorderPt,
    stockStatus: onHand === 0 ? 'OUT_OF_STOCK' : onHand <= reorderPt ? 'LOW' : 'IN_STOCK',
  };
}

async function getOpportunity(opportunityId: string) {
  const prisma = getDb();
  const opp = await prisma.salesOpportunity.findUnique({
    where: { id: opportunityId },
    include: {
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          companyName: true,
        },
      },
      quotes: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          quoteNumber: true,
          status: true,
          total: true,
          createdAt: true,
        },
      },
      activities: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          activityType: true,
          subject: true,
          body: true,
          createdAt: true,
        },
      },
    },
  });

  if (!opp) return { error: 'Opportunity not found' };

  return {
    id: opp.id,
    title: opp.title,
    description: opp.description,
    stage: opp.stage,
    probability: opp.probability,
    estimatedValue: opp.estimatedValue ? Number(opp.estimatedValue) : null,
    expectedCloseDate: opp.expectedCloseDate,
    source: opp.source,
    lostReason: opp.lostReason,
    customer: {
      ...opp.customer,
      name: `${opp.customer.firstName} ${opp.customer.lastName}`.trim(),
    },
    quotes: opp.quotes,
    recentActivities: opp.activities,
    createdAt: opp.createdAt,
    updatedAt: opp.updatedAt,
  };
}

async function getPipelineOverview() {
  const prisma = getDb();
  const stages = ['PROSPECT', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];

  const opportunities = await prisma.salesOpportunity.findMany({
    select: {
      stage: true,
      estimatedValue: true,
      probability: true,
    },
  });

  const byStage = stages.map((stage) => {
    const stageOpps = opportunities.filter((o) => o.stage === stage);
    const value = stageOpps.reduce((s, o) => s + (o.estimatedValue ? Number(o.estimatedValue) : 0), 0);
    return { stage, count: stageOpps.length, totalValue: value };
  });

  const active = opportunities.filter((o) => !['CLOSED_WON', 'CLOSED_LOST'].includes(o.stage));
  const won = opportunities.filter((o) => o.stage === 'CLOSED_WON');
  const closed = opportunities.filter((o) => ['CLOSED_WON', 'CLOSED_LOST'].includes(o.stage));

  const totalValue = active.reduce(
    (s, o) => s + (o.estimatedValue ? Number(o.estimatedValue) : 0),
    0
  );
  const weightedForecast = active.reduce(
    (s, o) => s + (o.estimatedValue ? Number(o.estimatedValue) : 0) * ((o.probability ?? 0) / 100),
    0
  );

  return {
    totalActive: active.length,
    totalValue,
    weightedForecast,
    winRate: closed.length > 0 ? Math.round((won.length / closed.length) * 100) : 0,
    avgDealSize: won.length > 0 ? Math.round(totalValue / won.length) : 0,
    byStage,
  };
}

async function createDraftQuote(input: ToolInput, userId: string) {
  const prisma = getDb();
  const customerId = input.customer_id as string;
  const opportunityId = input.opportunity_id as string | undefined;
  const lines = input.lines as Array<{
    part_id?: string;
    description: string;
    quantity: number;
    unit_price: number;
    discount_percent?: number;
  }>;
  const validDays = (input.valid_days as number) || 30;

  const count = await prisma.quote.count();
  const quoteNumber = `Q-${String(count + 1).padStart(5, '0')}`;

  const quoteLines = lines.map((line) => {
    const discount = line.discount_percent ?? 0;
    const lineTotal = line.quantity * line.unit_price * (1 - discount / 100);
    return {
      partId: line.part_id || null,
      description: line.description,
      quantity: line.quantity,
      unitPrice: new Prisma.Decimal(line.unit_price),
      discountPercent: new Prisma.Decimal(discount),
      lineTotal: new Prisma.Decimal(lineTotal),
    };
  });

  const subtotal = quoteLines.reduce((s, l) => s + Number(l.lineTotal), 0);
  const taxRate = 0.07;
  const taxAmount = subtotal * taxRate;
  const total = subtotal + taxAmount;

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + validDays);

  const quote = await prisma.quote.create({
    data: {
      quoteNumber,
      customerId,
      opportunityId: opportunityId || null,
      status: 'DRAFT',
      subtotal: new Prisma.Decimal(subtotal),
      taxRate: new Prisma.Decimal(taxRate),
      taxAmount: new Prisma.Decimal(taxAmount),
      total: new Prisma.Decimal(total),
      validUntil,
      createdByUserId: userId,
      lines: { create: quoteLines },
    },
    include: { lines: true },
  });

  return {
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    status: quote.status,
    subtotal: Number(quote.subtotal),
    taxAmount: Number(quote.taxAmount),
    total: Number(quote.total),
    validUntil: quote.validUntil,
    lineCount: quote.lines.length,
    message: `Draft quote ${quoteNumber} created with ${quote.lines.length} line items totaling $${Number(quote.total).toFixed(2)}.`,
  };
}

async function logActivity(input: ToolInput, userId: string) {
  const prisma = getDb();

  const activity = await prisma.salesActivity.create({
    data: {
      opportunityId: (input.opportunity_id as string) || null,
      customerId: (input.customer_id as string) || null,
      activityType: input.type as string,
      subject: input.subject as string,
      body: (input.body as string) || null,
      performedByUserId: userId,
    },
  });

  return {
    id: activity.id,
    type: activity.activityType,
    subject: activity.subject,
    message: `Activity logged: ${activity.activityType} — "${activity.subject}"`,
  };
}

async function suggestPricing(input: ToolInput) {
  const prisma = getDb();
  const partId = input.part_id as string;
  const quantity = input.quantity as number;
  const customerId = input.customer_id as string | undefined;

  const part = await prisma.part.findUnique({
    where: { id: partId },
    select: {
      id: true,
      partName: true,
      retailPrice: true,
      costPrice: true,
    },
  });

  if (!part) return { error: 'Part not found' };

  const retail = part.retailPrice ? Number(part.retailPrice) : 0;
  const cost = part.costPrice ? Number(part.costPrice) : 0;
  const margin = retail > 0 ? ((retail - cost) / retail) * 100 : 0;

  // Volume discount tiers
  let volumeDiscount = 0;
  if (quantity >= 20) volumeDiscount = 15;
  else if (quantity >= 10) volumeDiscount = 10;
  else if (quantity >= 5) volumeDiscount = 5;

  // Customer loyalty discount (based on past quote count)
  let loyaltyDiscount = 0;
  if (customerId) {
    const quoteCount = await prisma.quote.count({
      where: { customerId, status: { in: ['ACCEPTED', 'CONVERTED'] } },
    });
    if (quoteCount >= 10) loyaltyDiscount = 10;
    else if (quoteCount >= 5) loyaltyDiscount = 5;
    else if (quoteCount >= 2) loyaltyDiscount = 3;
  }

  const totalDiscount = Math.min(volumeDiscount + loyaltyDiscount, 25);
  const suggestedPrice = retail * (1 - totalDiscount / 100);
  const suggestedMargin = suggestedPrice > 0 ? ((suggestedPrice - cost) / suggestedPrice) * 100 : 0;

  return {
    part: part.partName,
    listPrice: retail,
    costPrice: cost,
    standardMargin: Math.round(margin),
    volumeDiscount,
    loyaltyDiscount,
    totalDiscount,
    suggestedPrice: Math.round(suggestedPrice * 100) / 100,
    suggestedMargin: Math.round(suggestedMargin),
    lineTotal: Math.round(suggestedPrice * quantity * 100) / 100,
  };
}

async function draftFollowUpEmail(input: ToolInput) {
  const prisma = getDb();
  const customerId = input.customer_id as string;
  const opportunityId = input.opportunity_id as string | undefined;
  const tone = (input.tone as string) || 'professional';
  const context = (input.context as string) || '';

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { firstName: true, lastName: true, email: true, companyName: true },
  });

  if (!customer) return { error: 'Customer not found' };

  let oppContext = '';
  if (opportunityId) {
    const opp = await prisma.salesOpportunity.findUnique({
      where: { id: opportunityId },
      select: { title: true, stage: true, estimatedValue: true },
    });
    if (opp) {
      oppContext = `Opportunity: "${opp.title}" (${opp.stage}, est. $${opp.estimatedValue ? Number(opp.estimatedValue).toLocaleString() : 'N/A'})`;
    }
  }

  // Return context for the AI to compose the email (the main agent will write it)
  return {
    customerName: `${customer.firstName} ${customer.lastName}`.trim(),
    customerEmail: customer.email,
    company: customer.companyName,
    opportunityContext: oppContext,
    requestedTone: tone,
    additionalContext: context,
    instruction:
      'Use this information to compose a personalized follow-up email. Return the full email with subject line and body.',
  };
}
