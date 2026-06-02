import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';
import { QcGateService } from '../../contexts/tickets/qcGate.service.js';
import { TimeEntryService } from '../../contexts/tickets/timeEntry.service.js';
import type { CreateLaborTimeEntryInput } from '../../../../../packages/domain/src/model/tickets.js';

let prisma: PrismaClient | undefined;
let prismaOverride: Partial<PrismaClient> | undefined;
let qcGateService: QcGateService | undefined;
let timeEntryService: TimeEntryService | undefined;
let timeEntryServiceOverride:
  | Pick<TimeEntryService, 'listEntries' | 'createEntry' | 'updateEntry' | 'deleteEntry'>
  | undefined;

function getPrisma(): PrismaClient {
  if (prismaOverride) return prismaOverride as PrismaClient;
  prisma ??= new PrismaClient();
  return prisma;
}

function getQcGateService(): QcGateService {
  qcGateService ??= new QcGateService(getPrisma());
  return qcGateService;
}

function getTimeEntryService(): TimeEntryService {
  if (timeEntryServiceOverride) {
    return timeEntryServiceOverride as TimeEntryService;
  }

  timeEntryService ??= new TimeEntryService(getPrisma());
  return timeEntryService;
}

export function setTicketHandlerTimeEntryServiceForTests(
  service:
    | Pick<TimeEntryService, 'listEntries' | 'createEntry' | 'updateEntry' | 'deleteEntry'>
    | undefined,
): void {
  timeEntryServiceOverride = service;
}

export function setTicketHandlerPrismaForTests(client: Partial<PrismaClient> | undefined): void {
  prismaOverride = client;
}

export async function disconnectTicketHandlerDependencies(): Promise<void> {
  await prisma?.$disconnect();
  prisma = undefined;
  prismaOverride = undefined;
  qcGateService = undefined;
  timeEntryService = undefined;
  timeEntryServiceOverride = undefined;
}

// ─── Technician Tasks ─────────────────────────────────────────────────────────

// Prisma's UUID columns reject any non-UUID string with a 500 at the driver
// layer. The frontend occasionally passes demo placeholder IDs (e.g. "emp-1")
// before Cognito has supplied a real user ID. Treat such filters as "no matches"
// rather than crashing the endpoint.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(value: string | undefined): string | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}

function compactUuidIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => UUID_RE.test(id))));
}

const BUILD_OPERATION_STAGE_ORDER = [
  'FABRICATION',
  'FRAME',
  'WIRING',
  'PARTS_PREP',
  'FINAL_ASSEMBLY',
  'GENERAL',
] as const;

const BUILD_STAGE_SKILL: Record<string, string> = {
  FABRICATION: 'FABRICATION',
  FRAME: 'MECHANICAL',
  WIRING: 'ELECTRICAL',
  PARTS_PREP: 'PARTS',
  FINAL_ASSEMBLY: 'ASSEMBLY',
  GENERAL: 'BUILD',
};

interface CreateExecutionWorkOrderInput {
  workOrderNumber: string;
  vehicleId: string;
  customerId?: string;
  buildConfigurationId: string;
  bomId: string;
  routingTemplateId?: string;
  title?: string;
  description?: string;
  scheduledDate?: string;
  priority?: number;
  stockLocationId?: string;
}

interface ReleasedBuildPackageHeaderRow {
  buildConfigurationId: string;
  configurationCode: string;
  configurationVersion: number;
  configurationStatus: string;
  vehicleId: string;
  vehicleDisplayName: string;
  customerId: string | null;
  customerDisplayName: string | null;
  bomId: string;
  bomCode: string;
  revision: number;
  bomStatus: string;
}

interface ReleasedBuildPackageLineRow {
  partId: string;
  partSku: string;
  partName: string;
  quantityPerUnit: unknown;
  scrapFactor: unknown;
  installStage: string | null;
}

interface ReleasedRoutingTemplateHeaderRow {
  routingTemplateId: string;
  routeCode: string;
  routeName: string;
  routeVersion: number;
  templateStatus: string;
  effectiveFrom: Date | string;
  effectiveTo: Date | string | null;
}

interface ReleasedRoutingTemplateStepRow {
  id: string;
  sequenceNo: number;
  operationCode: string;
  operationName: string;
  workstationCode: string | null;
  estimatedMinutes: number;
  laborRateCents: number | null;
  requiredSkillCode: string | null;
  jobCardTitle: string | null;
  qcRequired: boolean;
  evidenceRequired: boolean;
}

interface ExecutionWorkOrderRecord {
  id: string;
  workOrderNumber: string;
  title: string;
  description?: string | null;
  customerReference?: string | null;
  assetReference?: string | null;
  status: string;
  priority: number;
  stockLocationId?: string | null;
  openedAt: Date;
  dueAt?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PendingQcGateRow {
  id: string;
  workOrderId: string;
  taskId: null;
  gateLabel: string;
  isCritical: boolean;
  result: null;
  failureNote: null;
  reviewedBy: null;
  reviewedAt: null;
  createdAt: Date;
}

function stageSortKey(stage: string): number {
  const idx = BUILD_OPERATION_STAGE_ORDER.indexOf(stage as (typeof BUILD_OPERATION_STAGE_ORDER)[number]);
  return idx === -1 ? BUILD_OPERATION_STAGE_ORDER.length : idx;
}

function stageLabel(stage: string): string {
  return stage
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function parseUuidField(value: unknown, fieldName: string): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, message: `${fieldName} is required.` };
  }
  const trimmed = value.trim();
  if (!UUID_RE.test(trimmed)) {
    return { ok: false, message: `${fieldName} must be a valid UUID.` };
  }
  return { ok: true, value: trimmed };
}

function clampWorkOrderPriority(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 3;
  return Math.min(5, Math.max(1, Math.round(value)));
}

function requestedBuildQuantity(row: ReleasedBuildPackageLineRow): number {
  const baseQuantity = numberFromDb(row.quantityPerUnit);
  const scrapFactor = numberFromDb(row.scrapFactor);
  return Math.round(baseQuantity * (1 + scrapFactor) * 1000) / 1000;
}

function standardLaborCostCents(estimatedMinutes: number, laborRateCents: number | null): number {
  if (laborRateCents == null) return 0;
  return Math.round((estimatedMinutes / 60) * laborRateCents);
}

function toExecutionWorkOrderResponse(order: ExecutionWorkOrderRecord) {
  return {
    id: order.id,
    workOrderNumber: order.workOrderNumber,
    title: order.title,
    description: order.description ?? undefined,
    customerReference: order.customerReference ?? undefined,
    assetReference: order.assetReference ?? undefined,
    status: mapWoStatus(order.status),
    priority: order.priority,
    stockLocationId: order.stockLocationId ?? undefined,
    openedAt: order.openedAt.toISOString(),
    dueAt: optionalIso(order.dueAt),
    completedAt: optionalIso(order.completedAt),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export const createWoOrderHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<CreateExecutionWorkOrderInput>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });
    if (!body.value || typeof body.value !== 'object' || Array.isArray(body.value)) {
      return jsonResponse(422, { message: 'Request body must be an object.' });
    }

    const workOrderNumber = body.value.workOrderNumber?.trim();
    if (!workOrderNumber) return jsonResponse(422, { message: 'workOrderNumber is required.' });

    const vehicle = parseUuidField(body.value.vehicleId, 'vehicleId');
    if (!vehicle.ok) return jsonResponse(422, { message: vehicle.message });
    const buildConfiguration = parseUuidField(
      body.value.buildConfigurationId,
      'buildConfigurationId',
    );
    if (!buildConfiguration.ok) return jsonResponse(422, { message: buildConfiguration.message });
    const bom = parseUuidField(body.value.bomId, 'bomId');
    if (!bom.ok) return jsonResponse(422, { message: bom.message });
    const routingTemplate =
      body.value.routingTemplateId == null || body.value.routingTemplateId === ''
        ? undefined
        : parseUuidField(body.value.routingTemplateId, 'routingTemplateId');
    if (routingTemplate && !routingTemplate.ok) {
      return jsonResponse(422, { message: routingTemplate.message });
    }
    const customer =
      body.value.customerId == null || body.value.customerId === ''
        ? undefined
        : parseUuidField(body.value.customerId, 'customerId');
    if (customer && !customer.ok) return jsonResponse(422, { message: customer.message });
    const stockLocation =
      body.value.stockLocationId == null || body.value.stockLocationId === ''
        ? undefined
        : parseUuidField(body.value.stockLocationId, 'stockLocationId');
    if (stockLocation && !stockLocation.ok) {
      return jsonResponse(422, { message: stockLocation.message });
    }

    let dueAt: Date | undefined;
    if (body.value.scheduledDate) {
      dueAt = new Date(body.value.scheduledDate);
      if (Number.isNaN(dueAt.getTime())) {
        return jsonResponse(422, { message: 'scheduledDate must be a valid ISO date.' });
      }
    }

    const db = getPrisma();
    const existing = await db.woOrder.findUnique({
      where: { workOrderNumber },
      select: { id: true, workOrderNumber: true, title: true, status: true },
    });
    if (existing) {
      return jsonResponse(409, {
        message: `Work order already exists: ${workOrderNumber}`,
        workOrder: existing,
      });
    }

    const existingPlanningOrder = await db.workOrder.findUnique({
      where: { workOrderNumber },
      select: { id: true, workOrderNumber: true },
    });
    if (existingPlanningOrder) {
      return jsonResponse(409, {
        message: `Planning work order already exists: ${workOrderNumber}`,
        workOrder: existingPlanningOrder,
      });
    }

    const [header] = await db.$queryRaw<ReleasedBuildPackageHeaderRow[]>`
      SELECT
        bc.id::text AS "buildConfigurationId",
        bc.configuration_code AS "configurationCode",
        bc.configuration_version AS "configurationVersion",
        bc.configuration_status::text AS "configurationStatus",
        cv.id::text AS "vehicleId",
        concat(cv.model_year::text, ' ', cv.model_code, ' - ', cv.serial_number) AS "vehicleDisplayName",
        cv.customer_id::text AS "customerId",
        coalesce(nullif(c.company_name, ''), c.full_name) AS "customerDisplayName",
        b.id::text AS "bomId",
        b.bom_code AS "bomCode",
        b.revision AS "revision",
        b.bom_status::text AS "bomStatus"
      FROM planning.build_configurations bc
      JOIN planning.cart_vehicles cv ON cv.id = bc.vehicle_id
      JOIN planning.build_boms b ON b.build_configuration_id = bc.id
      LEFT JOIN customers.customers c ON c.id = cv.customer_id
      WHERE bc.id = ${buildConfiguration.value}::uuid
        AND b.id = ${bom.value}::uuid
        AND cv.id = ${vehicle.value}::uuid
      LIMIT 1
    `;

    if (!header) {
      return jsonResponse(404, {
        message: 'Released build package was not found for the selected cart.',
      });
    }
    if (header.configurationStatus !== 'RELEASED') {
      return jsonResponse(409, {
        message: 'Build configuration must be released before creating a work order.',
        configurationStatus: header.configurationStatus,
      });
    }
    if (header.bomStatus !== 'APPROVED') {
      return jsonResponse(409, {
        message: 'BOM must be approved before creating a work order.',
        bomStatus: header.bomStatus,
      });
    }
    if (customer && customer.ok && header.customerId && customer.value !== header.customerId) {
      return jsonResponse(422, {
        message: 'Selected customer does not own the selected cart.',
      });
    }

    let routingHeader: ReleasedRoutingTemplateHeaderRow | undefined;
    let routingSteps: ReleasedRoutingTemplateStepRow[] = [];
    if (routingTemplate && routingTemplate.ok) {
      [routingHeader] = await db.$queryRaw<ReleasedRoutingTemplateHeaderRow[]>`
        SELECT
          rt.id::text AS "routingTemplateId",
          rt.route_code AS "routeCode",
          rt.route_name AS "routeName",
          rt.route_version AS "routeVersion",
          rt.template_status::text AS "templateStatus",
          rt.effective_from AS "effectiveFrom",
          rt.effective_to AS "effectiveTo"
        FROM planning.routing_templates rt
        WHERE rt.id = ${routingTemplate.value}::uuid
          AND (
            rt.build_configuration_id IS NULL
            OR rt.build_configuration_id = ${buildConfiguration.value}::uuid
          )
        LIMIT 1
      `;
      if (!routingHeader) {
        return jsonResponse(404, {
          message: 'Routing template was not found for the selected build configuration.',
        });
      }
      if (routingHeader.templateStatus !== 'ACTIVE') {
        return jsonResponse(409, {
          message: 'Routing template must be active before creating a work order.',
          templateStatus: routingHeader.templateStatus,
        });
      }
      const routeEffectiveFrom = new Date(routingHeader.effectiveFrom);
      const routeEffectiveTo = routingHeader.effectiveTo ? new Date(routingHeader.effectiveTo) : null;
      if (routeEffectiveFrom > new Date()) {
        return jsonResponse(409, {
          message: 'Routing template is not effective yet.',
          effectiveFrom: routeEffectiveFrom.toISOString(),
        });
      }
      if (routeEffectiveTo && routeEffectiveTo <= new Date()) {
        return jsonResponse(409, {
          message: 'Routing template effective window has ended.',
          effectiveTo: routeEffectiveTo.toISOString(),
        });
      }
      routingSteps = await db.$queryRaw<ReleasedRoutingTemplateStepRow[]>`
        SELECT
          id::text AS "id",
          sequence_no AS "sequenceNo",
          operation_code AS "operationCode",
          operation_name AS "operationName",
          workstation_code AS "workstationCode",
          estimated_minutes AS "estimatedMinutes",
          labor_rate_cents AS "laborRateCents",
          required_skill_code AS "requiredSkillCode",
          job_card_title AS "jobCardTitle",
          qc_required AS "qcRequired",
          evidence_required AS "evidenceRequired"
        FROM planning.routing_template_steps
        WHERE routing_template_id = ${routingTemplate.value}::uuid
        ORDER BY sequence_no ASC
      `;
      if (routingSteps.length === 0) {
        return jsonResponse(422, {
          message: 'Active routing template must contain at least one operation.',
        });
      }
    }

    const lines = await db.$queryRaw<ReleasedBuildPackageLineRow[]>`
      SELECT
        p.id::text AS "partId",
        p.sku AS "partSku",
        p.name AS "partName",
        bl.quantity_per_unit AS "quantityPerUnit",
        bl.scrap_factor AS "scrapFactor",
        p.install_stage::text AS "installStage"
      FROM planning.build_bom_lines bl
      JOIN inventory.parts p ON p.id = bl.part_id
      WHERE bl.bom_id = ${bom.value}::uuid
      ORDER BY
        CASE p.install_stage::text
          WHEN 'FABRICATION' THEN 10
          WHEN 'FRAME' THEN 20
          WHEN 'WIRING' THEN 30
          WHEN 'PARTS_PREP' THEN 40
          WHEN 'FINAL_ASSEMBLY' THEN 50
          ELSE 99
        END,
        p.sku
    `;

    if (lines.length === 0) {
      return jsonResponse(422, {
        message: 'Approved BOM must contain at least one part line before creating a work order.',
      });
    }

    const actorUserId = ctx.actorUserId!;
    const now = new Date();
    const workOrderId = randomUUID();
    const status = dueAt ? 'SCHEDULED' : 'READY';
    const customerReference = customer && customer.ok ? customer.value : header.customerId;
    const title =
      body.value.title?.trim() ||
      `${header.vehicleDisplayName} build - ${header.configurationCode}`;
    const description =
      body.value.description?.trim() ||
      [
        `Created from released configuration ${header.configurationCode} v${header.configurationVersion}.`,
        `Approved BOM ${header.bomCode} rev ${header.revision}.`,
        routingHeader
          ? `Routing template ${routingHeader.routeCode} v${routingHeader.routeVersion}.`
          : undefined,
      ]
        .filter(Boolean)
        .join('\n');

    const operationIdByStage = new Map<string, string>();
    const operationIdByCode = new Map<string, string>();
    const operationIdBySkill = new Map<string, string>();
    const operationRows =
      routingSteps.length > 0
        ? routingSteps.map((step) => {
            const id = randomUUID();
            operationIdByCode.set(step.operationCode, id);
            if (step.requiredSkillCode) operationIdBySkill.set(step.requiredSkillCode, id);
            return {
              id,
              workOrderId,
              operationCode: step.operationCode,
              sequenceNo: step.sequenceNo,
              operationName: step.operationName,
              requiredSkillCode: step.requiredSkillCode ?? 'BUILD',
              estimatedMinutes: step.estimatedMinutes,
              routingTemplateStepId: step.id,
              standardLaborCostCents: standardLaborCostCents(
                step.estimatedMinutes,
                step.laborRateCents,
              ),
              operationStatus: 'READY' as const,
              correlationId: ctx.correlationId,
              createdAt: now,
              updatedAt: now,
            };
          })
        : (() => {
            const linesByStage = new Map<string, ReleasedBuildPackageLineRow[]>();
            for (const line of lines) {
              const stage = line.installStage ?? 'GENERAL';
              const stageLines = linesByStage.get(stage) ?? [];
              stageLines.push(line);
              linesByStage.set(stage, stageLines);
            }
            const stageEntries = Array.from(linesByStage.entries()).sort(
              ([a], [b]) => stageSortKey(a) - stageSortKey(b),
            );
            return stageEntries.map(([stage, stageLines], idx) => {
              const id = randomUUID();
              operationIdByStage.set(stage, id);
              return {
                id,
                workOrderId,
                operationCode: `BUILD-${stage.replace(/_/g, '-')}`,
                sequenceNo: (idx + 1) * 10,
                operationName: `${stageLabel(stage)} build`,
                requiredSkillCode: BUILD_STAGE_SKILL[stage] ?? BUILD_STAGE_SKILL.GENERAL,
                estimatedMinutes: Math.max(30, stageLines.length * 30),
                routingTemplateStepId: null,
                standardLaborCostCents: 0,
                operationStatus: 'READY' as const,
                correlationId: ctx.correlationId,
                createdAt: now,
                updatedAt: now,
              };
            });
          })();

    const firstOperationId = operationRows[0]?.id ?? null;
    const partRows = lines.map((line) => {
      const stage = line.installStage ?? 'GENERAL';
      const stageOperationCode = `BUILD-${stage.replace(/_/g, '-')}`;
      const operationId =
        operationIdByStage.get(stage) ??
        operationIdByCode.get(stage) ??
        operationIdByCode.get(stageOperationCode) ??
        operationIdBySkill.get(BUILD_STAGE_SKILL[stage] ?? '') ??
        firstOperationId;
      return {
        id: randomUUID(),
        workOrderId,
        workOrderOperationId: operationId,
        partId: line.partId,
        requestedQuantity: requestedBuildQuantity(line),
        reservedQuantity: 0,
        consumedQuantity: 0,
        partStatus: 'REQUESTED' as const,
        correlationId: ctx.correlationId,
        createdAt: now,
        updatedAt: now,
      };
    });
    const qcGateRows: PendingQcGateRow[] = [];
    for (const step of routingSteps) {
      const label = step.jobCardTitle?.trim() || step.operationName;
      if (step.qcRequired) {
        qcGateRows.push({
          id: randomUUID(),
          workOrderId,
          taskId: null,
          gateLabel: `${label} QC`,
          isCritical: true,
          result: null,
          failureNote: null,
          reviewedBy: null,
          reviewedAt: null,
          createdAt: now,
        });
      }
      if (step.evidenceRequired) {
        qcGateRows.push({
          id: randomUUID(),
          workOrderId,
          taskId: null,
          gateLabel: `${label} evidence`,
          isCritical: false,
          result: null,
          failureNote: null,
          reviewedBy: null,
          reviewedAt: null,
          createdAt: now,
        });
      }
    }

    const created = await db.$transaction(async (tx) => {
      await tx.workOrder.create({
        data: {
          id: workOrderId,
          workOrderNumber,
          vehicleId: vehicle.value,
          buildConfigurationId: buildConfiguration.value,
          bomId: bom.value,
          state: 'RELEASED' as const,
          scheduledStartAt: dueAt ?? null,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
          lastCorrelationId: ctx.correlationId,
          lastRequestId: ctx.requestId,
          createdAt: now,
          updatedAt: now,
        },
      });

      const workOrder = await tx.woOrder.create({
        data: {
          id: workOrderId,
          workOrderNumber,
          customerReference,
          assetReference: vehicle.value,
          title,
          description,
          status: status as 'READY' | 'SCHEDULED',
          priority: clampWorkOrderPriority(body.value.priority),
          stockLocationId: stockLocation && stockLocation.ok ? stockLocation.value : null,
          dueAt: dueAt ?? null,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
          correlationId: ctx.correlationId,
          openedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        select: {
          id: true,
          workOrderNumber: true,
          title: true,
          description: true,
          customerReference: true,
          assetReference: true,
          status: true,
          priority: true,
          stockLocationId: true,
          openedAt: true,
          dueAt: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await tx.woOperation.createMany({ data: operationRows });
      await tx.woPartLine.createMany({ data: partRows });
      if (qcGateRows.length > 0) {
        await tx.workOrderQcGate.createMany({ data: qcGateRows });
      }
      await tx.woStatusHistory.create({
        data: {
          id: randomUUID(),
          workOrderId,
          fromStatus: null,
          toStatus: status,
          reasonCode: 'BUILD_PACKAGE_RELEASED',
          reasonNote: `Created from ${header.configurationCode} / ${header.bomCode}`,
          actorUserId,
          correlationId: ctx.correlationId,
          createdAt: now,
        },
      });

      return workOrder;
    });

    return jsonResponse(201, { workOrder: toExecutionWorkOrderResponse(created) });
  },
  { requireAuth: true },
);

export const listTasksHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const rawWorkOrderId = qs.workOrderId;
    const rawTechnicianId = qs.technicianId;
    const state = qs.state as string | undefined;
    const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);

    const workOrderId = uuidOrNull(rawWorkOrderId);
    const technicianId = uuidOrNull(rawTechnicianId);

    // If the caller filtered by a non-UUID id, the result set is empty by
    // definition (no row can match). Short-circuit instead of round-tripping.
    if ((rawWorkOrderId && !workOrderId) || (rawTechnicianId && !technicianId)) {
      return jsonResponse(200, { items: [] });
    }

    const where = {
      ...(workOrderId ? { workOrderId } : {}),
      ...(technicianId ? { technicianId } : {}),
      ...(state
        ? { state: state as 'READY' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED' }
        : {}),
    };

    const items = await getPrisma().technicianTask.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    return jsonResponse(200, { items: await buildTaskResponses(items) });
  },
  { requireAuth: false },
);

export const createTaskHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<{ workOrderId: string; routingStepId: string; technicianId?: string }>(
      ctx.event,
    );
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const { workOrderId, routingStepId, technicianId } = body.value;
    if (!workOrderId) return jsonResponse(422, { message: 'workOrderId is required.' });
    if (!routingStepId) return jsonResponse(422, { message: 'routingStepId is required.' });

    const task = await getPrisma().technicianTask.create({
      data: {
        id: randomUUID(),
        workOrderId,
        routingStepId,
        technicianId: technicianId ?? null,
        state: 'READY',
        correlationId: ctx.correlationId,
        updatedAt: new Date(),
      },
    });

    return jsonResponse(201, { task: await buildTaskResponse(task) });
  },
  { requireAuth: false },
);

const TASK_TRANSITIONS: Record<string, string[]> = {
  READY: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'DONE', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

export const transitionTaskHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Task ID is required.' });

    const body = parseBody<{ state: string; blockedReason?: string; technicianId?: string }>(
      ctx.event,
    );
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const { state: nextState, blockedReason, technicianId } = body.value;
    if (!nextState) return jsonResponse(422, { message: 'state is required.' });
    if (technicianId && !UUID_RE.test(technicianId)) {
      return jsonResponse(422, { message: 'technicianId must be a valid UUID.' });
    }

    const existing = await getPrisma().technicianTask.findUnique({ where: { id } });
    if (!existing) return jsonResponse(404, { message: `Task not found: ${id}` });

    if (nextState === 'IN_PROGRESS' && !(technicianId ?? existing.technicianId)) {
      return jsonResponse(409, {
        message: 'Assign a technician before starting this task.',
        requiredAction: 'ASSIGN_TECHNICIAN',
      });
    }

    if (nextState === existing.state && technicianId) {
      const task = await getPrisma().technicianTask.update({
        where: { id },
        data: {
          technicianId,
          updatedAt: new Date(),
        },
      });
      return jsonResponse(200, { task: await buildTaskResponse(task) });
    }

    const allowed = TASK_TRANSITIONS[existing.state as string] ?? [];
    if (!allowed.includes(nextState)) {
      return jsonResponse(409, {
        message: `Cannot transition task from ${existing.state} to ${nextState}.`,
        allowedTransitions: allowed,
      });
    }

    const now = new Date();
    const task = await getPrisma().technicianTask.update({
      where: { id },
      data: {
        state: nextState as 'READY' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED',
        updatedAt: now,
        ...(nextState === 'IN_PROGRESS' && !existing.startedAt ? { startedAt: now } : {}),
        ...(nextState === 'DONE' ? { completedAt: now } : {}),
        ...(nextState === 'BLOCKED' && blockedReason ? { blockedReason } : {}),
        ...(technicianId ? { technicianId } : {}),
      },
    });

    return jsonResponse(200, { task: await buildTaskResponse(task) });
  },
  { requireAuth: false },
);

// ─── Rework Issues ────────────────────────────────────────────────────────────

export const listReworkHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const workOrderId = qs.workOrderId;
    const state = qs.state as string | undefined;
    const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);

    const where = {
      ...(workOrderId ? { workOrderId } : {}),
      ...(state
        ? { state: state as 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'REOPENED' | 'CLOSED' }
        : {}),
    };

    const items = await getPrisma().reworkIssue.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return jsonResponse(200, { items: items.map(toReworkResponse) });
  },
  { requireAuth: false },
);

export const createReworkHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<{
      workOrderId: string;
      title: string;
      description: string;
      severity: string;
      reportedBy: string;
      assignedTo?: string;
    }>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const { workOrderId, title, description, severity, reportedBy, assignedTo } = body.value;
    if (!workOrderId) return jsonResponse(422, { message: 'workOrderId is required.' });
    if (!title?.trim()) return jsonResponse(422, { message: 'title is required.' });
    if (!description?.trim()) return jsonResponse(422, { message: 'description is required.' });
    if (!severity) return jsonResponse(422, { message: 'severity is required.' });
    if (!reportedBy) return jsonResponse(422, { message: 'reportedBy is required.' });

    const issue = await getPrisma().reworkIssue.create({
      data: {
        id: randomUUID(),
        workOrderId,
        title: title.trim(),
        description: description.trim(),
        severity: severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
        state: 'OPEN',
        reportedBy,
        assignedTo: assignedTo ?? null,
        correlationId: ctx.correlationId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return jsonResponse(201, { issue: toReworkResponse(issue) });
  },
  { requireAuth: false },
);

// ─── Invoice Sync ─────────────────────────────────────────────────────────────

export const listInvoiceSyncHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const state = qs.state as string | undefined;
    const workOrderId = qs.workOrderId;
    const limit = Math.min(parseInt(qs.limit ?? '50', 10), 200);

    const where = {
      ...(state
        ? { state: state as 'PENDING' | 'IN_PROGRESS' | 'SYNCED' | 'FAILED' | 'CANCELLED' }
        : {}),
      ...(workOrderId ? { workOrderId } : {}),
    };

    const items = await getPrisma().invoiceSyncRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return jsonResponse(200, { items: items.map(toSyncResponse) });
  },
  { requireAuth: false },
);

// ─── QC Gates ─────────────────────────────────────────────────────────────────

export const getQcGatesHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const workOrderId = ctx.event.pathParameters?.workOrderId ?? qs.workOrderId;
    if (!workOrderId) return jsonResponse(400, { message: 'workOrderId is required.' });

    const gates = await getQcGateService().getGates({ workOrderId, taskId: qs.taskId });
    return jsonResponse(200, { gates });
  },
  { requireAuth: false },
);

export const batchSubmitQcGatesHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<{
      workOrderId: string;
      taskId?: string;
      reviewedBy: string;
      results: Array<{
        gateLabel: string;
        isCritical: boolean;
        result: 'PASS' | 'FAIL' | 'NA';
        failureNote?: string;
      }>;
    }>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const workOrderId = ctx.event.pathParameters?.workOrderId ?? body.value.workOrderId;
    const { taskId, reviewedBy, results } = body.value;
    if (!workOrderId) return jsonResponse(400, { message: 'workOrderId is required.' });
    if (!reviewedBy) return jsonResponse(400, { message: 'reviewedBy is required.' });
    if (!results || results.length === 0)
      return jsonResponse(400, { message: 'results array must not be empty.' });

    const outcome = await getQcGateService().batchSubmit({
      workOrderId,
      taskId,
      reviewedBy,
      results,
      correlationId: ctx.correlationId,
    });

    return jsonResponse(200, {
      ...outcome,
      status: outcome.overallResult,
      openReworkCount: outcome.reworkIssuesCreated,
    });
  },
  { requireAuth: false },
);

// ─── Labor Time Entries ───────────────────────────────────────────────────────

export const listTimeEntriesHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const workOrderId = ctx.event.pathParameters?.workOrderId ?? qs.workOrderId;
    if (!workOrderId) return jsonResponse(400, { message: 'workOrderId is required.' });

    const entries = await getTimeEntryService().listEntries({
      workOrderId,
      technicianId: qs.technicianId,
    });
    return jsonResponse(200, { entries });
  },
  { requireAuth: false },
);

export const createTimeEntryHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<CreateLaborTimeEntryInput>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const input = body.value;
    if (!input.workOrderId) return jsonResponse(422, { message: 'workOrderId is required.' });
    if (!input.technicianId) return jsonResponse(422, { message: 'technicianId is required.' });
    if (!input.startedAt) return jsonResponse(422, { message: 'startedAt is required.' });

    const entry = await getTimeEntryService().createEntry({
      ...input,
      correlationId: ctx.correlationId,
    });
    return jsonResponse(201, { entry });
  },
  { requireAuth: false },
);

export const updateTimeEntryHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Time entry ID is required.' });

    const body = parseBody<{ endedAt?: string; manualHours?: number; description?: string }>(
      ctx.event,
    );
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const entry = await getTimeEntryService().updateEntry(id, body.value, ctx.correlationId);
    return jsonResponse(200, { entry });
  },
  { requireAuth: false },
);

export const deleteTimeEntryHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Time entry ID is required.' });

    await getTimeEntryService().deleteEntry(id);
    return jsonResponse(204, {});
  },
  { requireAuth: false },
);

// ─── Response mappers ─────────────────────────────────────────────────────────

function toTaskResponse(
  r: {
    id: string;
    workOrderId: string;
    routingStepId: string;
    technicianId: string | null;
    state: string;
    startedAt?: Date | null;
    completedAt?: Date | null;
    blockedReason?: string | null;
    updatedAt: Date;
  },
  context?: {
    workOrder?: { workOrderNumber: string; title: string };
    routingStep?: { stepName: string; stepCode: string; sequenceNo: number };
  },
) {
  return {
    id: r.id,
    workOrderId: r.workOrderId,
    workOrderNumber: context?.workOrder?.workOrderNumber,
    workOrderTitle: context?.workOrder?.title,
    routingStepId: r.routingStepId,
    routingStepTitle: context?.routingStep
      ? `${context.routingStep.sequenceNo}. ${context.routingStep.stepName}`
      : undefined,
    routingStepCode: context?.routingStep?.stepCode,
    technicianId: r.technicianId ?? undefined,
    state: r.state,
    startedAt: r.startedAt?.toISOString(),
    completedAt: r.completedAt?.toISOString(),
    blockedReason: r.blockedReason ?? undefined,
    updatedAt: r.updatedAt.toISOString(),
  };
}

type TechnicianTaskRecord = Parameters<typeof toTaskResponse>[0];

interface TechnicianTaskWorkOrderSummary {
  id: string;
  workOrderNumber: string;
  title: string;
}

interface TechnicianTaskRoutingStepSummary {
  id: string;
  stepName: string;
  stepCode: string;
  sequenceNo: number;
}

interface TechnicianTaskContextPrisma {
  woOrder?: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; workOrderNumber: true; title: true };
    }): Promise<TechnicianTaskWorkOrderSummary[]>;
  };
  routingSopStep?: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; stepName: true; stepCode: true; sequenceNo: true };
    }): Promise<TechnicianTaskRoutingStepSummary[]>;
  };
}

async function buildTaskResponse(task: TechnicianTaskRecord) {
  const [response] = await buildTaskResponses([task]);
  return response ?? toTaskResponse(task);
}

async function buildTaskResponses(tasks: TechnicianTaskRecord[]) {
  if (tasks.length === 0) return [];
  const db = getPrisma() as unknown as TechnicianTaskContextPrisma;
  const workOrderIds = compactUuidIds(tasks.map((task) => task.workOrderId));
  const routingStepIds = compactUuidIds(tasks.map((task) => task.routingStepId));

  const [workOrders, routingSteps] = await Promise.all([
    db.woOrder?.findMany && workOrderIds.length > 0
      ? db.woOrder.findMany({
          where: { id: { in: workOrderIds } },
          select: { id: true, workOrderNumber: true, title: true },
        })
      : Promise.resolve([]),
    db.routingSopStep?.findMany && routingStepIds.length > 0
      ? db.routingSopStep.findMany({
          where: { id: { in: routingStepIds } },
          select: { id: true, stepName: true, stepCode: true, sequenceNo: true },
        })
      : Promise.resolve([]),
  ]);

  const workOrdersById = new Map(workOrders.map((workOrder) => [workOrder.id, workOrder]));
  const routingStepsById = new Map(routingSteps.map((step) => [step.id, step]));

  return tasks.map((task) =>
    toTaskResponse(task, {
      workOrder: workOrdersById.get(task.workOrderId),
      routingStep: routingStepsById.get(task.routingStepId),
    }),
  );
}

function toReworkResponse(r: {
  id: string;
  workOrderId: string;
  title: string;
  description: string;
  severity: string;
  state: string;
  reportedBy: string;
  assignedTo: string | null;
  createdAt: Date;
  resolvedAt?: Date | null;
}) {
  return {
    id: r.id,
    workOrderId: r.workOrderId,
    title: r.title,
    description: r.description,
    severity: r.severity,
    state: r.state,
    reportedBy: r.reportedBy,
    assignedTo: r.assignedTo ?? undefined,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString(),
  };
}

function toSyncResponse(r: {
  id: string;
  invoiceNumber: string;
  workOrderId: string;
  provider: string;
  state: string;
  attemptCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  externalReference: string | null;
  createdAt: Date;
  syncedAt?: Date | null;
}) {
  return {
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    workOrderId: r.workOrderId,
    provider: r.provider,
    state: r.state,
    attemptCount: r.attemptCount,
    lastErrorCode: r.lastErrorCode ?? undefined,
    lastErrorMessage: r.lastErrorMessage ?? undefined,
    externalReference: r.externalReference ?? undefined,
    createdAt: r.createdAt.toISOString(),
    syncedAt: r.syncedAt?.toISOString(),
  };
}

// ─── Work Order Queue (floor-tech) ───────────────────────────────────────────

type WoStatus =
  | 'DRAFT'
  | 'READY'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'CANCELLED';

const ACTIVE_WO_STATUSES: WoStatus[] = ['READY', 'SCHEDULED', 'IN_PROGRESS', 'BLOCKED'];

function mapWoStatus(status: string): WoStatus {
  if (isWoStatus(status)) return status;
  return 'READY';
}

function isWoStatus(value: string): value is WoStatus {
  return [
    'DRAFT',
    'READY',
    'SCHEDULED',
    'IN_PROGRESS',
    'BLOCKED',
    'COMPLETED',
    'CANCELLED',
  ].includes(value);
}

function formatAge(date: Date | null): string {
  if (!date) return 'Unknown';
  const ms = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `Started ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Started ${hours}h ago`;
  return `Started ${Math.floor(hours / 24)}d ago`;
}

interface WoOperation {
  id: string;
  operationCode?: string;
  sequenceNo?: number;
  operationName: string;
  operationStatus: string;
  requiredSkillCode?: string | null;
  estimatedMinutes?: number;
  blockingReason?: string | null;
  actualStartAt?: Date | null;
  actualEndAt?: Date | null;
  updatedAt?: Date | null;
}

type WoOperationStatus =
  | 'PENDING'
  | 'READY'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'DONE'
  | 'SKIPPED'
  | 'CANCELLED';

const WO_OPERATION_STATUSES: WoOperationStatus[] = [
  'PENDING',
  'READY',
  'IN_PROGRESS',
  'BLOCKED',
  'DONE',
  'SKIPPED',
  'CANCELLED',
];

const TERMINAL_WO_OPERATION_STATUSES: WoOperationStatus[] = ['DONE', 'SKIPPED', 'CANCELLED'];

const WO_OPERATION_TRANSITIONS: Record<WoOperationStatus, WoOperationStatus[]> = {
  PENDING: ['READY', 'CANCELLED'],
  READY: ['IN_PROGRESS', 'BLOCKED', 'SKIPPED', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'DONE', 'SKIPPED', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
  DONE: [],
  SKIPPED: [],
  CANCELLED: [],
};

function isWoOperationStatus(value: string): value is WoOperationStatus {
  return WO_OPERATION_STATUSES.includes(value as WoOperationStatus);
}

function deriveWoStatusFromOperations(
  currentStatus: WoStatus,
  operations: Array<{ operationStatus: string }>,
): WoStatus {
  if (currentStatus === 'CANCELLED') return currentStatus;
  if (operations.length === 0) return currentStatus;

  if (operations.some((operation) => operation.operationStatus === 'BLOCKED')) {
    return 'BLOCKED';
  }
  if (operations.some((operation) => operation.operationStatus === 'IN_PROGRESS')) {
    return 'IN_PROGRESS';
  }
  if (operations.every((operation) => operation.operationStatus === 'CANCELLED')) {
    return 'CANCELLED';
  }
  if (
    operations.every((operation) =>
      TERMINAL_WO_OPERATION_STATUSES.includes(operation.operationStatus as WoOperationStatus),
    )
  ) {
    return 'COMPLETED';
  }

  return currentStatus === 'SCHEDULED' ? 'SCHEDULED' : 'READY';
}

interface WoPart {
  id: string;
  partId: string;
  partStatus: string;
  requestedQuantity?: unknown;
  reservedQuantity?: unknown;
  consumedQuantity?: unknown;
  part?: { name?: string; sku?: string } | null;
}

interface WoDetailOrder {
  id: string;
  workOrderNumber: string;
  title: string;
  customerReference?: string | null;
  assetReference?: string | null;
  stockLocation?: { locationName?: string | null } | null;
  status: string;
  dueAt?: Date | null;
  operations?: WoOperation[];
  parts?: WoPart[];
  statusHistory?: WoStatusHistoryRecord[];
}

interface WoStatusHistoryRecord {
  id: string;
  fromStatus?: string | null;
  toStatus: string;
  reasonCode?: string | null;
  reasonNote?: string | null;
  actorUserId?: string | null;
  correlationId: string;
  createdAt: Date;
}

interface WorkOrderCommercialContext {
  customerProfile?: {
    id: string;
    fullName: string;
    companyName?: string;
    email: string;
    phone?: string;
    billingAddress?: string;
    shippingAddress?: string;
    state: string;
    preferredContactMethod: string;
    externalReference?: string;
  };
  cartProfile?: {
    id: string;
    vin: string;
    serialNumber: string;
    modelCode: string;
    modelYear: number;
    customerId: string;
    state: string;
  };
  quotes: Array<{
    id: string;
    quoteNumber: string;
    status: string;
    total: number;
    validUntil?: string;
    convertedWoId?: string;
    updatedAt: string;
  }>;
  opportunities: Array<{
    id: string;
    title: string;
    stage: string;
    probability: number;
    estimatedValue?: number;
    expectedCloseDate?: string;
    wonWorkOrderId?: string;
    updatedAt: string;
  }>;
  activities: Array<{
    id: string;
    activityType: string;
    subject: string;
    body?: string;
    dueDate?: string;
    completedAt?: string;
    createdAt: string;
  }>;
}

interface WorkOrderBuildProvenance {
  configuration?: {
    id: string;
    code: string;
    version: number;
    status: string;
    releasedAt?: string;
    updatedAt?: string;
  };
  bom?: {
    id: string;
    code: string;
    revision: number;
    status: string;
    approvedAt?: string;
    lineCount: number;
  };
  routingTemplate?: {
    id: string;
    code: string;
    name: string;
    version: number;
    status: string;
    stepCount: number;
  };
  latestChanges: Array<{
    id: string;
    entityType: 'CONFIGURATION' | 'BOM' | 'ROUTE';
    recordCode: string;
    versionLabel: string;
    changeKind: string;
    changeSummary: string;
    approvalNote?: string;
    approvedBy?: string;
    approvedAt?: string;
    createdAt: string;
  }>;
}

const EMPTY_COMMERCIAL_CONTEXT: WorkOrderCommercialContext = {
  quotes: [],
  opportunities: [],
  activities: [],
};

interface WorkOrderBuildProvenanceHeaderRow {
  buildConfigurationId: string | null;
  configurationCode: string | null;
  configurationVersion: number | null;
  configurationStatus: string | null;
  configurationReleasedAt: Date | string | null;
  configurationUpdatedAt: Date | string | null;
  bomId: string | null;
  bomCode: string | null;
  bomRevision: number | null;
  bomStatus: string | null;
  bomApprovedAt: Date | string | null;
  bomLineCount: number | bigint | null;
  routingTemplateId: string | null;
  routeCode: string | null;
  routeName: string | null;
  routeVersion: number | null;
  routeStatus: string | null;
  routeStepCount: number | bigint | null;
}

interface WorkOrderBuildProvenanceChangeRow {
  id: string;
  entityType: 'CONFIGURATION' | 'BOM' | 'ROUTE';
  entityId: string;
  recordCode: string;
  versionLabel: string;
  changeKind: string;
  changeSummary: string;
  approvalNote: string | null;
  approvedBy: string | null;
  approvedAt: Date | string | null;
  createdAt: Date | string;
}

interface WorkOrderReservationRow {
  id: string;
  status: string;
  reservedQuantity: unknown;
  consumedQuantity: unknown;
  allocatedQuantity: unknown;
  reservationPriority: number;
  shortageReason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  partId: string;
  partSku: string;
  partName: string;
  unitOfMeasure: string;
  stockLocationId: string;
  locationName: string;
  stockLotId: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  workOrderId: string;
  workOrderNumber: string | null;
  workOrderTitle: string | null;
  workOrderPartId: string | null;
}

function numberFromDb(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  if (value && typeof value === 'object' && 'toNumber' in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  return 0;
}

function workOrderPartOpenQuantity(part: WoPart): number {
  return Math.max(
    numberFromDb(part.requestedQuantity) -
      numberFromDb(part.reservedQuantity) -
      numberFromDb(part.consumedQuantity),
    0,
  );
}

function toWorkOrderReservationResponse(r: WorkOrderReservationRow) {
  const reservedQuantity = numberFromDb(r.reservedQuantity);
  const consumedQuantity = numberFromDb(r.consumedQuantity);
  const allocatedQuantity = numberFromDb(r.allocatedQuantity);
  const isOpen = r.status === 'ACTIVE' || r.status === 'PARTIALLY_CONSUMED';

  return {
    id: r.id,
    status: r.status,
    reservedQuantity,
    consumedQuantity,
    allocatedQuantity,
    openQuantity: isOpen ? Math.max(reservedQuantity - consumedQuantity - allocatedQuantity, 0) : 0,
    reservationPriority: r.reservationPriority,
    shortageReason: r.shortageReason ?? undefined,
    expiresAt: r.expiresAt?.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    partId: r.partId,
    partSku: r.partSku,
    partName: r.partName,
    unitOfMeasure: r.unitOfMeasure,
    stockLocationId: r.stockLocationId,
    locationName: r.locationName,
    stockLotId: r.stockLotId ?? undefined,
    lotNumber: r.lotNumber ?? r.stockLotId ?? undefined,
    serialNumber: r.serialNumber ?? undefined,
    workOrderId: r.workOrderId,
    workOrderNumber: r.workOrderNumber ?? undefined,
    workOrderTitle: r.workOrderTitle ?? undefined,
    workOrderPartId: r.workOrderPartId ?? undefined,
  };
}

function optionalIso(value?: Date | null): string | undefined {
  return value ? value.toISOString() : undefined;
}

function isoFromDb(value?: Date | string | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function isUuid(value?: string | null): value is string {
  return Boolean(value && UUID_RE.test(value));
}

function toBuildProvenanceChange(
  row: WorkOrderBuildProvenanceChangeRow,
): WorkOrderBuildProvenance['latestChanges'][number] {
  return {
    id: row.id,
    entityType: row.entityType,
    recordCode: row.recordCode,
    versionLabel: row.versionLabel,
    changeKind: row.changeKind,
    changeSummary: row.changeSummary,
    approvalNote: row.approvalNote ?? undefined,
    approvedBy: row.approvedBy ?? undefined,
    approvedAt: isoFromDb(row.approvedAt),
    createdAt: isoFromDb(row.createdAt) ?? new Date(0).toISOString(),
  };
}

function toCustomerProfileResponse(r: {
  id: string;
  fullName: string;
  companyName?: string | null;
  email: string;
  phone?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  state: string;
  preferredContactMethod: string;
  externalReference?: string | null;
}) {
  return {
    id: r.id,
    fullName: r.fullName,
    companyName: r.companyName ?? undefined,
    email: r.email,
    phone: r.phone ?? undefined,
    billingAddress: r.billingAddress ?? undefined,
    shippingAddress: r.shippingAddress ?? undefined,
    state: r.state,
    preferredContactMethod: r.preferredContactMethod,
    externalReference: r.externalReference ?? undefined,
  };
}

function toCartProfileResponse(r: {
  id: string;
  vin: string;
  serialNumber: string;
  modelCode: string;
  modelYear: number;
  customerId: string;
  state: string;
}) {
  return {
    id: r.id,
    vin: r.vin,
    serialNumber: r.serialNumber,
    modelCode: r.modelCode,
    modelYear: r.modelYear,
    customerId: r.customerId,
    state: r.state,
  };
}

function toQuoteSummaryResponse(r: {
  id: string;
  quoteNumber: string;
  status: string;
  total: unknown;
  validUntil?: Date | null;
  convertedWoId?: string | null;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    quoteNumber: r.quoteNumber,
    status: r.status,
    total: numberFromDb(r.total),
    validUntil: optionalIso(r.validUntil),
    convertedWoId: r.convertedWoId ?? undefined,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toOpportunitySummaryResponse(r: {
  id: string;
  title: string;
  stage: string;
  probability: number;
  estimatedValue?: unknown;
  expectedCloseDate?: Date | null;
  wonWorkOrderId?: string | null;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    title: r.title,
    stage: r.stage,
    probability: r.probability,
    estimatedValue: r.estimatedValue == null ? undefined : numberFromDb(r.estimatedValue),
    expectedCloseDate: optionalIso(r.expectedCloseDate),
    wonWorkOrderId: r.wonWorkOrderId ?? undefined,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toSalesActivitySummaryResponse(r: {
  id: string;
  activityType: string;
  subject: string;
  body?: string | null;
  dueDate?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
}) {
  return {
    id: r.id,
    activityType: r.activityType,
    subject: r.subject,
    body: r.body ?? undefined,
    dueDate: optionalIso(r.dueDate),
    completedAt: optionalIso(r.completedAt),
    createdAt: r.createdAt.toISOString(),
  };
}

function toStatusHistoryResponse(r: WoStatusHistoryRecord) {
  return {
    id: r.id,
    fromStatus: r.fromStatus ?? undefined,
    toStatus: r.toStatus,
    reasonCode: r.reasonCode ?? undefined,
    reasonNote: r.reasonNote ?? undefined,
    actorUserId: r.actorUserId ?? undefined,
    correlationId: r.correlationId,
    createdAt: r.createdAt.toISOString(),
  };
}

function toOperationChecklistResponse(operation: {
  id: string;
  operationCode?: string | null;
  sequenceNo?: number | null;
  operationName: string;
  operationStatus: string;
  requiredSkillCode?: string | null;
  estimatedMinutes?: number | null;
  blockingReason?: string | null;
  actualStartAt?: Date | null;
  actualEndAt?: Date | null;
  updatedAt?: Date | null;
}) {
  return {
    id: operation.id,
    label: operation.operationName,
    done: TERMINAL_WO_OPERATION_STATUSES.includes(operation.operationStatus as WoOperationStatus),
    operationCode: operation.operationCode ?? undefined,
    sequenceNo: operation.sequenceNo ?? undefined,
    status: operation.operationStatus,
    requiredSkillCode: operation.requiredSkillCode ?? undefined,
    estimatedMinutes: operation.estimatedMinutes ?? undefined,
    blockingReason: operation.blockingReason ?? undefined,
    actualStartAt: optionalIso(operation.actualStartAt),
    actualEndAt: optionalIso(operation.actualEndAt),
    updatedAt: optionalIso(operation.updatedAt),
  };
}

async function resolveCustomerProfile(reference?: string | null) {
  if (!reference?.trim()) return undefined;
  const value = reference.trim();
  const customer = await getPrisma().customer.findFirst({
    where: {
      OR: [
        ...(isUuid(value) ? [{ id: value }] : []),
        { externalReference: value },
        { fullName: { contains: value, mode: 'insensitive' as const } },
        { companyName: { contains: value, mode: 'insensitive' as const } },
        { email: { contains: value, mode: 'insensitive' as const } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  });

  return customer ? toCustomerProfileResponse(customer) : undefined;
}

async function resolveCartProfile(reference?: string | null, customerId?: string) {
  if (!reference?.trim() && !customerId) return undefined;
  const value = reference?.trim();
  const cart = await getPrisma().cartVehicle.findFirst({
    where: {
      ...(customerId ? { customerId } : {}),
      ...(value
        ? {
            OR: [
              ...(isUuid(value) ? [{ id: value }] : []),
              { vin: { contains: value, mode: 'insensitive' as const } },
              { serialNumber: { contains: value, mode: 'insensitive' as const } },
              { modelCode: { contains: value, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: 'desc' },
  });

  return cart ? toCartProfileResponse(cart) : undefined;
}

async function buildCommercialContext(order: {
  id: string;
  customerReference?: string | null;
  assetReference?: string | null;
}): Promise<WorkOrderCommercialContext> {
  const customerProfile = await resolveCustomerProfile(order.customerReference);
  const cartProfile = await resolveCartProfile(order.assetReference, customerProfile?.id);
  const quoteWhere = customerProfile
    ? { OR: [{ customerId: customerProfile.id }, { convertedWoId: order.id }] }
    : { convertedWoId: order.id };
  const opportunityWhere = customerProfile
    ? { OR: [{ customerId: customerProfile.id }, { wonWorkOrderId: order.id }] }
    : { wonWorkOrderId: order.id };

  const [quotes, opportunities, activities] = await Promise.all([
    getPrisma().quote.findMany({
      where: quoteWhere,
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
    getPrisma().salesOpportunity.findMany({
      where: opportunityWhere,
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
    customerProfile
      ? getPrisma().salesActivity.findMany({
          where: { customerId: customerProfile.id },
          orderBy: { createdAt: 'desc' },
          take: 5,
        })
      : Promise.resolve([]),
  ]);

  return {
    customerProfile,
    cartProfile,
    quotes: quotes.map(toQuoteSummaryResponse),
    opportunities: opportunities.map(toOpportunitySummaryResponse),
    activities: activities.map(toSalesActivitySummaryResponse),
  };
}

async function loadWorkOrderBuildProvenance(
  workOrderId: string,
): Promise<WorkOrderBuildProvenance | undefined> {
  const [header] = await getPrisma().$queryRaw<WorkOrderBuildProvenanceHeaderRow[]>`
    SELECT
      pwo.build_configuration_id AS "buildConfigurationId",
      bc.configuration_code AS "configurationCode",
      bc.configuration_version AS "configurationVersion",
      bc.configuration_status::text AS "configurationStatus",
      bc.released_at AS "configurationReleasedAt",
      bc.updated_at AS "configurationUpdatedAt",
      pwo.bom_id AS "bomId",
      b.bom_code AS "bomCode",
      b.revision AS "bomRevision",
      b.bom_status::text AS "bomStatus",
      b.approved_at AS "bomApprovedAt",
      coalesce(bom_lines.line_count, 0)::int AS "bomLineCount",
      route.routing_template_id AS "routingTemplateId",
      route.route_code AS "routeCode",
      route.route_name AS "routeName",
      route.route_version AS "routeVersion",
      route.template_status AS "routeStatus",
      coalesce(route.step_count, 0)::int AS "routeStepCount"
    FROM work_orders.work_orders wo
    LEFT JOIN planning.work_orders pwo
      ON pwo.id = wo.id OR pwo.work_order_number = wo.work_order_number
    LEFT JOIN planning.build_configurations bc
      ON bc.id::text = pwo.build_configuration_id
    LEFT JOIN planning.build_boms b
      ON b.id::text = pwo.bom_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS line_count
      FROM planning.build_bom_lines bl
      WHERE bl.bom_id = b.id
    ) bom_lines ON true
    LEFT JOIN LATERAL (
      SELECT
        rt.id::text AS routing_template_id,
        rt.route_code,
        rt.route_name,
        rt.route_version,
        rt.template_status::text AS template_status,
        count(distinct rts_all.id)::int AS step_count,
        min(op.sequence_no) AS first_sequence
      FROM work_orders.work_order_operations op
      JOIN planning.routing_template_steps rts
        ON rts.id = op.routing_template_step_id
      JOIN planning.routing_templates rt
        ON rt.id = rts.routing_template_id
      LEFT JOIN planning.routing_template_steps rts_all
        ON rts_all.routing_template_id = rt.id
      WHERE op.work_order_id = wo.id
      GROUP BY rt.id, rt.route_code, rt.route_name, rt.route_version, rt.template_status
      ORDER BY first_sequence ASC
      LIMIT 1
    ) route ON true
    WHERE wo.id = ${workOrderId}::uuid
    LIMIT 1
  `;

  if (!header?.buildConfigurationId && !header?.bomId && !header?.routingTemplateId) {
    return undefined;
  }

  const latestChanges = await getPrisma().$queryRaw<WorkOrderBuildProvenanceChangeRow[]>`
    WITH events AS (
      SELECT
        id::text AS id,
        'CONFIGURATION'::text AS entity_type,
        build_configuration_id::text AS entity_id,
        configuration_code AS record_code,
        concat('v', configuration_version::text) AS version_label,
        change_kind::text AS change_kind,
        change_summary,
        approval_note,
        coalesce(approved_by_ref, approved_by_user_id::text) AS approved_by,
        approved_at,
        created_at
      FROM planning.build_configuration_change_events
      UNION ALL
      SELECT
        id::text AS id,
        'BOM'::text AS entity_type,
        bom_id::text AS entity_id,
        bom_code AS record_code,
        concat('rev ', revision::text) AS version_label,
        change_kind::text AS change_kind,
        change_summary,
        approval_note,
        coalesce(approved_by_ref, approved_by_user_id::text) AS approved_by,
        approved_at,
        created_at
      FROM planning.build_bom_change_events
      UNION ALL
      SELECT
        id::text AS id,
        'ROUTE'::text AS entity_type,
        routing_template_id::text AS entity_id,
        route_code AS record_code,
        concat('v', route_version::text) AS version_label,
        change_kind::text AS change_kind,
        change_summary,
        approval_note,
        coalesce(approved_by_ref, approved_by_user_id::text) AS approved_by,
        approved_at,
        created_at
      FROM planning.routing_template_change_events
    )
    SELECT
      id,
      entity_type AS "entityType",
      entity_id AS "entityId",
      record_code AS "recordCode",
      version_label AS "versionLabel",
      change_kind AS "changeKind",
      change_summary AS "changeSummary",
      approval_note AS "approvalNote",
      approved_by AS "approvedBy",
      approved_at AS "approvedAt",
      created_at AS "createdAt"
    FROM events
    WHERE
      (entity_type = 'CONFIGURATION' AND entity_id = ${header.buildConfigurationId ?? ''})
      OR (entity_type = 'BOM' AND entity_id = ${header.bomId ?? ''})
      OR (entity_type = 'ROUTE' AND entity_id = ${header.routingTemplateId ?? ''})
    ORDER BY created_at DESC, id DESC
    LIMIT 6
  `;

  return {
    configuration:
      header.buildConfigurationId && header.configurationCode
        ? {
            id: header.buildConfigurationId,
            code: header.configurationCode,
            version: Number(header.configurationVersion ?? 0),
            status: header.configurationStatus ?? 'UNKNOWN',
            releasedAt: isoFromDb(header.configurationReleasedAt),
            updatedAt: isoFromDb(header.configurationUpdatedAt),
          }
        : undefined,
    bom:
      header.bomId && header.bomCode
        ? {
            id: header.bomId,
            code: header.bomCode,
            revision: Number(header.bomRevision ?? 0),
            status: header.bomStatus ?? 'UNKNOWN',
            approvedAt: isoFromDb(header.bomApprovedAt),
            lineCount: Number(header.bomLineCount ?? 0),
          }
        : undefined,
    routingTemplate:
      header.routingTemplateId && header.routeCode
        ? {
            id: header.routingTemplateId,
            code: header.routeCode,
            name: header.routeName ?? header.routeCode,
            version: Number(header.routeVersion ?? 0),
            status: header.routeStatus ?? 'UNKNOWN',
            stepCount: Number(header.routeStepCount ?? 0),
          }
        : undefined,
    latestChanges: latestChanges.map(toBuildProvenanceChange),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toQueueItem(order: any) {
  const ops: WoOperation[] = order.operations ?? [];
  const parts: WoPart[] = order.parts ?? [];
  const doneOps = ops.filter((op) =>
    ['DONE', 'SKIPPED', 'CANCELLED'].includes(op.operationStatus),
  ).length;
  const firstPending = ops.find(
    (op) => !['DONE', 'SKIPPED', 'CANCELLED'].includes(op.operationStatus),
  );
  const shortageCount = parts.filter((p) => p.partStatus === 'SHORT').length;
  const materialReadiness =
    parts.length === 0
      ? 'READY'
      : shortageCount > 0
        ? 'NOT_READY'
        : parts.some((p) => workOrderPartOpenQuantity(p) > 0)
          ? 'PARTIAL'
          : 'READY';
  return {
    id: order.id,
    number: order.workOrderNumber,
    title: order.title,
    customer: order.customerReference ?? 'Unknown customer',
    cart: order.assetReference ?? '—',
    bay: order.stockLocation?.locationName ?? '—',
    age: formatAge(order.openedAt),
    status: mapWoStatus(order.status),
    materialReadiness,
    shortageCount: shortageCount || undefined,
    reworkLoop: 0,
    syncStatus: 'SYNCED',
    checklistCompletion:
      ops.length > 0 ? `${doneOps} / ${ops.length} ops complete` : 'No operations',
    nextAction: firstPending?.operationName ?? 'All operations complete',
  };
}

function toDetailItem(
  order: WoDetailOrder,
  reservations: WorkOrderReservationRow[] = [],
  commercialContext: WorkOrderCommercialContext = EMPTY_COMMERCIAL_CONTEXT,
  buildProvenance?: WorkOrderBuildProvenance,
) {
  const ops: WoOperation[] = order.operations ?? [];
  const partLines: WoPart[] = order.parts ?? [];
  const reservationResponses = reservations.map(toWorkOrderReservationResponse);
  const reservationsByPartLine = new Map<string, typeof reservationResponses>();
  for (const reservation of reservationResponses) {
    if (!reservation.workOrderPartId) continue;
    const current = reservationsByPartLine.get(reservation.workOrderPartId) ?? [];
    current.push(reservation);
    reservationsByPartLine.set(reservation.workOrderPartId, current);
  }

  const shortageCount = partLines.filter((p) => p.partStatus === 'SHORT').length;
  const materialReadiness =
    partLines.length === 0
      ? 'READY'
      : shortageCount > 0
        ? 'NOT_READY'
        : partLines.some((p) => workOrderPartOpenQuantity(p) > 0)
          ? 'PARTIAL'
          : 'READY';
  return {
    id: order.id,
    number: order.workOrderNumber,
    title: order.title,
    customerReference: order.customerReference ?? undefined,
    assetReference: order.assetReference ?? undefined,
    customer: order.customerReference ?? 'Unknown customer',
    cart: order.assetReference ?? '—',
    customerProfile: commercialContext.customerProfile,
    cartProfile: commercialContext.cartProfile,
    buildProvenance,
    commercialContext: {
      quotes: commercialContext.quotes,
      opportunities: commercialContext.opportunities,
      activities: commercialContext.activities,
    },
    bay: order.stockLocation?.locationName ?? '—',
    status: mapWoStatus(order.status),
    eta: order.dueAt ? new Date(order.dueAt).toLocaleDateString() : 'No due date',
    syncStatus: 'SYNCED',
    materialReadiness,
    shortageCount: shortageCount || undefined,
    reworkLoop: 0,
    checklist: ops.map(toOperationChecklistResponse),
    parts: partLines.map((p) => {
      const requestedQuantity = numberFromDb(p.requestedQuantity);
      const reservedQuantity = numberFromDb(p.reservedQuantity);
      const consumedQuantity = numberFromDb(p.consumedQuantity);
      return {
        id: p.id,
        partId: p.partId,
        partSku: p.part?.sku ?? p.partId,
        name: p.part?.name ?? p.partId,
        qty: requestedQuantity,
        requestedQuantity,
        reservedQuantity,
        consumedQuantity,
        openQuantity: Math.max(requestedQuantity - reservedQuantity - consumedQuantity, 0),
        state: p.partStatus,
        reservations: reservationsByPartLine.get(p.id) ?? [],
      };
    }),
    reservations: reservationResponses,
    notes: [] as { id: string; author: string; message: string; createdAt: string }[],
    statusHistory: ((order.statusHistory ?? []) as WoStatusHistoryRecord[]).map(
      toStatusHistoryResponse,
    ),
  };
}

export const transitionWoOperationHandler = wrapHandler(
  async (ctx) => {
    const workOrderId = ctx.event.pathParameters?.workOrderId;
    const operationId = ctx.event.pathParameters?.operationId ?? ctx.event.pathParameters?.id;
    if (!workOrderId) return jsonResponse(400, { message: 'Work order ID is required.' });
    if (!operationId) return jsonResponse(400, { message: 'Operation ID is required.' });

    const body = parseBody<{
      status?: string;
      state?: string;
      blockingReason?: string;
      reasonCode?: string;
      reasonNote?: string;
      actorUserId?: string;
    }>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const nextStatus = body.value.status ?? body.value.state;
    if (!nextStatus) return jsonResponse(422, { message: 'status is required.' });
    if (!isWoOperationStatus(nextStatus)) {
      return jsonResponse(422, { message: `Invalid operation status: ${nextStatus}` });
    }

    const blockingReason = body.value.blockingReason?.trim();
    if (nextStatus === 'BLOCKED' && !blockingReason) {
      return jsonResponse(422, {
        message: 'blockingReason is required when blocking an operation.',
      });
    }

    const operation = await getPrisma().woOperation.findUnique({
      where: { id: operationId },
      include: {
        workOrder: { select: { id: true, status: true, completedAt: true, updatedAt: true } },
      },
    });
    if (!operation || operation.workOrderId !== workOrderId) {
      return jsonResponse(404, { message: `Operation not found: ${operationId}` });
    }

    const workOrderStatus = mapWoStatus(operation.workOrder.status);
    if (['COMPLETED', 'CANCELLED'].includes(workOrderStatus)) {
      return jsonResponse(409, {
        message: `Cannot change operations on ${workOrderStatus.toLowerCase()} work orders.`,
      });
    }

    const currentStatus = operation.operationStatus;
    if (!isWoOperationStatus(currentStatus)) {
      return jsonResponse(409, { message: `Operation has unsupported status: ${currentStatus}` });
    }

    if (currentStatus === nextStatus) {
      return jsonResponse(200, {
        operation: toOperationChecklistResponse(operation),
        workOrder: {
          id: operation.workOrder.id,
          status: workOrderStatus,
          completedAt: optionalIso(operation.workOrder.completedAt),
          updatedAt: optionalIso(operation.workOrder.updatedAt),
        },
      });
    }

    const allowedTransitions = WO_OPERATION_TRANSITIONS[currentStatus];
    if (!allowedTransitions.includes(nextStatus)) {
      return jsonResponse(409, {
        message: `Cannot transition operation from ${currentStatus} to ${nextStatus}.`,
        allowedTransitions,
      });
    }

    const now = new Date();
    const updatedOperation = await getPrisma().woOperation.update({
      where: { id: operationId },
      data: {
        operationStatus: nextStatus,
        updatedAt: now,
        correlationId: ctx.correlationId,
        version: { increment: 1 },
        ...(nextStatus === 'IN_PROGRESS' && !operation.actualStartAt ? { actualStartAt: now } : {}),
        ...(TERMINAL_WO_OPERATION_STATUSES.includes(nextStatus) ? { actualEndAt: now } : {}),
        ...(nextStatus === 'BLOCKED'
          ? { blockingReason }
          : currentStatus === 'BLOCKED'
            ? { blockingReason: null }
            : {}),
      },
    });

    const operations = await getPrisma().woOperation.findMany({
      where: { workOrderId },
      select: { operationStatus: true },
    });
    const nextWorkOrderStatus = deriveWoStatusFromOperations(workOrderStatus, operations);
    let updatedWorkOrder: {
      id: string;
      status: string;
      completedAt?: Date | null;
      updatedAt?: Date | null;
    } = {
      id: operation.workOrder.id,
      status: workOrderStatus,
      completedAt: operation.workOrder.completedAt,
      updatedAt: operation.workOrder.updatedAt,
    };

    if (nextWorkOrderStatus !== workOrderStatus) {
      updatedWorkOrder = await getPrisma().woOrder.update({
        where: { id: workOrderId },
        data: {
          status: nextWorkOrderStatus,
          updatedAt: now,
          completedAt: nextWorkOrderStatus === 'COMPLETED' ? now : undefined,
          correlationId: ctx.correlationId,
          version: { increment: 1 },
        },
        select: { id: true, status: true, completedAt: true, updatedAt: true },
      });

      const actorUserId = uuidOrNull(body.value.actorUserId) ?? uuidOrNull(ctx.actorUserId);
      await getPrisma().woStatusHistory.create({
        data: {
          id: randomUUID(),
          workOrderId,
          fromStatus: workOrderStatus,
          toStatus: nextWorkOrderStatus,
          reasonCode: body.value.reasonCode?.trim() || `OPERATION_${nextStatus}`,
          reasonNote: body.value.reasonNote?.trim() || blockingReason,
          ...(actorUserId ? { actorUserId } : {}),
          correlationId: ctx.correlationId,
        },
      });
    }

    return jsonResponse(200, {
      operation: toOperationChecklistResponse(updatedOperation),
      workOrder: {
        id: updatedWorkOrder.id,
        status: mapWoStatus(updatedWorkOrder.status),
        completedAt: optionalIso(updatedWorkOrder.completedAt),
        updatedAt: optionalIso(updatedWorkOrder.updatedAt),
      },
    });
  },
  { requireAuth: false },
);

export const listWoQueueHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const status = qs.status as WoStatus | undefined;
    const limit = Math.min(parseInt(qs.limit ?? '50', 10), 200);

    const orders = await getPrisma().woOrder.findMany({
      where: { status: status ? { equals: status } : { in: ACTIVE_WO_STATUSES } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: {
        stockLocation: { select: { locationName: true } },
        operations: { orderBy: { sequenceNo: 'asc' } },
        parts: true,
      },
    });

    return jsonResponse(200, { items: orders.map(toQueueItem) });
  },
  { requireAuth: false },
);

export const getWoDetailHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Work order ID is required.' });

    const order = await getPrisma().woOrder.findUnique({
      where: { id },
      include: {
        stockLocation: { select: { locationName: true } },
        operations: { orderBy: { sequenceNo: 'asc' } },
        parts: { include: { part: { select: { name: true, sku: true } } } },
        statusHistory: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });

    if (!order) return jsonResponse(404, { message: `Work order not found: ${id}` });
    const [commercialContext, buildProvenance] = await Promise.all([
      buildCommercialContext(order),
      loadWorkOrderBuildProvenance(id),
    ]);

    const reservations = await getPrisma().$queryRaw<WorkOrderReservationRow[]>`
    SELECT
      r.id::text AS "id",
      r.reservation_status AS "status",
      r.reserved_quantity AS "reservedQuantity",
      r.consumed_quantity AS "consumedQuantity",
      COALESCE(r.allocated_quantity, 0) AS "allocatedQuantity",
      r.reservation_priority AS "reservationPriority",
      r.shortage_reason AS "shortageReason",
      r.expires_at AS "expiresAt",
      r.created_at AS "createdAt",
      r.updated_at AS "updatedAt",
      p.id::text AS "partId",
      p.sku AS "partSku",
      p.name AS "partName",
      p.unit_of_measure AS "unitOfMeasure",
      loc.id::text AS "stockLocationId",
      loc.location_name AS "locationName",
      lot.id::text AS "stockLotId",
      lot.lot_number AS "lotNumber",
      lot.serial_number AS "serialNumber",
      r.work_order_id::text AS "workOrderId",
      wo.work_order_number AS "workOrderNumber",
      wo.title AS "workOrderTitle",
      r.work_order_part_id::text AS "workOrderPartId"
    FROM inventory.inventory_reservations r
    JOIN inventory.parts p ON p.id = r.part_id
    JOIN inventory.stock_locations loc ON loc.id = r.stock_location_id
    LEFT JOIN inventory.stock_lots lot ON lot.id = r.stock_lot_id
    LEFT JOIN work_orders.work_orders wo ON wo.id = r.work_order_id
    WHERE r.work_order_id = ${id}::uuid
    ORDER BY
      CASE WHEN r.reservation_status IN ('ACTIVE', 'PARTIALLY_CONSUMED') THEN 0 ELSE 1 END,
      r.created_at DESC
  `;

    return jsonResponse(200, {
      workOrder: toDetailItem(order, reservations, commercialContext, buildProvenance),
    });
  },
  { requireAuth: false },
);

// ─── Time Entries (flat list — no workOrderId path param) ─────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTimeEntryResponse(e: any) {
  const computedHours =
    e.manualHours != null
      ? Number(e.manualHours)
      : e.endedAt
        ? (new Date(e.endedAt).getTime() - new Date(e.startedAt).getTime()) / (1000 * 60 * 60)
        : 0;
  return {
    id: e.id,
    workOrderId: e.workOrderId,
    technicianId: e.technicianId,
    startedAt: e.startedAt instanceof Date ? e.startedAt.toISOString() : e.startedAt,
    endedAt: e.endedAt instanceof Date ? e.endedAt.toISOString() : (e.endedAt ?? undefined),
    description: e.description ?? undefined,
    source: e.source,
    computedHours,
  };
}

// ─── Work Orders — full paginated list (all statuses) ─────────────────────────

export const listAllWorkOrdersHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const status = qs.status as WoStatus | undefined;
    const customerId = qs.customerId?.trim();
    const search = qs.search?.trim();
    const limit = Math.min(parseInt(qs.limit ?? '100', 10), 500);
    const offset = parseInt(qs.offset ?? '0', 10);

    const where = {
      ...(status ? { status: { equals: status } } : {}),
      ...(customerId ? { customerReference: { equals: customerId } } : {}),
      ...(search
        ? {
            OR: [
              { workOrderNumber: { contains: search, mode: 'insensitive' as const } },
              { title: { contains: search, mode: 'insensitive' as const } },
              { customerReference: { contains: search, mode: 'insensitive' as const } },
              { assetReference: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [orders, total] = await Promise.all([
      getPrisma().woOrder.findMany({
        where,
        orderBy: { openedAt: 'desc' },
        take: limit,
        skip: offset,
        include: { stockLocation: { select: { locationName: true } } },
      }),
      getPrisma().woOrder.count({ where }),
    ]);

    const items = orders.map((o) => ({
      id: o.id,
      workOrderNumber: o.workOrderNumber,
      title: o.title,
      description: o.description ?? undefined,
      customerReference: o.customerReference ?? undefined,
      assetReference: o.assetReference ?? undefined,
      status: o.status as WoStatus,
      priority: o.priority,
      stockLocationId: o.stockLocationId ?? undefined,
      locationName: o.stockLocation?.locationName ?? undefined,
      openedAt: o.openedAt.toISOString(),
      dueAt: o.dueAt?.toISOString() ?? undefined,
      completedAt: o.completedAt?.toISOString() ?? undefined,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    }));

    return jsonResponse(200, { items, total, limit, offset });
  },
  { requireAuth: false },
);

export const listAllTimeEntriesHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const workOrderId = qs.workOrderId;
    const technicianId = qs.technicianId;
    const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);

    const entries = await getPrisma().laborTimeEntry.findMany({
      where: {
        ...(workOrderId ? { workOrderId } : {}),
        ...(technicianId ? { technicianId } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    return jsonResponse(200, { entries: entries.map(toTimeEntryResponse) });
  },
  { requireAuth: false },
);
