import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  wrapHandler,
  parseBody,
  jsonResponse,
  type LambdaEvent,
} from '../../shared/lambda/index.js';

let inventoryPrisma: PrismaClient | undefined;

function getInventoryPrisma(): PrismaClient {
  inventoryPrisma ??= new PrismaClient();
  return inventoryPrisma;
}

export const inventoryLotQueries = {
  listAvailableLots() {
    return getInventoryPrisma().$queryRaw<
      Array<{
        id: string;
        lotNumber: string | null;
        quantityOnHand: number | string;
        quantityReserved: number | string;
      }>
    >`
      SELECT
        lots.id::text AS "id",
        lots.lot_number AS "lotNumber",
        COALESCE(SUM(balances.quantity_on_hand), 0) AS "quantityOnHand",
        COALESCE(SUM(balances.quantity_reserved), 0) AS "quantityReserved"
      FROM inventory.stock_lots AS lots
      LEFT JOIN inventory.inventory_balances AS balances
        ON balances.stock_lot_id = lots.id
      WHERE lots.lot_state = 'AVAILABLE'
      GROUP BY lots.id, lots.lot_number, lots.received_at, lots.created_at
      ORDER BY lots.received_at DESC, lots.created_at DESC
    `;
  },

  async listLots(filters?: {
    partNumber?: string;
    warehouseId?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(filters?.page ?? 1, 1);
    const pageSize = Math.min(Math.max(filters?.pageSize ?? 50, 1), 200);

    const where = {
      ...(filters?.partNumber
        ? { part: { sku: { contains: filters.partNumber, mode: 'insensitive' as const } } }
        : {}),
      ...(filters?.warehouseId ? { stockLocationId: filters.warehouseId } : {}),
      ...(filters?.status
        ? { lotState: filters.status as 'AVAILABLE' | 'QUARANTINED' | 'CONSUMED' | 'CLOSED' }
        : {}),
    };

    const prisma = getInventoryPrisma();

    const [items, total] = await Promise.all([
      prisma.stockLot.findMany({
        where,
        include: {
          part: { select: { sku: true, name: true } },
          stockLocation: { select: { locationName: true } },
        },
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.stockLot.count({ where }),
    ]);

    const balanceRows =
      items.length > 0
        ? await prisma.$queryRaw<InventoryLotBalanceRow[]>`
            SELECT
              stock_lot_id::text AS "stockLotId",
              COALESCE(SUM(quantity_on_hand), 0) AS "quantityOnHand",
              COALESCE(SUM(quantity_reserved), 0) AS "quantityReserved",
              COALESCE(SUM(quantity_allocated), 0) AS "quantityAllocated",
              COALESCE(SUM(quantity_consumed), 0) AS "quantityConsumed"
            FROM inventory.inventory_balances
            WHERE stock_lot_id IN (${Prisma.join(items.map((item) => Prisma.sql`${item.id}::uuid`))})
            GROUP BY stock_lot_id
          `
        : [];
    const balancesByLot = new Map(balanceRows.map((row) => [row.stockLotId, row]));

    return {
      items: items.map((item) => ({ ...item, balance: balancesByLot.get(item.id) })),
      total,
      page,
      pageSize,
    };
  },

  async receivePurchaseOrderLine(input: ReceiveInventoryLotInput, correlationId: string) {
    const acceptedQuantity = input.quantity;
    const rejectedQuantity = input.rejectedQuantity ?? 0;
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

    return getInventoryPrisma().$transaction(async (tx) => {
      const lines = await tx.$queryRaw<PurchaseOrderReceiptLineRow[]>`
        SELECT
          pol.id::text AS "id",
          pol.purchase_order_id::text AS "purchaseOrderId",
          pol.part_id::text AS "partId",
          pol.ordered_quantity AS "orderedQuantity",
          pol.received_quantity AS "receivedQuantity",
          pol.rejected_quantity AS "rejectedQuantity",
          pol.unit_cost AS "unitCost",
          pol.line_state AS "lineState",
          po.purchase_order_state AS "purchaseOrderState",
          p.sku AS "partSku",
          p.name AS "partName",
          p.default_location_id::text AS "partDefaultLocationId"
        FROM inventory.purchase_order_lines pol
        JOIN inventory.purchase_orders po ON po.id = pol.purchase_order_id
        JOIN inventory.parts p ON p.id = pol.part_id
        WHERE pol.id = ${input.purchaseOrderLineId}::uuid
        FOR UPDATE OF pol, po
      `;
      const line = lines[0];
      if (!line) {
        throw new ReceivingCommandError(
          404,
          `Purchase order line not found: ${input.purchaseOrderLineId}`,
        );
      }
      if (input.purchaseOrderId && input.purchaseOrderId !== line.purchaseOrderId) {
        throw new ReceivingCommandError(
          409,
          `Purchase order line ${input.purchaseOrderLineId} does not belong to purchase order ${input.purchaseOrderId}.`,
        );
      }

      if (!['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'].includes(line.purchaseOrderState)) {
        throw new ReceivingCommandError(
          409,
          `Purchase order is not receivable in ${line.purchaseOrderState} state.`,
        );
      }

      const openQuantity = Math.max(
        numberFromDb(line.orderedQuantity) -
          numberFromDb(line.receivedQuantity) -
          numberFromDb(line.rejectedQuantity),
        0,
      );
      if (openQuantity <= 0) {
        throw new ReceivingCommandError(409, 'Purchase order line has no open quantity.');
      }
      if (acceptedQuantity + rejectedQuantity > openQuantity) {
        throw new ReceivingCommandError(
          409,
          `Receipt quantity exceeds open quantity (${openQuantity}).`,
        );
      }

      let lotResponse: ReturnType<typeof toLotDetailResponse> | undefined;
      if (acceptedQuantity > 0) {
        const lotId = randomUUID();
        const ledgerEntryId = randomUUID();
        const stockLocation = await resolveReceiptStockLocation(
          tx,
          input.stockLocationId ?? line.partDefaultLocationId ?? undefined,
        );
        if (!stockLocation) {
          throw new ReceivingCommandError(
            409,
            'No active stock location is available for receiving.',
          );
        }

        const lotNumber =
          input.lotNumber?.trim() ||
          `RCV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${lotId.slice(0, 8)}`;
        const metadata = {
          source: 'purchase_order_receipt',
          purchaseOrderId: line.purchaseOrderId,
          purchaseOrderLineId: line.id,
        };

        await tx.$executeRaw`
          INSERT INTO inventory.stock_lots (
            id,
            part_id,
            stock_location_id,
            lot_number,
            serial_number,
            lot_state,
            received_at,
            expires_at,
            metadata,
            created_at,
            updated_at,
            version
          )
          VALUES (
            ${lotId}::uuid,
            ${line.partId}::uuid,
            ${stockLocation.id}::uuid,
            ${lotNumber},
            ${input.serialNumber?.trim() || null},
            'AVAILABLE',
            ${receivedAt},
            ${expiresAt}::date,
            ${JSON.stringify(metadata)}::jsonb,
            now(),
            now(),
            0
          )
        `;

        await tx.$executeRaw`
          INSERT INTO inventory.inventory_ledger_entries (
            id,
            part_id,
            stock_location_id,
            stock_lot_id,
            movement_type,
            quantity_delta,
            unit_cost,
            value_delta,
            reason_code,
            source_document_type,
            source_document_id,
            correlation_id,
            created_at
          )
          VALUES (
            ${ledgerEntryId}::uuid,
            ${line.partId}::uuid,
            ${stockLocation.id}::uuid,
            ${lotId}::uuid,
            'RECEIPT',
            ${acceptedQuantity},
            ${numberFromDb(line.unitCost)},
            ${acceptedQuantity * numberFromDb(line.unitCost)},
            'PURCHASE_ORDER_RECEIPT',
            'PURCHASE_ORDER_LINE',
            ${line.id},
            ${correlationId},
            now()
          )
        `;

        await tx.$executeRaw`
          INSERT INTO inventory.inventory_balances (
            id,
            part_id,
            stock_location_id,
            stock_lot_id,
            quantity_on_hand,
            quantity_reserved,
            quantity_allocated,
            quantity_consumed,
            last_ledger_entry_id,
            updated_at,
            last_correlation_id,
            version
          )
          VALUES (
            ${randomUUID()}::uuid,
            ${line.partId}::uuid,
            ${stockLocation.id}::uuid,
            ${lotId}::uuid,
            ${acceptedQuantity},
            0,
            0,
            0,
            ${ledgerEntryId}::uuid,
            now(),
            ${correlationId},
            0
          )
        `;

        const lot = await tx.stockLot.findUnique({
          where: { id: lotId },
          include: {
            part: { select: { sku: true, name: true } },
            stockLocation: { select: { locationName: true } },
          },
        });
        if (!lot) {
          throw new ReceivingCommandError(500, 'Received lot could not be reloaded.');
        }

        const balanceRows = await tx.$queryRaw<InventoryLotBalanceRow[]>`
          SELECT
            stock_lot_id::text AS "stockLotId",
            COALESCE(SUM(quantity_on_hand), 0) AS "quantityOnHand",
            COALESCE(SUM(quantity_reserved), 0) AS "quantityReserved",
            COALESCE(SUM(quantity_allocated), 0) AS "quantityAllocated",
            COALESCE(SUM(quantity_consumed), 0) AS "quantityConsumed"
          FROM inventory.inventory_balances
          WHERE stock_lot_id = ${lotId}::uuid
          GROUP BY stock_lot_id
        `;
        lotResponse = toLotDetailResponse({ ...lot, balance: balanceRows[0] });
      }

      await tx.$executeRaw`
        UPDATE inventory.purchase_order_lines
        SET
          received_quantity = received_quantity + ${acceptedQuantity},
          rejected_quantity = rejected_quantity + ${rejectedQuantity},
          line_state = CASE
            WHEN received_quantity + rejected_quantity + ${acceptedQuantity + rejectedQuantity} >= ordered_quantity
              THEN 'RECEIVED'
            ELSE 'PARTIALLY_RECEIVED'
          END,
          updated_at = now(),
          correlation_id = ${correlationId},
          version = version + 1
        WHERE id = ${line.id}::uuid
      `;

      await tx.$executeRaw`
        WITH line_rollup AS (
          SELECT
            bool_and(received_quantity + rejected_quantity >= ordered_quantity) AS all_complete,
            bool_or(received_quantity + rejected_quantity > 0) AS any_received
          FROM inventory.purchase_order_lines
          WHERE purchase_order_id = ${line.purchaseOrderId}::uuid
        )
        UPDATE inventory.purchase_orders po
        SET
          purchase_order_state = CASE
            WHEN line_rollup.all_complete THEN 'RECEIVED'::inventory."PurchaseOrderState"
            WHEN line_rollup.any_received THEN 'PARTIALLY_RECEIVED'::inventory."PurchaseOrderState"
            ELSE po.purchase_order_state
          END,
          closed_at = CASE WHEN line_rollup.all_complete THEN now() ELSE po.closed_at END,
          updated_at = now(),
          correlation_id = ${correlationId},
          version = po.version + 1
        FROM line_rollup
        WHERE po.id = ${line.purchaseOrderId}::uuid
      `;

      const receiptRows = await tx.$queryRaw<
        Array<{
          purchaseOrderState: string;
          lineState: string;
          receivedQuantity: unknown;
          rejectedQuantity: unknown;
        }>
      >`
        SELECT
          po.purchase_order_state AS "purchaseOrderState",
          pol.line_state AS "lineState",
          pol.received_quantity AS "receivedQuantity",
          pol.rejected_quantity AS "rejectedQuantity"
        FROM inventory.purchase_order_lines pol
        JOIN inventory.purchase_orders po ON po.id = pol.purchase_order_id
        WHERE pol.id = ${line.id}::uuid
      `;
      const receipt = receiptRows[0];

      return {
        ...(lotResponse ? { lot: lotResponse } : {}),
        purchaseOrderLine: {
          id: line.id,
          lineState: receipt?.lineState ?? line.lineState,
          receivedQuantity: numberFromDb(receipt?.receivedQuantity),
          rejectedQuantity: numberFromDb(receipt?.rejectedQuantity),
        },
        purchaseOrderState: receipt?.purchaseOrderState ?? line.purchaseOrderState,
      };
    });
  },
};

const PURCHASE_ORDER_INCLUDE = Prisma.validator<Prisma.PurchaseOrderInclude>()({
  vendor: { select: { vendorName: true, vendorCode: true } },
  lines: {
    include: {
      part: {
        select: {
          sku: true,
          name: true,
          defaultLocationId: true,
          defaultLocation: { select: { locationName: true } },
        },
      },
      unitOfMeasure: { select: { uomCode: true, uomName: true } },
    },
    orderBy: { lineNumber: 'asc' },
  },
});

export const inventoryPurchaseOrderQueries = {
  async listPurchaseOrders(filters?: {
    status?: string;
    supplierId?: string;
    vendorId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(filters?.page ?? 1, 1);
    const pageSize = Math.min(Math.max(filters?.pageSize ?? 50, 1), 200);

    const where = {
      ...(filters?.status
        ? {
            purchaseOrderState: filters.status as
              | 'DRAFT'
              | 'APPROVED'
              | 'SENT'
              | 'PARTIALLY_RECEIVED'
              | 'RECEIVED'
              | 'CANCELLED',
          }
        : {}),
      ...(filters?.supplierId || filters?.vendorId
        ? { vendorId: filters.supplierId ?? filters.vendorId }
        : {}),
    };

    const prisma = getInventoryPrisma();

    const [items, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: PURCHASE_ORDER_INCLUDE,
        orderBy: { orderedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    return { items, total, page, pageSize };
  },

  async getPurchaseOrder(id: string) {
    return getInventoryPrisma().purchaseOrder.findFirst({
      where: { id },
      include: PURCHASE_ORDER_INCLUDE,
    });
  },

  async getVendor(id: string) {
    return getInventoryPrisma().vendor.findFirst({
      where: { id, deletedAt: null },
      include: {
        purchaseOrders: {
          select: { id: true, purchaseOrderState: true, expectedAt: true },
          orderBy: [{ expectedAt: 'desc' }, { orderedAt: 'desc' }],
          take: 25,
        },
      },
    });
  },
};

interface PurchaseOrderLineCommandInput {
  id?: string;
  partId: string;
  orderedQuantity: number;
  unitCost: number;
  unitOfMeasureId?: string;
  promisedAt?: string | null;
}

interface CreatePurchaseOrderInput {
  poNumber?: string;
  vendorId: string;
  expectedAt?: string | null;
  notes?: string | null;
  lines: PurchaseOrderLineCommandInput[];
}

interface UpdatePurchaseOrderInput {
  vendorId?: string;
  expectedAt?: string | null;
  notes?: string | null;
  lines?: PurchaseOrderLineCommandInput[];
}

type PurchaseOrderCommandAction = 'approve' | 'send' | 'cancel' | 'close';

interface PreparedPurchaseOrderLine {
  id: string;
  partId: string;
  unitOfMeasureId: string;
  orderedQuantity: number;
  unitCost: number;
  promisedAt: Date | null;
}

export const inventoryPurchaseOrderCommands = {
  async createPurchaseOrder(input: CreatePurchaseOrderInput, correlationId: string) {
    const prisma = getInventoryPrisma();
    return prisma.$transaction(async (tx) => {
      await assertActiveVendor(tx, input.vendorId);
      const lines = await preparePurchaseOrderLines(tx, input.lines);
      const poNumber = input.poNumber?.trim() || generatePurchaseOrderNumber();

      return tx.purchaseOrder.create({
        data: {
          id: randomUUID(),
          poNumber,
          vendorId: input.vendorId,
          purchaseOrderState: 'DRAFT',
          orderedAt: new Date(),
          expectedAt: normalizeNullableDate(input.expectedAt),
          notes: normalizeNullableString(input.notes),
          correlationId,
          lines: {
            create: lines.map((line, index) => ({
              id: line.id,
              lineNumber: index + 1,
              orderedQuantity: line.orderedQuantity,
              unitCost: line.unitCost,
              promisedAt: line.promisedAt,
              lineState: 'OPEN',
              correlationId,
              part: { connect: { id: line.partId } },
              unitOfMeasure: { connect: { id: line.unitOfMeasureId } },
            })),
          },
        },
        include: PURCHASE_ORDER_INCLUDE,
      });
    });
  },

  async updatePurchaseOrder(id: string, input: UpdatePurchaseOrderInput, correlationId: string) {
    const prisma = getInventoryPrisma();
    return prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { lines: { select: { id: true } } },
      });
      if (!existing) {
        throw new PurchaseOrderCommandError(404, `Purchase order not found: ${id}`);
      }
      if (existing.purchaseOrderState !== 'DRAFT') {
        throw new PurchaseOrderCommandError(
          409,
          `Purchase order is not editable in ${existing.purchaseOrderState} state.`,
        );
      }

      if (input.vendorId !== undefined) {
        await assertActiveVendor(tx, input.vendorId);
      }

      const data: Prisma.PurchaseOrderUncheckedUpdateInput = {
        updatedAt: new Date(),
        correlationId,
        version: { increment: 1 },
      };
      if (input.vendorId !== undefined) data.vendorId = input.vendorId;
      if ('expectedAt' in input) data.expectedAt = normalizeNullableDate(input.expectedAt);
      if ('notes' in input) data.notes = normalizeNullableString(input.notes);

      await tx.purchaseOrder.update({ where: { id }, data });

      if (input.lines !== undefined) {
        const lines = await preparePurchaseOrderLines(tx, input.lines);
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderLine.createMany({
          data: lines.map((line, index) => ({
            id: line.id,
            purchaseOrderId: id,
            lineNumber: index + 1,
            partId: line.partId,
            orderedQuantity: line.orderedQuantity,
            receivedQuantity: 0,
            rejectedQuantity: 0,
            unitOfMeasureId: line.unitOfMeasureId,
            unitCost: line.unitCost,
            promisedAt: line.promisedAt,
            lineState: 'OPEN',
            correlationId,
          })),
        });
      }

      const updated = await tx.purchaseOrder.findUnique({
        where: { id },
        include: PURCHASE_ORDER_INCLUDE,
      });
      if (!updated) throw new PurchaseOrderCommandError(404, `Purchase order not found: ${id}`);
      return updated;
    });
  },

  async transitionPurchaseOrder(
    id: string,
    action: PurchaseOrderCommandAction,
    correlationId: string,
  ) {
    const prisma = getInventoryPrisma();
    return prisma.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findUnique({
        where: { id },
        include: {
          vendor: { select: { vendorState: true } },
          lines: {
            select: {
              id: true,
              orderedQuantity: true,
              receivedQuantity: true,
              rejectedQuantity: true,
            },
          },
        },
      });
      if (!existing) {
        throw new PurchaseOrderCommandError(404, `Purchase order not found: ${id}`);
      }

      const now = new Date();
      const data: Prisma.PurchaseOrderUncheckedUpdateInput = {
        updatedAt: now,
        correlationId,
        version: { increment: 1 },
      };

      if (action === 'approve') {
        if (existing.purchaseOrderState !== 'DRAFT') {
          throw new PurchaseOrderCommandError(
            409,
            `Only DRAFT purchase orders can be approved. Current state: ${existing.purchaseOrderState}.`,
          );
        }
        if (existing.vendor.vendorState !== 'ACTIVE') {
          throw new PurchaseOrderCommandError(
            409,
            'Only ACTIVE vendors can receive new purchase orders.',
          );
        }
        if (existing.lines.length === 0) {
          throw new PurchaseOrderCommandError(409, 'Purchase order must have at least one line.');
        }
        data.purchaseOrderState = 'APPROVED';
      } else if (action === 'send') {
        if (existing.purchaseOrderState !== 'APPROVED') {
          throw new PurchaseOrderCommandError(
            409,
            `Only APPROVED purchase orders can be sent. Current state: ${existing.purchaseOrderState}.`,
          );
        }
        data.purchaseOrderState = 'SENT';
        data.sentAt = now;
      } else if (action === 'cancel') {
        if (
          !['DRAFT', 'APPROVED', 'SENT'].includes(existing.purchaseOrderState) ||
          hasReceivedPurchaseOrderQuantity(existing.lines)
        ) {
          throw new PurchaseOrderCommandError(
            409,
            `Purchase order cannot be cancelled in ${existing.purchaseOrderState} state after receipt activity.`,
          );
        }
        data.purchaseOrderState = 'CANCELLED';
        data.closedAt = now;
        await tx.purchaseOrderLine.updateMany({
          where: { purchaseOrderId: id },
          data: {
            lineState: 'CANCELLED',
            updatedAt: now,
            correlationId,
            version: { increment: 1 },
          },
        });
      } else {
        if (!['SENT', 'PARTIALLY_RECEIVED'].includes(existing.purchaseOrderState)) {
          throw new PurchaseOrderCommandError(
            409,
            `Only SENT or PARTIALLY_RECEIVED purchase orders can be closed. Current state: ${existing.purchaseOrderState}.`,
          );
        }
        if (!arePurchaseOrderLinesComplete(existing.lines)) {
          throw new PurchaseOrderCommandError(
            409,
            'Purchase order cannot be closed until all line quantities are received or rejected.',
          );
        }
        data.purchaseOrderState = 'RECEIVED';
        data.closedAt = now;
        await tx.purchaseOrderLine.updateMany({
          where: { purchaseOrderId: id },
          data: { lineState: 'RECEIVED', updatedAt: now, correlationId, version: { increment: 1 } },
        });
      }

      return tx.purchaseOrder.update({
        where: { id },
        data,
        include: PURCHASE_ORDER_INCLUDE,
      });
    });
  },
};

const RESERVATION_STATUSES = [
  'ACTIVE',
  'PARTIALLY_CONSUMED',
  'CONSUMED',
  'RELEASED',
  'CANCELLED',
  'EXPIRED',
] as const;

type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
type ReservationStatusFilter = ReservationStatus | 'OPEN' | 'ALL';

interface ListReservationsFilters {
  status?: ReservationStatusFilter;
  workOrderId?: string;
  partId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

interface InventoryReservationRow {
  id: string;
  status: ReservationStatus;
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
  workOrderId: string | null;
  workOrderNumber: string | null;
  workOrderTitle: string | null;
  workOrderPartId: string | null;
}

interface CountRow {
  total: number | bigint | string;
}

interface InventoryLotBalanceRow {
  stockLotId: string;
  quantityOnHand: unknown;
  quantityReserved: unknown;
  quantityAllocated: unknown;
  quantityConsumed: unknown;
}

interface PartInventoryBalanceRow {
  partId: string;
  quantityOnHand: unknown;
  quantityReserved: unknown;
  quantityAllocated: unknown;
  quantityConsumed: unknown;
}

interface PartProcurementRow {
  partId: string;
  inboundQuantity: unknown;
  draftQuantity: unknown;
  openPurchaseOrderCount: unknown;
  nextExpectedAt: Date | null;
  estimatedUnitCost: unknown;
}

interface CreateReservationInput {
  stockLotId: string;
  quantity: number;
  workOrderId?: string;
  workOrderPartId?: string;
  expiresAt?: string;
  priority?: number;
}

interface AdjustReservationInput {
  quantity?: number;
}

interface ReceiveInventoryLotInput {
  purchaseOrderId?: string;
  purchaseOrderLineId: string;
  quantity: number;
  rejectedQuantity?: number;
  stockLocationId?: string;
  lotNumber?: string;
  serialNumber?: string;
  receivedAt?: string;
  expiresAt?: string;
}

interface PurchaseOrderReceiptLineRow {
  id: string;
  purchaseOrderId: string;
  partId: string;
  orderedQuantity: unknown;
  receivedQuantity: unknown;
  rejectedQuantity: unknown;
  unitCost: unknown;
  lineState: string;
  purchaseOrderState: string;
  partSku: string;
  partName: string;
  partDefaultLocationId: string | null;
}

class ReservationCommandError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

class ReceivingCommandError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

class PurchaseOrderCommandError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const inventoryReservationQueries = {
  async listReservations(filters?: ListReservationsFilters) {
    const page = Math.max(filters?.page ?? 1, 1);
    const pageSize = Math.min(Math.max(filters?.pageSize ?? 50, 1), 200);
    const offset = (page - 1) * pageSize;
    const status = filters?.status && filters.status !== 'ALL' ? filters.status : undefined;
    const openOnly = status === 'OPEN';
    const exactStatus = status && status !== 'OPEN' ? status : undefined;
    const search = filters?.search?.trim() || undefined;

    const prisma = getInventoryPrisma();
    const [items, countRows] = await Promise.all([
      prisma.$queryRaw<InventoryReservationRow[]>`
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
          wo.id::text AS "workOrderId",
          wo.work_order_number AS "workOrderNumber",
          wo.title AS "workOrderTitle",
          wop.id::text AS "workOrderPartId"
        FROM inventory.inventory_reservations r
        JOIN inventory.parts p ON p.id = r.part_id
        JOIN inventory.stock_locations loc ON loc.id = r.stock_location_id
        LEFT JOIN inventory.stock_lots lot ON lot.id = r.stock_lot_id
        LEFT JOIN work_orders.work_orders wo ON wo.id = r.work_order_id
        LEFT JOIN work_orders.work_order_parts wop ON wop.id = r.work_order_part_id
        WHERE (${exactStatus ?? null}::text IS NULL OR r.reservation_status = ${exactStatus ?? null})
          AND (${openOnly}::boolean = false OR r.reservation_status IN ('ACTIVE', 'PARTIALLY_CONSUMED'))
          AND (${filters?.workOrderId ?? null}::uuid IS NULL OR r.work_order_id = ${filters?.workOrderId ?? null}::uuid)
          AND (${filters?.partId ?? null}::uuid IS NULL OR r.part_id = ${filters?.partId ?? null}::uuid)
          AND (
            ${search ?? null}::text IS NULL
            OR p.sku ILIKE '%' || ${search ?? null}::text || '%'
            OR p.name ILIKE '%' || ${search ?? null}::text || '%'
            OR lot.lot_number ILIKE '%' || ${search ?? null}::text || '%'
            OR wo.work_order_number ILIKE '%' || ${search ?? null}::text || '%'
          )
        ORDER BY
          CASE WHEN r.reservation_status IN ('ACTIVE', 'PARTIALLY_CONSUMED') THEN 0 ELSE 1 END,
          r.reservation_priority ASC,
          r.created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*) AS "total"
        FROM inventory.inventory_reservations r
        JOIN inventory.parts p ON p.id = r.part_id
        JOIN inventory.stock_locations loc ON loc.id = r.stock_location_id
        LEFT JOIN inventory.stock_lots lot ON lot.id = r.stock_lot_id
        LEFT JOIN work_orders.work_orders wo ON wo.id = r.work_order_id
        WHERE (${exactStatus ?? null}::text IS NULL OR r.reservation_status = ${exactStatus ?? null})
          AND (${openOnly}::boolean = false OR r.reservation_status IN ('ACTIVE', 'PARTIALLY_CONSUMED'))
          AND (${filters?.workOrderId ?? null}::uuid IS NULL OR r.work_order_id = ${filters?.workOrderId ?? null}::uuid)
          AND (${filters?.partId ?? null}::uuid IS NULL OR r.part_id = ${filters?.partId ?? null}::uuid)
          AND (
            ${search ?? null}::text IS NULL
            OR p.sku ILIKE '%' || ${search ?? null}::text || '%'
            OR p.name ILIKE '%' || ${search ?? null}::text || '%'
            OR lot.lot_number ILIKE '%' || ${search ?? null}::text || '%'
            OR wo.work_order_number ILIKE '%' || ${search ?? null}::text || '%'
          )
      `,
    ]);

    return {
      items: items.map(toReservationResponse),
      total: Number(countRows[0]?.total ?? 0),
      page,
      pageSize,
    };
  },

  async createReservation(input: CreateReservationInput, correlationId: string) {
    const id = randomUUID();
    const priority = input.priority ?? 100;
    return getInventoryPrisma().$transaction(async (tx) => {
      const lots = await tx.$queryRaw<
        Array<{
          id: string;
          partId: string;
          stockLocationId: string;
          lotState: string;
        }>
      >`
        SELECT
          id::text AS "id",
          part_id::text AS "partId",
          stock_location_id::text AS "stockLocationId",
          lot_state AS "lotState"
        FROM inventory.stock_lots
        WHERE id = ${input.stockLotId}::uuid
        FOR UPDATE
      `;
      const lot = lots[0];
      if (!lot) {
        throw new ReservationCommandError(404, `Stock lot not found: ${input.stockLotId}`);
      }
      if (lot.lotState !== 'AVAILABLE') {
        throw new ReservationCommandError(409, `Stock lot is not available: ${input.stockLotId}`);
      }

      const updatedBalances = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE inventory.inventory_balances
        SET
          quantity_reserved = quantity_reserved + ${input.quantity},
          updated_at = now(),
          last_correlation_id = ${correlationId},
          version = version + 1
        WHERE stock_lot_id = ${input.stockLotId}::uuid
          AND quantity_on_hand - quantity_reserved >= ${input.quantity}
        RETURNING id::text AS "id"
      `;
      if (updatedBalances.length === 0) {
        throw new ReservationCommandError(
          409,
          `Insufficient available inventory for lot ${input.stockLotId}.`,
        );
      }

      await tx.$executeRaw`
        INSERT INTO inventory.inventory_reservations (
          id,
          part_id,
          stock_location_id,
          stock_lot_id,
          work_order_id,
          work_order_part_id,
          reservation_status,
          reserved_quantity,
          consumed_quantity,
          reservation_priority,
          expires_at,
          correlation_id
        )
        VALUES (
          ${id}::uuid,
          ${lot.partId}::uuid,
          ${lot.stockLocationId}::uuid,
          ${input.stockLotId}::uuid,
          ${input.workOrderId ?? null}::uuid,
          ${input.workOrderPartId ?? null}::uuid,
          'ACTIVE',
          ${input.quantity},
          0,
          ${priority},
          ${input.expiresAt ? new Date(input.expiresAt) : null},
          ${correlationId}
        )
      `;

      if (input.workOrderPartId) {
        await tx.$executeRaw`
          UPDATE work_orders.work_order_parts
          SET
            reserved_quantity = reserved_quantity + ${input.quantity},
            part_status = 'RESERVED',
            updated_at = now(),
            version = version + 1
          WHERE id = ${input.workOrderPartId}::uuid
        `;
      }

      const rows = await queryReservationById(tx, id);
      return toReservationResponse(rows[0]);
    });
  },

  async releaseReservation(id: string, input: AdjustReservationInput, correlationId: string) {
    return getInventoryPrisma().$transaction(async (tx) => {
      const reservation = await lockReservationForAction(tx, id);
      const openQuantity = reservationOpenQuantity(reservation);
      const quantity = input.quantity ?? openQuantity;
      validateActionQuantity(quantity, openQuantity, 'release');

      const updatedBalances = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE inventory.inventory_balances
        SET
          quantity_reserved = quantity_reserved - ${quantity},
          updated_at = now(),
          last_correlation_id = ${correlationId},
          version = version + 1
        WHERE stock_lot_id = ${reservation.stockLotId}::uuid
          AND quantity_reserved >= ${quantity}
        RETURNING id::text AS "id"
      `;
      if (updatedBalances.length === 0) {
        throw new ReservationCommandError(409, 'Inventory balance cannot release that quantity.');
      }

      const fullRelease = quantity === openQuantity;
      await tx.$executeRaw`
        UPDATE inventory.inventory_reservations
        SET
          reservation_status = ${
            fullRelease
              ? 'RELEASED'
              : reservation.consumedQuantity > 0
                ? 'PARTIALLY_CONSUMED'
                : 'ACTIVE'
          },
          reserved_quantity = CASE
            WHEN ${fullRelease}::boolean THEN reserved_quantity
            ELSE reserved_quantity - ${quantity}
          END,
          updated_at = now(),
          version = version + 1
        WHERE id = ${id}::uuid
      `;

      if (reservation.workOrderPartId) {
        await tx.$executeRaw`
          UPDATE work_orders.work_order_parts
          SET
            reserved_quantity = GREATEST(reserved_quantity - ${quantity}, 0),
            part_status = CASE
              WHEN GREATEST(reserved_quantity - ${quantity}, 0) = 0 THEN 'REQUESTED'
              ELSE part_status
            END,
            updated_at = now(),
            version = version + 1
          WHERE id = ${reservation.workOrderPartId}::uuid
        `;
      }

      const rows = await queryReservationById(tx, id);
      return toReservationResponse(rows[0]);
    });
  },

  async consumeReservation(id: string, input: AdjustReservationInput, correlationId: string) {
    return getInventoryPrisma().$transaction(async (tx) => {
      const reservation = await lockReservationForAction(tx, id);
      const openQuantity = reservationOpenQuantity(reservation);
      const quantity = input.quantity ?? openQuantity;
      validateActionQuantity(quantity, openQuantity, 'consume');

      const updatedBalances = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE inventory.inventory_balances
        SET
          quantity_on_hand = quantity_on_hand - ${quantity},
          quantity_reserved = quantity_reserved - ${quantity},
          quantity_consumed = COALESCE(quantity_consumed, 0) + ${quantity},
          updated_at = now(),
          last_correlation_id = ${correlationId},
          version = version + 1
        WHERE stock_lot_id = ${reservation.stockLotId}::uuid
          AND quantity_on_hand >= ${quantity}
          AND quantity_reserved >= ${quantity}
        RETURNING id::text AS "id"
      `;
      if (updatedBalances.length === 0) {
        throw new ReservationCommandError(409, 'Inventory balance cannot fulfill that quantity.');
      }

      const nextConsumed = reservation.consumedQuantity + quantity;
      const nextStatus =
        nextConsumed >= reservation.reservedQuantity ? 'CONSUMED' : 'PARTIALLY_CONSUMED';
      await tx.$executeRaw`
        UPDATE inventory.inventory_reservations
        SET
          consumed_quantity = consumed_quantity + ${quantity},
          reservation_status = ${nextStatus},
          updated_at = now(),
          version = version + 1
        WHERE id = ${id}::uuid
      `;

      if (reservation.workOrderPartId) {
        await tx.$executeRaw`
          UPDATE work_orders.work_order_parts
          SET
            reserved_quantity = GREATEST(reserved_quantity - ${quantity}, 0),
            consumed_quantity = consumed_quantity + ${quantity},
            part_status = CASE
              WHEN consumed_quantity + ${quantity} >= requested_quantity THEN 'CONSUMED'
              ELSE 'PARTIALLY_CONSUMED'
            END,
            updated_at = now(),
            version = version + 1
          WHERE id = ${reservation.workOrderPartId}::uuid
        `;
      }

      const rows = await queryReservationById(tx, id);
      return toReservationResponse(rows[0]);
    });
  },
};

type InventorySqlClient = Prisma.TransactionClient | PrismaClient;

interface ActionReservation {
  id: string;
  status: ReservationStatus;
  reservedQuantity: number;
  consumedQuantity: number;
  allocatedQuantity: number;
  stockLotId: string;
  workOrderPartId: string | null;
}

async function queryReservationById(
  db: InventorySqlClient,
  id: string,
): Promise<InventoryReservationRow[]> {
  return db.$queryRaw<InventoryReservationRow[]>`
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
      wo.id::text AS "workOrderId",
      wo.work_order_number AS "workOrderNumber",
      wo.title AS "workOrderTitle",
      wop.id::text AS "workOrderPartId"
    FROM inventory.inventory_reservations r
    JOIN inventory.parts p ON p.id = r.part_id
    JOIN inventory.stock_locations loc ON loc.id = r.stock_location_id
    LEFT JOIN inventory.stock_lots lot ON lot.id = r.stock_lot_id
    LEFT JOIN work_orders.work_orders wo ON wo.id = r.work_order_id
    LEFT JOIN work_orders.work_order_parts wop ON wop.id = r.work_order_part_id
    WHERE r.id = ${id}::uuid
  `;
}

async function lockReservationForAction(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<ActionReservation> {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      status: ReservationStatus;
      reservedQuantity: unknown;
      consumedQuantity: unknown;
      allocatedQuantity: unknown;
      stockLotId: string | null;
      workOrderPartId: string | null;
    }>
  >`
    SELECT
      id::text AS "id",
      reservation_status AS "status",
      reserved_quantity AS "reservedQuantity",
      consumed_quantity AS "consumedQuantity",
      COALESCE(allocated_quantity, 0) AS "allocatedQuantity",
      stock_lot_id::text AS "stockLotId",
      work_order_part_id::text AS "workOrderPartId"
    FROM inventory.inventory_reservations
    WHERE id = ${id}::uuid
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new ReservationCommandError(404, `Reservation not found: ${id}`);
  }
  if (!row.stockLotId) {
    throw new ReservationCommandError(409, 'Reservation is not tied to a stock lot.');
  }

  return {
    id: row.id,
    status: row.status,
    reservedQuantity: numberFromDb(row.reservedQuantity),
    consumedQuantity: numberFromDb(row.consumedQuantity),
    allocatedQuantity: numberFromDb(row.allocatedQuantity),
    stockLotId: row.stockLotId,
    workOrderPartId: row.workOrderPartId,
  };
}

function reservationOpenQuantity(reservation: ActionReservation): number {
  if (reservation.status !== 'ACTIVE' && reservation.status !== 'PARTIALLY_CONSUMED') return 0;
  return Math.max(
    reservation.reservedQuantity - reservation.consumedQuantity - reservation.allocatedQuantity,
    0,
  );
}

function validateActionQuantity(quantity: number, openQuantity: number, verb: string): void {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new ReservationCommandError(
      422,
      `Reservation ${verb} quantity must be greater than zero.`,
    );
  }
  if (openQuantity <= 0) {
    throw new ReservationCommandError(409, 'Reservation has no open quantity.');
  }
  if (quantity > openQuantity) {
    throw new ReservationCommandError(
      409,
      `Reservation ${verb} quantity exceeds open quantity (${openQuantity}).`,
    );
  }
}

async function handleReservationCommand(
  command: Promise<ReturnType<typeof toReservationResponse>>,
  successStatus = 200,
) {
  try {
    const reservation = await command;
    return jsonResponse(successStatus, { reservation });
  } catch (error) {
    if (error instanceof ReservationCommandError) {
      return jsonResponse(error.statusCode, { message: error.message });
    }
    throw error;
  }
}

async function handleReceivingCommand(
  command: Promise<{
    lot?: ReturnType<typeof toLotDetailResponse>;
    purchaseOrderLine: {
      id: string;
      lineState: string;
      receivedQuantity: number;
      rejectedQuantity: number;
    };
    purchaseOrderState: string;
  }>,
) {
  try {
    const receipt = await command;
    return jsonResponse(201, receipt);
  } catch (error) {
    if (error instanceof ReceivingCommandError) {
      return jsonResponse(error.statusCode, { message: error.message });
    }
    throw error;
  }
}

async function resolveReceiptStockLocation(
  db: InventorySqlClient,
  preferredLocationId?: string,
): Promise<{ id: string; locationName: string } | undefined> {
  if (preferredLocationId) {
    const rows = await db.$queryRaw<Array<{ id: string; locationName: string }>>`
      SELECT id::text AS "id", location_name AS "locationName"
      FROM inventory.stock_locations
      WHERE id = ${preferredLocationId}::uuid
        AND deleted_at IS NULL
      LIMIT 1
    `;
    return rows[0];
  }

  const rows = await db.$queryRaw<Array<{ id: string; locationName: string }>>`
    SELECT id::text AS "id", location_name AS "locationName"
    FROM inventory.stock_locations
    WHERE deleted_at IS NULL
    ORDER BY is_pickable DESC, location_code ASC
    LIMIT 1
  `;
  return rows[0];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseOptionalUuid(
  value: string | undefined,
  field: string,
): { value?: string; error?: string } {
  if (!value?.trim()) return {};
  const trimmed = value.trim();
  if (!UUID_PATTERN.test(trimmed)) return { error: `${field} must be a UUID.` };
  return { value: trimmed };
}

function parseReservationStatusFilter(value: string | undefined): {
  value?: ReservationStatusFilter;
  error?: string;
} {
  if (!value?.trim()) return { value: 'OPEN' };
  const normalized = value.trim().toUpperCase();
  if (normalized === 'OPEN' || normalized === 'ALL') return { value: normalized };
  if (RESERVATION_STATUSES.includes(normalized as ReservationStatus)) {
    return { value: normalized as ReservationStatus };
  }
  return { error: `Unsupported reservation status: ${value}` };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalAdjustmentBody(
  event: LambdaEvent,
): { ok: true; value: AdjustReservationInput } | { ok: false; error: string } {
  if (!event.body?.trim()) return { ok: true, value: {} };
  return parseBody<AdjustReservationInput>(event);
}

function parseOptionalPurchaseOrderBody(
  event: LambdaEvent,
): { ok: true; value: UpdatePurchaseOrderInput } | { ok: false; error: string } {
  if (!event.body?.trim()) return { ok: true, value: {} };
  return parseBody<UpdatePurchaseOrderInput>(event);
}

function generatePurchaseOrderNumber(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `PO-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function normalizeNullableString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNullableDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return new Date(value);
}

async function assertActiveVendor(tx: Prisma.TransactionClient, vendorId: string): Promise<void> {
  const vendor = await tx.vendor.findFirst({
    where: { id: vendorId, deletedAt: null },
    select: { vendorState: true },
  });
  if (!vendor) {
    throw new PurchaseOrderCommandError(404, `Vendor not found: ${vendorId}`);
  }
  if (vendor.vendorState !== 'ACTIVE') {
    throw new PurchaseOrderCommandError(
      409,
      'Only ACTIVE vendors can receive new purchase orders.',
    );
  }
}

async function preparePurchaseOrderLines(
  tx: Prisma.TransactionClient,
  lines: PurchaseOrderLineCommandInput[],
): Promise<PreparedPurchaseOrderLine[]> {
  const seenPartIds = new Set<string>();
  const prepared: PreparedPurchaseOrderLine[] = [];

  for (const line of lines) {
    if (seenPartIds.has(line.partId)) {
      throw new PurchaseOrderCommandError(
        409,
        `Duplicate purchase order line for part: ${line.partId}`,
      );
    }
    seenPartIds.add(line.partId);

    const part = await tx.part.findFirst({
      where: { id: line.partId, deletedAt: null },
      select: { id: true, sku: true, partState: true, unitOfMeasure: true },
    });
    if (!part) {
      throw new PurchaseOrderCommandError(404, `Part not found: ${line.partId}`);
    }
    if (part.partState !== 'ACTIVE') {
      throw new PurchaseOrderCommandError(
        409,
        `Only ACTIVE parts can be added to a purchase order: ${part.sku}`,
      );
    }

    const unitOfMeasure = line.unitOfMeasureId
      ? await tx.unitOfMeasure.findFirst({
          where: { id: line.unitOfMeasureId, deletedAt: null },
          select: { id: true },
        })
      : ((await tx.unitOfMeasure.findFirst({
          where: { uomCode: part.unitOfMeasure, deletedAt: null },
          select: { id: true },
        })) ??
        (await tx.unitOfMeasure.findFirst({
          where: { uomCode: 'EA', deletedAt: null },
          select: { id: true },
        })));

    if (!unitOfMeasure) {
      throw new PurchaseOrderCommandError(
        409,
        `No active unit of measure found for part ${part.sku}.`,
      );
    }

    prepared.push({
      id: line.id?.trim() || randomUUID(),
      partId: line.partId,
      unitOfMeasureId: unitOfMeasure.id,
      orderedQuantity: line.orderedQuantity,
      unitCost: line.unitCost,
      promisedAt: normalizeNullableDate(line.promisedAt) ?? null,
    });
  }

  return prepared;
}

function hasReceivedPurchaseOrderQuantity(
  lines: Array<{ receivedQuantity: unknown; rejectedQuantity: unknown }>,
): boolean {
  return lines.some(
    (line) => numberFromDb(line.receivedQuantity) > 0 || numberFromDb(line.rejectedQuantity) > 0,
  );
}

function arePurchaseOrderLinesComplete(
  lines: Array<{
    orderedQuantity: unknown;
    receivedQuantity: unknown;
    rejectedQuantity: unknown;
  }>,
): boolean {
  return (
    lines.length > 0 &&
    lines.every(
      (line) =>
        numberFromDb(line.receivedQuantity) + numberFromDb(line.rejectedQuantity) >=
        numberFromDb(line.orderedQuantity),
    )
  );
}

function validatePurchaseOrderLineInput(
  line: PurchaseOrderLineCommandInput,
  index: number,
): string | undefined {
  const prefix = `lines[${index}]`;
  const id = parseOptionalUuid(line.id, `${prefix}.id`);
  if (id.error) return id.error;
  const partId = parseOptionalUuid(line.partId, `${prefix}.partId`);
  if (partId.error || !partId.value) return partId.error ?? `${prefix}.partId is required.`;
  const unitOfMeasureId = parseOptionalUuid(line.unitOfMeasureId, `${prefix}.unitOfMeasureId`);
  if (unitOfMeasureId.error) return unitOfMeasureId.error;
  if (!Number.isFinite(line.orderedQuantity) || line.orderedQuantity <= 0) {
    return `${prefix}.orderedQuantity must be greater than zero.`;
  }
  if (!Number.isFinite(line.unitCost) || line.unitCost < 0) {
    return `${prefix}.unitCost must be zero or greater.`;
  }
  if (line.promisedAt && Number.isNaN(new Date(line.promisedAt).getTime())) {
    return `${prefix}.promisedAt must be a valid date.`;
  }
  return undefined;
}

function validateCreatePurchaseOrderInput(input: CreatePurchaseOrderInput): string | undefined {
  if (input.poNumber !== undefined && input.poNumber.trim().length === 0) {
    return 'poNumber cannot be blank when provided.';
  }
  const vendorId = parseOptionalUuid(input.vendorId, 'vendorId');
  if (vendorId.error || !vendorId.value) return vendorId.error ?? 'vendorId is required.';
  if (input.expectedAt && Number.isNaN(new Date(input.expectedAt).getTime())) {
    return 'expectedAt must be a valid date.';
  }
  if (input.notes !== undefined && input.notes !== null && typeof input.notes !== 'string') {
    return 'notes must be a string.';
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return 'lines must include at least one purchase order line.';
  }
  for (let i = 0; i < input.lines.length; i += 1) {
    const validation = validatePurchaseOrderLineInput(input.lines[i]!, i);
    if (validation) return validation;
  }
  return undefined;
}

function validateUpdatePurchaseOrderInput(input: UpdatePurchaseOrderInput): string | undefined {
  const vendorId = parseOptionalUuid(input.vendorId, 'vendorId');
  if (vendorId.error) return vendorId.error;
  if (input.expectedAt && Number.isNaN(new Date(input.expectedAt).getTime())) {
    return 'expectedAt must be a valid date.';
  }
  if (input.notes !== undefined && input.notes !== null && typeof input.notes !== 'string') {
    return 'notes must be a string.';
  }
  if (input.lines !== undefined) {
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      return 'lines must include at least one purchase order line.';
    }
    for (let i = 0; i < input.lines.length; i += 1) {
      const validation = validatePurchaseOrderLineInput(input.lines[i]!, i);
      if (validation) return validation;
    }
  }
  return undefined;
}

function validateCreateReservationInput(input: CreateReservationInput): string | undefined {
  const stockLotId = parseOptionalUuid(input.stockLotId, 'stockLotId');
  if (stockLotId.error || !stockLotId.value) return stockLotId.error ?? 'stockLotId is required.';
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return 'quantity must be greater than zero.';
  }
  const workOrderId = parseOptionalUuid(input.workOrderId, 'workOrderId');
  if (workOrderId.error) return workOrderId.error;
  const workOrderPartId = parseOptionalUuid(input.workOrderPartId, 'workOrderPartId');
  if (workOrderPartId.error) return workOrderPartId.error;
  if (input.priority !== undefined && (!Number.isInteger(input.priority) || input.priority < 0)) {
    return 'priority must be a non-negative integer.';
  }
  if (input.expiresAt && Number.isNaN(new Date(input.expiresAt).getTime())) {
    return 'expiresAt must be a valid date.';
  }
  return undefined;
}

function validateReceiveInventoryLotInput(input: ReceiveInventoryLotInput): string | undefined {
  const purchaseOrderId = parseOptionalUuid(input.purchaseOrderId, 'purchaseOrderId');
  if (purchaseOrderId.error) return purchaseOrderId.error;
  const purchaseOrderLineId = parseOptionalUuid(input.purchaseOrderLineId, 'purchaseOrderLineId');
  if (purchaseOrderLineId.error || !purchaseOrderLineId.value) {
    return purchaseOrderLineId.error ?? 'purchaseOrderLineId is required.';
  }
  const stockLocationId = parseOptionalUuid(input.stockLocationId, 'stockLocationId');
  if (stockLocationId.error) return stockLocationId.error;
  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    return 'quantity must be zero or greater.';
  }
  if (
    input.rejectedQuantity !== undefined &&
    (!Number.isFinite(input.rejectedQuantity) || input.rejectedQuantity < 0)
  ) {
    return 'rejectedQuantity must be zero or greater.';
  }
  if (input.quantity + (input.rejectedQuantity ?? 0) <= 0) {
    return 'accepted or rejected quantity must be greater than zero.';
  }
  if (input.receivedAt && Number.isNaN(new Date(input.receivedAt).getTime())) {
    return 'receivedAt must be a valid date.';
  }
  if (input.expiresAt && Number.isNaN(new Date(input.expiresAt).getTime())) {
    return 'expiresAt must be a valid date.';
  }
  return undefined;
}

function validateAdjustmentInput(input: AdjustReservationInput, verb: string): string | undefined {
  if (input.quantity === undefined) return undefined;
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return `Reservation ${verb} quantity must be greater than zero.`;
  }
  return undefined;
}

// ─── List Parts ───────────────────────────────────────────────────────────────

const PART_INCLUDE = {
  stockLots: {
    where: { lotState: 'AVAILABLE' as const },
    include: { stockLocation: { select: { locationName: true } } },
  },
  manufacturer: { select: { manufacturerName: true } },
  defaultVendor: { select: { vendorName: true, vendorState: true, leadTimeDays: true } },
  defaultLocation: { select: { locationName: true } },
} as const;

export const listPartsHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const search = qs.search;
    const partState = qs.partState as string | undefined;
    const stock = qs.stock as string | undefined;
    const category = qs.category as string | undefined;
    const installStage = qs.installStage as string | undefined;
    const lifecycleLevel = qs.lifecycleLevel as string | undefined;
    const manufacturerId = qs.manufacturerId as string | undefined;
    const defaultVendorId = qs.defaultVendorId as string | undefined;
    const limit = Math.min(parseInt(qs.limit ?? '100', 10), 1000);
    const offset = parseInt(qs.offset ?? '0', 10);

    if (stock && stock !== 'OUT') {
      return jsonResponse(422, { message: 'Invalid stock filter. Must be OUT.' });
    }

    const where = {
      ...(partState ? { partState: partState as 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED' } : {}),
      ...(stock === 'OUT' ? { stockLots: { none: { lotState: 'AVAILABLE' as const } } } : {}),
      ...(category
        ? {
            category: category as
              | 'ELECTRONICS'
              | 'AUDIO'
              | 'FABRICATION'
              | 'HARDWARE'
              | 'SMALL_PARTS'
              | 'DRIVE_TRAIN',
          }
        : {}),
      ...(installStage
        ? {
            installStage: installStage as
              | 'FABRICATION'
              | 'FRAME'
              | 'WIRING'
              | 'PARTS_PREP'
              | 'FINAL_ASSEMBLY',
          }
        : {}),
      ...(lifecycleLevel
        ? {
            lifecycleLevel: lifecycleLevel as
              | 'RAW_MATERIAL'
              | 'RAW_COMPONENT'
              | 'PREPARED_COMPONENT'
              | 'ASSEMBLED_COMPONENT',
          }
        : {}),
      ...(manufacturerId ? { manufacturerId } : {}),
      ...(defaultVendorId ? { defaultVendorId } : {}),
      ...(search
        ? {
            OR: [
              { sku: { contains: search, mode: 'insensitive' as const } },
              { name: { contains: search, mode: 'insensitive' as const } },
              { variant: { contains: search, mode: 'insensitive' as const } },
              { description: { contains: search, mode: 'insensitive' as const } },
              { manufacturerPartNumber: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      deletedAt: null,
    };

    const [items, total] = await Promise.all([
      getInventoryPrisma().part.findMany({
        where,
        orderBy: { sku: 'asc' },
        take: limit,
        skip: offset,
        include: PART_INCLUDE,
      }),
      getInventoryPrisma().part.count({ where }),
    ]);

    return jsonResponse(200, { items: items.map(toPartResponse), total, limit, offset });
  },
  { requireAuth: false },
);

// ─── Get Part Transformation Chain ───────────────────────────────────────────

export const getPartChainHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Part ID is required.' });

    const prisma = getInventoryPrisma();
    const part = await prisma.part.findFirst({
      where: { id, deletedAt: null },
      include: PART_INCLUDE,
    });
    if (!part) return jsonResponse(404, { message: `Part not found: ${id}` });

    const ancestors: Array<typeof part> = [];
    let cursorId = part.producedFromPartId;
    while (cursorId) {
      const next = await prisma.part.findFirst({
        where: { id: cursorId, deletedAt: null },
        include: PART_INCLUDE,
      });
      if (!next) break;
      ancestors.unshift(next);
      cursorId = next.producedFromPartId;
    }

    const descendants: Array<typeof part> = [];
    const toVisit: string[] = [part.id];
    while (toVisit.length > 0) {
      const currentId = toVisit.shift()!;
      const children = await prisma.part.findMany({
        where: { producedFromPartId: currentId, deletedAt: null },
        include: PART_INCLUDE,
        orderBy: { lifecycleLevel: 'asc' },
      });
      for (const child of children) {
        descendants.push(child);
        toVisit.push(child.id);
      }
    }

    return jsonResponse(200, {
      ancestors: ancestors.map((p) => ({
        part: toPartResponse(p),
        producedViaStage: p.producedViaStage ?? undefined,
      })),
      part: toPartResponse(part),
      descendants: descendants.map((p) => ({
        part: toPartResponse(p),
        producedViaStage: p.producedViaStage ?? undefined,
      })),
    });
  },
  { requireAuth: false },
);

// ─── Material Plan by Install Stage ──────────────────────────────────────────

export const inventoryPlanningQueries = {
  async getMaterialPlanByStage() {
    const prisma = getInventoryPrisma();
    const parts = await prisma.part.findMany({
      where: { deletedAt: null, partState: 'ACTIVE' },
      orderBy: { sku: 'asc' },
      include: PART_INCLUDE,
    });

    let balanceRows: PartInventoryBalanceRow[] = [];
    let procurementRows: PartProcurementRow[] = [];
    if (parts.length > 0) {
      const partIds = parts.map((part) => Prisma.sql`${part.id}::uuid`);
      [balanceRows, procurementRows] = await Promise.all([
        prisma.$queryRaw<PartInventoryBalanceRow[]>`
          SELECT
            part_id::text AS "partId",
            COALESCE(SUM(quantity_on_hand), 0) AS "quantityOnHand",
            COALESCE(SUM(quantity_reserved), 0) AS "quantityReserved",
            COALESCE(SUM(quantity_allocated), 0) AS "quantityAllocated",
            COALESCE(SUM(quantity_consumed), 0) AS "quantityConsumed"
          FROM inventory.inventory_balances
          WHERE part_id IN (${Prisma.join(partIds)})
          GROUP BY part_id
        `,
        prisma.$queryRaw<PartProcurementRow[]>`
          SELECT
            pol.part_id::text AS "partId",
            COALESCE(SUM(
              CASE
                WHEN po.purchase_order_state IN ('APPROVED', 'SENT', 'PARTIALLY_RECEIVED')
                THEN GREATEST(pol.ordered_quantity - pol.received_quantity - pol.rejected_quantity, 0)
                ELSE 0
              END
            ), 0) AS "inboundQuantity",
            COALESCE(SUM(
              CASE
                WHEN po.purchase_order_state = 'DRAFT'
                THEN GREATEST(pol.ordered_quantity - pol.received_quantity - pol.rejected_quantity, 0)
                ELSE 0
              END
            ), 0) AS "draftQuantity",
            COUNT(DISTINCT CASE
              WHEN po.purchase_order_state IN ('APPROVED', 'SENT', 'PARTIALLY_RECEIVED')
              THEN po.id
              ELSE NULL
            END)::int AS "openPurchaseOrderCount",
            MIN(CASE
              WHEN po.purchase_order_state IN ('APPROVED', 'SENT', 'PARTIALLY_RECEIVED')
              THEN po.expected_at
              ELSE NULL
            END) AS "nextExpectedAt",
            (ARRAY_AGG(pol.unit_cost ORDER BY po.ordered_at DESC NULLS LAST, pol.created_at DESC))[1]
              AS "estimatedUnitCost"
          FROM inventory.purchase_order_lines pol
          INNER JOIN inventory.purchase_orders po ON po.id = pol.purchase_order_id
          WHERE pol.part_id IN (${Prisma.join(partIds)})
            AND po.purchase_order_state IN ('DRAFT', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED')
            AND pol.line_state <> 'CANCELLED'
          GROUP BY pol.part_id
        `,
      ]);
    }

    const balanceByPart = new Map(balanceRows.map((row) => [row.partId, row]));
    const procurementByPart = new Map(procurementRows.map((row) => [row.partId, row]));

    const STAGE_ORDER = ['FABRICATION', 'FRAME', 'WIRING', 'PARTS_PREP', 'FINAL_ASSEMBLY'] as const;
    type Stage = (typeof STAGE_ORDER)[number];

    const toLine = (part: (typeof parts)[number]) => {
      const balance = balanceByPart.get(part.id);
      const onHand = numberFromDb(balance?.quantityOnHand);
      const reserved = numberFromDb(balance?.quantityReserved);
      const allocated = numberFromDb(balance?.quantityAllocated);
      const consumed = numberFromDb(balance?.quantityConsumed);
      const available = Math.max(onHand - reserved, 0);
      const reorderPoint = Number(part.reorderPoint);
      return {
        part: {
          ...toPartResponse(part),
          quantityOnHand: onHand,
          quantityReserved: reserved,
          quantityAllocated: allocated,
          quantityConsumed: consumed,
          quantityAvailable: available,
        },
        onHand,
        reserved,
        available,
        reorderPoint,
        shortfall: Math.max(reorderPoint - available, 0),
      };
    };

    const lines = parts.map(toLine);
    const byStage = new Map<Stage, typeof lines>();
    const unassigned: typeof lines = [];
    for (const line of lines) {
      if (!line.part.installStage) {
        unassigned.push(line);
        continue;
      }
      const arr = byStage.get(line.part.installStage as Stage) ?? [];
      arr.push(line);
      byStage.set(line.part.installStage as Stage, arr);
    }

    const groups = STAGE_ORDER.filter((s) => byStage.has(s)).map((stage) => {
      const stageLines = (byStage.get(stage) ?? []).sort(
        (a, b) => b.shortfall - a.shortfall || a.part.sku.localeCompare(b.part.sku),
      );
      return {
        installStage: stage,
        lines: stageLines,
        totalShortfall: stageLines.reduce((sum, l) => sum + l.shortfall, 0),
      };
    });

    const recommendations = lines
      .map((line) => {
        const procurement = procurementByPart.get(line.part.id);
        const inboundQuantity = numberFromDb(procurement?.inboundQuantity);
        const draftQuantity = numberFromDb(procurement?.draftQuantity);
        const projectedAvailable = line.available + inboundQuantity;
        const shortfall = Math.max(line.reorderPoint - projectedAvailable, 0);
        const estimatedUnitCost = numberFromDb(procurement?.estimatedUnitCost);
        const vendorName = line.part.defaultVendorName;
        const vendorState = (parts.find((part) => part.id === line.part.id)?.defaultVendor
          ?.vendorState ?? undefined) as 'ACTIVE' | 'INACTIVE' | undefined;
        const leadTimeDays =
          parts.find((part) => part.id === line.part.id)?.defaultVendor?.leadTimeDays ?? undefined;
        if (shortfall <= 0) return null;
        const severity: 'critical' | 'high' | 'medium' =
          line.available <= 0 ? 'critical' : shortfall >= line.reorderPoint ? 'high' : 'medium';
        return {
          part: line.part,
          vendorId: line.part.defaultVendorId,
          vendorName,
          vendorState,
          leadTimeDays,
          onHand: line.onHand,
          reserved: line.reserved,
          available: line.available,
          reorderPoint: line.reorderPoint,
          inboundQuantity,
          draftQuantity,
          projectedAvailable,
          shortfall,
          recommendedOrderQuantity: shortfall,
          openPurchaseOrderCount: numberFromDb(procurement?.openPurchaseOrderCount),
          nextExpectedAt: procurement?.nextExpectedAt?.toISOString(),
          estimatedUnitCost: estimatedUnitCost > 0 ? estimatedUnitCost : undefined,
          severity,
          reason: !line.part.defaultVendorId
            ? 'Assign a default vendor before creating a replenishment purchase order.'
            : inboundQuantity > 0
              ? 'Open purchase orders do not cover the reorder point.'
              : 'Available inventory is below the reorder point and has no inbound cover.',
        };
      })
      .filter((recommendation): recommendation is NonNullable<typeof recommendation> =>
        Boolean(recommendation),
      )
      .sort((a, b) => {
        const severityRank = { critical: 0, high: 1, medium: 2 } as const;
        return (
          severityRank[a.severity] - severityRank[b.severity] ||
          b.shortfall - a.shortfall ||
          a.part.sku.localeCompare(b.part.sku)
        );
      });

    const vendorGroupMap = new Map<
      string,
      {
        vendorId?: string;
        vendorName: string;
        vendorState?: 'ACTIVE' | 'INACTIVE';
        leadTimeDays?: number;
        recommendations: typeof recommendations;
        totalRecommendedQuantity: number;
        estimatedSubtotal: number;
      }
    >();
    for (const recommendation of recommendations) {
      const key = recommendation.vendorId ?? 'UNASSIGNED';
      const group =
        vendorGroupMap.get(key) ??
        ({
          vendorId: recommendation.vendorId,
          vendorName: recommendation.vendorName ?? 'No default vendor',
          vendorState: recommendation.vendorState,
          leadTimeDays: recommendation.leadTimeDays,
          recommendations: [],
          totalRecommendedQuantity: 0,
          estimatedSubtotal: 0,
        } satisfies {
          vendorId?: string;
          vendorName: string;
          vendorState?: 'ACTIVE' | 'INACTIVE';
          leadTimeDays?: number;
          recommendations: typeof recommendations;
          totalRecommendedQuantity: number;
          estimatedSubtotal: number;
        });
      group.recommendations.push(recommendation);
      group.totalRecommendedQuantity += recommendation.recommendedOrderQuantity;
      group.estimatedSubtotal +=
        recommendation.recommendedOrderQuantity * (recommendation.estimatedUnitCost ?? 0);
      vendorGroupMap.set(key, group);
    }

    const vendorGroups = [...vendorGroupMap.values()].sort(
      (a, b) =>
        b.recommendations.length - a.recommendations.length ||
        a.vendorName.localeCompare(b.vendorName),
    );
    const summary = {
      recommendationCount: recommendations.length,
      vendorGroupCount: vendorGroups.filter((group) => Boolean(group.vendorId)).length,
      partsNeedingVendor: recommendations.filter((recommendation) => !recommendation.vendorId)
        .length,
      criticalCount: recommendations.filter(
        (recommendation) => recommendation.severity === 'critical',
      ).length,
      highCount: recommendations.filter((recommendation) => recommendation.severity === 'high')
        .length,
      mediumCount: recommendations.filter((recommendation) => recommendation.severity === 'medium')
        .length,
      totalRecommendedQuantity: recommendations.reduce(
        (sum, recommendation) => sum + recommendation.recommendedOrderQuantity,
        0,
      ),
      estimatedCost: recommendations.reduce(
        (sum, recommendation) =>
          sum + recommendation.recommendedOrderQuantity * (recommendation.estimatedUnitCost ?? 0),
        0,
      ),
    };

    return {
      generatedAt: new Date().toISOString(),
      groups,
      unassigned,
      replenishment: { summary, recommendations, vendorGroups },
    };
  },
};

export const planMaterialByStageHandler = wrapHandler(
  async () => jsonResponse(200, await inventoryPlanningQueries.getMaterialPlanByStage()),
  { requireAuth: false },
);

// ─── List Manufacturers ──────────────────────────────────────────────────────

export const listManufacturersHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const state = qs.state as string | undefined;
    const limit = Math.min(parseInt(qs.limit ?? '200', 10), 500);
    const offset = parseInt(qs.offset ?? '0', 10);

    const where = {
      ...(state ? { manufacturerState: state as 'ACTIVE' | 'INACTIVE' } : {}),
      deletedAt: null,
    };

    const [items, total] = await Promise.all([
      getInventoryPrisma().manufacturer.findMany({
        where,
        orderBy: { manufacturerName: 'asc' },
        take: limit,
        skip: offset,
      }),
      getInventoryPrisma().manufacturer.count({ where }),
    ]);

    return jsonResponse(200, { items: items.map(toManufacturerResponse), total, limit, offset });
  },
  { requireAuth: false },
);

// ─── Create Manufacturer ─────────────────────────────────────────────────────

interface CreateManufacturerBody {
  manufacturerCode: string;
  name: string;
  website?: string;
  notes?: string;
}

export const createManufacturerHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<CreateManufacturerBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const { manufacturerCode, name, website, notes } = body.value;
    if (!manufacturerCode?.trim())
      return jsonResponse(422, { message: 'manufacturerCode is required.' });
    if (!name?.trim()) return jsonResponse(422, { message: 'name is required.' });

    const code = manufacturerCode.trim().toUpperCase();
    const prisma = getInventoryPrisma();
    const duplicate = await prisma.manufacturer.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { manufacturerCode: code },
          { manufacturerName: { equals: name.trim(), mode: 'insensitive' } },
        ],
      },
    });
    if (duplicate) {
      return jsonResponse(409, {
        message: `Manufacturer already exists: ${duplicate.manufacturerName}`,
      });
    }

    const now = new Date();
    const created = await prisma.manufacturer.create({
      data: {
        id: randomUUID(),
        manufacturerCode: code,
        manufacturerName: name.trim(),
        manufacturerState: 'ACTIVE',
        website: website?.trim() || null,
        notes: notes?.trim() || null,
        createdAt: now,
        updatedAt: now,
      },
    });

    return jsonResponse(201, { manufacturer: toManufacturerResponse(created) });
  },
  { requireAuth: false },
);

// ─── List Inventory Lots ─────────────────────────────────────────────────────

export const listLotsHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const page = parseInt(qs.page ?? '1', 10);
    const pageSize = parseInt(qs.pageSize ?? '50', 10);

    const result = await inventoryLotQueries.listLots({
      partNumber: qs.partNumber,
      warehouseId: qs.warehouseId,
      status: qs.status,
      page,
      pageSize,
    });

    return jsonResponse(200, {
      items: result.items.map(toLotDetailResponse),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  },
  { requireAuth: false },
);

export const receiveInventoryLotHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<ReceiveInventoryLotInput>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const validation = validateReceiveInventoryLotInput(body.value);
    if (validation) return jsonResponse(422, { message: validation });

    return handleReceivingCommand(
      inventoryLotQueries.receivePurchaseOrderLine(body.value, ctx.correlationId),
    );
  },
  { requireAuth: false },
);

// ─── Inventory Reservations ─────────────────────────────────────────────────

export const listReservationsHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const status = parseReservationStatusFilter(qs.status);
    if (status.error) return jsonResponse(422, { message: status.error });

    const workOrderId = parseOptionalUuid(qs.workOrderId, 'workOrderId');
    if (workOrderId.error) return jsonResponse(422, { message: workOrderId.error });
    const partId = parseOptionalUuid(qs.partId, 'partId');
    if (partId.error) return jsonResponse(422, { message: partId.error });

    const page = parsePositiveInteger(qs.page, 1);
    const pageSize = parsePositiveInteger(qs.pageSize, 50);
    const result = await inventoryReservationQueries.listReservations({
      status: status.value,
      workOrderId: workOrderId.value,
      partId: partId.value,
      search: qs.search,
      page,
      pageSize,
    });

    return jsonResponse(200, result);
  },
  { requireAuth: false },
);

export const createReservationHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<CreateReservationInput>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const validation = validateCreateReservationInput(body.value);
    if (validation) return jsonResponse(422, { message: validation });

    return handleReservationCommand(
      inventoryReservationQueries.createReservation(body.value, ctx.correlationId),
      201,
    );
  },
  { requireAuth: false },
);

export const releaseReservationHandler = wrapHandler(
  async (ctx) => {
    const id = parseOptionalUuid(ctx.event.pathParameters?.id, 'id');
    if (id.error || !id.value) return jsonResponse(422, { message: id.error ?? 'id is required.' });
    const body = parseOptionalAdjustmentBody(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });
    const validation = validateAdjustmentInput(body.value, 'release');
    if (validation) return jsonResponse(422, { message: validation });

    return handleReservationCommand(
      inventoryReservationQueries.releaseReservation(id.value, body.value, ctx.correlationId),
    );
  },
  { requireAuth: false },
);

export const consumeReservationHandler = wrapHandler(
  async (ctx) => {
    const id = parseOptionalUuid(ctx.event.pathParameters?.id, 'id');
    if (id.error || !id.value) return jsonResponse(422, { message: id.error ?? 'id is required.' });
    const body = parseOptionalAdjustmentBody(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });
    const validation = validateAdjustmentInput(body.value, 'fulfill');
    if (validation) return jsonResponse(422, { message: validation });

    return handleReservationCommand(
      inventoryReservationQueries.consumeReservation(id.value, body.value, ctx.correlationId),
    );
  },
  { requireAuth: false },
);

// ─── List Purchase Orders ────────────────────────────────────────────────────

export const listPurchaseOrdersHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const page = parseInt(qs.page ?? '1', 10);
    const pageSize = parseInt(qs.pageSize ?? '50', 10);

    const result = await inventoryPurchaseOrderQueries.listPurchaseOrders({
      status: qs.status,
      supplierId: qs.supplierId,
      vendorId: qs.vendorId,
      page,
      pageSize,
    });

    return jsonResponse(200, {
      items: result.items.map(toPurchaseOrderResponse),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  },
  { requireAuth: false },
);

export const getPurchaseOrderHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Purchase order ID is required.' });

    const purchaseOrder = await inventoryPurchaseOrderQueries.getPurchaseOrder(id);
    if (!purchaseOrder) return jsonResponse(404, { message: `Purchase order not found: ${id}` });

    return jsonResponse(200, { purchaseOrder: toPurchaseOrderResponse(purchaseOrder) });
  },
  { requireAuth: false },
);

async function handlePurchaseOrderCommand(
  command: Promise<Awaited<ReturnType<typeof inventoryPurchaseOrderCommands.createPurchaseOrder>>>,
  statusCode = 200,
) {
  try {
    const purchaseOrder = await command;
    return jsonResponse(statusCode, { purchaseOrder: toPurchaseOrderResponse(purchaseOrder) });
  } catch (error) {
    if (error instanceof PurchaseOrderCommandError) {
      return jsonResponse(error.statusCode, { message: error.message });
    }
    throw error;
  }
}

export const createPurchaseOrderHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<CreatePurchaseOrderInput>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });
    const validation = validateCreatePurchaseOrderInput(body.value);
    if (validation) return jsonResponse(422, { message: validation });

    return handlePurchaseOrderCommand(
      inventoryPurchaseOrderCommands.createPurchaseOrder(body.value, ctx.correlationId),
      201,
    );
  },
  { requireAuth: false },
);

export const updatePurchaseOrderHandler = wrapHandler(
  async (ctx) => {
    const id = parseOptionalUuid(ctx.event.pathParameters?.id, 'id');
    if (id.error || !id.value) return jsonResponse(422, { message: id.error ?? 'id is required.' });
    const body = parseOptionalPurchaseOrderBody(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });
    const validation = validateUpdatePurchaseOrderInput(body.value);
    if (validation) return jsonResponse(422, { message: validation });

    return handlePurchaseOrderCommand(
      inventoryPurchaseOrderCommands.updatePurchaseOrder(id.value, body.value, ctx.correlationId),
    );
  },
  { requireAuth: false },
);

function purchaseOrderTransitionHandler(action: PurchaseOrderCommandAction) {
  return wrapHandler(
    async (ctx) => {
      const id = parseOptionalUuid(ctx.event.pathParameters?.id, 'id');
      if (id.error || !id.value) {
        return jsonResponse(422, { message: id.error ?? 'id is required.' });
      }
      return handlePurchaseOrderCommand(
        inventoryPurchaseOrderCommands.transitionPurchaseOrder(id.value, action, ctx.correlationId),
      );
    },
    { requireAuth: false },
  );
}

export const approvePurchaseOrderHandler = purchaseOrderTransitionHandler('approve');
export const sendPurchaseOrderHandler = purchaseOrderTransitionHandler('send');
export const cancelPurchaseOrderHandler = purchaseOrderTransitionHandler('cancel');
export const closePurchaseOrderHandler = purchaseOrderTransitionHandler('close');

export const purchaseOrderCommandRouterHandler = wrapHandler(
  async (ctx) => {
    const method = ctx.event.httpMethod ?? ctx.event.requestContext?.http?.method ?? 'GET';
    const routeKey = ctx.event.routeKey ?? '';
    const path = ctx.event.rawPath ?? ctx.event.path ?? ctx.event.requestContext?.http?.path ?? '';
    const id = ctx.event.pathParameters?.id;

    if (
      method === 'POST' &&
      (routeKey === 'POST /inventory/purchase-orders' || path === '/inventory/purchase-orders')
    ) {
      return createPurchaseOrderHandler(ctx.event);
    }
    if (
      method === 'PATCH' &&
      (routeKey === 'PATCH /inventory/purchase-orders/{id}' ||
        /^\/inventory\/purchase-orders\/[^/]+$/.test(path))
    ) {
      return updatePurchaseOrderHandler(ctx.event);
    }

    const action =
      routeKey.endsWith('/approve') || path.endsWith('/approve')
        ? 'approve'
        : routeKey.endsWith('/send') || path.endsWith('/send')
          ? 'send'
          : routeKey.endsWith('/cancel') || path.endsWith('/cancel')
            ? 'cancel'
            : routeKey.endsWith('/close') || path.endsWith('/close')
              ? 'close'
              : undefined;
    if (method === 'PATCH' && id && action) {
      return purchaseOrderTransitionHandler(action)(ctx.event);
    }

    return jsonResponse(405, { message: 'Unsupported purchase order command route.' });
  },
  { requireAuth: false },
);

// ─── Get Part ─────────────────────────────────────────────────────────────────

export const getPartHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Part ID is required.' });

    const part = await getInventoryPrisma().part.findFirst({
      where: { id, deletedAt: null },
      include: PART_INCLUDE,
    });
    if (!part) return jsonResponse(404, { message: `Part not found: ${id}` });

    return jsonResponse(200, { part: toPartResponse(part) });
  },
  { requireAuth: false },
);

// ─── Create Part SKU ──────────────────────────────────────────────────────────

interface CreatePartBody {
  sku: string;
  name: string;
  description?: string;
  unitOfMeasure: string;
  reorderPoint?: number;
}

export const createPartHandler = wrapHandler(
  async (ctx) => {
    const body = parseBody<CreatePartBody>(ctx.event);
    if (!body.ok) return jsonResponse(400, { message: body.error });

    const { sku, name, description, unitOfMeasure, reorderPoint } = body.value;

    if (!sku?.trim()) return jsonResponse(422, { message: 'sku is required.' });
    if (!name?.trim()) return jsonResponse(422, { message: 'name is required.' });
    if (!unitOfMeasure?.trim()) return jsonResponse(422, { message: 'unitOfMeasure is required.' });

    const normalizedSku = sku.trim().toUpperCase();
    const existing = await getInventoryPrisma().part.findFirst({
      where: { sku: normalizedSku, deletedAt: null },
    });
    if (existing) {
      return jsonResponse(409, { message: `Part SKU already exists: ${normalizedSku}` });
    }

    const now = new Date();
    const part = await getInventoryPrisma().part.create({
      data: {
        id: randomUUID(),
        sku: normalizedSku,
        name: name.trim(),
        description: description?.trim() ?? null,
        unitOfMeasure: unitOfMeasure.trim(),
        partState: 'ACTIVE',
        reorderPoint: reorderPoint ?? 0,
        createdAt: now,
        updatedAt: now,
      },
    });

    return jsonResponse(201, { part: toPartResponse(part) });
  },
  { requireAuth: false },
);

// ─── List Vendors ─────────────────────────────────────────────────────────────

export const listVendorsHandler = wrapHandler(
  async (ctx) => {
    const qs = ctx.event.queryStringParameters ?? {};
    const vendorState = qs.state as string | undefined;
    const limit = Math.min(parseInt(qs.limit ?? '100', 10), 200);
    const offset = parseInt(qs.offset ?? '0', 10);

    const where = {
      ...(vendorState ? { state: vendorState as 'ACTIVE' | 'ON_HOLD' | 'INACTIVE' } : {}),
      deletedAt: null,
    };

    const [items, total] = await Promise.all([
      getInventoryPrisma().vendor.findMany({
        where,
        orderBy: { vendorName: 'asc' },
        take: limit,
        skip: offset,
      }),
      getInventoryPrisma().vendor.count({ where }),
    ]);

    return jsonResponse(200, { items: items.map(toVendorResponse), total, limit, offset });
  },
  { requireAuth: false },
);

export const getVendorHandler = wrapHandler(
  async (ctx) => {
    const id = ctx.event.pathParameters?.id;
    if (!id) return jsonResponse(400, { message: 'Vendor ID is required.' });

    const vendor = await inventoryPurchaseOrderQueries.getVendor(id);
    if (!vendor) return jsonResponse(404, { message: `Vendor not found: ${id}` });

    return jsonResponse(200, { vendor: toVendorResponse(vendor) });
  },
  { requireAuth: false },
);

// ─── Response mappers ─────────────────────────────────────────────────────────

function numberFromDb(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  if (value && typeof value === 'object' && 'toNumber' in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  return 0;
}

function toReservationResponse(r: InventoryReservationRow) {
  const reservedQuantity = numberFromDb(r.reservedQuantity);
  const consumedQuantity = numberFromDb(r.consumedQuantity);
  const allocatedQuantity = numberFromDb(r.allocatedQuantity);
  const isOpen = r.status === 'ACTIVE' || r.status === 'PARTIALLY_CONSUMED';
  const openQuantity = isOpen
    ? Math.max(reservedQuantity - consumedQuantity - allocatedQuantity, 0)
    : 0;

  return {
    id: r.id,
    status: r.status,
    reservedQuantity,
    consumedQuantity,
    allocatedQuantity,
    openQuantity,
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
    workOrderId: r.workOrderId ?? undefined,
    workOrderNumber: r.workOrderNumber ?? undefined,
    workOrderTitle: r.workOrderTitle ?? undefined,
    workOrderPartId: r.workOrderPartId ?? undefined,
  };
}

function toPartResponse(r: {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  variant?: string | null;
  color?: string | null;
  category?: string | null;
  lifecycleLevel?: string | null;
  installStage?: string | null;
  manufacturerId?: string | null;
  manufacturerPartNumber?: string | null;
  defaultVendorId?: string | null;
  defaultLocationId?: string | null;
  producedFromPartId?: string | null;
  producedViaStage?: string | null;
  unitOfMeasure: string;
  partState: string;
  reorderPoint: unknown;
  createdAt: Date;
  updatedAt: Date;
  stockLots?: Array<{ lotState: string; stockLocation?: { locationName: string } | null }>;
  manufacturer?: { manufacturerName: string } | null;
  defaultVendor?: { vendorName: string } | null;
  defaultLocation?: { locationName: string } | null;
}) {
  const availableLots = r.stockLots?.filter((l) => l.lotState === 'AVAILABLE') ?? [];
  const location =
    r.defaultLocation?.locationName ?? availableLots[0]?.stockLocation?.locationName ?? undefined;
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    description: r.description ?? undefined,
    variant: r.variant ?? undefined,
    color: r.color ?? undefined,
    category: r.category ?? undefined,
    lifecycleLevel: r.lifecycleLevel ?? undefined,
    installStage: r.installStage ?? undefined,
    manufacturerId: r.manufacturerId ?? undefined,
    manufacturerName: r.manufacturer?.manufacturerName ?? undefined,
    manufacturerPartNumber: r.manufacturerPartNumber ?? undefined,
    defaultVendorId: r.defaultVendorId ?? undefined,
    defaultVendorName: r.defaultVendor?.vendorName ?? undefined,
    defaultLocationId: r.defaultLocationId ?? undefined,
    defaultLocationName: r.defaultLocation?.locationName ?? undefined,
    producedFromPartId: r.producedFromPartId ?? undefined,
    producedViaStage: r.producedViaStage ?? undefined,
    unitOfMeasure: r.unitOfMeasure,
    partState: r.partState,
    reorderPoint: Number(r.reorderPoint),
    quantityOnHand: availableLots.length,
    location,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toManufacturerResponse(r: {
  id: string;
  manufacturerCode: string;
  manufacturerName: string;
  manufacturerState: string;
  website: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    manufacturerCode: r.manufacturerCode,
    name: r.manufacturerName,
    state: r.manufacturerState,
    website: r.website ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toVendorResponse(r: {
  id: string;
  vendorCode: string;
  vendorName: string;
  vendorState: string;
  email: string | null;
  phone: string | null;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  createdAt: Date;
  updatedAt: Date;
  purchaseOrders?: Array<{
    id: string;
    purchaseOrderState: string;
    expectedAt: Date | null;
  }>;
}) {
  const openPurchaseOrders =
    r.purchaseOrders?.filter(
      (po) => po.purchaseOrderState !== 'RECEIVED' && po.purchaseOrderState !== 'CANCELLED',
    ) ?? [];
  return {
    id: r.id,
    vendorCode: r.vendorCode,
    vendorName: r.vendorName,
    vendorState: r.vendorState,
    email: r.email ?? undefined,
    phone: r.phone ?? undefined,
    leadTimeDays: r.leadTimeDays ?? undefined,
    paymentTerms: r.paymentTerms ?? undefined,
    purchaseOrderCount: r.purchaseOrders?.length,
    openPurchaseOrderCount: r.purchaseOrders ? openPurchaseOrders.length : undefined,
    nextExpectedAt: openPurchaseOrders
      .map((po) => po.expectedAt)
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => a.getTime() - b.getTime())[0]
      ?.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toLotDetailResponse(r: {
  id: string;
  lotNumber: string | null;
  serialNumber: string | null;
  lotState: string;
  receivedAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  part: { sku: string; name: string };
  stockLocation: { locationName: string };
  balance?: InventoryLotBalanceRow;
}) {
  const quantityOnHand = numberFromDb(r.balance?.quantityOnHand);
  const quantityReserved = numberFromDb(r.balance?.quantityReserved);
  const quantityAllocated = numberFromDb(r.balance?.quantityAllocated);
  const quantityConsumed = numberFromDb(r.balance?.quantityConsumed);

  return {
    id: r.id,
    lotNumber: r.lotNumber ?? r.id,
    serialNumber: r.serialNumber ?? undefined,
    lotState: r.lotState,
    partSku: r.part.sku,
    partName: r.part.name,
    locationName: r.stockLocation.locationName,
    quantityOnHand,
    quantityReserved,
    quantityAllocated,
    quantityConsumed,
    quantityAvailable: Math.max(quantityOnHand - quantityReserved, 0),
    receivedAt: r.receivedAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toPurchaseOrderResponse(r: {
  id: string;
  poNumber: string;
  vendorId: string;
  purchaseOrderState: string;
  orderedAt: Date;
  expectedAt: Date | null;
  sentAt: Date | null;
  closedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  vendor: { vendorName: string; vendorCode: string };
  lines: Array<{
    id: string;
    lineNumber: number;
    partId: string;
    part?: {
      sku: string;
      name: string;
      defaultLocationId: string | null;
      defaultLocation: { locationName: string } | null;
    };
    orderedQuantity: unknown;
    receivedQuantity: unknown;
    rejectedQuantity: unknown;
    unitCost: unknown;
    promisedAt?: Date | null;
    lineState: string;
    unitOfMeasure?: { uomCode: string; uomName: string } | null;
  }>;
}) {
  return {
    id: r.id,
    poNumber: r.poNumber,
    vendorId: r.vendorId,
    vendorName: r.vendor.vendorName,
    vendorCode: r.vendor.vendorCode,
    purchaseOrderState: r.purchaseOrderState,
    orderedAt: r.orderedAt.toISOString(),
    expectedAt: r.expectedAt?.toISOString(),
    sentAt: r.sentAt?.toISOString(),
    closedAt: r.closedAt?.toISOString(),
    notes: r.notes ?? undefined,
    lineCount: r.lines.length,
    lines: r.lines.map((l) => ({
      id: l.id,
      lineNumber: l.lineNumber,
      partId: l.partId,
      partSku: l.part?.sku,
      partName: l.part?.name,
      defaultLocationId: l.part?.defaultLocationId ?? undefined,
      defaultLocationName: l.part?.defaultLocation?.locationName ?? undefined,
      orderedQuantity: Number(l.orderedQuantity),
      receivedQuantity: Number(l.receivedQuantity),
      rejectedQuantity: Number(l.rejectedQuantity),
      openQuantity: Math.max(
        Number(l.orderedQuantity) - Number(l.receivedQuantity) - Number(l.rejectedQuantity),
        0,
      ),
      unitOfMeasure: l.unitOfMeasure?.uomCode,
      unitOfMeasureName: l.unitOfMeasure?.uomName,
      unitCost: Number(l.unitCost),
      lineTotal: Number(l.unitCost) * Number(l.orderedQuantity),
      promisedAt: l.promisedAt?.toISOString(),
      lineState: l.lineState,
    })),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
