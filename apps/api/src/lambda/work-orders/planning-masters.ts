import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type {
  ApiGatewayProxyEventLike,
  ApiGatewayProxyResultLike,
} from './handlers.js';
import type {
  ListBuildPackagesQuery,
  ListBuildPackagesResponse,
  WorkOrderBuildPackageResponse,
} from '../../contexts/build-planning/workOrder.contracts.js';

const prisma = new PrismaClient();

type BuildConfigurationStatus = 'DRAFT' | 'LOCKED' | 'RELEASED' | 'SUPERSEDED';
type BomStatus = 'DRAFT' | 'APPROVED' | 'OBSOLETE';
type RoutingTemplateStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';
type BuildConfigurationChangeKind = 'CREATED' | 'LOCKED' | 'RELEASED' | 'SUPERSEDED';
type BomChangeKind = 'CREATED' | 'APPROVED' | 'OBSOLETED';
type RoutingTemplateChangeKind = 'CREATED' | 'ACTIVATED' | 'RETIRED' | 'AUTO_RETIRED';

const BUILD_CONFIGURATION_STATUSES: BuildConfigurationStatus[] = [
  'DRAFT',
  'LOCKED',
  'RELEASED',
  'SUPERSEDED',
];
const BOM_STATUSES: BomStatus[] = ['DRAFT', 'APPROVED', 'OBSOLETE'];
const ROUTING_TEMPLATE_STATUSES: RoutingTemplateStatus[] = ['DRAFT', 'ACTIVE', 'RETIRED'];

interface RequestContext {
  actorId?: string;
  correlationId: string;
  requestId?: string;
}

export interface BuildConfigurationResponse {
  id: string;
  configurationCode: string;
  vehicleId: string;
  vehicleDisplayName?: string;
  customerDisplayName?: string;
  configurationVersion: number;
  configurationStatus: BuildConfigurationStatus;
  selectedOptions: string[];
  notes?: string;
  releasedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  changeEvents: BuildConfigurationChangeEventResponse[];
}

export interface BuildConfigurationChangeEventResponse {
  id: string;
  buildConfigurationId: string;
  configurationCode: string;
  configurationVersion: number;
  changeKind: BuildConfigurationChangeKind;
  previousStatus?: BuildConfigurationStatus;
  newStatus: BuildConfigurationStatus;
  changeSummary: string;
  approvalNote?: string;
  approvedBy?: string;
  approvedAt?: string;
  appliedBy?: string;
  createdAt: string;
}

export interface BomLineInput {
  partId: string;
  quantityPerUnit: number;
  scrapFactor?: number;
  lineNote?: string;
}

export interface BomLineResponse {
  id: string;
  bomId: string;
  partId: string;
  sku: string;
  partName: string;
  unitOfMeasure: string;
  quantityPerUnit: number;
  scrapFactor: number;
  lineNote?: string;
}

export interface BomResponse {
  id: string;
  bomCode: string;
  buildConfigurationId: string;
  configurationCode?: string;
  revision: number;
  bomStatus: BomStatus;
  notes?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  lines: BomLineResponse[];
  changeEvents: BomChangeEventResponse[];
}

export interface BomChangeEventResponse {
  id: string;
  bomId: string;
  bomCode: string;
  buildConfigurationId: string;
  revision: number;
  changeKind: BomChangeKind;
  previousStatus?: BomStatus;
  newStatus: BomStatus;
  changeSummary: string;
  approvalNote?: string;
  approvedBy?: string;
  approvedAt?: string;
  appliedBy?: string;
  createdAt: string;
}

export interface RoutingTemplateStepInput {
  sequenceNo?: number;
  operationCode: string;
  operationName: string;
  workstationCode?: string;
  estimatedMinutes: number;
  laborRateCents?: number;
  requiredSkillCode?: string;
  jobCardTitle?: string;
  jobCardInstructions?: string;
  qcRequired?: boolean;
  evidenceRequired?: boolean;
}

export interface RoutingTemplateStepResponse {
  id: string;
  routingTemplateId: string;
  sequenceNo: number;
  operationCode: string;
  operationName: string;
  workstationCode?: string;
  estimatedMinutes: number;
  laborRateCents?: number;
  laborCostCents: number;
  requiredSkillCode?: string;
  jobCardTitle?: string;
  jobCardInstructions?: string;
  qcRequired: boolean;
  evidenceRequired: boolean;
}

export interface RoutingTemplateChangeEventResponse {
  id: string;
  routingTemplateId: string;
  routeCode: string;
  routeVersion: number;
  changeKind: RoutingTemplateChangeKind;
  previousStatus?: RoutingTemplateStatus;
  newStatus: RoutingTemplateStatus;
  changeSummary: string;
  approvalNote?: string;
  approvedBy?: string;
  approvedAt?: string;
  appliedBy?: string;
  createdAt: string;
}

export interface RoutingTemplateResponse {
  id: string;
  routeCode: string;
  routeName: string;
  routeVersion: number;
  buildConfigurationId?: string;
  configurationCode?: string;
  templateStatus: RoutingTemplateStatus;
  effectiveFrom: string;
  effectiveTo?: string;
  notes?: string;
  activatedAt?: string;
  retiredAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  stepCount: number;
  estimatedMinutes: number;
  estimatedLaborCostCents: number;
  steps: RoutingTemplateStepResponse[];
  changeEvents: RoutingTemplateChangeEventResponse[];
}

export interface CreateBuildConfigurationInput {
  configurationCode: string;
  vehicleId: string;
  configurationVersion?: number;
  selectedOptions?: string[];
  notes?: string;
}

export interface TransitionBuildConfigurationInput {
  state: BuildConfigurationStatus;
  approvalNote?: string;
  changeSummary?: string;
}

export interface ApproveBomInput {
  approvalNote?: string;
  changeSummary?: string;
}

export interface CreateBomInput {
  bomCode: string;
  buildConfigurationId: string;
  revision?: number;
  notes?: string;
  lines: BomLineInput[];
}

export interface CreateRoutingTemplateInput {
  routeCode: string;
  routeName: string;
  routeVersion?: number;
  buildConfigurationId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  notes?: string;
  steps: RoutingTemplateStepInput[];
}

export interface TransitionRoutingTemplateInput {
  status: RoutingTemplateStatus;
  approvalNote?: string;
  changeSummary?: string;
}

export interface PlanningMasterStore {
  listBuildConfigurations(input: {
    search?: string;
    status?: BuildConfigurationStatus;
    vehicleId?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: BuildConfigurationResponse[]; total: number; limit: number; offset: number }>;
  createBuildConfiguration(
    input: CreateBuildConfigurationInput,
    context: RequestContext,
  ): Promise<BuildConfigurationResponse>;
  transitionBuildConfiguration(
    id: string,
    input: TransitionBuildConfigurationInput,
    context: RequestContext,
  ): Promise<BuildConfigurationResponse>;
  listBoms(input: {
    search?: string;
    status?: BomStatus;
    buildConfigurationId?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: BomResponse[]; total: number; limit: number; offset: number }>;
  createBom(input: CreateBomInput, context: RequestContext): Promise<BomResponse>;
  approveBom(id: string, input: ApproveBomInput, context: RequestContext): Promise<BomResponse>;
  listRoutingTemplates(input: {
    search?: string;
    status?: RoutingTemplateStatus;
    buildConfigurationId?: string;
    effectiveOn?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: RoutingTemplateResponse[]; total: number; limit: number; offset: number }>;
  createRoutingTemplate(
    input: CreateRoutingTemplateInput,
    context: RequestContext,
  ): Promise<RoutingTemplateResponse>;
  transitionRoutingTemplate(
    id: string,
    input: TransitionRoutingTemplateInput,
    context: RequestContext,
  ): Promise<RoutingTemplateResponse>;
  listBuildPackages(input: ListBuildPackagesQuery): Promise<ListBuildPackagesResponse>;
}

class PlanningMasterCommandError extends Error {
  constructor(
    message: string,
    readonly statusCode = 422,
    readonly issues?: Array<{ field: string; message: string }>,
  ) {
    super(message);
  }
}

type DbClient = PrismaClient | Prisma.TransactionClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined): value is string {
  return Boolean(value && UUID_RE.test(value));
}

function actorUuid(actorId: string | undefined): string | null {
  return isUuid(actorId) ? actorId : null;
}

function actorRef(actorId: string | undefined): string | null {
  return actorId?.trim() || null;
}

function normalizeOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((option) => (typeof option === 'string' ? option.trim() : ''))
        .filter(Boolean),
    ),
  );
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function toPositiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function toNonNegativeInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function toDateTime(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function optionalIso(value: unknown): string | undefined {
  return value ? iso(value) : undefined;
}

function laborCostCents(estimatedMinutes: number, laborRateCents?: number): number {
  if (laborRateCents === undefined) return 0;
  return Math.round((estimatedMinutes / 60) * laborRateCents);
}

interface BuildConfigurationRow {
  id: string;
  configurationCode: string;
  vehicleId: string;
  vehicleDisplayName: string | null;
  customerDisplayName: string | null;
  configurationVersion: number;
  configurationStatus: BuildConfigurationStatus;
  selectedOptions: unknown;
  notes: string | null;
  releasedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  version: number;
}

interface BuildConfigurationChangeEventRow {
  id: string;
  buildConfigurationId: string;
  configurationCode: string;
  configurationVersion: number;
  changeKind: BuildConfigurationChangeKind;
  previousStatus: BuildConfigurationStatus | null;
  newStatus: BuildConfigurationStatus;
  changeSummary: string;
  approvalNote: string | null;
  approvedBy: string | null;
  approvedAt: Date | string | null;
  appliedBy: string | null;
  createdAt: Date | string;
}

interface BomRow {
  id: string;
  bomCode: string;
  buildConfigurationId: string;
  configurationCode: string | null;
  revision: number;
  bomStatus: BomStatus;
  notes: string | null;
  approvedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  version: number;
}

interface BomChangeEventRow {
  id: string;
  bomId: string;
  bomCode: string;
  buildConfigurationId: string;
  revision: number;
  changeKind: BomChangeKind;
  previousStatus: BomStatus | null;
  newStatus: BomStatus;
  changeSummary: string;
  approvalNote: string | null;
  approvedBy: string | null;
  approvedAt: Date | string | null;
  appliedBy: string | null;
  createdAt: Date | string;
}

interface BomLineRow {
  id: string;
  bomId: string;
  partId: string;
  sku: string;
  partName: string;
  unitOfMeasure: string;
  quantityPerUnit: Prisma.Decimal | number | string;
  scrapFactor: Prisma.Decimal | number | string;
  lineNote: string | null;
}

interface RoutingTemplateRow {
  id: string;
  routeCode: string;
  routeName: string;
  routeVersion: number;
  buildConfigurationId: string | null;
  configurationCode: string | null;
  templateStatus: RoutingTemplateStatus;
  effectiveFrom: Date | string;
  effectiveTo: Date | string | null;
  notes: string | null;
  activatedAt: Date | string | null;
  retiredAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  version: number;
  stepCount: bigint | number | string;
  estimatedMinutes: bigint | number | string;
  estimatedLaborCostCents: bigint | number | string;
}

interface RoutingTemplateStepRow {
  id: string;
  routingTemplateId: string;
  sequenceNo: number;
  operationCode: string;
  operationName: string;
  workstationCode: string | null;
  estimatedMinutes: number;
  laborRateCents: number | null;
  requiredSkillCode: string | null;
  jobCardTitle: string | null;
  jobCardInstructions: string | null;
  qcRequired: boolean;
  evidenceRequired: boolean;
}

interface RoutingTemplateChangeEventRow {
  id: string;
  routingTemplateId: string;
  routeCode: string;
  routeVersion: number;
  changeKind: RoutingTemplateChangeKind;
  previousStatus: RoutingTemplateStatus | null;
  newStatus: RoutingTemplateStatus;
  changeSummary: string;
  approvalNote: string | null;
  approvedBy: string | null;
  approvedAt: Date | string | null;
  appliedBy: string | null;
  createdAt: Date | string;
}

function mapConfiguration(
  row: BuildConfigurationRow,
  changeEvents: BuildConfigurationChangeEventResponse[],
): BuildConfigurationResponse {
  return {
    id: row.id,
    configurationCode: row.configurationCode,
    vehicleId: row.vehicleId,
    vehicleDisplayName: row.vehicleDisplayName ?? undefined,
    customerDisplayName: row.customerDisplayName ?? undefined,
    configurationVersion: Number(row.configurationVersion),
    configurationStatus: row.configurationStatus,
    selectedOptions: normalizeOptions(row.selectedOptions),
    notes: row.notes ?? undefined,
    releasedAt: optionalIso(row.releasedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    version: Number(row.version),
    changeEvents,
  };
}

function mapBuildConfigurationChangeEvent(
  row: BuildConfigurationChangeEventRow,
): BuildConfigurationChangeEventResponse {
  return {
    id: row.id,
    buildConfigurationId: row.buildConfigurationId,
    configurationCode: row.configurationCode,
    configurationVersion: Number(row.configurationVersion),
    changeKind: row.changeKind,
    previousStatus: row.previousStatus ?? undefined,
    newStatus: row.newStatus,
    changeSummary: row.changeSummary,
    approvalNote: row.approvalNote ?? undefined,
    approvedBy: row.approvedBy ?? undefined,
    approvedAt: optionalIso(row.approvedAt),
    appliedBy: row.appliedBy ?? undefined,
    createdAt: iso(row.createdAt),
  };
}

function mapBom(
  row: BomRow,
  lines: BomLineResponse[],
  changeEvents: BomChangeEventResponse[],
): BomResponse {
  return {
    id: row.id,
    bomCode: row.bomCode,
    buildConfigurationId: row.buildConfigurationId,
    configurationCode: row.configurationCode ?? undefined,
    revision: Number(row.revision),
    bomStatus: row.bomStatus,
    notes: row.notes ?? undefined,
    approvedAt: optionalIso(row.approvedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    version: Number(row.version),
    lines,
    changeEvents,
  };
}

function mapBomChangeEvent(row: BomChangeEventRow): BomChangeEventResponse {
  return {
    id: row.id,
    bomId: row.bomId,
    bomCode: row.bomCode,
    buildConfigurationId: row.buildConfigurationId,
    revision: Number(row.revision),
    changeKind: row.changeKind,
    previousStatus: row.previousStatus ?? undefined,
    newStatus: row.newStatus,
    changeSummary: row.changeSummary,
    approvalNote: row.approvalNote ?? undefined,
    approvedBy: row.approvedBy ?? undefined,
    approvedAt: optionalIso(row.approvedAt),
    appliedBy: row.appliedBy ?? undefined,
    createdAt: iso(row.createdAt),
  };
}

function mapBomLine(row: BomLineRow): BomLineResponse {
  return {
    id: row.id,
    bomId: row.bomId,
    partId: row.partId,
    sku: row.sku,
    partName: row.partName,
    unitOfMeasure: row.unitOfMeasure,
    quantityPerUnit: Number(row.quantityPerUnit),
    scrapFactor: Number(row.scrapFactor),
    lineNote: row.lineNote ?? undefined,
  };
}

function mapRoutingTemplateStep(row: RoutingTemplateStepRow): RoutingTemplateStepResponse {
  return {
    id: row.id,
    routingTemplateId: row.routingTemplateId,
    sequenceNo: Number(row.sequenceNo),
    operationCode: row.operationCode,
    operationName: row.operationName,
    workstationCode: row.workstationCode ?? undefined,
    estimatedMinutes: Number(row.estimatedMinutes),
    laborRateCents: row.laborRateCents ?? undefined,
    laborCostCents: laborCostCents(Number(row.estimatedMinutes), row.laborRateCents ?? undefined),
    requiredSkillCode: row.requiredSkillCode ?? undefined,
    jobCardTitle: row.jobCardTitle ?? undefined,
    jobCardInstructions: row.jobCardInstructions ?? undefined,
    qcRequired: Boolean(row.qcRequired),
    evidenceRequired: Boolean(row.evidenceRequired),
  };
}

function mapRoutingTemplateChangeEvent(
  row: RoutingTemplateChangeEventRow,
): RoutingTemplateChangeEventResponse {
  return {
    id: row.id,
    routingTemplateId: row.routingTemplateId,
    routeCode: row.routeCode,
    routeVersion: Number(row.routeVersion),
    changeKind: row.changeKind,
    previousStatus: row.previousStatus ?? undefined,
    newStatus: row.newStatus,
    changeSummary: row.changeSummary,
    approvalNote: row.approvalNote ?? undefined,
    approvedBy: row.approvedBy ?? undefined,
    approvedAt: optionalIso(row.approvedAt),
    appliedBy: row.appliedBy ?? undefined,
    createdAt: iso(row.createdAt),
  };
}

function mapRoutingTemplate(
  row: RoutingTemplateRow,
  steps: RoutingTemplateStepResponse[],
  changeEvents: RoutingTemplateChangeEventResponse[],
): RoutingTemplateResponse {
  return {
    id: row.id,
    routeCode: row.routeCode,
    routeName: row.routeName,
    routeVersion: Number(row.routeVersion),
    buildConfigurationId: row.buildConfigurationId ?? undefined,
    configurationCode: row.configurationCode ?? undefined,
    templateStatus: row.templateStatus,
    effectiveFrom: iso(row.effectiveFrom),
    effectiveTo: optionalIso(row.effectiveTo),
    notes: row.notes ?? undefined,
    activatedAt: optionalIso(row.activatedAt),
    retiredAt: optionalIso(row.retiredAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    version: Number(row.version),
    stepCount: Number(row.stepCount),
    estimatedMinutes: Number(row.estimatedMinutes),
    estimatedLaborCostCents: Number(row.estimatedLaborCostCents),
    steps,
    changeEvents,
  };
}

function configurationSelect(where: Prisma.Sql, orderLimit: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT
      bc.id::text AS "id",
      bc.configuration_code AS "configurationCode",
      bc.vehicle_id::text AS "vehicleId",
      concat(cv.model_year::text, ' ', cv.model_code, ' · ', cv.serial_number) AS "vehicleDisplayName",
      coalesce(nullif(c.company_name, ''), c.full_name) AS "customerDisplayName",
      bc.configuration_version AS "configurationVersion",
      bc.configuration_status::text AS "configurationStatus",
      bc.selected_options AS "selectedOptions",
      bc.notes AS "notes",
      bc.released_at AS "releasedAt",
      bc.created_at AS "createdAt",
      bc.updated_at AS "updatedAt",
      bc.version AS "version"
    FROM planning.build_configurations bc
    JOIN planning.cart_vehicles cv ON cv.id = bc.vehicle_id
    LEFT JOIN customers.customers c ON c.id = cv.customer_id
    ${where}
    ${orderLimit}
  `;
}

function bomSelect(where: Prisma.Sql, orderLimit: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT
      b.id::text AS "id",
      b.bom_code AS "bomCode",
      b.build_configuration_id::text AS "buildConfigurationId",
      bc.configuration_code AS "configurationCode",
      b.revision AS "revision",
      b.bom_status::text AS "bomStatus",
      b.notes AS "notes",
      b.approved_at AS "approvedAt",
      b.created_at AS "createdAt",
      b.updated_at AS "updatedAt",
      b.version AS "version"
    FROM planning.build_boms b
    JOIN planning.build_configurations bc ON bc.id = b.build_configuration_id
    ${where}
    ${orderLimit}
  `;
}

function routingTemplateSelect(where: Prisma.Sql, orderLimit: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT
      rt.id::text AS "id",
      rt.route_code AS "routeCode",
      rt.route_name AS "routeName",
      rt.route_version AS "routeVersion",
      rt.build_configuration_id::text AS "buildConfigurationId",
      bc.configuration_code AS "configurationCode",
      rt.template_status::text AS "templateStatus",
      rt.effective_from AS "effectiveFrom",
      rt.effective_to AS "effectiveTo",
      rt.notes AS "notes",
      rt.activated_at AS "activatedAt",
      rt.retired_at AS "retiredAt",
      rt.created_at AS "createdAt",
      rt.updated_at AS "updatedAt",
      rt.version AS "version",
      count(rts.id)::bigint AS "stepCount",
      coalesce(sum(rts.estimated_minutes), 0)::bigint AS "estimatedMinutes",
      coalesce(
        sum(
          CASE
            WHEN rts.labor_rate_cents IS NULL THEN 0
            ELSE round((rts.estimated_minutes::numeric / 60) * rts.labor_rate_cents)
          END
        ),
        0
      )::bigint AS "estimatedLaborCostCents"
    FROM planning.routing_templates rt
    LEFT JOIN planning.build_configurations bc ON bc.id = rt.build_configuration_id
    LEFT JOIN planning.routing_template_steps rts ON rts.routing_template_id = rt.id
    ${where}
    GROUP BY rt.id, bc.id
    ${orderLimit}
  `;
}

async function loadBomLines(db: DbClient, bomIds: string[]): Promise<Map<string, BomLineResponse[]>> {
  if (bomIds.length === 0) return new Map();
  const rows = await db.$queryRaw<BomLineRow[]>`
    SELECT
      bl.id::text AS "id",
      bl.bom_id::text AS "bomId",
      bl.part_id::text AS "partId",
      p.sku AS "sku",
      p.name AS "partName",
      p.unit_of_measure AS "unitOfMeasure",
      bl.quantity_per_unit AS "quantityPerUnit",
      bl.scrap_factor AS "scrapFactor",
      bl.line_note AS "lineNote"
    FROM planning.build_bom_lines bl
    JOIN inventory.parts p ON p.id = bl.part_id
    WHERE bl.bom_id::text IN (${Prisma.join(bomIds)})
    ORDER BY p.sku ASC
  `;

  const byBom = new Map<string, BomLineResponse[]>();
  for (const row of rows) {
    const item = mapBomLine(row);
    byBom.set(item.bomId, [...(byBom.get(item.bomId) ?? []), item]);
  }
  return byBom;
}

async function loadBuildConfigurationChangeEvents(
  db: DbClient,
  buildConfigurationIds: string[],
): Promise<Map<string, BuildConfigurationChangeEventResponse[]>> {
  if (buildConfigurationIds.length === 0) return new Map();
  const rows = await db.$queryRaw<BuildConfigurationChangeEventRow[]>`
    SELECT
      id::text AS "id",
      build_configuration_id::text AS "buildConfigurationId",
      configuration_code AS "configurationCode",
      configuration_version AS "configurationVersion",
      change_kind::text AS "changeKind",
      previous_status::text AS "previousStatus",
      new_status::text AS "newStatus",
      change_summary AS "changeSummary",
      approval_note AS "approvalNote",
      coalesce(approved_by_ref, approved_by_user_id::text) AS "approvedBy",
      approved_at AS "approvedAt",
      coalesce(applied_by_ref, applied_by_user_id::text) AS "appliedBy",
      created_at AS "createdAt"
    FROM (
      SELECT
        bcce.*,
        row_number() OVER (
          PARTITION BY bcce.build_configuration_id
          ORDER BY bcce.created_at DESC, bcce.id DESC
        ) AS row_number
      FROM planning.build_configuration_change_events bcce
      WHERE bcce.build_configuration_id::text IN (${Prisma.join(buildConfigurationIds)})
    ) ranked
    WHERE row_number <= 5
    ORDER BY build_configuration_id, created_at DESC
  `;

  const byConfiguration = new Map<string, BuildConfigurationChangeEventResponse[]>();
  for (const row of rows) {
    const item = mapBuildConfigurationChangeEvent(row);
    byConfiguration.set(item.buildConfigurationId, [
      ...(byConfiguration.get(item.buildConfigurationId) ?? []),
      item,
    ]);
  }
  return byConfiguration;
}

async function loadBomChangeEvents(
  db: DbClient,
  bomIds: string[],
): Promise<Map<string, BomChangeEventResponse[]>> {
  if (bomIds.length === 0) return new Map();
  const rows = await db.$queryRaw<BomChangeEventRow[]>`
    SELECT
      id::text AS "id",
      bom_id::text AS "bomId",
      bom_code AS "bomCode",
      build_configuration_id::text AS "buildConfigurationId",
      revision AS "revision",
      change_kind::text AS "changeKind",
      previous_status::text AS "previousStatus",
      new_status::text AS "newStatus",
      change_summary AS "changeSummary",
      approval_note AS "approvalNote",
      coalesce(approved_by_ref, approved_by_user_id::text) AS "approvedBy",
      approved_at AS "approvedAt",
      coalesce(applied_by_ref, applied_by_user_id::text) AS "appliedBy",
      created_at AS "createdAt"
    FROM (
      SELECT
        bbce.*,
        row_number() OVER (
          PARTITION BY bbce.bom_id
          ORDER BY bbce.created_at DESC, bbce.id DESC
        ) AS row_number
      FROM planning.build_bom_change_events bbce
      WHERE bbce.bom_id::text IN (${Prisma.join(bomIds)})
    ) ranked
    WHERE row_number <= 5
    ORDER BY bom_id, created_at DESC
  `;

  const byBom = new Map<string, BomChangeEventResponse[]>();
  for (const row of rows) {
    const item = mapBomChangeEvent(row);
    byBom.set(item.bomId, [...(byBom.get(item.bomId) ?? []), item]);
  }
  return byBom;
}

async function loadRoutingTemplateSteps(
  db: DbClient,
  routingTemplateIds: string[],
): Promise<Map<string, RoutingTemplateStepResponse[]>> {
  if (routingTemplateIds.length === 0) return new Map();
  const rows = await db.$queryRaw<RoutingTemplateStepRow[]>`
    SELECT
      id::text AS "id",
      routing_template_id::text AS "routingTemplateId",
      sequence_no AS "sequenceNo",
      operation_code AS "operationCode",
      operation_name AS "operationName",
      workstation_code AS "workstationCode",
      estimated_minutes AS "estimatedMinutes",
      labor_rate_cents AS "laborRateCents",
      required_skill_code AS "requiredSkillCode",
      job_card_title AS "jobCardTitle",
      job_card_instructions AS "jobCardInstructions",
      qc_required AS "qcRequired",
      evidence_required AS "evidenceRequired"
    FROM planning.routing_template_steps
    WHERE routing_template_id::text IN (${Prisma.join(routingTemplateIds)})
    ORDER BY routing_template_id, sequence_no ASC
  `;

  const byTemplate = new Map<string, RoutingTemplateStepResponse[]>();
  for (const row of rows) {
    const item = mapRoutingTemplateStep(row);
    byTemplate.set(item.routingTemplateId, [...(byTemplate.get(item.routingTemplateId) ?? []), item]);
  }
  return byTemplate;
}

async function loadRoutingTemplateChangeEvents(
  db: DbClient,
  routingTemplateIds: string[],
): Promise<Map<string, RoutingTemplateChangeEventResponse[]>> {
  if (routingTemplateIds.length === 0) return new Map();
  const rows = await db.$queryRaw<RoutingTemplateChangeEventRow[]>`
    SELECT
      id::text AS "id",
      routing_template_id::text AS "routingTemplateId",
      route_code AS "routeCode",
      route_version AS "routeVersion",
      change_kind::text AS "changeKind",
      previous_status::text AS "previousStatus",
      new_status::text AS "newStatus",
      change_summary AS "changeSummary",
      approval_note AS "approvalNote",
      coalesce(approved_by_ref, approved_by_user_id::text) AS "approvedBy",
      approved_at AS "approvedAt",
      coalesce(applied_by_ref, applied_by_user_id::text) AS "appliedBy",
      created_at AS "createdAt"
    FROM (
      SELECT
        rtce.*,
        row_number() OVER (
          PARTITION BY rtce.routing_template_id
          ORDER BY rtce.created_at DESC, rtce.id DESC
        ) AS row_number
      FROM planning.routing_template_change_events rtce
      WHERE rtce.routing_template_id::text IN (${Prisma.join(routingTemplateIds)})
    ) ranked
    WHERE row_number <= 5
    ORDER BY routing_template_id, created_at DESC
  `;

  const byTemplate = new Map<string, RoutingTemplateChangeEventResponse[]>();
  for (const row of rows) {
    const item = mapRoutingTemplateChangeEvent(row);
    byTemplate.set(item.routingTemplateId, [
      ...(byTemplate.get(item.routingTemplateId) ?? []),
      item,
    ]);
  }
  return byTemplate;
}

async function getConfigurationById(
  db: DbClient,
  id: string,
): Promise<BuildConfigurationResponse | undefined> {
  const rows = await db.$queryRaw<BuildConfigurationRow[]>(
    configurationSelect(
      Prisma.sql`WHERE bc.id = ${id}::uuid`,
      Prisma.sql`LIMIT 1`,
    ),
  );
  const row = rows[0];
  if (!row) return undefined;
  const changesByConfiguration = await loadBuildConfigurationChangeEvents(db, [row.id]);
  return mapConfiguration(row, changesByConfiguration.get(row.id) ?? []);
}

async function getBomById(db: DbClient, id: string): Promise<BomResponse | undefined> {
  const rows = await db.$queryRaw<BomRow[]>(
    bomSelect(Prisma.sql`WHERE b.id = ${id}::uuid`, Prisma.sql`LIMIT 1`),
  );
  const row = rows[0];
  if (!row) return undefined;
  const linesByBom = await loadBomLines(db, [row.id]);
  const changesByBom = await loadBomChangeEvents(db, [row.id]);
  return mapBom(row, linesByBom.get(row.id) ?? [], changesByBom.get(row.id) ?? []);
}

async function getRoutingTemplateById(
  db: DbClient,
  id: string,
): Promise<RoutingTemplateResponse | undefined> {
  const rows = await db.$queryRaw<RoutingTemplateRow[]>(
    routingTemplateSelect(Prisma.sql`WHERE rt.id = ${id}::uuid`, Prisma.sql`LIMIT 1`),
  );
  const row = rows[0];
  if (!row) return undefined;
  const stepsByTemplate = await loadRoutingTemplateSteps(db, [row.id]);
  const changesByTemplate = await loadRoutingTemplateChangeEvents(db, [row.id]);
  return mapRoutingTemplate(
    row,
    stepsByTemplate.get(row.id) ?? [],
    changesByTemplate.get(row.id) ?? [],
  );
}

async function recordBuildConfigurationChangeEvent(
  db: DbClient,
  config: Pick<
    BuildConfigurationResponse,
    'id' | 'configurationCode' | 'configurationVersion' | 'configurationStatus'
  >,
  input: {
    changeKind: BuildConfigurationChangeKind;
    previousStatus?: BuildConfigurationStatus;
    newStatus: BuildConfigurationStatus;
    changeSummary: string;
    approvalNote?: string;
  },
  context: RequestContext,
): Promise<void> {
  const approvalRequired =
    input.changeKind === 'LOCKED' ||
    input.changeKind === 'RELEASED' ||
    input.changeKind === 'SUPERSEDED';
  const actorUserId = actorUuid(context.actorId);
  const actorReference = actorRef(context.actorId);
  await db.$executeRaw`
    INSERT INTO planning.build_configuration_change_events (
      build_configuration_id,
      configuration_code,
      configuration_version,
      change_kind,
      previous_status,
      new_status,
      change_summary,
      approval_note,
      approved_by_user_id,
      approved_by_ref,
      approved_at,
      applied_by_user_id,
      applied_by_ref,
      last_correlation_id,
      last_request_id
    )
    VALUES (
      ${config.id}::uuid,
      ${config.configurationCode},
      ${config.configurationVersion},
      ${input.changeKind}::planning."BuildConfigurationChangeKind",
      ${input.previousStatus ?? null}::planning."BuildConfigurationStatus",
      ${input.newStatus}::planning."BuildConfigurationStatus",
      ${input.changeSummary},
      ${input.approvalNote ?? null},
      ${approvalRequired ? actorUserId : null}::uuid,
      ${approvalRequired ? actorReference : null},
      ${approvalRequired ? new Date().toISOString() : null}::timestamptz,
      ${actorUserId}::uuid,
      ${actorReference},
      ${context.correlationId},
      ${context.requestId ?? null}
    )
  `;
}

async function recordBomChangeEvent(
  db: DbClient,
  bom: Pick<BomResponse, 'id' | 'bomCode' | 'buildConfigurationId' | 'revision' | 'bomStatus'>,
  input: {
    changeKind: BomChangeKind;
    previousStatus?: BomStatus;
    newStatus: BomStatus;
    changeSummary: string;
    approvalNote?: string;
  },
  context: RequestContext,
): Promise<void> {
  const approvalRequired = input.changeKind === 'APPROVED' || input.changeKind === 'OBSOLETED';
  const actorUserId = actorUuid(context.actorId);
  const actorReference = actorRef(context.actorId);
  await db.$executeRaw`
    INSERT INTO planning.build_bom_change_events (
      bom_id,
      bom_code,
      build_configuration_id,
      revision,
      change_kind,
      previous_status,
      new_status,
      change_summary,
      approval_note,
      approved_by_user_id,
      approved_by_ref,
      approved_at,
      applied_by_user_id,
      applied_by_ref,
      last_correlation_id,
      last_request_id
    )
    VALUES (
      ${bom.id}::uuid,
      ${bom.bomCode},
      ${bom.buildConfigurationId}::uuid,
      ${bom.revision},
      ${input.changeKind}::planning."BomChangeKind",
      ${input.previousStatus ?? null}::planning."BomStatus",
      ${input.newStatus}::planning."BomStatus",
      ${input.changeSummary},
      ${input.approvalNote ?? null},
      ${approvalRequired ? actorUserId : null}::uuid,
      ${approvalRequired ? actorReference : null},
      ${approvalRequired ? new Date().toISOString() : null}::timestamptz,
      ${actorUserId}::uuid,
      ${actorReference},
      ${context.correlationId},
      ${context.requestId ?? null}
    )
  `;
}

async function recordRoutingTemplateChangeEvent(
  db: DbClient,
  template: Pick<
    RoutingTemplateResponse,
    'id' | 'routeCode' | 'routeVersion' | 'templateStatus'
  >,
  input: {
    changeKind: RoutingTemplateChangeKind;
    previousStatus?: RoutingTemplateStatus;
    newStatus: RoutingTemplateStatus;
    changeSummary: string;
    approvalNote?: string;
  },
  context: RequestContext,
): Promise<void> {
  const approvalRequired =
    input.changeKind === 'ACTIVATED' ||
    input.changeKind === 'RETIRED' ||
    input.changeKind === 'AUTO_RETIRED';
  const actorUserId = actorUuid(context.actorId);
  const actorReference = actorRef(context.actorId);
  await db.$executeRaw`
    INSERT INTO planning.routing_template_change_events (
      routing_template_id,
      route_code,
      route_version,
      change_kind,
      previous_status,
      new_status,
      change_summary,
      approval_note,
      approved_by_user_id,
      approved_by_ref,
      approved_at,
      applied_by_user_id,
      applied_by_ref,
      last_correlation_id,
      last_request_id
    )
    VALUES (
      ${template.id}::uuid,
      ${template.routeCode},
      ${template.routeVersion},
      ${input.changeKind}::planning."RoutingTemplateChangeKind",
      ${input.previousStatus ?? null}::planning."RoutingTemplateStatus",
      ${input.newStatus}::planning."RoutingTemplateStatus",
      ${input.changeSummary},
      ${input.approvalNote ?? null},
      ${approvalRequired ? actorUserId : null}::uuid,
      ${approvalRequired ? actorReference : null},
      ${approvalRequired ? new Date().toISOString() : null}::timestamptz,
      ${actorUserId}::uuid,
      ${actorReference},
      ${context.correlationId},
      ${context.requestId ?? null}
    )
  `;
}

function validationError(
  message: string,
  issues: Array<{ field: string; message: string }>,
): PlanningMasterCommandError {
  return new PlanningMasterCommandError(message, 422, issues);
}

function validateCreateConfiguration(input: unknown): CreateBuildConfigurationInput {
  const body = input as Partial<CreateBuildConfigurationInput>;
  const issues: Array<{ field: string; message: string }> = [];
  const configurationCode = normalizeText(body.configurationCode);
  const vehicleId = normalizeText(body.vehicleId);
  const configurationVersion = toPositiveInt(body.configurationVersion);
  const selectedOptions = normalizeOptions(body.selectedOptions);
  const notes = normalizeText(body.notes);

  if (!configurationCode) {
    issues.push({ field: 'configurationCode', message: 'configurationCode is required.' });
  }
  if (!vehicleId || !isUuid(vehicleId)) {
    issues.push({ field: 'vehicleId', message: 'vehicleId must be a UUID.' });
  }
  if (body.configurationVersion !== undefined && !configurationVersion) {
    issues.push({
      field: 'configurationVersion',
      message: 'configurationVersion must be a positive integer.',
    });
  }

  if (issues.length) {
    throw validationError('Build configuration validation failed.', issues);
  }

  return {
    configurationCode: configurationCode!,
    vehicleId: vehicleId!,
    configurationVersion,
    selectedOptions,
    notes,
  };
}

function validateCreateBom(input: unknown): CreateBomInput {
  const body = input as Partial<CreateBomInput>;
  const issues: Array<{ field: string; message: string }> = [];
  const bomCode = normalizeText(body.bomCode);
  const buildConfigurationId = normalizeText(body.buildConfigurationId);
  const revision = toPositiveInt(body.revision);
  const notes = normalizeText(body.notes);
  const lines = Array.isArray(body.lines) ? body.lines : [];

  if (!bomCode) issues.push({ field: 'bomCode', message: 'bomCode is required.' });
  if (!buildConfigurationId || !isUuid(buildConfigurationId)) {
    issues.push({ field: 'buildConfigurationId', message: 'buildConfigurationId must be a UUID.' });
  }
  if (body.revision !== undefined && !revision) {
    issues.push({ field: 'revision', message: 'revision must be a positive integer.' });
  }
  if (lines.length === 0) {
    issues.push({ field: 'lines', message: 'At least one BOM line is required.' });
  }

  const seen = new Set<string>();
  const normalizedLines = lines.map((line, index): BomLineInput => {
    const partId = normalizeText(line?.partId);
    const quantityPerUnit = toPositiveNumber(line?.quantityPerUnit);
    const scrapFactor = toNonNegativeNumber(line?.scrapFactor, 0);
    if (!partId || !isUuid(partId)) {
      issues.push({ field: `lines.${index}.partId`, message: 'partId must be a UUID.' });
    } else if (seen.has(partId)) {
      issues.push({ field: `lines.${index}.partId`, message: 'partId must be unique per BOM.' });
    } else {
      seen.add(partId);
    }
    if (Number.isNaN(quantityPerUnit)) {
      issues.push({
        field: `lines.${index}.quantityPerUnit`,
        message: 'quantityPerUnit must be greater than zero.',
      });
    }
    if (Number.isNaN(scrapFactor)) {
      issues.push({
        field: `lines.${index}.scrapFactor`,
        message: 'scrapFactor must be zero or greater.',
      });
    }
    return {
      partId: partId ?? '',
      quantityPerUnit,
      scrapFactor,
      lineNote: normalizeText(line?.lineNote),
    };
  });

  if (issues.length) {
    throw validationError('BOM validation failed.', issues);
  }

  return {
    bomCode: bomCode!,
    buildConfigurationId: buildConfigurationId!,
    revision,
    notes,
    lines: normalizedLines,
  };
}

function validateCreateRoutingTemplate(input: unknown): CreateRoutingTemplateInput {
  const body = input as Partial<CreateRoutingTemplateInput>;
  const issues: Array<{ field: string; message: string }> = [];
  const routeCode = normalizeText(body.routeCode);
  const routeName = normalizeText(body.routeName);
  const routeVersion = toPositiveInt(body.routeVersion);
  const buildConfigurationId = normalizeText(body.buildConfigurationId);
  const effectiveFrom = toDateTime(body.effectiveFrom);
  const effectiveTo = toDateTime(body.effectiveTo);
  const notes = normalizeText(body.notes);
  const steps = Array.isArray(body.steps) ? body.steps : [];

  if (!routeCode) issues.push({ field: 'routeCode', message: 'routeCode is required.' });
  if (!routeName) issues.push({ field: 'routeName', message: 'routeName is required.' });
  if (body.routeVersion !== undefined && !routeVersion) {
    issues.push({ field: 'routeVersion', message: 'routeVersion must be a positive integer.' });
  }
  if (buildConfigurationId && !isUuid(buildConfigurationId)) {
    issues.push({ field: 'buildConfigurationId', message: 'buildConfigurationId must be a UUID.' });
  }
  if (body.effectiveFrom !== undefined && !effectiveFrom) {
    issues.push({ field: 'effectiveFrom', message: 'effectiveFrom must be a valid date.' });
  }
  if (body.effectiveTo !== undefined && !effectiveTo) {
    issues.push({ field: 'effectiveTo', message: 'effectiveTo must be a valid date.' });
  }
  if (effectiveFrom && effectiveTo && new Date(effectiveTo) <= new Date(effectiveFrom)) {
    issues.push({ field: 'effectiveTo', message: 'effectiveTo must be after effectiveFrom.' });
  }
  if (steps.length === 0) {
    issues.push({ field: 'steps', message: 'At least one routing step is required.' });
  }

  const seenSequences = new Set<number>();
  const seenOperationCodes = new Set<string>();
  const normalizedSteps = steps.map((step, index): RoutingTemplateStepInput => {
    const sequenceNo = toPositiveInt(step?.sequenceNo) ?? index + 1;
    const operationCode = normalizeText(step?.operationCode);
    const operationName = normalizeText(step?.operationName);
    const estimatedMinutes = toPositiveInt(step?.estimatedMinutes);
    const laborRateCents = toNonNegativeInt(step?.laborRateCents);
    const workstationCode = normalizeText(step?.workstationCode);
    const requiredSkillCode = normalizeText(step?.requiredSkillCode);
    const jobCardTitle = normalizeText(step?.jobCardTitle);
    const jobCardInstructions = normalizeText(step?.jobCardInstructions);

    if (step?.sequenceNo !== undefined && !toPositiveInt(step.sequenceNo)) {
      issues.push({ field: `steps.${index}.sequenceNo`, message: 'sequenceNo must be a positive integer.' });
    }
    if (seenSequences.has(sequenceNo)) {
      issues.push({ field: `steps.${index}.sequenceNo`, message: 'sequenceNo must be unique.' });
    } else {
      seenSequences.add(sequenceNo);
    }
    if (!operationCode) {
      issues.push({ field: `steps.${index}.operationCode`, message: 'operationCode is required.' });
    } else if (seenOperationCodes.has(operationCode)) {
      issues.push({ field: `steps.${index}.operationCode`, message: 'operationCode must be unique.' });
    } else {
      seenOperationCodes.add(operationCode);
    }
    if (!operationName) {
      issues.push({ field: `steps.${index}.operationName`, message: 'operationName is required.' });
    }
    if (!estimatedMinutes) {
      issues.push({
        field: `steps.${index}.estimatedMinutes`,
        message: 'estimatedMinutes must be a positive integer.',
      });
    }
    if (Number.isNaN(laborRateCents)) {
      issues.push({
        field: `steps.${index}.laborRateCents`,
        message: 'laborRateCents must be a non-negative integer.',
      });
    }

    return {
      sequenceNo,
      operationCode: operationCode ?? '',
      operationName: operationName ?? '',
      workstationCode,
      estimatedMinutes: estimatedMinutes ?? Number.NaN,
      laborRateCents,
      requiredSkillCode,
      jobCardTitle,
      jobCardInstructions,
      qcRequired: toBoolean(step?.qcRequired),
      evidenceRequired: toBoolean(step?.evidenceRequired),
    };
  });

  if (issues.length) {
    throw validationError('Routing template validation failed.', issues);
  }

  return {
    routeCode: routeCode!,
    routeName: routeName!,
    routeVersion,
    buildConfigurationId,
    effectiveFrom,
    effectiveTo,
    notes,
    steps: normalizedSteps,
  };
}

class PrismaPlanningMasterStore implements PlanningMasterStore {
  async listBuildConfigurations(input: {
    search?: string;
    status?: BuildConfigurationStatus;
    vehicleId?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: BuildConfigurationResponse[]; total: number; limit: number; offset: number }> {
    const predicates: Prisma.Sql[] = [];
    if (input.status) {
      predicates.push(Prisma.sql`bc.configuration_status = ${input.status}::planning."BuildConfigurationStatus"`);
    }
    if (input.vehicleId) {
      predicates.push(Prisma.sql`bc.vehicle_id = ${input.vehicleId}::uuid`);
    }
    if (input.search) {
      const pattern = `%${input.search}%`;
      predicates.push(Prisma.sql`(
        bc.configuration_code ILIKE ${pattern}
        OR cv.serial_number ILIKE ${pattern}
        OR cv.vin ILIKE ${pattern}
        OR cv.model_code ILIKE ${pattern}
        OR c.full_name ILIKE ${pattern}
        OR c.company_name ILIKE ${pattern}
      )`);
    }
    const where =
      predicates.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(predicates, ' AND ')}`
        : Prisma.empty;

    const rows = await prisma.$queryRaw<BuildConfigurationRow[]>(
      configurationSelect(
        where,
        Prisma.sql`ORDER BY bc.updated_at DESC LIMIT ${input.limit} OFFSET ${input.offset}`,
      ),
    );
    const totalRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM planning.build_configurations bc
      JOIN planning.cart_vehicles cv ON cv.id = bc.vehicle_id
      LEFT JOIN customers.customers c ON c.id = cv.customer_id
      ${where}
    `;
    const changesByConfiguration = await loadBuildConfigurationChangeEvents(
      prisma,
      rows.map((row) => row.id),
    );

    return {
      items: rows.map((row) => mapConfiguration(row, changesByConfiguration.get(row.id) ?? [])),
      total: Number(totalRows[0]?.count ?? 0),
      limit: input.limit,
      offset: input.offset,
    };
  }

  async createBuildConfiguration(
    input: CreateBuildConfigurationInput,
    context: RequestContext,
  ): Promise<BuildConfigurationResponse> {
    return prisma.$transaction(async (tx) => {
      const vehicleRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id FROM planning.cart_vehicles WHERE id = ${input.vehicleId}::uuid
      `;
      if (!vehicleRows[0]) {
        throw new PlanningMasterCommandError('Cart vehicle was not found.', 404);
      }

      const version =
        input.configurationVersion ??
        Number(
          (
            await tx.$queryRaw<Array<{ nextVersion: number }>>`
              SELECT coalesce(max(configuration_version), 0)::int + 1 AS "nextVersion"
              FROM planning.build_configurations
              WHERE vehicle_id = ${input.vehicleId}::uuid
            `
          )[0]?.nextVersion ?? 1,
        );

      const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO planning.build_configurations (
          configuration_code,
          vehicle_id,
          configuration_version,
          selected_options,
          notes,
          created_by_user_id,
          updated_by_user_id,
          last_correlation_id,
          last_request_id
        )
        VALUES (
          ${input.configurationCode},
          ${input.vehicleId}::uuid,
          ${version},
          ${JSON.stringify(input.selectedOptions ?? [])}::jsonb,
          ${input.notes ?? null},
          ${actorUuid(context.actorId)}::uuid,
          ${actorUuid(context.actorId)}::uuid,
          ${context.correlationId},
          ${context.requestId ?? null}
        )
        RETURNING id::text
      `;
      const configurationId = inserted[0]!.id;
      await recordBuildConfigurationChangeEvent(
        tx,
        {
          id: configurationId,
          configurationCode: input.configurationCode,
          configurationVersion: version,
          configurationStatus: 'DRAFT',
        },
        {
          changeKind: 'CREATED',
          newStatus: 'DRAFT',
          changeSummary: 'Build configuration draft created for engineering review.',
        },
        context,
      );

      const created = await getConfigurationById(tx, configurationId);
      if (!created) throw new PlanningMasterCommandError('Build configuration was not created.', 500);
      return created;
    });
  }

  async transitionBuildConfiguration(
    id: string,
    input: TransitionBuildConfigurationInput,
    context: RequestContext,
  ): Promise<BuildConfigurationResponse> {
    if (!isUuid(id)) throw new PlanningMasterCommandError('Build configuration ID must be a UUID.', 400);
    if (!BUILD_CONFIGURATION_STATUSES.includes(input.state)) {
      throw new PlanningMasterCommandError(`Invalid build configuration state: ${input.state}`, 422);
    }

    return prisma.$transaction(async (tx) => {
      const current = await getConfigurationById(tx, id);
      if (!current) throw new PlanningMasterCommandError('Build configuration was not found.', 404);
      const approvalNote = normalizeText(input.approvalNote);
      if (!approvalNote) {
        throw new PlanningMasterCommandError(
          'Build configuration lock and release require an approval note.',
          422,
        );
      }
      if (input.state === 'DRAFT' || input.state === 'SUPERSEDED') {
        throw new PlanningMasterCommandError(
          'Build configurations can only be locked or released through this endpoint.',
          422,
        );
      }
      if (current.configurationStatus === input.state) {
        throw new PlanningMasterCommandError(
          `Build configuration is already ${input.state}.`,
          409,
        );
      }
      if (current.configurationStatus === 'SUPERSEDED') {
        throw new PlanningMasterCommandError('Superseded build configurations cannot transition.', 409);
      }
      if (current.configurationStatus === 'RELEASED') {
        throw new PlanningMasterCommandError(
          'Released build configurations can only be superseded by releasing a newer version.',
          409,
        );
      }
      if (current.configurationStatus === 'DRAFT' && input.state !== 'LOCKED') {
        throw new PlanningMasterCommandError('Build configurations must be locked before release.', 409);
      }
      if (current.configurationStatus === 'LOCKED' && input.state !== 'RELEASED') {
        throw new PlanningMasterCommandError('Locked build configurations can only be released.', 409);
      }

      const supersededRows =
        input.state === 'RELEASED'
          ? await tx.$queryRaw<Array<{
              id: string;
              configurationCode: string;
              configurationVersion: number;
              configurationStatus: BuildConfigurationStatus;
            }>>`
              SELECT
                id::text AS "id",
                configuration_code AS "configurationCode",
                configuration_version AS "configurationVersion",
                configuration_status::text AS "configurationStatus"
              FROM planning.build_configurations
              WHERE vehicle_id = ${current.vehicleId}::uuid
                AND configuration_status = 'RELEASED'
                AND id <> ${id}::uuid
            `
          : [];

      if (input.state === 'RELEASED') {
        await tx.$executeRaw`
          UPDATE planning.build_configurations
          SET configuration_status = 'SUPERSEDED',
              superseded_by_id = ${id}::uuid,
              updated_at = now(),
              updated_by_user_id = ${actorUuid(context.actorId)}::uuid,
              last_correlation_id = ${context.correlationId},
              last_request_id = ${context.requestId ?? null},
              version = version + 1
          WHERE vehicle_id = ${current.vehicleId}::uuid
            AND configuration_status = 'RELEASED'
            AND id <> ${id}::uuid
        `;
      }
      for (const superseded of supersededRows) {
        await recordBuildConfigurationChangeEvent(
          tx,
          superseded,
          {
            changeKind: 'SUPERSEDED',
            previousStatus: 'RELEASED',
            newStatus: 'SUPERSEDED',
            changeSummary: `Build configuration superseded by ${current.configurationCode} v${current.configurationVersion}.`,
            approvalNote,
          },
          context,
        );
      }

      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE planning.build_configurations
        SET configuration_status = ${input.state}::planning."BuildConfigurationStatus",
            released_at = CASE
              WHEN ${input.state} = 'RELEASED' THEN coalesce(released_at, now())
              ELSE released_at
            END,
            updated_at = now(),
            updated_by_user_id = ${actorUuid(context.actorId)}::uuid,
            last_correlation_id = ${context.correlationId},
            last_request_id = ${context.requestId ?? null},
            version = version + 1
        WHERE id = ${id}::uuid
        RETURNING id::text
      `;
      if (!rows[0]) throw new PlanningMasterCommandError('Build configuration was not found.', 404);
      await recordBuildConfigurationChangeEvent(
        tx,
        current,
        {
          changeKind: input.state === 'LOCKED' ? 'LOCKED' : 'RELEASED',
          previousStatus: current.configurationStatus,
          newStatus: input.state,
          changeSummary:
            normalizeText(input.changeSummary) ??
            `Build configuration moved from ${current.configurationStatus} to ${input.state}.`,
          approvalNote,
        },
        context,
      );
      const updated = await getConfigurationById(tx, id);
      if (!updated) throw new PlanningMasterCommandError('Build configuration was not found.', 404);
      return updated;
    });
  }

  async listBoms(input: {
    search?: string;
    status?: BomStatus;
    buildConfigurationId?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: BomResponse[]; total: number; limit: number; offset: number }> {
    const predicates: Prisma.Sql[] = [];
    if (input.status) {
      predicates.push(Prisma.sql`b.bom_status = ${input.status}::planning."BomStatus"`);
    }
    if (input.buildConfigurationId) {
      predicates.push(Prisma.sql`b.build_configuration_id = ${input.buildConfigurationId}::uuid`);
    }
    if (input.search) {
      const pattern = `%${input.search}%`;
      predicates.push(Prisma.sql`(
        b.bom_code ILIKE ${pattern}
        OR bc.configuration_code ILIKE ${pattern}
      )`);
    }
    const where =
      predicates.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(predicates, ' AND ')}`
        : Prisma.empty;
    const rows = await prisma.$queryRaw<BomRow[]>(
      bomSelect(
        where,
        Prisma.sql`ORDER BY b.updated_at DESC LIMIT ${input.limit} OFFSET ${input.offset}`,
      ),
    );
    const totalRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM planning.build_boms b
      JOIN planning.build_configurations bc ON bc.id = b.build_configuration_id
      ${where}
    `;
    const linesByBom = await loadBomLines(
      prisma,
      rows.map((row) => row.id),
    );
    const changesByBom = await loadBomChangeEvents(
      prisma,
      rows.map((row) => row.id),
    );

    return {
      items: rows.map((row) =>
        mapBom(row, linesByBom.get(row.id) ?? [], changesByBom.get(row.id) ?? []),
      ),
      total: Number(totalRows[0]?.count ?? 0),
      limit: input.limit,
      offset: input.offset,
    };
  }

  async createBom(input: CreateBomInput, context: RequestContext): Promise<BomResponse> {
    return prisma.$transaction(async (tx) => {
      const configRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id
        FROM planning.build_configurations
        WHERE id = ${input.buildConfigurationId}::uuid
      `;
      if (!configRows[0]) throw new PlanningMasterCommandError('Build configuration was not found.', 404);

      const revision =
        input.revision ??
        Number(
          (
            await tx.$queryRaw<Array<{ nextRevision: number }>>`
              SELECT coalesce(max(revision), 0)::int + 1 AS "nextRevision"
              FROM planning.build_boms
              WHERE build_configuration_id = ${input.buildConfigurationId}::uuid
            `
          )[0]?.nextRevision ?? 1,
        );

      const partRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id
        FROM inventory.parts
        WHERE id::text IN (${Prisma.join(input.lines.map((line) => line.partId))})
          AND deleted_at IS NULL
      `;
      const existingParts = new Set(partRows.map((row) => row.id));
      const missing = input.lines.filter((line) => !existingParts.has(line.partId));
      if (missing.length > 0) {
        throw validationError('BOM validation failed.', [
          { field: 'lines.partId', message: `Unknown active part ID: ${missing[0]!.partId}` },
        ]);
      }

      const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO planning.build_boms (
          bom_code,
          build_configuration_id,
          revision,
          notes,
          created_by_user_id,
          updated_by_user_id,
          last_correlation_id,
          last_request_id
        )
        VALUES (
          ${input.bomCode},
          ${input.buildConfigurationId}::uuid,
          ${revision},
          ${input.notes ?? null},
          ${actorUuid(context.actorId)}::uuid,
          ${actorUuid(context.actorId)}::uuid,
          ${context.correlationId},
          ${context.requestId ?? null}
        )
        RETURNING id::text
      `;
      const bomId = inserted[0]!.id;

      await tx.$executeRaw`
        INSERT INTO planning.build_bom_lines (
          bom_id,
          part_id,
          quantity_per_unit,
          scrap_factor,
          line_note
        )
        VALUES ${Prisma.join(
          input.lines.map((line) => Prisma.sql`(
            ${bomId}::uuid,
            ${line.partId}::uuid,
            ${line.quantityPerUnit},
            ${line.scrapFactor ?? 0},
            ${line.lineNote ?? null}
          )`),
        )}
      `;

      await recordBomChangeEvent(
        tx,
        {
          id: bomId,
          bomCode: input.bomCode,
          buildConfigurationId: input.buildConfigurationId,
          revision,
          bomStatus: 'DRAFT',
        },
        {
          changeKind: 'CREATED',
          newStatus: 'DRAFT',
          changeSummary: 'BOM revision created for engineering review.',
        },
        context,
      );

      const created = await getBomById(tx, bomId);
      if (!created) throw new PlanningMasterCommandError('BOM was not created.', 500);
      return created;
    });
  }

  async approveBom(id: string, input: ApproveBomInput, context: RequestContext): Promise<BomResponse> {
    if (!isUuid(id)) throw new PlanningMasterCommandError('BOM ID must be a UUID.', 400);

    return prisma.$transaction(async (tx) => {
      const current = await getBomById(tx, id);
      if (!current) throw new PlanningMasterCommandError('BOM was not found.', 404);
      const approvalNote = normalizeText(input.approvalNote);
      if (!approvalNote) {
        throw new PlanningMasterCommandError('BOM approval requires an approval note.', 422);
      }
      if (current.lines.length === 0) {
        throw new PlanningMasterCommandError('BOM requires at least one line before approval.', 409);
      }
      if (current.bomStatus === 'APPROVED') {
        throw new PlanningMasterCommandError('BOM revision is already approved.', 409);
      }
      if (current.bomStatus === 'OBSOLETE') {
        throw new PlanningMasterCommandError('Obsolete BOM revisions cannot be approved.', 409);
      }

      const obsoleteRows = await tx.$queryRaw<Array<{
        id: string;
        bomCode: string;
        buildConfigurationId: string;
        revision: number;
        bomStatus: BomStatus;
      }>>`
        SELECT
          id::text AS "id",
          bom_code AS "bomCode",
          build_configuration_id::text AS "buildConfigurationId",
          revision AS "revision",
          bom_status::text AS "bomStatus"
        FROM planning.build_boms
        WHERE build_configuration_id = ${current.buildConfigurationId}::uuid
          AND bom_status = 'APPROVED'
          AND id <> ${id}::uuid
      `;

      await tx.$executeRaw`
        UPDATE planning.build_boms
        SET bom_status = 'OBSOLETE',
            updated_at = now(),
            updated_by_user_id = ${actorUuid(context.actorId)}::uuid,
            last_correlation_id = ${context.correlationId},
            last_request_id = ${context.requestId ?? null},
            version = version + 1
        WHERE build_configuration_id = ${current.buildConfigurationId}::uuid
          AND bom_status = 'APPROVED'
          AND id <> ${id}::uuid
      `;
      for (const obsolete of obsoleteRows) {
        await recordBomChangeEvent(
          tx,
          obsolete,
          {
            changeKind: 'OBSOLETED',
            previousStatus: 'APPROVED',
            newStatus: 'OBSOLETE',
            changeSummary: `BOM revision obsoleted by ${current.bomCode} rev ${current.revision}.`,
            approvalNote,
          },
          context,
        );
      }

      await tx.$executeRaw`
        UPDATE planning.build_boms
        SET bom_status = 'APPROVED',
            approved_at = coalesce(approved_at, now()),
            approved_by_user_id = ${actorUuid(context.actorId)}::uuid,
            updated_at = now(),
            updated_by_user_id = ${actorUuid(context.actorId)}::uuid,
            last_correlation_id = ${context.correlationId},
            last_request_id = ${context.requestId ?? null},
            version = version + 1
        WHERE id = ${id}::uuid
      `;
      await recordBomChangeEvent(
        tx,
        current,
        {
          changeKind: 'APPROVED',
          previousStatus: current.bomStatus,
          newStatus: 'APPROVED',
          changeSummary:
            normalizeText(input.changeSummary) ??
            `BOM revision ${current.revision} approved for production.`,
          approvalNote,
        },
        context,
      );

      const approved = await getBomById(tx, id);
      if (!approved) throw new PlanningMasterCommandError('BOM was not found.', 404);
      return approved;
    });
  }

  async listRoutingTemplates(input: {
    search?: string;
    status?: RoutingTemplateStatus;
    buildConfigurationId?: string;
    effectiveOn?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: RoutingTemplateResponse[]; total: number; limit: number; offset: number }> {
    const predicates: Prisma.Sql[] = [];
    if (input.status) {
      predicates.push(Prisma.sql`rt.template_status = ${input.status}::planning."RoutingTemplateStatus"`);
    }
    if (input.buildConfigurationId) {
      predicates.push(Prisma.sql`rt.build_configuration_id = ${input.buildConfigurationId}::uuid`);
    }
    if (input.effectiveOn) {
      predicates.push(Prisma.sql`(
        rt.effective_from <= ${input.effectiveOn}::timestamptz
        AND (rt.effective_to IS NULL OR rt.effective_to > ${input.effectiveOn}::timestamptz)
      )`);
    }
    if (input.search) {
      const pattern = `%${input.search}%`;
      predicates.push(Prisma.sql`(
        rt.route_code ILIKE ${pattern}
        OR rt.route_name ILIKE ${pattern}
        OR rt.notes ILIKE ${pattern}
        OR bc.configuration_code ILIKE ${pattern}
      )`);
    }
    const where =
      predicates.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(predicates, ' AND ')}`
        : Prisma.empty;

    const rows = await prisma.$queryRaw<RoutingTemplateRow[]>(
      routingTemplateSelect(
        where,
        Prisma.sql`ORDER BY rt.updated_at DESC LIMIT ${input.limit} OFFSET ${input.offset}`,
      ),
    );
    const totalRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM planning.routing_templates rt
      LEFT JOIN planning.build_configurations bc ON bc.id = rt.build_configuration_id
      ${where}
    `;
    const stepsByTemplate = await loadRoutingTemplateSteps(
      prisma,
      rows.map((row) => row.id),
    );
    const changesByTemplate = await loadRoutingTemplateChangeEvents(
      prisma,
      rows.map((row) => row.id),
    );

    return {
      items: rows.map((row) =>
        mapRoutingTemplate(
          row,
          stepsByTemplate.get(row.id) ?? [],
          changesByTemplate.get(row.id) ?? [],
        ),
      ),
      total: Number(totalRows[0]?.count ?? 0),
      limit: input.limit,
      offset: input.offset,
    };
  }

  async createRoutingTemplate(
    input: CreateRoutingTemplateInput,
    context: RequestContext,
  ): Promise<RoutingTemplateResponse> {
    return prisma.$transaction(async (tx) => {
      if (input.buildConfigurationId) {
        const configRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id::text AS id
          FROM planning.build_configurations
          WHERE id = ${input.buildConfigurationId}::uuid
        `;
        if (!configRows[0]) {
          throw new PlanningMasterCommandError('Build configuration was not found.', 404);
        }
      }

      const routeVersion =
        input.routeVersion ??
        Number(
          (
            await tx.$queryRaw<Array<{ nextVersion: number }>>`
              SELECT coalesce(max(route_version), 0)::int + 1 AS "nextVersion"
              FROM planning.routing_templates
              WHERE route_code = ${input.routeCode}
            `
          )[0]?.nextVersion ?? 1,
        );

      const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO planning.routing_templates (
          route_code,
          route_name,
          route_version,
          build_configuration_id,
          effective_from,
          effective_to,
          notes,
          created_by_user_id,
          updated_by_user_id,
          last_correlation_id,
          last_request_id
        )
        VALUES (
          ${input.routeCode},
          ${input.routeName},
          ${routeVersion},
          ${input.buildConfigurationId ?? null}::uuid,
          ${input.effectiveFrom ?? new Date().toISOString()}::timestamptz,
          ${input.effectiveTo ?? null}::timestamptz,
          ${input.notes ?? null},
          ${actorUuid(context.actorId)}::uuid,
          ${actorUuid(context.actorId)}::uuid,
          ${context.correlationId},
          ${context.requestId ?? null}
        )
        RETURNING id::text
      `;
      const routingTemplateId = inserted[0]!.id;

      await tx.$executeRaw`
        INSERT INTO planning.routing_template_steps (
          routing_template_id,
          sequence_no,
          operation_code,
          operation_name,
          workstation_code,
          estimated_minutes,
          labor_rate_cents,
          required_skill_code,
          job_card_title,
          job_card_instructions,
          qc_required,
          evidence_required
        )
        VALUES ${Prisma.join(
          input.steps.map((step, index) => Prisma.sql`(
            ${routingTemplateId}::uuid,
            ${step.sequenceNo ?? index + 1},
            ${step.operationCode},
            ${step.operationName},
            ${step.workstationCode ?? null},
            ${step.estimatedMinutes},
            ${step.laborRateCents ?? null},
            ${step.requiredSkillCode ?? null},
            ${step.jobCardTitle ?? null},
            ${step.jobCardInstructions ?? null},
            ${step.qcRequired ?? false},
            ${step.evidenceRequired ?? false}
          )`),
        )}
      `;

      await recordRoutingTemplateChangeEvent(
        tx,
        {
          id: routingTemplateId,
          routeCode: input.routeCode,
          routeVersion,
          templateStatus: 'DRAFT',
        },
        {
          changeKind: 'CREATED',
          newStatus: 'DRAFT',
          changeSummary: 'Route version created for engineering review.',
        },
        context,
      );

      const created = await getRoutingTemplateById(tx, routingTemplateId);
      if (!created) throw new PlanningMasterCommandError('Routing template was not created.', 500);
      return created;
    });
  }

  async transitionRoutingTemplate(
    id: string,
    input: TransitionRoutingTemplateInput,
    context: RequestContext,
  ): Promise<RoutingTemplateResponse> {
    if (!isUuid(id)) throw new PlanningMasterCommandError('Routing template ID must be a UUID.', 400);
    if (!ROUTING_TEMPLATE_STATUSES.includes(input.status)) {
      throw new PlanningMasterCommandError(`Invalid routing template status: ${input.status}`, 422);
    }
    if (input.status === 'DRAFT') {
      throw new PlanningMasterCommandError('Routing templates cannot transition back to DRAFT.', 422);
    }

    return prisma.$transaction(async (tx) => {
      const current = await getRoutingTemplateById(tx, id);
      if (!current) throw new PlanningMasterCommandError('Routing template was not found.', 404);
      const approvalNote = normalizeText(input.approvalNote);
      const approvalRequired = input.status === 'ACTIVE' || input.status === 'RETIRED';
      if (approvalRequired && !approvalNote) {
        throw new PlanningMasterCommandError(
          'Routing template activation and retirement require an approval note.',
          422,
        );
      }
      if (current.templateStatus === input.status) {
        throw new PlanningMasterCommandError(
          `Routing template is already ${input.status}.`,
          409,
        );
      }
      if (current.templateStatus === 'RETIRED' && input.status === 'ACTIVE') {
        throw new PlanningMasterCommandError(
          'Retired routing templates cannot be reactivated; create a new route version instead.',
          409,
        );
      }
      if (input.status === 'ACTIVE' && current.steps.length === 0) {
        throw new PlanningMasterCommandError(
          'Routing template requires at least one step before activation.',
          409,
        );
      }
      if (input.status === 'ACTIVE' && current.effectiveTo && new Date(current.effectiveTo) <= new Date()) {
        throw new PlanningMasterCommandError(
          'Routing template effective window has already ended.',
          409,
        );
      }

      const autoRetiredRows =
        input.status === 'ACTIVE'
          ? await tx.$queryRaw<Array<{
              id: string;
              routeCode: string;
              routeVersion: number;
              templateStatus: RoutingTemplateStatus;
            }>>`
              SELECT
                id::text AS "id",
                route_code AS "routeCode",
                route_version AS "routeVersion",
                template_status::text AS "templateStatus"
              FROM planning.routing_templates
              WHERE route_code = ${current.routeCode}
                AND template_status = 'ACTIVE'
                AND id <> ${id}::uuid
            `
          : [];

      if (input.status === 'ACTIVE') {
        await tx.$executeRaw`
          UPDATE planning.routing_templates
          SET template_status = 'RETIRED',
              retired_at = coalesce(retired_at, now()),
              updated_at = now(),
              updated_by_user_id = ${actorUuid(context.actorId)}::uuid,
              last_correlation_id = ${context.correlationId},
              last_request_id = ${context.requestId ?? null},
              version = version + 1
          WHERE route_code = ${current.routeCode}
            AND template_status = 'ACTIVE'
            AND id <> ${id}::uuid
        `;
      }
      for (const retired of autoRetiredRows) {
        await recordRoutingTemplateChangeEvent(
          tx,
          retired,
          {
            changeKind: 'AUTO_RETIRED',
            previousStatus: 'ACTIVE',
            newStatus: 'RETIRED',
            changeSummary: `Route version auto-retired because ${current.routeCode} v${current.routeVersion} was activated.`,
            approvalNote,
          },
          context,
        );
      }

      await tx.$executeRaw`
        UPDATE planning.routing_templates
        SET template_status = ${input.status}::planning."RoutingTemplateStatus",
            activated_at = CASE
              WHEN ${input.status} = 'ACTIVE' THEN coalesce(activated_at, now())
              ELSE activated_at
            END,
            retired_at = CASE
              WHEN ${input.status} = 'RETIRED' THEN coalesce(retired_at, now())
              ELSE retired_at
            END,
            updated_at = now(),
            updated_by_user_id = ${actorUuid(context.actorId)}::uuid,
            last_correlation_id = ${context.correlationId},
            last_request_id = ${context.requestId ?? null},
            version = version + 1
        WHERE id = ${id}::uuid
      `;

      await recordRoutingTemplateChangeEvent(
        tx,
        current,
        {
          changeKind: input.status === 'ACTIVE' ? 'ACTIVATED' : 'RETIRED',
          previousStatus: current.templateStatus,
          newStatus: input.status,
          changeSummary:
            normalizeText(input.changeSummary) ??
            `Route version moved from ${current.templateStatus} to ${input.status}.`,
          approvalNote,
        },
        context,
      );

      const updated = await getRoutingTemplateById(tx, id);
      if (!updated) throw new PlanningMasterCommandError('Routing template was not found.', 404);
      return updated;
    });
  }

  async listBuildPackages(input: ListBuildPackagesQuery): Promise<ListBuildPackagesResponse> {
    const search = input.search?.trim();
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        buildConfigurationId: string;
        bomId: string;
        label: string;
        description: string;
        workOrderCount: bigint;
        lastUsedAt: Date | string;
        lastWorkOrderId: string | null;
        lastWorkOrderNumber: string | null;
        lastVehicleDisplayName: string | null;
        lastCustomerDisplayName: string | null;
        configurationStatus: string;
        bomStatus: string;
      }>
    >`
      SELECT
        concat(bc.id::text, ':', b.id::text) AS "id",
        bc.id::text AS "buildConfigurationId",
        b.id::text AS "bomId",
        concat(bc.configuration_code, ' / ', b.bom_code) AS "label",
        concat(
          'Version ', bc.configuration_version::text,
          ' · Revision ', b.revision::text,
          ' · ', coalesce(nullif(c.company_name, ''), c.full_name, 'Unassigned customer')
        ) AS "description",
        count(wo.id)::bigint AS "workOrderCount",
        coalesce(max(wo.updated_at), greatest(bc.updated_at, b.updated_at)) AS "lastUsedAt",
        (array_remove(array_agg(wo.id::text ORDER BY wo.updated_at DESC), NULL))[1] AS "lastWorkOrderId",
        (array_remove(array_agg(wo.work_order_number ORDER BY wo.updated_at DESC), NULL))[1] AS "lastWorkOrderNumber",
        concat(cv.model_year::text, ' ', cv.model_code, ' · ', cv.serial_number) AS "lastVehicleDisplayName",
        coalesce(nullif(c.company_name, ''), c.full_name) AS "lastCustomerDisplayName",
        bc.configuration_status::text AS "configurationStatus",
        b.bom_status::text AS "bomStatus"
      FROM planning.build_configurations bc
      JOIN planning.build_boms b ON b.build_configuration_id = bc.id
      JOIN planning.cart_vehicles cv ON cv.id = bc.vehicle_id
      LEFT JOIN customers.customers c ON c.id = cv.customer_id
      LEFT JOIN planning.work_orders wo
        ON wo.build_configuration_id = bc.id::text
       AND wo.bom_id = b.id::text
      WHERE bc.configuration_status = 'RELEASED'
        AND b.bom_status = 'APPROVED'
        AND (
          ${search ?? null}::text IS NULL
          OR bc.configuration_code ILIKE concat('%', ${search ?? ''}, '%')
          OR b.bom_code ILIKE concat('%', ${search ?? ''}, '%')
          OR cv.serial_number ILIKE concat('%', ${search ?? ''}, '%')
          OR cv.vin ILIKE concat('%', ${search ?? ''}, '%')
          OR c.full_name ILIKE concat('%', ${search ?? ''}, '%')
          OR c.company_name ILIKE concat('%', ${search ?? ''}, '%')
        )
      GROUP BY bc.id, b.id, cv.id, c.id
      ORDER BY coalesce(max(wo.updated_at), greatest(bc.updated_at, b.updated_at)) DESC
      LIMIT 500
    `;

    const items: WorkOrderBuildPackageResponse[] = rows.map((row) => ({
      id: row.id,
      buildConfigurationId: row.buildConfigurationId,
      bomId: row.bomId,
      label: row.label,
      description: row.description,
      source: 'PLANNING_MASTER',
      workOrderCount: Number(row.workOrderCount),
      lastUsedAt: iso(row.lastUsedAt),
      lastWorkOrderId: row.lastWorkOrderId ?? undefined,
      lastWorkOrderNumber: row.lastWorkOrderNumber ?? undefined,
      lastVehicleDisplayName: row.lastVehicleDisplayName ?? undefined,
      lastCustomerDisplayName: row.lastCustomerDisplayName ?? undefined,
      stateCounts: {
        [`CONFIG_${row.configurationStatus}`]: 1,
        [`BOM_${row.bomStatus}`]: 1,
      },
    }));
    const offset = input.offset ?? 0;
    const limit = Math.min(input.limit ?? 100, 500);
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
      source: 'PLANNING_MASTER',
    };
  }
}

let planningMasterStore: PlanningMasterStore = new PrismaPlanningMasterStore();

export function setPlanningMasterStoreForTests(store: PlanningMasterStore): void {
  planningMasterStore = store;
}

export function resetPlanningMasterStoreForTests(): void {
  planningMasterStore = new PrismaPlanningMasterStore();
}

export async function listPlanningMasterBuildPackages(
  input: ListBuildPackagesQuery,
): Promise<ListBuildPackagesResponse> {
  return planningMasterStore.listBuildPackages(input);
}

function toLimit(value: string | undefined, fallback = 50): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : Number.NaN;
}

function toOffset(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function resolveCorrelationId(event: ApiGatewayProxyEventLike): string {
  return (
    event.headers?.['x-correlation-id'] ??
    event.headers?.['X-Correlation-Id'] ??
    event.requestContext?.requestId ??
    randomUUID()
  );
}

function resolveActorId(event: ApiGatewayProxyEventLike): string | undefined {
  const actorHeader = event.headers?.['x-actor-id'] ?? event.headers?.['X-Actor-Id'];
  return actorHeader?.trim() ? actorHeader.trim() : undefined;
}

function parseJsonBody(body: string | null | undefined): unknown {
  if (!body?.trim()) return undefined;
  return JSON.parse(body) as unknown;
}

function requestContext(event: ApiGatewayProxyEventLike): RequestContext {
  return {
    actorId: resolveActorId(event),
    correlationId: resolveCorrelationId(event),
    requestId: event.requestContext?.requestId,
  };
}

function json(statusCode: number, payload: unknown): ApiGatewayProxyResultLike {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function errorJson(error: unknown): ApiGatewayProxyResultLike {
  if (error instanceof SyntaxError) return json(400, { message: 'Invalid JSON payload.' });
  if (error instanceof PlanningMasterCommandError) {
    return json(error.statusCode, {
      message: error.message,
      issues: error.issues,
    });
  }
  throw error;
}

export async function listBuildConfigurationsHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  const query = event.queryStringParameters ?? {};
  const limit = toLimit(query.limit);
  const offset = toOffset(query.offset);
  const status = query.status?.trim() as BuildConfigurationStatus | undefined;
  const vehicleId = query.vehicleId?.trim();
  if (Number.isNaN(limit)) return json(422, { message: 'limit must be a positive integer.' });
  if (Number.isNaN(offset)) return json(422, { message: 'offset must be a non-negative integer.' });
  if (status && !BUILD_CONFIGURATION_STATUSES.includes(status)) {
    return json(422, { message: `Invalid build configuration status: ${status}` });
  }
  if (vehicleId && !isUuid(vehicleId)) return json(422, { message: 'vehicleId must be a UUID.' });

  const result = await planningMasterStore.listBuildConfigurations({
    search: query.search?.trim() || undefined,
    status,
    vehicleId,
    limit,
    offset,
  });
  return json(200, result);
}

export async function createBuildConfigurationHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  try {
    const input = validateCreateConfiguration(parseJsonBody(event.body));
    const item = await planningMasterStore.createBuildConfiguration(input, requestContext(event));
    return json(201, { buildConfiguration: item });
  } catch (error) {
    return errorJson(error);
  }
}

export async function transitionBuildConfigurationHandler(
  event: ApiGatewayProxyEventLike & { pathParameters?: { id?: string } },
): Promise<ApiGatewayProxyResultLike> {
  try {
    const id = event.pathParameters?.id;
    if (!id) return json(400, { message: 'Build configuration ID is required.' });
    const body = parseJsonBody(event.body) as Partial<TransitionBuildConfigurationInput> | undefined;
    const state = body?.state;
    if (!state) return json(400, { message: 'Body must include { state }.' });
    const approvalNote = normalizeText(body?.approvalNote);
    const changeSummary = normalizeText(body?.changeSummary);
    if ((state === 'LOCKED' || state === 'RELEASED') && !approvalNote) {
      return json(422, { message: 'Build configuration lock and release require an approval note.' });
    }
    const item = await planningMasterStore.transitionBuildConfiguration(
      id,
      { state, approvalNote, changeSummary },
      requestContext(event),
    );
    return json(200, { buildConfiguration: item });
  } catch (error) {
    return errorJson(error);
  }
}

export async function listBomsHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  const query = event.queryStringParameters ?? {};
  const limit = toLimit(query.limit);
  const offset = toOffset(query.offset);
  const status = query.status?.trim() as BomStatus | undefined;
  const buildConfigurationId = query.buildConfigurationId?.trim();
  if (Number.isNaN(limit)) return json(422, { message: 'limit must be a positive integer.' });
  if (Number.isNaN(offset)) return json(422, { message: 'offset must be a non-negative integer.' });
  if (status && !BOM_STATUSES.includes(status)) return json(422, { message: `Invalid BOM status: ${status}` });
  if (buildConfigurationId && !isUuid(buildConfigurationId)) {
    return json(422, { message: 'buildConfigurationId must be a UUID.' });
  }

  const result = await planningMasterStore.listBoms({
    search: query.search?.trim() || undefined,
    status,
    buildConfigurationId,
    limit,
    offset,
  });
  return json(200, result);
}

export async function createBomHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  try {
    const input = validateCreateBom(parseJsonBody(event.body));
    const item = await planningMasterStore.createBom(input, requestContext(event));
    return json(201, { bom: item });
  } catch (error) {
    return errorJson(error);
  }
}

export async function approveBomHandler(
  event: ApiGatewayProxyEventLike & { pathParameters?: { id?: string } },
): Promise<ApiGatewayProxyResultLike> {
  try {
    const id = event.pathParameters?.id;
    if (!id) return json(400, { message: 'BOM ID is required.' });
    const body = parseJsonBody(event.body) as Partial<ApproveBomInput> | undefined;
    const approvalNote = normalizeText(body?.approvalNote);
    if (!approvalNote) return json(422, { message: 'BOM approval requires an approval note.' });
    const item = await planningMasterStore.approveBom(
      id,
      {
        approvalNote,
        changeSummary: normalizeText(body?.changeSummary),
      },
      requestContext(event),
    );
    return json(200, { bom: item });
  } catch (error) {
    return errorJson(error);
  }
}

export async function listRoutingTemplatesHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  const query = event.queryStringParameters ?? {};
  const limit = toLimit(query.limit);
  const offset = toOffset(query.offset);
  const status = query.status?.trim() as RoutingTemplateStatus | undefined;
  const buildConfigurationId = query.buildConfigurationId?.trim();
  const effectiveOn = toDateTime(query.effectiveOn);
  if (Number.isNaN(limit)) return json(422, { message: 'limit must be a positive integer.' });
  if (Number.isNaN(offset)) return json(422, { message: 'offset must be a non-negative integer.' });
  if (status && !ROUTING_TEMPLATE_STATUSES.includes(status)) {
    return json(422, { message: `Invalid routing template status: ${status}` });
  }
  if (buildConfigurationId && !isUuid(buildConfigurationId)) {
    return json(422, { message: 'buildConfigurationId must be a UUID.' });
  }
  if (query.effectiveOn !== undefined && !effectiveOn) {
    return json(422, { message: 'effectiveOn must be a valid date.' });
  }

  const result = await planningMasterStore.listRoutingTemplates({
    search: query.search?.trim() || undefined,
    status,
    buildConfigurationId,
    effectiveOn,
    limit,
    offset,
  });
  return json(200, result);
}

export async function createRoutingTemplateHandler(
  event: ApiGatewayProxyEventLike,
): Promise<ApiGatewayProxyResultLike> {
  try {
    const input = validateCreateRoutingTemplate(parseJsonBody(event.body));
    const item = await planningMasterStore.createRoutingTemplate(input, requestContext(event));
    return json(201, { routingTemplate: item });
  } catch (error) {
    return errorJson(error);
  }
}

export async function transitionRoutingTemplateHandler(
  event: ApiGatewayProxyEventLike & { pathParameters?: { id?: string } },
): Promise<ApiGatewayProxyResultLike> {
  try {
    const id = event.pathParameters?.id;
    if (!id) return json(400, { message: 'Routing template ID is required.' });
    const body = parseJsonBody(event.body) as Partial<TransitionRoutingTemplateInput> & {
      state?: RoutingTemplateStatus;
    } | undefined;
    const status = body?.status ?? body?.state;
    if (!status) return json(400, { message: 'Body must include { status }.' });
    const approvalNote = normalizeText(body?.approvalNote);
    const changeSummary = normalizeText(body?.changeSummary);
    const item = await planningMasterStore.transitionRoutingTemplate(
      id,
      { status, approvalNote, changeSummary },
      requestContext(event),
    );
    return json(200, { routingTemplate: item });
  } catch (error) {
    return errorJson(error);
  }
}
