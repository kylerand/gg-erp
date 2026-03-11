import { randomUUID } from 'node:crypto';
import { InvariantViolationError } from '../../../../../packages/domain/src/model/index.js';
import { AUDIT_POINTS } from '../../audit/index.js';
import type {
  CycleCountReconciliationContract,
  CycleCountSessionContract,
  ReconcileCycleCountRequest,
  StartCycleCountSessionRequest
} from './inventory.api.contracts.js';
import { INVENTORY_WORKFLOW_EVENT_NAMES } from './inventory.events.js';
import { validateReconcileCycleCountRequest } from './inventory.validation.js';
import type { CommandContext, InventoryServiceDeps } from './inventory.service.shared.js';
import { InventoryServiceSupport } from './inventory.service.shared.js';
import type { InventoryStockMovementService } from './inventory.stock-movement.service.js';

export class InventoryCycleCountService {
  private readonly support: InventoryServiceSupport;

  constructor(
    private readonly deps: InventoryServiceDeps,
    private readonly stockMovementService: Pick<InventoryStockMovementService, 'recordAdjustment'>
  ) {
    this.support = new InventoryServiceSupport(deps);
  }

  async startCycleCount(
    input: StartCycleCountSessionRequest,
    context: CommandContext
  ): Promise<CycleCountSessionContract> {
    return this.support.withObservedExecution('inventory.cycle_count.start', context, async () => {
      if (!input.locationId.trim()) {
        throw new InvariantViolationError('locationId is required');
      }
      const location = await this.deps.repository.findLocationById(input.locationId);
      if (location && location.state !== 'ACTIVE') {
        throw new InvariantViolationError(`Location ${input.locationId} is not ACTIVE`);
      }
      if (input.binId) {
        const bin = await this.deps.repository.findBinById(input.binId);
        if (bin && bin.state !== 'OPEN') {
          throw new InvariantViolationError(`Bin ${input.binId} is not OPEN`);
        }
      }

      const now = new Date().toISOString();
      const session: CycleCountSessionContract = {
        id: randomUUID(),
        locationId: input.locationId,
        binId: input.binId,
        status: 'OPEN',
        startedAt: now
      };
      await this.deps.repository.saveCycleCountSession(session);
      await this.support.recordMutation(
        {
          action: AUDIT_POINTS.inventoryCycleCountReconcile,
          entityType: 'CycleCountSession',
          entityId: session.id,
          metadata: {
            sessionId: session.id,
            locationId: session.locationId,
            binId: session.binId,
            partSkuIds: input.partSkuIds
          },
          eventName: INVENTORY_WORKFLOW_EVENT_NAMES.cycleCountStarted,
          successMetricName: 'inventory.cycle_count.session.started'
        },
        context
      );
      return session;
    });
  }

  async reconcileCycleCount(
    input: ReconcileCycleCountRequest,
    context: CommandContext
  ): Promise<CycleCountReconciliationContract> {
    return this.support.withObservedExecution('inventory.cycle_count.reconcile', context, async () => {
      const validation = validateReconcileCycleCountRequest(input);
      if (!validation.ok) {
        const message = validation.issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ');
        throw new InvariantViolationError(message);
      }

      const session = await this.deps.repository.findCycleCountSessionById(input.sessionId);
      if (!session) {
        throw new InvariantViolationError(`Cycle count session not found: ${input.sessionId}`);
      }
      if (session.status !== 'OPEN') {
        throw new InvariantViolationError(
          `Cycle count session ${input.sessionId} is not OPEN (status=${session.status})`
        );
      }

      const adjustmentIds: string[] = [];
      let varianceCount = 0;
      let netQuantityDelta = 0;

      for (const line of input.lines) {
        const quantityDelta = line.countedQuantity - line.expectedQuantity;
        if (quantityDelta === 0) {
          continue;
        }
        varianceCount += 1;
        netQuantityDelta += quantityDelta;
        const adjustment = await this.stockMovementService.recordAdjustment(
          {
            partSkuId: line.partSkuId,
            locationId: session.locationId,
            binId: session.binId,
            lotId: line.lotId,
            quantityDelta,
            reasonCode: line.reasonCode ?? 'CYCLE_COUNT',
            note: `cycleCountSession=${session.id}`
          },
          context
        );
        adjustmentIds.push(adjustment.id);
      }

      const completedAt = new Date().toISOString();
      const updatedSession: CycleCountSessionContract = {
        ...session,
        status: 'RECONCILED',
        completedAt
      };
      await this.deps.repository.saveCycleCountSession(updatedSession);

      const reconciliation: CycleCountReconciliationContract = {
        sessionId: session.id,
        varianceCount,
        netQuantityDelta,
        adjustmentIds,
        completedAt
      };
      await this.support.recordMutation(
        {
          action: AUDIT_POINTS.inventoryCycleCountReconcile,
          entityType: 'CycleCountSession',
          entityId: session.id,
          metadata: reconciliation,
          eventName: INVENTORY_WORKFLOW_EVENT_NAMES.cycleCountCompleted,
          successMetricName: 'inventory.cycle_count.session.reconciled'
        },
        context
      );
      return reconciliation;
    });
  }
}
