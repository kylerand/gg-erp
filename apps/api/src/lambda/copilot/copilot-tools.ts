/**
 * Global ERP Copilot — Tool definitions for Bedrock Converse API.
 *
 * General-purpose tools that span the entire ERP: customers, inventory,
 * work orders, employees, training, sales, and more.
 */
import { PrismaClient, Prisma } from '@prisma/client';

type ToolInput = Record<string, unknown>;

let prisma: PrismaClient | undefined;
function getDb(): PrismaClient {
  prisma ??= new PrismaClient();
  return prisma;
}

// ---------------------------------------------------------------------------
// Tool definitions (Bedrock Converse format)
// ---------------------------------------------------------------------------

export const TOOL_CONFIG = {
  tools: [
    {
      toolSpec: {
        name: 'search_customers',
        description:
          'Search customers by name, email, phone, or company. Returns matching customers with lifecycle state.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search term (name, email, phone, or company)' },
            },
            required: ['query'],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'get_customer_detail',
        description:
          'Get full customer details including recent opportunities, quotes, and vehicles.',
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
        description: 'Search parts by name, SKU, or description. Returns stock availability.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search term (part name, SKU, or description)' },
            },
            required: ['query'],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'search_work_orders',
        description:
          'Search work orders by number, status, or vehicle. Returns matching work orders.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Work order number or keyword to search',
              },
              status: {
                type: 'string',
                description:
                  'Filter by status: DRAFT, READY, SCHEDULED, IN_PROGRESS, BLOCKED, COMPLETED, CANCELLED',
              },
            },
            required: [],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'get_work_order_detail',
        description:
          'Get full work order details including operations, parts, assignments, and status history.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              work_order_id: { type: 'string', description: 'Work order UUID' },
            },
            required: ['work_order_id'],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'search_employees',
        description:
          'Search employees by name, number, or skills. Returns matching employees with their skills.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Employee name, number, or skill to search' },
            },
            required: ['query'],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'get_dashboard_summary',
        description:
          'Get a high-level overview of the ERP: counts of active work orders, open opportunities, low-stock parts, pending tasks, etc.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'search_sales_pipeline',
        description:
          'Search sales opportunities by title, customer, or stage. Returns pipeline data.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search term for opportunities' },
              stage: {
                type: 'string',
                description:
                  'Filter by stage: PROSPECT, QUALIFIED, PROPOSAL, NEGOTIATION, CLOSED_WON, CLOSED_LOST',
              },
            },
            required: [],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'search_vehicles',
        description: 'Search vehicles by VIN, serial number, model, or customer.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'VIN, serial number, model code, or keyword' },
            },
            required: ['query'],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'get_training_status',
        description:
          'Get training/certification status for an employee or overview of all training assignments.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              employee_id: {
                type: 'string',
                description: 'Employee UUID (optional — omit for overview)',
              },
            },
            required: [],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'search_purchase_orders',
        description: 'Search purchase orders by PO number, vendor, or status.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'PO number, vendor name, or keyword' },
              status: {
                type: 'string',
                description:
                  'Filter by status: DRAFT, APPROVED, SENT, PARTIALLY_RECEIVED, RECEIVED, CANCELLED',
              },
            },
            required: [],
          },
        },
      },
    },
    {
      toolSpec: {
        name: 'run_custom_query',
        description:
          'Run a read-only database query to answer questions not covered by other tools. Use Prisma-style queries. Specify the model name and filters.',
        inputSchema: {
          json: {
            type: 'object',
            properties: {
              model: {
                type: 'string',
                description:
                  'Prisma model name: customer, part, workOrder, woOrder, employee, salesOpportunity, quote, vendor, cartVehicle, channel, notification, etc.',
              },
              operation: {
                type: 'string',
                description: 'Operation: count, findMany, aggregate',
              },
              where: {
                type: 'object',
                description: 'Prisma where clause as JSON',
              },
              take: { type: 'number', description: 'Limit results (default 20)' },
            },
            required: ['model', 'operation'],
          },
        },
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

export async function executeTool(
  toolName: string,
  input: ToolInput,
  _userId: string
): Promise<unknown> {
  switch (toolName) {
    case 'search_customers':
      return searchCustomers(input.query as string);
    case 'get_customer_detail':
      return getCustomerDetail(input.customer_id as string);
    case 'search_inventory':
      return searchInventory(input.query as string);
    case 'search_work_orders':
      return searchWorkOrders(input.query as string | undefined, input.status as string | undefined);
    case 'get_work_order_detail':
      return getWorkOrderDetail(input.work_order_id as string);
    case 'search_employees':
      return searchEmployees(input.query as string);
    case 'get_dashboard_summary':
      return getDashboardSummary();
    case 'search_sales_pipeline':
      return searchSalesPipeline(
        input.query as string | undefined,
        input.stage as string | undefined
      );
    case 'search_vehicles':
      return searchVehicles(input.query as string);
    case 'get_training_status':
      return getTrainingStatus(input.employee_id as string | undefined);
    case 'search_purchase_orders':
      return searchPurchaseOrders(
        input.query as string | undefined,
        input.status as string | undefined
      );
    case 'run_custom_query':
      return runCustomQuery(input);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function searchCustomers(query: string) {
  const db = getDb();
  const customers = await db.customer.findMany({
    where: {
      OR: [
        { fullName: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
        { email: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
        { phone: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
        { companyName: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
      ],
    },
    take: 15,
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      companyName: true,
      state: true,
      createdAt: true,
    },
  });
  return { count: customers.length, customers };
}

async function getCustomerDetail(customerId: string) {
  const db = getDb();
  const [customer, opportunities, quotes, vehicles] = await Promise.all([
    db.customer.findUnique({
      where: { id: customerId },
    }),
    db.salesOpportunity.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, title: true, stage: true, estimatedValue: true, createdAt: true },
    }),
    db.quote.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, quoteNumber: true, status: true, total: true, createdAt: true },
    }),
    db.cartVehicle.findMany({
      where: { customerId },
      take: 10,
      select: { id: true, vin: true, serialNumber: true, modelCode: true, state: true },
    }),
  ]);
  if (!customer) return { error: 'Customer not found' };
  return {
    customer,
    vehicles,
    recentOpportunities: opportunities,
    recentQuotes: quotes,
    totalQuoteValue: quotes.reduce((s, q) => s + (q.total ? Number(q.total) : 0), 0),
  };
}

async function searchInventory(query: string) {
  const db = getDb();
  const parts = await db.part.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
        { sku: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
        { description: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
      ],
    },
    take: 15,
    include: {
      stockLots: { where: { lotState: 'AVAILABLE' }, select: { id: true } },
    },
  });
  return {
    count: parts.length,
    parts: parts.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      availableStock: p.stockLots.length,
      state: p.partState,
      reorderPoint: Number(p.reorderPoint),
    })),
  };
}

async function searchWorkOrders(query?: string, status?: string) {
  const db = getDb();
  const where: Prisma.WoOrderWhereInput = {};

  if (query) {
    where.OR = [
      { workOrderNumber: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
      { title: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
      { customerReference: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
    ];
  }
  if (status) {
    where.status = status as Prisma.EnumWoStatusFilter;
  }

  const orders = await db.woOrder.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: {
      id: true,
      workOrderNumber: true,
      title: true,
      status: true,
      priority: true,
      dueAt: true,
      createdAt: true,
    },
  });
  return { count: orders.length, workOrders: orders };
}

async function getWorkOrderDetail(workOrderId: string) {
  const db = getDb();
  const wo = await db.woOrder.findUnique({
    where: { id: workOrderId },
    include: {
      operations: {
        select: {
          id: true,
          operationCode: true,
          operationName: true,
          sequenceNo: true,
          operationStatus: true,
          requiredSkillCode: true,
        },
        orderBy: { sequenceNo: 'asc' },
      },
      parts: {
        select: {
          id: true,
          partId: true,
          requestedQuantity: true,
          partStatus: true,
        },
      },
      statusHistory: {
        select: { fromStatus: true, toStatus: true, reasonCode: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });
  if (!wo) return { error: 'Work order not found' };
  return wo;
}

async function searchEmployees(query: string) {
  const db = getDb();
  const employees = await db.employee.findMany({
    where: {
      OR: [
        { firstName: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
        { lastName: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
        { employeeNumber: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
      ],
    },
    take: 15,
    include: {
      skills: { select: { skillCode: true, proficiencyLevel: true, isCertified: true } },
      certifications: {
        select: {
          certificationCode: true,
          certificationName: true,
          certificationStatus: true,
          expiresAt: true,
        },
      },
    },
  });
  return {
    count: employees.length,
    employees: employees.map((e) => ({
      id: e.id,
      name: `${e.firstName} ${e.lastName}`,
      employeeNumber: e.employeeNumber,
      state: e.employmentState,
      skills: e.skills,
      certifications: e.certifications,
    })),
  };
}

async function getDashboardSummary() {
  const db = getDb();
  const [
    activeWorkOrders,
    blockedWorkOrders,
    openOpportunities,
    totalCustomers,
    activeParts,
    pendingPOs,
    overdueAssignments,
  ] = await Promise.all([
    db.woOrder.count({ where: { status: { in: ['IN_PROGRESS', 'SCHEDULED', 'READY'] } } }),
    db.woOrder.count({ where: { status: 'BLOCKED' } }),
    db.salesOpportunity.count({
      where: { stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] } },
    }),
    db.customer.count({ where: { state: 'ACTIVE' } }),
    db.part.count({ where: { partState: 'ACTIVE' } }),
    db.purchaseOrder.count({
      where: { purchaseOrderState: { in: ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'] } },
    }),
    db.trainingAssignment.count({
      where: { assignmentStatus: 'ASSIGNED', dueAt: { lt: new Date() } },
    }),
  ]);

  return {
    workOrders: { active: activeWorkOrders, blocked: blockedWorkOrders },
    sales: { openOpportunities },
    customers: { active: totalCustomers },
    inventory: { activeParts, pendingPurchaseOrders: pendingPOs },
    training: { overdueAssignments },
  };
}

async function searchSalesPipeline(query?: string, stage?: string) {
  const db = getDb();
  const where: Prisma.SalesOpportunityWhereInput = {};
  if (query) {
    where.OR = [
      { title: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
    ];
  }
  if (stage) {
    where.stage = stage as Prisma.EnumSalesOpportunityStageFilter;
  }

  const opps = await db.salesOpportunity.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: {
      id: true,
      title: true,
      stage: true,
      probability: true,
      estimatedValue: true,
      expectedCloseDate: true,
      customerId: true,
      createdAt: true,
    },
  });
  return { count: opps.length, opportunities: opps };
}

async function searchVehicles(query: string) {
  const db = getDb();
  const vehicles = await db.cartVehicle.findMany({
    where: {
      OR: [
        { vin: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
        { serialNumber: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
        { modelCode: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
      ],
    },
    take: 15,
    select: {
      id: true,
      vin: true,
      serialNumber: true,
      modelCode: true,
      modelYear: true,
      state: true,
      customerId: true,
    },
  });
  return { count: vehicles.length, vehicles };
}

async function getTrainingStatus(employeeId?: string) {
  const db = getDb();
  if (employeeId) {
    const assignments = await db.trainingAssignment.findMany({
      where: { employeeId },
      include: {
        module: { select: { moduleName: true, moduleCode: true } },
      },
      orderBy: { dueAt: 'asc' },
    });
    return {
      employeeId,
      total: assignments.length,
      completed: assignments.filter((a) => a.assignmentStatus === 'COMPLETED').length,
      overdue: assignments.filter(
        (a) => a.assignmentStatus === 'ASSIGNED' && a.dueAt && a.dueAt < new Date()
      ).length,
      assignments: assignments.map((a) => ({
        module: a.module.moduleName,
        moduleCode: a.module.moduleCode,
        status: a.assignmentStatus,
        dueAt: a.dueAt,
        completedAt: a.completedAt,
        score: a.score,
      })),
    };
  }

  // Overview
  const [total, completed, overdue] = await Promise.all([
    db.trainingAssignment.count(),
    db.trainingAssignment.count({ where: { assignmentStatus: 'COMPLETED' } }),
    db.trainingAssignment.count({
      where: { assignmentStatus: 'ASSIGNED', dueAt: { lt: new Date() } },
    }),
  ]);
  return { total, completed, overdue, inProgress: total - completed };
}

async function searchPurchaseOrders(query?: string, status?: string) {
  const db = getDb();
  const where: Prisma.PurchaseOrderWhereInput = {};
  if (query) {
    where.OR = [
      { poNumber: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
    ];
  }
  if (status) {
    where.purchaseOrderState = status as Prisma.EnumPurchaseOrderStateFilter;
  }

  const pos = await db.purchaseOrder.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 15,
    include: {
      vendor: { select: { vendorName: true } },
      _count: { select: { lines: true } },
    },
  });
  return {
    count: pos.length,
    purchaseOrders: pos.map((po) => ({
      id: po.id,
      poNumber: po.poNumber,
      vendor: po.vendor.vendorName,
      status: po.purchaseOrderState,
      lineCount: po._count.lines,
      orderedAt: po.orderedAt,
      expectedAt: po.expectedAt,
    })),
  };
}

const ALLOWED_MODELS = new Set([
  'customer',
  'part',
  'woOrder',
  'employee',
  'salesOpportunity',
  'quote',
  'vendor',
  'cartVehicle',
  'channel',
  'notification',
  'trainingModule',
  'trainingAssignment',
  'purchaseOrder',
  'stockLot',
  'technicianTask',
  'salesActivity',
  'reworkIssue',
]);

async function runCustomQuery(input: ToolInput) {
  const db = getDb();
  const modelName = input.model as string;
  const operation = input.operation as string;
  const where = (input.where as Record<string, unknown>) || {};
  const take = (input.take as number) || 20;

  if (!ALLOWED_MODELS.has(modelName)) {
    return { error: `Model "${modelName}" is not available. Allowed: ${[...ALLOWED_MODELS].join(', ')}` };
  }

  if (!['count', 'findMany'].includes(operation)) {
    return { error: 'Only count and findMany operations are allowed.' };
  }

  try {
    const model = (db as unknown as Record<string, unknown>)[modelName] as Record<string, Function>;
    if (operation === 'count') {
      const count = await model.count({ where });
      return { model: modelName, count };
    }
    const results = await model.findMany({ where, take, orderBy: { createdAt: 'desc' } });
    return { model: modelName, count: results.length, results };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
