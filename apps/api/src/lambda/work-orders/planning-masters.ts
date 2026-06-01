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

const BUILD_CONFIGURATION_STATUSES: BuildConfigurationStatus[] = [
  'DRAFT',
  'LOCKED',
  'RELEASED',
  'SUPERSEDED',
];
const BOM_STATUSES: BomStatus[] = ['DRAFT', 'APPROVED', 'OBSOLETE'];

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
}

export interface CreateBomInput {
  bomCode: string;
  buildConfigurationId: string;
  revision?: number;
  notes?: string;
  lines: BomLineInput[];
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
  approveBom(id: string, context: RequestContext): Promise<BomResponse>;
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

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function optionalIso(value: unknown): string | undefined {
  return value ? iso(value) : undefined;
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

function mapConfiguration(row: BuildConfigurationRow): BuildConfigurationResponse {
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
  };
}

function mapBom(row: BomRow, lines: BomLineResponse[]): BomResponse {
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
  return rows[0] ? mapConfiguration(rows[0]) : undefined;
}

async function getBomById(db: DbClient, id: string): Promise<BomResponse | undefined> {
  const rows = await db.$queryRaw<BomRow[]>(
    bomSelect(Prisma.sql`WHERE b.id = ${id}::uuid`, Prisma.sql`LIMIT 1`),
  );
  const row = rows[0];
  if (!row) return undefined;
  const linesByBom = await loadBomLines(db, [row.id]);
  return mapBom(row, linesByBom.get(row.id) ?? []);
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

    return {
      items: rows.map(mapConfiguration),
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
      const created = await getConfigurationById(tx, inserted[0]!.id);
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
      if (current.configurationStatus === 'SUPERSEDED') {
        throw new PlanningMasterCommandError('Superseded build configurations cannot transition.', 409);
      }

      if (input.state === 'RELEASED') {
        await tx.$executeRaw`
          UPDATE planning.build_configurations
          SET configuration_status = 'SUPERSEDED',
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

    return {
      items: rows.map((row) => mapBom(row, linesByBom.get(row.id) ?? [])),
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

      const created = await getBomById(tx, bomId);
      if (!created) throw new PlanningMasterCommandError('BOM was not created.', 500);
      return created;
    });
  }

  async approveBom(id: string, context: RequestContext): Promise<BomResponse> {
    if (!isUuid(id)) throw new PlanningMasterCommandError('BOM ID must be a UUID.', 400);

    return prisma.$transaction(async (tx) => {
      const current = await getBomById(tx, id);
      if (!current) throw new PlanningMasterCommandError('BOM was not found.', 404);
      if (current.lines.length === 0) {
        throw new PlanningMasterCommandError('BOM requires at least one line before approval.', 409);
      }

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

      const approved = await getBomById(tx, id);
      if (!approved) throw new PlanningMasterCommandError('BOM was not found.', 404);
      return approved;
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
    const item = await planningMasterStore.transitionBuildConfiguration(
      id,
      { state },
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
    const item = await planningMasterStore.approveBom(id, requestContext(event));
    return json(200, { bom: item });
  } catch (error) {
    return errorJson(error);
  }
}
