import { z } from 'zod';

/**
 * Zod schemas mirroring the response shapes the apps expect from the API.
 * The network spy validates every captured response whose method+path
 * matches a registered route here. Unknown routes are not validated
 * (the smoke tier still asserts they don't 500).
 *
 * When the source-of-truth interface in `apps/web/src/lib/api-client.ts`
 * changes, mirror it here. We don't auto-derive — the server's actual
 * runtime shape is what matters; the TS interface is just our intent.
 *
 * Path templates use API Gateway placeholder syntax: `{id}`, `{moduleId}`,
 * etc. The matcher converts these to regex at lookup time.
 */

// ─── Common building blocks ───────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}T/, { message: 'expected ISO timestamp' });
const uuid = z.string().uuid();
const positiveInt = z.number().int().nonnegative();

const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: positiveInt });

// ─── Work Orders ──────────────────────────────────────────────────────────

const workOrderState = z.enum([
  'PLANNED',
  'RELEASED',
  'IN_PROGRESS',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
]);

const workOrder = z.object({
  id: uuid,
  workOrderNumber: z.string(),
  vehicleId: z.string(),
  customerId: z.string().optional(),
  buildConfigurationId: z.string(),
  bomId: z.string(),
  state: workOrderState,
  description: z.string().optional(),
  scheduledDate: z.string().optional(),
  assigneeId: z.string().optional(),
  completedAt: z.string().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

const cartVehicle = z.object({
  id: uuid,
  vin: z.string(),
  serialNumber: z.string(),
  modelCode: z.string(),
  modelYear: z.number().int(),
  customerId: uuid,
  state: z.enum(['REGISTERED', 'IN_BUILD', 'QUALITY_HOLD', 'COMPLETED', 'RETIRED']),
  createdAt: isoDate,
  updatedAt: isoDate,
});

// ─── Inventory ────────────────────────────────────────────────────────────

const partLifecycleLevel = z.enum(['RAW_COMPONENT', 'PREPARED_COMPONENT', 'ASSEMBLED_COMPONENT']);

const part = z.object({
  id: uuid,
  sku: z.string(),
  name: z.string(),
  variant: z.string().optional(),
  lifecycleLevel: partLifecycleLevel,
  installStage: z.string().nullable().optional(),
  manufacturerId: z.string().nullable().optional(),
  manufacturerName: z.string().nullable().optional(),
  defaultVendorId: z.string().nullable().optional(),
  defaultVendorName: z.string().nullable().optional(),
  unitOfMeasure: z.string(),
  partState: z.enum(['ACTIVE', 'DISCONTINUED']),
  reorderPoint: z.number().nonnegative(),
  quantityOnHand: z.number().nonnegative(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

const manufacturer = z.object({
  id: uuid,
  name: z.string(),
  notes: z.string().nullable().optional(),
});

const inventoryLedgerEntry = z.object({
  id: uuid,
  movementType: z.string(),
  quantityDelta: z.number(),
  unitCost: z.number().optional(),
  valueDelta: z.number().optional(),
  reasonCode: z.string(),
  sourceDocument: z.object({ type: z.string(), id: z.string() }).optional(),
  correlationId: z.string(),
  createdAt: isoDate,
  part: z.object({
    id: uuid,
    sku: z.string(),
    name: z.string(),
    unitOfMeasure: z.string(),
  }),
  location: z.object({
    id: uuid,
    name: z.string(),
  }),
  lot: z
    .object({ id: z.string().nullable().optional(), lotNumber: z.string().nullable().optional() })
    .optional(),
  workOrder: z
    .object({ id: z.string().nullable().optional(), number: z.string().nullable().optional() })
    .optional(),
  purchaseOrder: z
    .object({
      id: z.string().nullable().optional(),
      number: z.string().nullable().optional(),
      lineId: z.string().nullable().optional(),
    })
    .optional(),
});

const inventoryAdjustment = z.object({
  id: uuid,
  adjustmentNumber: z.string(),
  adjustmentType: z.string(),
  status: z.string(),
  stockLocationId: uuid,
  locationName: z.string(),
  stockLotId: uuid,
  lotNumber: z.string().optional(),
  partId: uuid,
  partSku: z.string(),
  partName: z.string(),
  quantityDelta: z.number(),
  expectedQuantity: z.number(),
  countedQuantity: z.number(),
  reasonCode: z.string(),
  notes: z.string().optional(),
  ledgerEntryId: uuid,
  postedAt: isoDate,
  correlationId: z.string(),
});

const inventoryLocation = z.object({
  id: uuid,
  locationCode: z.string(),
  locationName: z.string(),
  locationType: z.string(),
  isPickable: z.boolean(),
});

const inventoryTransfer = z.object({
  id: uuid,
  transferNumber: z.string(),
  status: z.string(),
  fromStockLocationId: uuid,
  fromLocationName: z.string(),
  toStockLocationId: uuid,
  toLocationName: z.string(),
  fromStockLotId: uuid,
  toStockLotId: uuid,
  sourceLotNumber: z.string().optional(),
  destinationLotNumber: z.string(),
  partId: uuid,
  partSku: z.string(),
  partName: z.string(),
  quantity: z.number(),
  reasonCode: z.string().optional(),
  notes: z.string().optional(),
  transferOutLedgerEntryId: uuid,
  transferInLedgerEntryId: uuid,
  shippedAt: isoDate,
  receivedAt: isoDate,
  correlationId: z.string(),
});

// ─── Customers / Dealers ──────────────────────────────────────────────────

const customer = z.object({
  id: uuid,
  name: z.string(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  state: z.string().optional(),
});

const dealer = z.object({
  id: z.string(), // Mock data uses 'd-1' style; relax UUID requirement.
  name: z.string(),
  contactEmail: z.string().optional(),
  serviceRelationship: z.enum(['ACTIVE', 'INACTIVE']),
  territory: z.string().optional(),
});

// ─── Tickets / Tasks ──────────────────────────────────────────────────────

const taskState = z.enum(['READY', 'IN_PROGRESS', 'BLOCKED', 'DONE']);
const technicianTask = z.object({
  id: z.string(),
  workOrderId: z.string(),
  title: z.string(),
  state: taskState,
  technicianId: z.string().nullable().optional(),
  blockReasonCode: z.string().nullable().optional(),
  blockReason: z.string().nullable().optional(),
});

// ─── Accounting ───────────────────────────────────────────────────────────

const reconciliationRun = z.object({
  id: z.string(),
  status: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  mismatchCount: z.number().optional(),
  summary: z.string().optional(),
});

// ─── Sales ────────────────────────────────────────────────────────────────

const opportunityStage = z.enum([
  'PROSPECTING',
  'PROPOSAL',
  'NEGOTIATION',
  'CLOSED_WON',
  'CLOSED_LOST',
]);
const opportunity = z.object({
  id: uuid,
  name: z.string(),
  stage: opportunityStage,
  value: z.number().nullable().optional(),
  ownerId: z.string().nullable().optional(),
});

const quote = z.object({
  id: uuid,
  customerId: z.string(),
  status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED']),
  total: z.number().optional(),
});

// ─── Training / SOP ───────────────────────────────────────────────────────

const trainingModule = z.object({
  id: z.string(),
  moduleCode: z.string(),
  moduleName: z.string(),
  description: z.string().optional(),
  moduleStatus: z.enum(['ACTIVE', 'INACTIVE', 'RETIRED']).optional(),
  passScore: z.number().optional(),
  isRequired: z.boolean().optional(),
  requiresSupervisorSignoff: z.boolean().optional(),
  estimatedTime: z.union([z.number(), z.string()]).optional(),
});

const sopDocument = z.object({
  id: uuid,
  documentCode: z.string(),
  title: z.string(),
  documentStatus: z.enum(['DRAFT', 'PUBLISHED', 'RETIRED']),
});

// ─── Status / health ──────────────────────────────────────────────────────

const accountingStatus = z.object({
  connected: z.boolean(),
  companyName: z.string().optional(),
  realmId: z.string().optional(),
});

// ─── Route registry ───────────────────────────────────────────────────────
// Map "METHOD /api/path/with/{placeholders}" → schema. The lookup helper
// converts the template to a regex so /work-orders/abc-123 still matches.

interface RouteEntry {
  method: string;
  template: string;
  schema: z.ZodTypeAny;
}

const ROUTES: RouteEntry[] = [
  // Work Orders
  { method: 'GET', template: '/planning/work-orders', schema: paginated(workOrder) },
  { method: 'GET', template: '/planning/vehicles', schema: paginated(cartVehicle) },
  { method: 'GET', template: '/work-orders/{id}', schema: z.object({ workOrder }) },

  // Tickets / tasks
  { method: 'GET', template: '/tickets/work-orders', schema: paginated(workOrder) },
  { method: 'GET', template: '/tickets/technician-tasks', schema: paginated(technicianTask) },
  { method: 'GET', template: '/tickets/tasks', schema: paginated(technicianTask) },

  // Inventory
  { method: 'GET', template: '/inventory/parts', schema: paginated(part) },
  { method: 'GET', template: '/inventory/parts/{id}', schema: z.object({ part }) },
  { method: 'PATCH', template: '/inventory/parts/{id}', schema: z.object({ part }) },
  { method: 'GET', template: '/inventory/locations', schema: paginated(inventoryLocation) },
  { method: 'GET', template: '/inventory/manufacturers', schema: paginated(manufacturer) },
  {
    method: 'GET',
    template: '/inventory/ledger',
    schema: z.object({
      items: z.array(inventoryLedgerEntry),
      total: positiveInt,
      limit: positiveInt,
      offset: positiveInt,
      summary: z.array(
        z.object({
          movementType: z.string(),
          entryCount: positiveInt,
          quantityDelta: z.number(),
          valueDelta: z.number(),
        }),
      ),
    }),
  },
  {
    method: 'POST',
    template: '/inventory/adjustments',
    schema: z.object({ adjustment: inventoryAdjustment }),
  },
  {
    method: 'POST',
    template: '/inventory/transfers',
    schema: z.object({ transfer: inventoryTransfer }),
  },

  // Identity / Customers / Dealers
  { method: 'GET', template: '/identity/customers', schema: paginated(customer) },
  { method: 'GET', template: '/identity/dealers', schema: paginated(dealer) },

  // Accounting
  { method: 'GET', template: '/accounting/status', schema: accountingStatus },
  {
    method: 'GET',
    template: '/accounting/reconciliation/runs',
    schema: paginated(reconciliationRun),
  },

  // Sales
  { method: 'GET', template: '/sales/opportunities', schema: paginated(opportunity) },
  { method: 'GET', template: '/sales/quotes', schema: paginated(quote) },

  // SOP / Training
  { method: 'GET', template: '/sop', schema: paginated(sopDocument) },
  { method: 'GET', template: '/sop/modules', schema: paginated(trainingModule) },
];

/** Convert `/sop/modules/{id}` into a regex matching `/sop/modules/<anything-not-slash>`. */
function templateToRegex(template: string): RegExp {
  const escaped = template.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withParams = escaped.replace(/\\\{[^}]+\\\}/g, '[^/]+');
  return new RegExp(`^${withParams}$`);
}

const COMPILED = ROUTES.map((r) => ({
  ...r,
  re: templateToRegex(r.template),
}));

export interface SchemaMatch {
  schema: z.ZodTypeAny;
  template: string;
}

/** Return the registered schema for a method+pathname, if any. */
export function schemaForRoute(method: string, pathname: string): SchemaMatch | undefined {
  for (const r of COMPILED) {
    if (r.method === method.toUpperCase() && r.re.test(pathname)) {
      return { schema: r.schema, template: r.template };
    }
  }
  return undefined;
}

export const REGISTERED_ROUTE_COUNT = ROUTES.length;
