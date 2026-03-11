import { randomUUID } from 'node:crypto';
import {
  InventoryLotDesign,
  InventoryLotState,
  InvariantViolationError,
  PartSkuState,
  assertTransitionAllowed,
  type InventoryLot,
  type PartSku
} from '../../../../../packages/domain/src/model/index.js';
import { AUDIT_POINTS } from '../../audit/index.js';
import type {
  ConsumeWorkOrderMaterialRequest,
  InventoryAdjustmentContract,
  InventoryBalanceRecord,
  InventoryDocumentReference,
  InventoryLedgerEntryContract,
  InventoryTransferContract,
  LinkReceiptToPurchaseOrderRequest,
  ReceiveLotRequest,
  RecordInventoryAdjustmentRequest,
  RecordInventoryTransferRequest,
  ReserveInventoryRequest,
  WorkOrderConsumptionContract
} from './inventory.api.contracts.js';
import { INVENTORY_WORKFLOW_EVENT_NAMES } from './inventory.events.js';
import type {
  InventoryAllocationRecord,
  InventoryReservationRecord
} from './inventory.repository.js';
import {
  validateConsumeWorkOrderMaterialRequest,
  validateLinkReceiptToPurchaseOrderRequest,
  validateReceiveLotRequest,
  validateRecordInventoryAdjustmentRequest,
  validateRecordInventoryTransferRequest,
  type InventoryValidationResult
} from './inventory.validation.js';
import {
  type CommandContext,
  type InventoryServiceDeps,
  InventoryServiceSupport
} from './inventory.service.shared.js';

export interface ReserveInventoryResult {
  lot: InventoryLot;
  reservation: InventoryReservationRecord;
}

interface BalanceDelta {
  onHand?: number;
  reserved?: number;
  allocated?: number;
  consumed?: number;
}

interface LedgerWriteInput {
  movementType: InventoryLedgerEntryContract['movementType'];
  partSkuId: string;
  locationId: string;
  binId?: string;
  lotId?: string;
  quantityDelta: number;
  unitCode: string;
  sourceDocument?: InventoryDocumentReference;
}

export class InventoryStockMovementService {
  private readonly support: InventoryServiceSupport;

  constructor(private readonly deps: InventoryServiceDeps) {
    this.support = new InventoryServiceSupport(deps);
  }

  async receiveLot(input: ReceiveLotRequest, context: CommandContext): Promise<InventoryLot> {
    return this.support.withObservedExecution('inventory.stock.receive_lot', context, async () => {
      this.assertValidation(validateReceiveLotRequest(input));

      const part = await this.requirePart(input.partSkuId, true);
      const existingLot = await this.deps.repository.findLotByNumber(input.lotNumber);
      if (existingLot) {
        throw new InvariantViolationError(`Lot already exists: ${input.lotNumber}`);
      }

      const location = await this.deps.repository.findLocationById(input.locationId);
      if (location && location.state !== 'ACTIVE') {
        throw new InvariantViolationError(`Location ${input.locationId} is not ACTIVE`);
      }
      const bin = await this.deps.repository.findBinById(input.binId);
      if (bin && bin.state !== 'OPEN') {
        throw new InvariantViolationError(`Bin ${input.binId} is not OPEN`);
      }

      const now = new Date().toISOString();
      const lot: InventoryLot = {
        id: randomUUID(),
        lotNumber: input.lotNumber.trim(),
        partSkuId: input.partSkuId,
        locationId: input.locationId,
        binId: input.binId,
        quantityOnHand: input.quantityOnHand,
        quantityReserved: 0,
        state: InventoryLotState.RECEIVED,
        receivedAt: now,
        expiresAt: input.expiresAt,
        updatedAt: now
      };
      await this.deps.repository.saveLot(lot);
      await this.applyBalanceDelta(
        {
          partSkuId: lot.partSkuId,
          locationId: lot.locationId,
          binId: lot.binId,
          lotId: lot.id,
          unitCode: part.unitOfMeasure
        },
        { onHand: input.quantityOnHand }
      );
      await this.appendLedgerEntry(
        {
          movementType: 'RECEIPT',
          partSkuId: lot.partSkuId,
          locationId: lot.locationId,
          binId: lot.binId,
          lotId: lot.id,
          quantityDelta: input.quantityOnHand,
          unitCode: part.unitOfMeasure,
          sourceDocument:
            input.sourceDocument ??
            ({
              documentType: 'MANUAL',
              documentId: lot.id
            } satisfies InventoryDocumentReference)
        },
        context
      );
      await this.support.recordMutation(
        {
          action: AUDIT_POINTS.inventoryReceiptRecord,
          entityType: 'InventoryLot',
          entityId: lot.id,
          metadata: lot,
          eventName: INVENTORY_WORKFLOW_EVENT_NAMES.lotReceived,
          successMetricName: 'inventory.stock.receipt.recorded'
        },
        context
      );
      return lot;
    });
  }

  async reserveInventory(
    input: ReserveInventoryRequest,
    context: CommandContext
  ): Promise<ReserveInventoryResult> {
    return this.support.withObservedExecution('inventory.stock.reserve_inventory', context, async () => {
      if (input.quantity <= 0) {
        throw new InvariantViolationError('Reservation quantity must be > 0');
      }

      const lot = await this.requireLot(input.lotId);
      const part = await this.requirePart(lot.partSkuId);
      if (
        lot.state !== InventoryLotState.RECEIVED &&
        lot.state !== InventoryLotState.AVAILABLE &&
        lot.state !== InventoryLotState.RESERVED
      ) {
        throw new InvariantViolationError(`Lot ${input.lotId} is not reservable from state ${lot.state}`);
      }

      const available = lot.quantityOnHand - lot.quantityReserved;
      if (available < input.quantity) {
        await this.support.emitEvent(
          INVENTORY_WORKFLOW_EVENT_NAMES.shortageDetected,
          {
            partSkuId: lot.partSkuId,
            locationId: lot.locationId,
            requested: input.quantity,
            available,
            demandReference: input.demandReference
          },
          context
        );
        this.deps.observability.metric('inventory.reserve.shortage', 1, context);
        throw new InvariantViolationError(
          `Insufficient inventory for lot ${lot.id}: requested ${input.quantity}, available ${available}`
        );
      }

      const now = new Date().toISOString();
      const updatedLot: InventoryLot = {
        ...lot,
        quantityReserved: lot.quantityReserved + input.quantity,
        state: InventoryLotState.RESERVED,
        updatedAt: now
      };
      const reservation: InventoryReservationRecord = {
        id: randomUUID(),
        lotId: lot.id,
        partSkuId: lot.partSkuId,
        requestedQuantity: input.quantity,
        quantity: input.quantity,
        allocatedQuantity: 0,
        workOrderId: input.workOrderId,
        demandReference: input.demandReference,
        state: 'ACTIVE',
        createdAt: now,
        updatedAt: now
      };

      await this.deps.repository.saveLot(updatedLot);
      await this.deps.repository.saveReservation(reservation);
      await this.applyBalanceDelta(
        {
          partSkuId: lot.partSkuId,
          locationId: lot.locationId,
          binId: lot.binId,
          lotId: lot.id,
          unitCode: part.unitOfMeasure
        },
        { reserved: input.quantity }
      );
      await this.appendLedgerEntry(
        {
          movementType: 'RESERVATION',
          partSkuId: lot.partSkuId,
          locationId: lot.locationId,
          binId: lot.binId,
          lotId: lot.id,
          quantityDelta: 0,
          unitCode: part.unitOfMeasure,
          sourceDocument: this.toReservationSourceDocument(input, reservation.id)
        },
        context
      );
      await this.support.recordMutation(
        {
          action: AUDIT_POINTS.inventoryReserve,
          entityType: 'InventoryReservation',
          entityId: reservation.id,
          metadata: {
            reservationId: reservation.id,
            lotId: reservation.lotId,
            partSkuId: reservation.partSkuId,
            quantity: reservation.quantity,
            workOrderId: reservation.workOrderId
          },
          eventName: INVENTORY_WORKFLOW_EVENT_NAMES.lotReserved,
          successMetricName: 'inventory.stock.reservation.recorded'
        },
        context
      );
      return {
        lot: updatedLot,
        reservation
      };
    });
  }

  async reserveLotQuantity(
    lotId: string,
    quantity: number,
    context: CommandContext
  ): Promise<InventoryLot> {
    const reservation = await this.reserveInventory({ lotId, quantity }, context);
    return reservation.lot;
  }

  async allocateReservation(
    input: {
      reservationId: string;
      quantity: number;
      targetType: 'WORK_ORDER' | 'KIT' | 'TRANSFER';
      targetId: string;
      locationId?: string;
      binId?: string;
    },
    context: CommandContext
  ) {
    return this.support.withObservedExecution(
      'inventory.stock.allocate_reservation',
      context,
      async () => {
        if (input.quantity <= 0) {
          throw new InvariantViolationError('Allocation quantity must be > 0');
        }

        const reservation = await this.deps.repository.findReservationById(input.reservationId);
        if (!reservation || reservation.state !== 'ACTIVE') {
          throw new InvariantViolationError(`Reservation not found or inactive: ${input.reservationId}`);
        }

        const lot = await this.requireLot(reservation.lotId);
        const part = await this.requirePart(lot.partSkuId);
        const availableToAllocate = reservation.quantity - reservation.allocatedQuantity;
        if (availableToAllocate < input.quantity) {
          throw new InvariantViolationError(
            `Allocation exceeds unallocated reservation quantity (${availableToAllocate})`
          );
        }

        const now = new Date().toISOString();
        const allocation: InventoryAllocationRecord = {
          id: randomUUID(),
          reservationId: reservation.id,
          quantity: input.quantity,
          targetType: input.targetType,
          targetId: input.targetId,
          createdAt: now,
          lotId: lot.id,
          partSkuId: lot.partSkuId,
          workOrderId: input.targetType === 'WORK_ORDER' ? input.targetId : undefined,
          quantityConsumed: 0,
          updatedAt: now
        };
        const updatedReservation: InventoryReservationRecord = {
          ...reservation,
          allocatedQuantity: reservation.allocatedQuantity + input.quantity,
          updatedAt: now
        };

        await this.deps.repository.saveAllocation(allocation);
        await this.deps.repository.saveReservation(updatedReservation);
        await this.applyBalanceDelta(
          {
            partSkuId: lot.partSkuId,
            locationId: lot.locationId,
            binId: lot.binId,
            lotId: lot.id,
            unitCode: part.unitOfMeasure
          },
          { reserved: -input.quantity, allocated: input.quantity }
        );
        await this.appendLedgerEntry(
          {
            movementType: 'ALLOCATION',
            partSkuId: lot.partSkuId,
            locationId: input.locationId ?? lot.locationId,
            binId: input.binId ?? lot.binId,
            lotId: lot.id,
            quantityDelta: 0,
            unitCode: part.unitOfMeasure,
            sourceDocument: this.toAllocationSourceDocument(input.targetType, input.targetId, allocation.id)
          },
          context
        );
        await this.support.recordMutation(
          {
            action: AUDIT_POINTS.inventoryAllocate,
            entityType: 'InventoryAllocation',
            entityId: allocation.id,
            metadata: {
              reservationId: allocation.reservationId,
              allocationId: allocation.id,
              targetType: allocation.targetType,
              targetId: allocation.targetId,
              quantity: allocation.quantity
            },
            eventName: INVENTORY_WORKFLOW_EVENT_NAMES.reservationAllocated,
            successMetricName: 'inventory.stock.allocation.recorded'
          },
          context
        );
        return allocation;
      }
    );
  }

  async releaseLotReservation(
    lotId: string,
    quantity: number,
    context: CommandContext,
    reasonCode?: string
  ): Promise<InventoryLot> {
    return this.support.withObservedExecution('inventory.stock.release_reservation', context, async () => {
      if (quantity <= 0) {
        throw new InvariantViolationError('Release quantity must be > 0');
      }

      const lot = await this.requireLot(lotId);
      const part = await this.requirePart(lot.partSkuId);
      if (lot.quantityReserved < quantity) {
        throw new InvariantViolationError(`Release quantity exceeds reserved quantity for lot ${lot.id}`);
      }

      await this.releaseReservationQuantity(lot.id, quantity);

      const nextReserved = lot.quantityReserved - quantity;
      const updatedLot: InventoryLot = {
        ...lot,
        quantityReserved: nextReserved,
        state: nextReserved > 0 ? InventoryLotState.RESERVED : InventoryLotState.AVAILABLE,
        updatedAt: new Date().toISOString()
      };
      await this.deps.repository.saveLot(updatedLot);
      await this.applyBalanceDelta(
        {
          partSkuId: lot.partSkuId,
          locationId: lot.locationId,
          binId: lot.binId,
          lotId: lot.id,
          unitCode: part.unitOfMeasure
        },
        { reserved: -quantity }
      );
      await this.appendLedgerEntry(
        {
          movementType: 'RELEASE',
          partSkuId: lot.partSkuId,
          locationId: lot.locationId,
          binId: lot.binId,
          lotId: lot.id,
          quantityDelta: 0,
          unitCode: part.unitOfMeasure,
          sourceDocument: {
            documentType: 'MANUAL',
            documentId: reasonCode ? `${lot.id}:${reasonCode}` : lot.id,
            externalReference: reasonCode
          }
        },
        context
      );
      await this.support.recordMutation(
        {
          action: AUDIT_POINTS.inventoryReserve,
          entityType: 'InventoryLot',
          entityId: lot.id,
          metadata: { lotId: lot.id, quantity, reasonCode },
          eventName: INVENTORY_WORKFLOW_EVENT_NAMES.lotReleased,
          successMetricName: 'inventory.stock.reservation.released'
        },
        context
      );
      return updatedLot;
    });
  }

  async consumeReservedQuantity(
    lotId: string,
    quantity: number,
    context: CommandContext
  ): Promise<InventoryLot> {
    return this.support.withObservedExecution('inventory.stock.consume_reserved', context, async () => {
      if (quantity <= 0) {
        throw new InvariantViolationError('Consume quantity must be > 0');
      }

      const lot = await this.requireLot(lotId);
      const part = await this.requirePart(lot.partSkuId);
      if (lot.quantityReserved < quantity) {
        throw new InvariantViolationError(`Consume quantity exceeds reserved quantity for lot ${lot.id}`);
      }

      const nextOnHand = lot.quantityOnHand - quantity;
      if (nextOnHand < 0) {
        throw new InvariantViolationError('Cannot consume more than on-hand quantity');
      }
      const nextReserved = lot.quantityReserved - quantity;
      const nextState = this.determineLotStateAfterConsumption(lot, nextOnHand, nextReserved);

      const updatedLot: InventoryLot = {
        ...lot,
        quantityOnHand: nextOnHand,
        quantityReserved: nextReserved,
        state: nextState,
        updatedAt: new Date().toISOString()
      };
      await this.deps.repository.saveLot(updatedLot);
      await this.consumeReservationQuantity(lot.id, quantity, true);
      await this.applyBalanceDelta(
        {
          partSkuId: lot.partSkuId,
          locationId: lot.locationId,
          binId: lot.binId,
          lotId: lot.id,
          unitCode: part.unitOfMeasure
        },
        { onHand: -quantity, reserved: -quantity, consumed: quantity }
      );
      await this.appendLedgerEntry(
        {
          movementType: 'ISSUE',
          partSkuId: lot.partSkuId,
          locationId: lot.locationId,
          binId: lot.binId,
          lotId: lot.id,
          quantityDelta: -quantity,
          unitCode: part.unitOfMeasure,
          sourceDocument: {
            documentType: 'MANUAL',
            documentId: lot.id
          }
        },
        context
      );
      await this.support.recordMutation(
        {
          action: AUDIT_POINTS.inventoryConsume,
          entityType: 'InventoryLot',
          entityId: lot.id,
          metadata: {
            lotId: lot.id,
            quantityOnHand: updatedLot.quantityOnHand,
            quantityReserved: updatedLot.quantityReserved
          },
          eventName: INVENTORY_WORKFLOW_EVENT_NAMES.lotConsumed,
          successMetricName: 'inventory.stock.reserved_quantity.consumed'
        },
        context
      );
      return updatedLot;
    });
  }

  async consumeWorkOrderMaterial(
    input: ConsumeWorkOrderMaterialRequest,
    context: CommandContext
  ): Promise<WorkOrderConsumptionContract> {
    return this.support.withObservedExecution(
      'inventory.stock.consume_work_order_material',
      context,
      async () => {
        this.assertValidation(validateConsumeWorkOrderMaterialRequest(input));

        const lot = await this.requireLot(input.lotId);
        const part = await this.requirePart(lot.partSkuId);
        if (lot.quantityOnHand < input.quantity) {
          throw new InvariantViolationError(
            `Lot ${input.lotId} on-hand is ${lot.quantityOnHand}, cannot consume ${input.quantity}`
          );
        }
        if (lot.quantityReserved < input.quantity) {
          throw new InvariantViolationError(
            `Lot ${input.lotId} reserved quantity is ${lot.quantityReserved}, cannot consume ${input.quantity}`
          );
        }

        let balanceDelta: BalanceDelta = { reserved: -input.quantity };
        if (input.allocationId) {
          const allocation = await this.deps.repository.findAllocationById(input.allocationId);
          if (!allocation) {
            throw new InvariantViolationError(`Allocation not found: ${input.allocationId}`);
          }
          if (allocation.targetType !== 'WORK_ORDER' || allocation.targetId !== input.workOrderId) {
            throw new InvariantViolationError(
              `Allocation ${input.allocationId} is not linked to work order ${input.workOrderId}`
            );
          }
          const remainingAllocated = allocation.quantity - allocation.quantityConsumed;
          if (remainingAllocated < input.quantity) {
            throw new InvariantViolationError(
              `Allocation ${input.allocationId} has only ${remainingAllocated} remaining`
            );
          }

          await this.deps.repository.saveAllocation({
            ...allocation,
            quantityConsumed: allocation.quantityConsumed + input.quantity,
            updatedAt: new Date().toISOString()
          });
          await this.consumeFromAllocationReservation(allocation.reservationId, input.quantity);
          balanceDelta = { allocated: -input.quantity };
        } else {
          await this.consumeReservationQuantity(lot.id, input.quantity, false, input.workOrderId);
        }

        const nextOnHand = lot.quantityOnHand - input.quantity;
        const nextReserved = lot.quantityReserved - input.quantity;
        const updatedLot: InventoryLot = {
          ...lot,
          quantityOnHand: nextOnHand,
          quantityReserved: nextReserved,
          state: this.determineLotStateAfterConsumption(lot, nextOnHand, nextReserved),
          updatedAt: new Date().toISOString()
        };
        await this.deps.repository.saveLot(updatedLot);

        const consumption: WorkOrderConsumptionContract = {
          id: randomUUID(),
          workOrderId: input.workOrderId,
          workOrderOperationId: input.workOrderOperationId,
          partSkuId: lot.partSkuId,
          lotId: lot.id,
          quantity: input.quantity,
          unitCode: part.unitOfMeasure,
          consumedAt: new Date().toISOString()
        };
        await this.deps.repository.saveWorkOrderConsumption(consumption);
        await this.applyBalanceDelta(
          {
            partSkuId: lot.partSkuId,
            locationId: lot.locationId,
            binId: lot.binId,
            lotId: lot.id,
            unitCode: part.unitOfMeasure
          },
          {
            onHand: -input.quantity,
            consumed: input.quantity,
            ...balanceDelta
          }
        );
        await this.appendLedgerEntry(
          {
            movementType: 'ISSUE',
            partSkuId: lot.partSkuId,
            locationId: lot.locationId,
            binId: lot.binId,
            lotId: lot.id,
            quantityDelta: -input.quantity,
            unitCode: part.unitOfMeasure,
            sourceDocument: {
              documentType: 'WORK_ORDER',
              documentId: input.workOrderId,
              lineId: input.workOrderOperationId
            }
          },
          context
        );
        await this.support.recordMutation(
          {
            action: AUDIT_POINTS.inventoryConsume,
            entityType: 'WorkOrderConsumption',
            entityId: consumption.id,
            metadata: consumption,
            eventName: INVENTORY_WORKFLOW_EVENT_NAMES.workOrderConsumptionRecorded,
            successMetricName: 'inventory.stock.work_order.consumed'
          },
          context
        );
        return consumption;
      }
    );
  }

  async recordAdjustment(
    input: RecordInventoryAdjustmentRequest,
    context: CommandContext
  ): Promise<InventoryAdjustmentContract> {
    return this.support.withObservedExecution('inventory.stock.record_adjustment', context, async () => {
      this.assertValidation(validateRecordInventoryAdjustmentRequest(input));
      const part = await this.requirePart(input.partSkuId);

      if (input.lotId) {
        const lot = await this.requireLot(input.lotId);
        if (lot.partSkuId !== input.partSkuId) {
          throw new InvariantViolationError(`Lot ${input.lotId} is not for part ${input.partSkuId}`);
        }
        if (lot.locationId !== input.locationId) {
          throw new InvariantViolationError(
            `Lot ${input.lotId} location mismatch: expected ${lot.locationId}, got ${input.locationId}`
          );
        }
        if (input.binId && lot.binId !== input.binId) {
          throw new InvariantViolationError(
            `Lot ${input.lotId} bin mismatch: expected ${lot.binId}, got ${input.binId}`
          );
        }

        const nextLotOnHand = lot.quantityOnHand + input.quantityDelta;
        if (nextLotOnHand < 0) {
          throw new InvariantViolationError('Adjustment would make lot on-hand negative');
        }
        if (nextLotOnHand < lot.quantityReserved) {
          throw new InvariantViolationError('Adjustment would make lot on-hand less than reserved quantity');
        }

        let nextState = lot.state;
        if (nextLotOnHand === 0) {
          assertTransitionAllowed(lot.state, InventoryLotState.CONSUMED, InventoryLotDesign.lifecycle);
          nextState = InventoryLotState.CONSUMED;
        } else if (lot.quantityReserved > 0) {
          nextState = InventoryLotState.RESERVED;
        } else {
          nextState = InventoryLotState.AVAILABLE;
        }

        await this.deps.repository.saveLot({
          ...lot,
          quantityOnHand: nextLotOnHand,
          state: nextState,
          updatedAt: new Date().toISOString()
        });
      }

      const updatedBalance = await this.applyBalanceDelta(
        {
          partSkuId: input.partSkuId,
          locationId: input.locationId,
          binId: input.binId,
          lotId: input.lotId,
          unitCode: part.unitOfMeasure
        },
        { onHand: input.quantityDelta }
      );
      const adjustment: InventoryAdjustmentContract = {
        id: randomUUID(),
        reasonCode: input.reasonCode.trim(),
        note: input.note?.trim() || undefined,
        quantityDelta: input.quantityDelta,
        postedAt: new Date().toISOString(),
        balanceAfter: updatedBalance
      };
      await this.appendLedgerEntry(
        {
          movementType: 'ADJUSTMENT',
          partSkuId: input.partSkuId,
          locationId: input.locationId,
          binId: input.binId,
          lotId: input.lotId,
          quantityDelta: input.quantityDelta,
          unitCode: part.unitOfMeasure,
          sourceDocument: {
            documentType: 'ADJUSTMENT',
            documentId: adjustment.id
          }
        },
        context
      );
      await this.support.recordMutation(
        {
          action: AUDIT_POINTS.inventoryAdjustment,
          entityType: 'InventoryAdjustment',
          entityId: adjustment.id,
          metadata: {
            adjustmentId: adjustment.id,
            partSkuId: input.partSkuId,
            locationId: input.locationId,
            binId: input.binId,
            quantityDelta: input.quantityDelta,
            reasonCode: adjustment.reasonCode
          },
          eventName: INVENTORY_WORKFLOW_EVENT_NAMES.adjustmentRecorded,
          successMetricName: 'inventory.stock.adjustment.recorded'
        },
        context
      );
      return adjustment;
    });
  }

  async recordTransfer(
    input: RecordInventoryTransferRequest,
    context: CommandContext
  ): Promise<InventoryTransferContract> {
    return this.support.withObservedExecution('inventory.stock.record_transfer', context, async () => {
      this.assertValidation(validateRecordInventoryTransferRequest(input));
      const part = await this.requirePart(input.partSkuId);
      const sourceLot = await this.resolveTransferSourceLot(input);
      if (sourceLot.quantityReserved > 0) {
        throw new InvariantViolationError('MVP transfer only supports unreserved lots');
      }
      if (sourceLot.quantityOnHand !== input.quantity) {
        throw new InvariantViolationError(
          'MVP transfer currently supports only full-lot moves (no lot splitting yet)'
        );
      }

      const fromLocation = await this.deps.repository.findLocationById(input.fromLocationId);
      const toLocation = await this.deps.repository.findLocationById(input.toLocationId);
      if (fromLocation && fromLocation.state !== 'ACTIVE') {
        throw new InvariantViolationError(`Source location ${input.fromLocationId} is not ACTIVE`);
      }
      if (toLocation && toLocation.state !== 'ACTIVE') {
        throw new InvariantViolationError(`Destination location ${input.toLocationId} is not ACTIVE`);
      }

      const destinationBinId = input.toBinId ?? sourceLot.binId;
      const destinationBin = await this.deps.repository.findBinById(destinationBinId);
      if (destinationBin && destinationBin.state !== 'OPEN') {
        throw new InvariantViolationError(`Destination bin ${destinationBinId} is not OPEN`);
      }

      const updatedLot: InventoryLot = {
        ...sourceLot,
        locationId: input.toLocationId,
        binId: destinationBinId,
        state: InventoryLotState.AVAILABLE,
        updatedAt: new Date().toISOString()
      };
      await this.deps.repository.saveLot(updatedLot);
      await this.applyBalanceDelta(
        {
          partSkuId: sourceLot.partSkuId,
          locationId: input.fromLocationId,
          binId: input.fromBinId ?? sourceLot.binId,
          lotId: sourceLot.id,
          unitCode: part.unitOfMeasure
        },
        { onHand: -input.quantity }
      );
      await this.applyBalanceDelta(
        {
          partSkuId: sourceLot.partSkuId,
          locationId: input.toLocationId,
          binId: destinationBinId,
          lotId: sourceLot.id,
          unitCode: part.unitOfMeasure
        },
        { onHand: input.quantity }
      );

      const transfer: InventoryTransferContract = {
        id: randomUUID(),
        partSkuId: sourceLot.partSkuId,
        lotId: sourceLot.id,
        quantity: input.quantity,
        fromLocationId: input.fromLocationId,
        fromBinId: input.fromBinId ?? sourceLot.binId,
        toLocationId: input.toLocationId,
        toBinId: destinationBinId,
        completedAt: new Date().toISOString()
      };
      const sourceDocument: InventoryDocumentReference = {
        documentType: 'TRANSFER',
        documentId: transfer.id
      };
      await this.appendLedgerEntry(
        {
          movementType: 'TRANSFER_OUT',
          partSkuId: transfer.partSkuId,
          locationId: transfer.fromLocationId,
          binId: transfer.fromBinId,
          lotId: transfer.lotId,
          quantityDelta: -transfer.quantity,
          unitCode: part.unitOfMeasure,
          sourceDocument
        },
        context
      );
      await this.appendLedgerEntry(
        {
          movementType: 'TRANSFER_IN',
          partSkuId: transfer.partSkuId,
          locationId: transfer.toLocationId,
          binId: transfer.toBinId,
          lotId: transfer.lotId,
          quantityDelta: transfer.quantity,
          unitCode: part.unitOfMeasure,
          sourceDocument
        },
        context
      );
      await this.support.recordMutation(
        {
          action: AUDIT_POINTS.inventoryTransfer,
          entityType: 'InventoryTransfer',
          entityId: transfer.id,
          metadata: transfer,
          eventName: INVENTORY_WORKFLOW_EVENT_NAMES.transferCompleted,
          successMetricName: 'inventory.stock.transfer.recorded'
        },
        context
      );
      return transfer;
    });
  }

  async linkReceiptToPurchaseOrder(
    input: LinkReceiptToPurchaseOrderRequest,
    context: CommandContext
  ) {
    return this.support.withObservedExecution(
      'inventory.stock.link_receipt_to_purchase_order',
      context,
      async () => {
        this.assertValidation(validateLinkReceiptToPurchaseOrderRequest(input));
        const purchaseOrder = await this.deps.repository.findPurchaseOrderById(input.purchaseOrderId);
        if (!purchaseOrder) {
          throw new InvariantViolationError(`Purchase order not found: ${input.purchaseOrderId}`);
        }
        const purchaseOrderLine = purchaseOrder.lines.find((line) => line.id === input.purchaseOrderLineId);
        if (!purchaseOrderLine) {
          throw new InvariantViolationError(
            `Purchase order line not found: ${input.purchaseOrderLineId}`
          );
        }

        const lot = await this.requireLot(input.lotId);
        if (lot.partSkuId !== purchaseOrderLine.partSkuId) {
          throw new InvariantViolationError('Lot partSkuId does not match purchase order line partSkuId');
        }

        const existingLink =
          (await this.deps.repository.findPurchaseOrderInventoryLink(input.purchaseOrderId)) ??
          {
            purchaseOrderId: input.purchaseOrderId,
            lineStatuses: purchaseOrder.lines.map((line) => ({
              purchaseOrderLineId: line.id,
              orderedQuantity: line.orderedQty,
              receivedQuantity: line.receivedQty,
              linkedLotIds: [] as string[]
            }))
          };
        const lineStatus = existingLink.lineStatuses.find(
          (line) => line.purchaseOrderLineId === input.purchaseOrderLineId
        );
        if (!lineStatus) {
          throw new InvariantViolationError(
            `Purchase order line ${input.purchaseOrderLineId} missing in link status`
          );
        }

        const nextReceived = lineStatus.receivedQuantity + input.quantityReceived;
        if (nextReceived > lineStatus.orderedQuantity) {
          throw new InvariantViolationError(
            `Linked receipt exceeds ordered quantity (${lineStatus.orderedQuantity})`
          );
        }

        lineStatus.receivedQuantity = nextReceived;
        if (!lineStatus.linkedLotIds.includes(input.lotId)) {
          lineStatus.linkedLotIds.push(input.lotId);
        }
        await this.deps.repository.savePurchaseOrderInventoryLink(existingLink);
        // TODO: coordinate this link with procurement PO-line received quantity persistence in one transaction.

        await this.appendLedgerEntry(
          {
            movementType: 'RECEIPT',
            partSkuId: lot.partSkuId,
            locationId: lot.locationId,
            binId: lot.binId,
            lotId: lot.id,
            quantityDelta: 0,
            unitCode: (await this.requirePart(lot.partSkuId)).unitOfMeasure,
            sourceDocument: {
              documentType: 'PURCHASE_ORDER',
              documentId: input.purchaseOrderId,
              lineId: input.purchaseOrderLineId,
              orderedQuantity: lineStatus.orderedQuantity,
              receivedQuantityToDate: lineStatus.receivedQuantity
            }
          },
          context
        );
        await this.support.recordMutation(
          {
            action: AUDIT_POINTS.inventoryPurchaseOrderLink,
            entityType: 'PurchaseOrder',
            entityId: input.purchaseOrderId,
            metadata: {
              purchaseOrderId: input.purchaseOrderId,
              purchaseOrderLineId: input.purchaseOrderLineId,
              lotId: input.lotId,
              quantityReceived: input.quantityReceived
            },
            eventName: INVENTORY_WORKFLOW_EVENT_NAMES.purchaseOrderLinked,
            successMetricName: 'inventory.stock.purchase_order.linked'
          },
          context
        );
        return existingLink;
      }
    );
  }

  private async resolveTransferSourceLot(
    input: RecordInventoryTransferRequest
  ): Promise<InventoryLot> {
    if (input.lotId) {
      const lot = await this.requireLot(input.lotId);
      if (lot.partSkuId !== input.partSkuId) {
        throw new InvariantViolationError(`Lot ${input.lotId} does not belong to part ${input.partSkuId}`);
      }
      if (lot.locationId !== input.fromLocationId) {
        throw new InvariantViolationError(
          `Lot ${input.lotId} location mismatch: expected ${input.fromLocationId}, got ${lot.locationId}`
        );
      }
      if (input.fromBinId && lot.binId !== input.fromBinId) {
        throw new InvariantViolationError(
          `Lot ${input.lotId} bin mismatch: expected ${input.fromBinId}, got ${lot.binId}`
        );
      }
      return lot;
    }

    const lots = await this.deps.repository.listLots();
    const candidate = lots.find((lot) => {
      if (lot.partSkuId !== input.partSkuId || lot.locationId !== input.fromLocationId) {
        return false;
      }
      if (input.fromBinId && lot.binId !== input.fromBinId) {
        return false;
      }
      return lot.quantityOnHand === input.quantity && lot.quantityReserved === 0;
    });
    if (!candidate) {
      throw new InvariantViolationError(
        'No matching unreserved lot found for full-quantity transfer in MVP mode'
      );
    }
    return candidate;
  }

  private async releaseReservationQuantity(lotId: string, quantity: number): Promise<void> {
    const reservations = await this.deps.repository.listReservationsByLot(lotId);
    if (reservations.length === 0) {
      return;
    }

    let remaining = quantity;
    const now = new Date().toISOString();
    for (const reservation of reservations) {
      if (remaining === 0 || reservation.state !== 'ACTIVE') {
        continue;
      }
      const releasable = reservation.quantity - reservation.allocatedQuantity;
      if (releasable <= 0) {
        continue;
      }
      const delta = Math.min(releasable, remaining);
      const nextQuantity = reservation.quantity - delta;
      await this.deps.repository.saveReservation({
        ...reservation,
        quantity: nextQuantity,
        state: nextQuantity === 0 && reservation.allocatedQuantity === 0 ? 'RELEASED' : reservation.state,
        updatedAt: now
      });
      remaining -= delta;
    }

    if (remaining > 0) {
      throw new InvariantViolationError(
        'Release request exceeds releasable quantity (allocated reservations must be deallocated first)'
      );
    }
  }

  private async consumeReservationQuantity(
    lotId: string,
    quantity: number,
    allowAllocated: boolean,
    workOrderId?: string
  ): Promise<void> {
    const reservations = await this.deps.repository.listReservationsByLot(lotId);
    let remaining = quantity;
    const now = new Date().toISOString();

    for (const reservation of reservations) {
      if (remaining === 0 || reservation.state !== 'ACTIVE') {
        continue;
      }
      if (workOrderId && reservation.workOrderId && reservation.workOrderId !== workOrderId) {
        continue;
      }

      const limit = allowAllocated ? reservation.quantity : reservation.quantity - reservation.allocatedQuantity;
      if (limit <= 0) {
        continue;
      }
      const consumed = Math.min(limit, remaining);
      const allocatedConsumed = allowAllocated ? Math.min(reservation.allocatedQuantity, consumed) : 0;
      const nextQuantity = reservation.quantity - consumed;
      const nextAllocated = reservation.allocatedQuantity - allocatedConsumed;
      await this.deps.repository.saveReservation({
        ...reservation,
        quantity: nextQuantity,
        allocatedQuantity: nextAllocated,
        state: nextQuantity === 0 && nextAllocated === 0 ? 'CONSUMED' : reservation.state,
        updatedAt: now
      });
      remaining -= consumed;
    }

    if (remaining > 0) {
      throw new InvariantViolationError('Insufficient reservation records to satisfy consume quantity');
    }
  }

  private async consumeFromAllocationReservation(
    reservationId: string,
    quantity: number
  ): Promise<void> {
    const reservation = await this.deps.repository.findReservationById(reservationId);
    if (!reservation) {
      return;
    }
    if (reservation.allocatedQuantity < quantity || reservation.quantity < quantity) {
      throw new InvariantViolationError(
        `Reservation ${reservationId} cannot absorb allocation consumption quantity ${quantity}`
      );
    }
    const nextAllocated = reservation.allocatedQuantity - quantity;
    const nextQuantity = reservation.quantity - quantity;
    await this.deps.repository.saveReservation({
      ...reservation,
      allocatedQuantity: nextAllocated,
      quantity: nextQuantity,
      state: nextQuantity === 0 && nextAllocated === 0 ? 'CONSUMED' : reservation.state,
      updatedAt: new Date().toISOString()
    });
  }

  private determineLotStateAfterConsumption(
    lot: InventoryLot,
    nextOnHand: number,
    nextReserved: number
  ): InventoryLotState {
    if (nextOnHand === 0) {
      assertTransitionAllowed(lot.state, InventoryLotState.CONSUMED, InventoryLotDesign.lifecycle);
      return InventoryLotState.CONSUMED;
    }
    if (nextReserved > 0) {
      return InventoryLotState.RESERVED;
    }
    return InventoryLotState.AVAILABLE;
  }

  private async applyBalanceDelta(
    locator: {
      partSkuId: string;
      locationId: string;
      binId?: string;
      lotId?: string;
      unitCode: string;
    },
    delta: BalanceDelta
  ): Promise<InventoryBalanceRecord> {
    const existing = await this.deps.repository.findBalance(
      locator.partSkuId,
      locator.locationId,
      locator.binId,
      locator.lotId
    );
    const baseline = existing ?? this.buildEmptyBalance(locator);
    const nextOnHand = baseline.quantity.onHand + (delta.onHand ?? 0);
    const nextReserved = baseline.quantity.reserved + (delta.reserved ?? 0);
    const nextAllocated = baseline.quantity.allocated + (delta.allocated ?? 0);
    const nextConsumed = baseline.quantity.consumed + (delta.consumed ?? 0);

    if (nextOnHand < 0 || nextReserved < 0 || nextAllocated < 0 || nextConsumed < 0) {
      throw new InvariantViolationError('Balance update produced negative inventory quantity');
    }
    if (nextReserved + nextAllocated > nextOnHand) {
      throw new InvariantViolationError('Balance update produced reserved + allocated > onHand');
    }

    const updated: InventoryBalanceRecord = {
      ...baseline,
      quantity: {
        ...baseline.quantity,
        onHand: nextOnHand,
        reserved: nextReserved,
        allocated: nextAllocated,
        consumed: nextConsumed,
        available: nextOnHand - nextReserved - nextAllocated,
        asOf: new Date().toISOString()
      }
    };
    await this.deps.repository.saveBalance(updated);
    return updated;
  }

  private buildEmptyBalance(locator: {
    partSkuId: string;
    locationId: string;
    binId?: string;
    lotId?: string;
    unitCode: string;
  }): InventoryBalanceRecord {
    return {
      partSkuId: locator.partSkuId,
      locationId: locator.locationId,
      binId: locator.binId,
      lotId: locator.lotId,
      quantity: {
        unitCode: locator.unitCode,
        onHand: 0,
        reserved: 0,
        allocated: 0,
        consumed: 0,
        available: 0,
        asOf: new Date().toISOString()
      }
    };
  }

  private async appendLedgerEntry(
    input: LedgerWriteInput,
    context: CommandContext
  ): Promise<InventoryLedgerEntryContract> {
    const now = new Date().toISOString();
    const entry: InventoryLedgerEntryContract = {
      id: randomUUID(),
      movementType: input.movementType,
      partSkuId: input.partSkuId,
      locationId: input.locationId,
      binId: input.binId,
      lotId: input.lotId,
      quantityDelta: input.quantityDelta,
      unitCode: input.unitCode,
      sourceDocument: input.sourceDocument,
      correlationId: context.correlationId,
      effectiveAt: now,
      recordedAt: now
    };
    await this.deps.repository.appendLedgerEntry(entry);
    await this.support.emitEvent(
      INVENTORY_WORKFLOW_EVENT_NAMES.ledgerEntryRecorded,
      {
        ledgerEntryId: entry.id,
        movementType: entry.movementType,
        partSkuId: entry.partSkuId,
        quantityDelta: entry.quantityDelta,
        locationId: entry.locationId,
        binId: entry.binId,
        correlationId: context.correlationId
      },
      context
    );
    this.deps.observability.metric('inventory.ledger.appended', 1, context);
    // TODO: execute this append in the same DB transaction as inventory mutations in the persistent repository.
    return entry;
  }

  private toReservationSourceDocument(
    input: ReserveInventoryRequest,
    reservationId: string
  ): InventoryDocumentReference {
    if (input.workOrderId) {
      return {
        documentType: 'WORK_ORDER',
        documentId: input.workOrderId,
        lineId: reservationId,
        externalReference: input.demandReference
      };
    }
    return {
      documentType: 'MANUAL',
      documentId: reservationId,
      externalReference: input.demandReference
    };
  }

  private toAllocationSourceDocument(
    targetType: 'WORK_ORDER' | 'KIT' | 'TRANSFER',
    targetId: string,
    allocationId: string
  ): InventoryDocumentReference {
    if (targetType === 'WORK_ORDER') {
      return {
        documentType: 'WORK_ORDER',
        documentId: targetId,
        lineId: allocationId
      };
    }
    if (targetType === 'TRANSFER') {
      return {
        documentType: 'TRANSFER',
        documentId: targetId,
        lineId: allocationId
      };
    }
    return {
      documentType: 'MANUAL',
      documentId: allocationId,
      externalReference: `KIT:${targetId}`
    };
  }

  private assertValidation(result: InventoryValidationResult): void {
    if (result.ok) {
      return;
    }
    const message = result.issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ');
    throw new InvariantViolationError(message);
  }

  private async requirePart(partSkuId: string, activeOnly = false): Promise<PartSku> {
    const part = await this.deps.repository.findPartSkuById(partSkuId);
    if (!part) {
      throw new InvariantViolationError(`Part SKU not found: ${partSkuId}`);
    }
    if (activeOnly && part.state !== PartSkuState.ACTIVE) {
      throw new InvariantViolationError(`Part SKU ${partSkuId} is not ACTIVE`);
    }
    return part;
  }

  private async requireLot(lotId: string): Promise<InventoryLot> {
    const lot = await this.deps.repository.findLotById(lotId);
    if (!lot) {
      throw new InvariantViolationError(`Inventory lot not found: ${lotId}`);
    }
    return lot;
  }
}
