import type {
  DomainEvent,
  DomainEventName
} from '../../../../../packages/domain/src/events.js';
import type {
  InventoryDocumentReference,
  InventoryLedgerQuery,
  InventoryMovementType,
  InventoryQuantitySnapshot
} from './inventory.api.contracts.js';

export const INVENTORY_WORKFLOW_EVENT_NAMES = {
  partSkuCreated: 'part.sku.created',
  partSkuUpdated: 'part.sku.updated',
  partSubstitutionConfigured: 'inventory.part_substitution_configured',
  partSubstitutionUsed: 'inventory.part_substitution_used',
  lotReceived: 'inventory.lot.received',
  lotReserved: 'inventory.lot.reserved',
  reservationAllocated: 'inventory.reservation_allocated',
  lotReleased: 'inventory.lot.released',
  lotConsumed: 'inventory.lot.consumed',
  shortageDetected: 'inventory.shortage_detected',
  uomConversionApplied: 'inventory.uom_conversion_applied',
  adjustmentRecorded: 'inventory.adjustment_recorded',
  transferCompleted: 'inventory.transfer_completed',
  cycleCountStarted: 'inventory.cycle_count_started',
  cycleCountCompleted: 'inventory.cycle_count_completed',
  workOrderConsumptionRecorded: 'inventory.work_order_consumption_recorded',
  purchaseOrderLinked: 'inventory.purchase_order_linked',
  ledgerEntryRecorded: 'inventory.ledger_entry_recorded',
  ledgerQueried: 'inventory.ledger_queried'
} as const;

export type InventoryWorkflowEventName =
  (typeof INVENTORY_WORKFLOW_EVENT_NAMES)[keyof typeof INVENTORY_WORKFLOW_EVENT_NAMES];

export interface PartSkuCreatedEventPayload {
  partSkuId: string;
  sku: string;
  unitOfMeasure: string;
  reorderPoint: number;
  state: string;
}

export interface PartSkuUpdatedEventPayload {
  partSkuId: string;
  changedFields: string[];
  state: string;
}

export interface PartSubstitutionConfiguredEventPayload {
  partSkuId: string;
  substitutePartSkuId: string;
  priority: number;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface PartSubstitutionUsedEventPayload {
  partSkuId: string;
  substitutePartSkuId: string;
  workOrderId: string;
  quantity: number;
}

export interface InventoryLotReceivedEventPayload {
  lotId: string;
  lotNumber: string;
  partSkuId: string;
  locationId: string;
  binId: string;
  quantityOnHand: number;
  sourceDocument?: InventoryDocumentReference;
}

export interface InventoryLotReservedEventPayload {
  reservationId: string;
  lotId: string;
  partSkuId: string;
  quantity: number;
  workOrderId?: string;
}

export interface InventoryReservationAllocatedEventPayload {
  reservationId: string;
  allocationId: string;
  targetType: 'WORK_ORDER' | 'KIT' | 'TRANSFER';
  targetId: string;
  quantity: number;
}

export interface InventoryLotReleasedEventPayload {
  reservationId: string;
  lotId: string;
  quantity: number;
  reasonCode?: string;
}

export interface InventoryLotConsumedEventPayload {
  lotId: string;
  partSkuId: string;
  workOrderId: string;
  workOrderOperationId?: string;
  quantity: number;
}

export interface InventoryShortageDetectedEventPayload {
  partSkuId: string;
  locationId?: string;
  requested: number;
  available: number;
  demandReference?: string;
}

export interface UomConversionAppliedEventPayload {
  partSkuId?: string;
  fromUnitCode: string;
  toUnitCode: string;
  inputQuantity: number;
  normalizedQuantity: number;
}

export interface InventoryAdjustmentRecordedEventPayload {
  adjustmentId: string;
  partSkuId: string;
  locationId: string;
  binId?: string;
  quantityDelta: number;
  reasonCode: string;
}

export interface InventoryTransferCompletedEventPayload {
  transferId: string;
  partSkuId: string;
  lotId?: string;
  quantity: number;
  fromLocationId: string;
  toLocationId: string;
  fromBinId?: string;
  toBinId?: string;
}

export interface InventoryCycleCountStartedEventPayload {
  sessionId: string;
  locationId: string;
  binId?: string;
  startedByActorId?: string;
}

export interface InventoryCycleCountCompletedEventPayload {
  sessionId: string;
  locationId: string;
  varianceCount: number;
  netQuantityDelta: number;
}

export interface WorkOrderConsumptionRecordedEventPayload {
  consumptionId: string;
  workOrderId: string;
  workOrderOperationId?: string;
  partSkuId: string;
  lotId?: string;
  quantity: number;
}

export interface PurchaseOrderLinkedEventPayload {
  purchaseOrderId: string;
  purchaseOrderLineId: string;
  lotId: string;
  quantityReceived: number;
}

export interface InventoryLedgerEntryRecordedEventPayload {
  ledgerEntryId: string;
  movementType: InventoryMovementType;
  partSkuId: string;
  quantityDelta: number;
  locationId: string;
  binId?: string;
  correlationId: string;
  quantityAfter?: InventoryQuantitySnapshot;
}

export interface InventoryLedgerQueriedEventPayload {
  query: InventoryLedgerQuery;
  resultCount: number;
}

export interface InventoryWorkflowEventPayloadByName {
  [INVENTORY_WORKFLOW_EVENT_NAMES.partSkuCreated]: PartSkuCreatedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.partSkuUpdated]: PartSkuUpdatedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.partSubstitutionConfigured]: PartSubstitutionConfiguredEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.partSubstitutionUsed]: PartSubstitutionUsedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.lotReceived]: InventoryLotReceivedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.lotReserved]: InventoryLotReservedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.reservationAllocated]: InventoryReservationAllocatedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.lotReleased]: InventoryLotReleasedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.lotConsumed]: InventoryLotConsumedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.shortageDetected]: InventoryShortageDetectedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.uomConversionApplied]: UomConversionAppliedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.adjustmentRecorded]: InventoryAdjustmentRecordedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.transferCompleted]: InventoryTransferCompletedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.cycleCountStarted]: InventoryCycleCountStartedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.cycleCountCompleted]: InventoryCycleCountCompletedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.workOrderConsumptionRecorded]: WorkOrderConsumptionRecordedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.purchaseOrderLinked]: PurchaseOrderLinkedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.ledgerEntryRecorded]: InventoryLedgerEntryRecordedEventPayload;
  [INVENTORY_WORKFLOW_EVENT_NAMES.ledgerQueried]: InventoryLedgerQueriedEventPayload;
}

export type InventoryWorkflowEventPayload<
  TName extends InventoryWorkflowEventName = InventoryWorkflowEventName
> = InventoryWorkflowEventPayloadByName[TName];

export type InventoryWorkflowEvent<
  TName extends InventoryWorkflowEventName = InventoryWorkflowEventName
> = Omit<DomainEvent<InventoryWorkflowEventPayload<TName>>, 'name' | 'payload'> & {
  name: TName;
  payload: InventoryWorkflowEventPayload<TName>;
};

export type InventoryWorkflowDomainEventName = Extract<DomainEventName, InventoryWorkflowEventName>;
