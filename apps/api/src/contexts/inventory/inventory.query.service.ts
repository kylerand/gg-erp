import { InvariantViolationError } from '../../../../../packages/domain/src/model/index.js';
import { AUDIT_POINTS } from '../../audit/index.js';
import type {
  InventoryBalanceQuery,
  InventoryBalanceRecord,
  InventoryLedgerQuery,
  InventoryLedgerQueryResponse,
  PurchaseOrderInventoryLinkContract,
  WorkOrderMaterialStatusContract,
  WorkOrderMaterialStatusLine
} from './inventory.api.contracts.js';
import { INVENTORY_WORKFLOW_EVENT_NAMES } from './inventory.events.js';
import { validateInventoryLedgerQuery } from './inventory.validation.js';
import { type CommandContext, type InventoryServiceDeps } from './inventory.service.shared.js';
import { InventoryServiceSupport } from './inventory.service.shared.js';

export class InventoryQueryService {
  private readonly support: InventoryServiceSupport;

  constructor(private readonly deps: InventoryServiceDeps) {
    this.support = new InventoryServiceSupport(deps);
  }

  async getBalances(
    query: InventoryBalanceQuery,
    context: CommandContext
  ): Promise<InventoryBalanceRecord[]> {
    return this.support.withObservedExecution('inventory.query.get_balances', context, async () => {
      return this.deps.repository.listBalances(query);
    });
  }

  async queryLedger(
    query: InventoryLedgerQuery,
    context: CommandContext
  ): Promise<InventoryLedgerQueryResponse> {
    return this.support.withObservedExecution('inventory.query.ledger', context, async () => {
      const validation = validateInventoryLedgerQuery(query);
      if (!validation.ok) {
        const message = validation.issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ');
        throw new InvariantViolationError(message);
      }

      const response = await this.deps.repository.queryLedgerEntries(query);
      await this.support.recordMutation(
        {
          action: AUDIT_POINTS.inventoryLedgerQuery,
          entityType: 'InventoryLedger',
          entityId: query.partSkuId ?? query.lotId ?? 'all',
          metadata: {
            query,
            resultCount: response.entries.length,
            nextCursor: response.nextCursor
          },
          eventName: INVENTORY_WORKFLOW_EVENT_NAMES.ledgerQueried,
          successMetricName: 'inventory.query.ledger.executed'
        },
        context
      );
      return response;
    });
  }

  async getWorkOrderMaterialStatus(
    workOrderId: string,
    context: CommandContext
  ): Promise<WorkOrderMaterialStatusContract> {
    return this.support.withObservedExecution(
      'inventory.query.work_order_material_status',
      context,
      async () => {
        if (!workOrderId.trim()) {
          throw new InvariantViolationError('workOrderId is required');
        }

        const reservations = await this.deps.repository.listReservationsByWorkOrder(workOrderId);
        const allocations = await this.deps.repository.listAllocationsByWorkOrder(workOrderId);
        const consumptions = await this.deps.repository.listWorkOrderConsumptions(workOrderId);

        const partIds = new Set<string>();
        for (const reservation of reservations) {
          partIds.add(reservation.partSkuId);
        }
        for (const allocation of allocations) {
          partIds.add(allocation.partSkuId);
        }
        for (const consumption of consumptions) {
          partIds.add(consumption.partSkuId);
        }

        const unitCodes = new Map<string, string>();
        for (const partSkuId of partIds) {
          const part = await this.deps.repository.findPartSkuById(partSkuId);
          unitCodes.set(partSkuId, part?.unitOfMeasure ?? 'EACH');
        }

        const linesByPart = new Map<string, WorkOrderMaterialStatusLine>();
        const ensureLine = (partSkuId: string): WorkOrderMaterialStatusLine => {
          let line = linesByPart.get(partSkuId);
          if (line) {
            return line;
          }
          line = {
            partSkuId,
            requested: 0,
            reserved: 0,
            allocated: 0,
            consumed: 0,
            unitCode: unitCodes.get(partSkuId) ?? 'EACH'
          };
          linesByPart.set(partSkuId, line);
          return line;
        };

        for (const reservation of reservations) {
          const line = ensureLine(reservation.partSkuId);
          line.requested += reservation.requestedQuantity;
          line.reserved += Math.max(reservation.quantity - reservation.allocatedQuantity, 0);
        }
        for (const allocation of allocations) {
          const line = ensureLine(allocation.partSkuId);
          line.allocated += Math.max(allocation.quantity - allocation.quantityConsumed, 0);
        }
        for (const consumption of consumptions) {
          const line = ensureLine(consumption.partSkuId);
          line.consumed += consumption.quantity;
        }

        return {
          workOrderId,
          lines: [...linesByPart.values()].sort((left, right) =>
            left.partSkuId.localeCompare(right.partSkuId)
          )
        };
      }
    );
  }

  async getPurchaseOrderReceiptStatus(
    purchaseOrderId: string,
    context: CommandContext
  ): Promise<PurchaseOrderInventoryLinkContract> {
    return this.support.withObservedExecution(
      'inventory.query.purchase_order_receipt_status',
      context,
      async () => {
        if (!purchaseOrderId.trim()) {
          throw new InvariantViolationError('purchaseOrderId is required');
        }
        const purchaseOrder = await this.deps.repository.findPurchaseOrderById(purchaseOrderId);
        if (!purchaseOrder) {
          throw new InvariantViolationError(`Purchase order not found: ${purchaseOrderId}`);
        }
        const linkedStatus = await this.deps.repository.findPurchaseOrderInventoryLink(purchaseOrderId);
        const linkedByLine = new Map(
          (linkedStatus?.lineStatuses ?? []).map((line) => [line.purchaseOrderLineId, line])
        );

        return {
          purchaseOrderId,
          lineStatuses: purchaseOrder.lines.map((line) => {
            const linkedLine = linkedByLine.get(line.id);
            return {
              purchaseOrderLineId: line.id,
              orderedQuantity: line.orderedQty,
              receivedQuantity: linkedLine?.receivedQuantity ?? line.receivedQty,
              linkedLotIds: linkedLine?.linkedLotIds ?? []
            };
          })
        };
      }
    );
  }
}
