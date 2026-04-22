import {
  InvariantViolationError,
  type PartSku
} from '../../../../../packages/domain/src/model/index.js';
import { AUDIT_POINTS } from '../../audit/index.js';
import type {
  InventoryBalanceQuery,
  InventoryBalanceRecord,
  InventoryLedgerQuery,
  InventoryLedgerQueryResponse,
  PartChainNode,
  PartChainResponse,
  PurchaseOrderInventoryLinkContract,
  StageMaterialPlanGroup,
  StageMaterialPlanLine,
  StageMaterialPlanResponse,
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

  async getPartChain(partSkuId: string, context: CommandContext): Promise<PartChainResponse> {
    return this.support.withObservedExecution('inventory.query.part_chain', context, async () => {
      if (!partSkuId.trim()) {
        throw new InvariantViolationError('partSkuId is required');
      }
      const part = await this.deps.repository.findPartSkuById(partSkuId);
      if (!part) {
        throw new InvariantViolationError(`Part SKU not found: ${partSkuId}`);
      }

      const ancestors: PartChainNode[] = [];
      let cursor: PartSku | undefined = part.producedFromPartId
        ? await this.deps.repository.findPartSkuById(part.producedFromPartId)
        : undefined;
      while (cursor) {
        ancestors.unshift({ part: cursor, producedViaStage: cursor.producedViaStage });
        cursor = cursor.producedFromPartId
          ? await this.deps.repository.findPartSkuById(cursor.producedFromPartId)
          : undefined;
      }

      const descendants: PartChainNode[] = [];
      const toVisit: PartSku[] = [part];
      const { items: allParts } = await this.deps.repository.listPartSkus();
      while (toVisit.length > 0) {
        const current = toVisit.shift()!;
        const children = allParts.filter((candidate) => candidate.producedFromPartId === current.id);
        for (const child of children) {
          descendants.push({ part: child, producedViaStage: child.producedViaStage });
          toVisit.push(child);
        }
      }

      return { ancestors, part, descendants };
    });
  }

  async planMaterialByStage(context: CommandContext): Promise<StageMaterialPlanResponse> {
    return this.support.withObservedExecution(
      'inventory.query.material_plan_by_stage',
      context,
      async () => {
        const [{ items: parts }, lots] = await Promise.all([
          this.deps.repository.listPartSkus(),
          this.deps.repository.listLots()
        ]);

        const onHandByPart = new Map<string, number>();
        for (const lot of lots) {
          if (lot.state === 'CONSUMED') continue;
          const running = onHandByPart.get(lot.partSkuId) ?? 0;
          onHandByPart.set(lot.partSkuId, running + lot.quantityOnHand);
        }

        const toLine = (part: PartSku): StageMaterialPlanLine => {
          const onHand = onHandByPart.get(part.id) ?? 0;
          const shortfall = Math.max(part.reorderPoint - onHand, 0);
          return { part, onHand, reorderPoint: part.reorderPoint, shortfall };
        };

        const groupsByStage = new Map<string, StageMaterialPlanGroup>();
        const unassigned: StageMaterialPlanLine[] = [];

        for (const part of parts) {
          const line = toLine(part);
          if (!part.installStage) {
            unassigned.push(line);
            continue;
          }
          let group = groupsByStage.get(part.installStage);
          if (!group) {
            group = { installStage: part.installStage, lines: [], totalShortfall: 0 };
            groupsByStage.set(part.installStage, group);
          }
          group.lines.push(line);
          group.totalShortfall += line.shortfall;
        }

        const stageOrder = ['FABRICATION', 'FRAME', 'WIRING', 'PARTS_PREP', 'FINAL_ASSEMBLY'];
        const groups = [...groupsByStage.values()].sort(
          (a, b) => stageOrder.indexOf(a.installStage) - stageOrder.indexOf(b.installStage)
        );
        for (const group of groups) {
          group.lines.sort((a, b) => b.shortfall - a.shortfall || a.part.sku.localeCompare(b.part.sku));
        }
        unassigned.sort((a, b) => a.part.sku.localeCompare(b.part.sku));

        return {
          generatedAt: new Date().toISOString(),
          groups,
          unassigned
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
