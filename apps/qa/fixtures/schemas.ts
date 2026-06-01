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

const executionWorkOrder = z.object({
  id: uuid,
  workOrderNumber: z.string(),
  title: z.string(),
  description: z.string().optional(),
  customerReference: z.string().optional(),
  assetReference: z.string().optional(),
  status: z.enum(['DRAFT', 'READY', 'SCHEDULED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED']),
  priority: z.number().int(),
  stockLocationId: z.string().optional(),
  openedAt: isoDate,
  dueAt: isoDate.optional(),
  completedAt: isoDate.optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

const executionWorkOrderQueueItem = z.object({
  id: uuid,
  number: z.string(),
  title: z.string(),
  customer: z.string(),
  cart: z.string(),
  bay: z.string(),
  age: z.string(),
  status: z.enum(['DRAFT', 'READY', 'SCHEDULED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED']),
  materialReadiness: z.enum(['READY', 'PARTIAL', 'NOT_READY']),
  shortageCount: z.number().int().nonnegative().optional(),
  reworkLoop: z.number().int().nonnegative(),
  syncStatus: z.enum(['SYNCED', 'PENDING', 'FAILED']),
  checklistCompletion: z.string(),
  nextAction: z.string(),
});

const executionWorkOrderBuildProvenance = z.object({
  configuration: z.object({
    id: z.string(),
    code: z.string(),
    version: z.number().int().nonnegative(),
    status: z.string(),
    releasedAt: isoDate.optional(),
    updatedAt: isoDate.optional(),
  }).optional(),
  bom: z.object({
    id: z.string(),
    code: z.string(),
    revision: z.number().int().nonnegative(),
    status: z.string(),
    approvedAt: isoDate.optional(),
    lineCount: z.number().int().nonnegative(),
  }).optional(),
  routingTemplate: z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    version: z.number().int().nonnegative(),
    status: z.string(),
    stepCount: z.number().int().nonnegative(),
  }).optional(),
  latestChanges: z.array(
    z.object({
      id: z.string(),
      entityType: z.enum(['CONFIGURATION', 'BOM', 'ROUTE']),
      recordCode: z.string(),
      versionLabel: z.string(),
      changeKind: z.string(),
      changeSummary: z.string(),
      approvalNote: z.string().optional(),
      approvedBy: z.string().optional(),
      approvedAt: isoDate.optional(),
      createdAt: isoDate,
    }),
  ),
});

const executionWorkOrderDetail = z.object({
  id: uuid,
  number: z.string(),
  title: z.string(),
  customerReference: z.string().optional(),
  assetReference: z.string().optional(),
  customer: z.string(),
  cart: z.string(),
  customerProfile: z.unknown().optional(),
  cartProfile: z.unknown().optional(),
  buildProvenance: executionWorkOrderBuildProvenance.optional(),
  commercialContext: z.unknown().optional(),
  bay: z.string(),
  status: z.enum(['DRAFT', 'READY', 'SCHEDULED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED']),
  eta: z.string(),
  syncStatus: z.enum(['SYNCED', 'PENDING', 'FAILED']),
  materialReadiness: z.enum(['READY', 'PARTIAL', 'NOT_READY']),
  shortageCount: z.number().int().nonnegative().optional(),
  reworkLoop: z.number().int().nonnegative(),
  checklist: z.array(z.unknown()),
  parts: z.array(z.unknown()),
  reservations: z.array(z.unknown()),
  notes: z.array(z.unknown()),
  statusHistory: z.array(z.unknown()).optional(),
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

const buildPackage = z.object({
  id: z.string(),
  buildConfigurationId: z.string(),
  bomId: z.string(),
  label: z.string(),
  description: z.string(),
  source: z.enum(['WORK_ORDER_HISTORY', 'PLANNING_MASTER']),
  workOrderCount: z.number().int().nonnegative(),
  lastUsedAt: isoDate,
  lastWorkOrderId: z.string().optional(),
  lastWorkOrderNumber: z.string().optional(),
  lastVehicleDisplayName: z.string().optional(),
  lastCustomerDisplayName: z.string().optional(),
  stateCounts: z.record(z.string(), z.number().int().nonnegative()),
});

const buildConfigurationChangeEvent = z.object({
  id: uuid,
  buildConfigurationId: uuid,
  configurationCode: z.string(),
  configurationVersion: z.number().int().positive(),
  changeKind: z.enum(['CREATED', 'LOCKED', 'RELEASED', 'SUPERSEDED']),
  previousStatus: z.enum(['DRAFT', 'LOCKED', 'RELEASED', 'SUPERSEDED']).optional(),
  newStatus: z.enum(['DRAFT', 'LOCKED', 'RELEASED', 'SUPERSEDED']),
  changeSummary: z.string(),
  approvalNote: z.string().optional(),
  approvedBy: z.string().optional(),
  approvedAt: isoDate.optional(),
  appliedBy: z.string().optional(),
  createdAt: isoDate,
});

const buildConfiguration = z.object({
  id: uuid,
  configurationCode: z.string(),
  vehicleId: uuid,
  vehicleDisplayName: z.string().optional(),
  customerDisplayName: z.string().optional(),
  configurationVersion: z.number().int().positive(),
  configurationStatus: z.enum(['DRAFT', 'LOCKED', 'RELEASED', 'SUPERSEDED']),
  selectedOptions: z.array(z.string()),
  notes: z.string().optional(),
  releasedAt: isoDate.optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
  version: z.number().int().nonnegative(),
  changeEvents: z.array(buildConfigurationChangeEvent),
});

const bomLine = z.object({
  id: uuid,
  bomId: uuid,
  partId: uuid,
  sku: z.string(),
  partName: z.string(),
  unitOfMeasure: z.string(),
  quantityPerUnit: z.number().positive(),
  scrapFactor: z.number().nonnegative(),
  lineNote: z.string().optional(),
});

const bomChangeEvent = z.object({
  id: uuid,
  bomId: uuid,
  bomCode: z.string(),
  buildConfigurationId: uuid,
  revision: z.number().int().positive(),
  changeKind: z.enum(['CREATED', 'APPROVED', 'OBSOLETED']),
  previousStatus: z.enum(['DRAFT', 'APPROVED', 'OBSOLETE']).optional(),
  newStatus: z.enum(['DRAFT', 'APPROVED', 'OBSOLETE']),
  changeSummary: z.string(),
  approvalNote: z.string().optional(),
  approvedBy: z.string().optional(),
  approvedAt: isoDate.optional(),
  appliedBy: z.string().optional(),
  createdAt: isoDate,
});

const buildBom = z.object({
  id: uuid,
  bomCode: z.string(),
  buildConfigurationId: uuid,
  configurationCode: z.string().optional(),
  revision: z.number().int().positive(),
  bomStatus: z.enum(['DRAFT', 'APPROVED', 'OBSOLETE']),
  notes: z.string().optional(),
  approvedAt: isoDate.optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
  version: z.number().int().nonnegative(),
  lines: z.array(bomLine),
  changeEvents: z.array(bomChangeEvent),
});

const routingTemplateStep = z.object({
  id: uuid,
  routingTemplateId: uuid,
  sequenceNo: z.number().int().positive(),
  operationCode: z.string(),
  operationName: z.string(),
  workstationCode: z.string().optional(),
  estimatedMinutes: z.number().int().positive(),
  laborRateCents: z.number().int().nonnegative().optional(),
  laborCostCents: z.number().int().nonnegative(),
  requiredSkillCode: z.string().optional(),
  jobCardTitle: z.string().optional(),
  jobCardInstructions: z.string().optional(),
  qcRequired: z.boolean(),
  evidenceRequired: z.boolean(),
});

const routingTemplateChangeEvent = z.object({
  id: uuid,
  routingTemplateId: uuid,
  routeCode: z.string(),
  routeVersion: z.number().int().positive(),
  changeKind: z.enum(['CREATED', 'ACTIVATED', 'RETIRED', 'AUTO_RETIRED']),
  previousStatus: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']).optional(),
  newStatus: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']),
  changeSummary: z.string(),
  approvalNote: z.string().optional(),
  approvedBy: z.string().optional(),
  approvedAt: isoDate.optional(),
  appliedBy: z.string().optional(),
  createdAt: isoDate,
});

const routingTemplate = z.object({
  id: uuid,
  routeCode: z.string(),
  routeName: z.string(),
  routeVersion: z.number().int().positive(),
  buildConfigurationId: uuid.optional(),
  configurationCode: z.string().optional(),
  templateStatus: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.optional(),
  notes: z.string().optional(),
  activatedAt: isoDate.optional(),
  retiredAt: isoDate.optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
  version: z.number().int().nonnegative(),
  stepCount: z.number().int().nonnegative(),
  estimatedMinutes: z.number().int().nonnegative(),
  estimatedLaborCostCents: z.number().int().nonnegative(),
  steps: z.array(routingTemplateStep),
  changeEvents: z.array(routingTemplateChangeEvent),
});

const planningChangeEvent = z.object({
  id: uuid,
  entityType: z.enum(['CONFIGURATION', 'BOM', 'ROUTE']),
  entityId: uuid,
  recordCode: z.string(),
  versionNumber: z.number().int().positive(),
  versionLabel: z.string(),
  changeKind: z.string(),
  previousStatus: z.string().optional(),
  newStatus: z.string(),
  changeSummary: z.string(),
  approvalNote: z.string().optional(),
  approvedBy: z.string().optional(),
  approvedAt: isoDate.optional(),
  appliedBy: z.string().optional(),
  createdAt: isoDate,
});

const buildPackageApprovalEvidence = z.object({
  id: uuid,
  entityType: z.enum(['CONFIGURATION', 'BOM', 'ROUTE']),
  recordCode: z.string(),
  versionLabel: z.string(),
  changeKind: z.string(),
  approvalNote: z.string().optional(),
  approvedBy: z.string().optional(),
  approvedAt: isoDate.optional(),
  appliedBy: z.string().optional(),
  createdAt: isoDate,
});

const buildPackageReviewPack = z.object({
  id: z.string(),
  generatedAt: isoDate,
  package: buildPackage,
  configuration: buildConfiguration,
  bom: buildBom,
  routeTemplates: z.array(routingTemplate),
  changeEvents: z.array(planningChangeEvent),
  approvalEvidence: z.array(buildPackageApprovalEvidence),
  summary: z.object({
    bomLineCount: z.number().int().nonnegative(),
    routeCount: z.number().int().nonnegative(),
    routeStepCount: z.number().int().nonnegative(),
    estimatedMinutes: z.number().int().nonnegative(),
    estimatedLaborCostCents: z.number().int().nonnegative(),
    changeCount: z.number().int().nonnegative(),
    approvalCount: z.number().int().nonnegative(),
  }),
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

const cycleCountLine = z.object({
  stockLotId: uuid,
  lotNumber: z.string().optional(),
  partId: uuid,
  partSku: z.string(),
  partName: z.string(),
  expectedQuantity: z.number(),
  countedQuantity: z.number(),
  varianceQuantity: z.number(),
  reasonCode: z.string(),
  ledgerEntryId: uuid.optional(),
  adjustmentLineId: uuid.optional(),
});

const cycleCount = z.object({
  id: uuid,
  cycleCountNumber: z.string(),
  status: z.string(),
  stockLocationId: uuid,
  locationName: z.string(),
  scheduledFor: z.string(),
  startedAt: isoDate,
  completedAt: isoDate,
  notes: z.string().optional(),
  lineCount: positiveInt,
  varianceCount: z.number(),
  netQuantityDelta: z.number(),
  adjustmentId: uuid.optional(),
  adjustmentNumber: z.string().optional(),
  ledgerEntryIds: z.array(uuid),
  lines: z.array(cycleCountLine),
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
  customerId: z.string().optional(),
  dealerCode: z.string().optional(),
  name: z.string(),
  contactEmail: z.string().optional(),
  serviceRelationship: z.enum(['ACTIVE', 'INACTIVE']),
  territory: z.string().optional(),
  source: z.string().optional(),
});

const dealerRelationship = z.object({
  id: z.string(),
  dealerId: z.string(),
  dealerCustomerId: z.string(),
  dealerCode: z.string().optional(),
  dealerName: z.string(),
  serviceRelationship: z.enum(['ACTIVE', 'INACTIVE']),
  territory: z.string().optional(),
  customerId: z.string(),
  customerName: z.string(),
  customerEmail: z.string().optional(),
  cartVehicleId: z.string().optional(),
  cartDisplayName: z.string().optional(),
  relationshipType: z.enum(['ACCOUNT_OWNER', 'SERVICING_DEALER', 'BILLING_ACCOUNT', 'WARRANTY_PROVIDER']),
  relationshipState: z.enum(['ACTIVE', 'INACTIVE', 'ENDED']),
  source: z.string().optional(),
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

const operationalLedgerEntry = z.object({
  id: z.string(),
  ledgerDate: isoDate,
  sourceType: z.enum(['PAYABLE_RECEIPT', 'CUSTOMER_PAYMENT', 'RECONCILIATION_VARIANCE']),
  sourceId: z.string(),
  documentNumber: z.string(),
  counterparty: z.string(),
  accountDebit: z.string(),
  accountCredit: z.string(),
  debitCents: z.number(),
  creditCents: z.number(),
  amountCents: z.number(),
  currency: z.literal('USD'),
  status: z.enum([
    'READY_FOR_REVIEW',
    'NEEDS_REVIEW',
    'POSTED',
    'PENDING',
    'FAILED',
    'MISMATCH',
    'RESOLVED',
  ]),
  memo: z.string(),
  relatedRecordType: z.enum(['purchase-order', 'payment-sync', 'reconciliation-record']),
  relatedRecordId: z.string(),
});

const operationalLedgerTotals = z.object({
  count: positiveInt,
  amountCents: z.number(),
});

const operationalLedger = z.object({
  items: z.array(operationalLedgerEntry),
  total: positiveInt,
  limit: positiveInt,
  offset: positiveInt,
  summary: z.object({
    generatedAt: isoDate,
    entryCount: positiveInt,
    totalDebitCents: z.number(),
    totalCreditCents: z.number(),
    sourceTotals: z.record(z.string(), operationalLedgerTotals),
    statusTotals: z.record(z.string(), operationalLedgerTotals),
    exceptions: z.object({
      invoice: positiveInt,
      customer: positiveInt,
      payment: positiveInt,
      reconciliation: positiveInt,
    }),
  }),
  postingRules: z.array(
    z.object({
      sourceType: z.enum(['PAYABLE_RECEIPT', 'CUSTOMER_PAYMENT', 'RECONCILIATION_VARIANCE']),
      trigger: z.string(),
      debitAccount: z.string(),
      creditAccount: z.string(),
      status: z.literal('active-preview'),
    }),
  ),
});

const reportMetric = z.object({
  value: z.string(),
  label: z.string(),
  tone: z.enum(['neutral', 'green', 'amber', 'red']),
  generatedAt: isoDate,
  source: z.string(),
});

const reportFreshness = z.object({
  reportKey: z.string(),
  source: z.string(),
  status: z.enum(['LIVE', 'STALE', 'ERROR']),
  generatedAt: isoDate,
  lastSuccessfulAt: isoDate.optional(),
  message: z.string().optional(),
});

const reportingSnapshot = z.object({
  generatedAt: isoDate,
  metrics: z.record(z.string(), reportMetric),
  freshness: z.record(z.string(), reportFreshness),
  blockedWorkOrders: z.array(
    z.object({
      id: z.string(),
      workOrderNumber: z.string(),
      title: z.string(),
    }),
  ),
  warnings: z.array(z.object({ source: z.string(), message: z.string() })),
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
  { method: 'GET', template: '/planning/build-packages', schema: paginated(buildPackage) },
  { method: 'GET', template: '/planning/build-packages/review-pack', schema: z.object({ reviewPack: buildPackageReviewPack }) },
  { method: 'GET', template: '/planning/change-events', schema: paginated(planningChangeEvent) },
  { method: 'GET', template: '/planning/build-configurations', schema: paginated(buildConfiguration) },
  { method: 'POST', template: '/planning/build-configurations', schema: z.object({ buildConfiguration }) },
  { method: 'PATCH', template: '/planning/build-configurations/{id}/state', schema: z.object({ buildConfiguration }) },
  { method: 'GET', template: '/planning/boms', schema: paginated(buildBom) },
  { method: 'POST', template: '/planning/boms', schema: z.object({ bom: buildBom }) },
  { method: 'PATCH', template: '/planning/boms/{id}/approve', schema: z.object({ bom: buildBom }) },
  { method: 'GET', template: '/planning/routing-templates', schema: paginated(routingTemplate) },
  { method: 'POST', template: '/planning/routing-templates', schema: z.object({ routingTemplate }) },
  { method: 'PATCH', template: '/planning/routing-templates/{id}/state', schema: z.object({ routingTemplate }) },
  { method: 'GET', template: '/planning/vehicles', schema: paginated(cartVehicle) },
  { method: 'GET', template: '/work-orders/{id}', schema: z.object({ workOrder }) },

  // Tickets / tasks
  { method: 'GET', template: '/tickets/work-orders', schema: paginated(executionWorkOrder) },
  { method: 'POST', template: '/tickets/work-orders', schema: z.object({ workOrder: executionWorkOrder }) },
  { method: 'GET', template: '/tickets/wo-queue', schema: z.object({ items: z.array(executionWorkOrderQueueItem) }) },
  { method: 'GET', template: '/tickets/wo-queue/{id}', schema: z.object({ workOrder: executionWorkOrderDetail }) },
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
  {
    method: 'POST',
    template: '/inventory/cycle-counts',
    schema: z.object({ cycleCount }),
  },

  // Identity / Customers / Dealers
  { method: 'GET', template: '/identity/customers', schema: paginated(customer) },
  { method: 'GET', template: '/identity/dealers', schema: paginated(dealer) },
  { method: 'GET', template: '/identity/dealer-relationships', schema: paginated(dealerRelationship) },

  // Accounting
  { method: 'GET', template: '/accounting/status', schema: accountingStatus },
  { method: 'GET', template: '/accounting/operational-ledger', schema: operationalLedger },
  {
    method: 'GET',
    template: '/accounting/reconciliation/runs',
    schema: paginated(reconciliationRun),
  },

  // Sales
  { method: 'GET', template: '/sales/opportunities', schema: paginated(opportunity) },
  { method: 'GET', template: '/sales/quotes', schema: paginated(quote) },

  // Reporting
  { method: 'GET', template: '/reporting/snapshot', schema: reportingSnapshot },

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
