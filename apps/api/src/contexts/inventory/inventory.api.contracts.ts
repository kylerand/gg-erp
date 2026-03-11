import type {
  InventoryLot,
  PartSku
} from '../../../../../packages/domain/src/model/inventory.js';

export type InventoryRouteActorParams = [correlationId: string, actorId?: string];

export interface InventoryRequestContext {
  correlationId: string;
  actorId?: string;
  idempotencyKey?: string;
}

export interface CreatePartSkuRequest {
  sku: string;
  name: string;
  description?: string;
  unitOfMeasure: PartSku['unitOfMeasure'];
  reorderPoint: number;
}

export interface UpdatePartSkuRequest {
  partSkuId: string;
  name?: string;
  description?: string;
  reorderPoint?: number;
  state?: PartSku['state'];
}

export interface PartSubstitutionContract {
  id: string;
  partSkuId: string;
  substitutePartSkuId: string;
  priority: number;
  reasonCode?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  state: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface ConfigurePartSubstitutionRequest {
  partSkuId: string;
  substitutePartSkuId: string;
  priority: number;
  reasonCode?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export type InventoryRoundingMode = 'NONE' | 'UP' | 'DOWN' | 'NEAREST';

export interface UnitOfMeasureContract {
  code: string;
  name: string;
  precisionScale: number;
  state: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface UpsertUnitOfMeasureRequest {
  code: string;
  name: string;
  precisionScale: number;
  state?: UnitOfMeasureContract['state'];
}

export interface UnitOfMeasureConversionContract {
  id: string;
  partSkuId?: string;
  fromUnitCode: string;
  toUnitCode: string;
  factor: number;
  roundingMode: InventoryRoundingMode;
  state: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface UpsertUnitConversionRequest {
  partSkuId?: string;
  fromUnitCode: string;
  toUnitCode: string;
  factor: number;
  roundingMode: InventoryRoundingMode;
  state?: UnitOfMeasureConversionContract['state'];
}

export interface InventoryLocationContract {
  id: string;
  code: string;
  name: string;
  zone: string;
  locationType: 'WAREHOUSE' | 'WORKSHOP' | 'VAN' | 'STAGING';
  isPickable: boolean;
  state: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface CreateLocationRequest {
  code: string;
  name: string;
  zone: string;
  locationType: InventoryLocationContract['locationType'];
  isPickable?: boolean;
}

export interface InventoryBinContract {
  id: string;
  locationId: string;
  code: string;
  state: 'OPEN' | 'QUARANTINED' | 'CLOSED';
  capacityUnits?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBinRequest {
  locationId: string;
  code: string;
  state?: InventoryBinContract['state'];
  capacityUnits?: number;
}

export interface InventoryQuantitySnapshot {
  unitCode: string;
  onHand: number;
  reserved: number;
  allocated: number;
  consumed: number;
  available: number;
  asOf: string;
}

export interface InventoryBalanceRecord {
  partSkuId: string;
  locationId: string;
  binId?: string;
  lotId?: string;
  quantity: InventoryQuantitySnapshot;
}

export interface InventoryDocumentReference {
  documentType:
    | 'PURCHASE_ORDER'
    | 'WORK_ORDER'
    | 'TRANSFER'
    | 'ADJUSTMENT'
    | 'CYCLE_COUNT'
    | 'MANUAL';
  documentId: string;
  lineId?: string;
  orderedQuantity?: number;
  receivedQuantityToDate?: number;
  externalReference?: string;
}

export interface ReceiveLotRequest {
  lotNumber: string;
  partSkuId: string;
  locationId: string;
  binId: string;
  quantityOnHand: number;
  receivedUnitCode?: string;
  expiresAt?: string;
  sourceDocument?: InventoryDocumentReference;
}

export interface ReserveInventoryRequest {
  lotId: string;
  quantity: number;
  workOrderId?: string;
  demandReference?: string;
}

export interface ReleaseInventoryRequest {
  lotId: string;
  quantity: number;
  reasonCode?: string;
}

export interface AllocateInventoryRequest {
  reservationId: string;
  quantity: number;
  targetType: 'WORK_ORDER' | 'KIT' | 'TRANSFER';
  targetId: string;
  locationId?: string;
  binId?: string;
}

export interface InventoryAllocationContract {
  id: string;
  reservationId: string;
  quantity: number;
  targetType: AllocateInventoryRequest['targetType'];
  targetId: string;
  createdAt: string;
}

export interface ConsumeWorkOrderMaterialRequest {
  lotId: string;
  quantity: number;
  workOrderId: string;
  workOrderOperationId?: string;
  allocationId?: string;
}

export interface WorkOrderConsumptionContract {
  id: string;
  workOrderId: string;
  workOrderOperationId?: string;
  partSkuId: string;
  lotId?: string;
  quantity: number;
  unitCode: string;
  consumedAt: string;
}

export interface RecordInventoryAdjustmentRequest {
  partSkuId: string;
  locationId: string;
  binId?: string;
  lotId?: string;
  quantityDelta: number;
  reasonCode: string;
  note?: string;
}

export interface InventoryAdjustmentContract {
  id: string;
  reasonCode: string;
  note?: string;
  quantityDelta: number;
  postedAt: string;
  balanceAfter: InventoryBalanceRecord;
}

export interface RecordInventoryTransferRequest {
  partSkuId: string;
  lotId?: string;
  quantity: number;
  fromLocationId: string;
  fromBinId?: string;
  toLocationId: string;
  toBinId?: string;
  reasonCode?: string;
}

export interface InventoryTransferContract {
  id: string;
  partSkuId: string;
  lotId?: string;
  quantity: number;
  fromLocationId: string;
  fromBinId?: string;
  toLocationId: string;
  toBinId?: string;
  completedAt: string;
}

export interface StartCycleCountSessionRequest {
  locationId: string;
  binId?: string;
  partSkuIds?: string[];
}

export interface CycleCountSessionContract {
  id: string;
  locationId: string;
  binId?: string;
  status: 'OPEN' | 'RECONCILED';
  startedAt: string;
  completedAt?: string;
}

export interface CycleCountReconciliationLine {
  partSkuId: string;
  lotId?: string;
  expectedQuantity: number;
  countedQuantity: number;
  reasonCode?: string;
}

export interface ReconcileCycleCountRequest {
  sessionId: string;
  lines: CycleCountReconciliationLine[];
  tolerancePercent?: number;
  supervisorOverrideActorId?: string;
}

export interface CycleCountReconciliationContract {
  sessionId: string;
  varianceCount: number;
  netQuantityDelta: number;
  adjustmentIds: string[];
  completedAt: string;
}

export interface WorkOrderMaterialStatusLine {
  partSkuId: string;
  requested: number;
  reserved: number;
  allocated: number;
  consumed: number;
  unitCode: string;
}

export interface WorkOrderMaterialStatusContract {
  workOrderId: string;
  lines: WorkOrderMaterialStatusLine[];
}

export interface LinkReceiptToPurchaseOrderRequest {
  purchaseOrderId: string;
  purchaseOrderLineId: string;
  lotId: string;
  quantityReceived: number;
}

export interface PurchaseOrderReceiptLineStatus {
  purchaseOrderLineId: string;
  orderedQuantity: number;
  receivedQuantity: number;
  linkedLotIds: string[];
}

export interface PurchaseOrderInventoryLinkContract {
  purchaseOrderId: string;
  lineStatuses: PurchaseOrderReceiptLineStatus[];
}

export type InventoryMovementType =
  | 'RECEIPT'
  | 'RESERVATION'
  | 'ALLOCATION'
  | 'RELEASE'
  | 'ISSUE'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'ADJUSTMENT'
  | 'CYCLE_COUNT';

export interface InventoryLedgerQuery {
  partSkuId?: string;
  locationId?: string;
  binId?: string;
  lotId?: string;
  movementTypes?: InventoryMovementType[];
  sourceDocumentId?: string;
  correlationId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  cursor?: string;
  limit?: number;
}

export interface InventoryLedgerEntryContract {
  id: string;
  movementType: InventoryMovementType;
  partSkuId: string;
  locationId: string;
  binId?: string;
  lotId?: string;
  quantityDelta: number;
  unitCode: string;
  sourceDocument?: InventoryDocumentReference;
  correlationId: string;
  effectiveAt: string;
  recordedAt: string;
}

export interface InventoryLedgerQueryResponse {
  entries: InventoryLedgerEntryContract[];
  nextCursor?: string;
}

export interface InventoryBalanceQuery {
  partSkuId?: string;
  locationId?: string;
  binId?: string;
  lotId?: string;
}

export interface InventoryApiRouteContract {
  createPartSku(
    input: CreatePartSkuRequest,
    ...context: InventoryRouteActorParams
  ): Promise<PartSku>;
  updatePartSku(
    input: UpdatePartSkuRequest,
    ...context: InventoryRouteActorParams
  ): Promise<PartSku>;
  configurePartSubstitution(
    input: ConfigurePartSubstitutionRequest,
    ...context: InventoryRouteActorParams
  ): Promise<PartSubstitutionContract>;
  listPartSubstitutions(
    partSkuId: string,
    ...context: InventoryRouteActorParams
  ): Promise<PartSubstitutionContract[]>;
  upsertUnitOfMeasure(
    input: UpsertUnitOfMeasureRequest,
    ...context: InventoryRouteActorParams
  ): Promise<UnitOfMeasureContract>;
  upsertUnitConversion(
    input: UpsertUnitConversionRequest,
    ...context: InventoryRouteActorParams
  ): Promise<UnitOfMeasureConversionContract>;
  createLocation(
    input: CreateLocationRequest,
    ...context: InventoryRouteActorParams
  ): Promise<InventoryLocationContract>;
  createBin(
    input: CreateBinRequest,
    ...context: InventoryRouteActorParams
  ): Promise<InventoryBinContract>;
  receiveLot(
    input: ReceiveLotRequest,
    ...context: InventoryRouteActorParams
  ): Promise<InventoryLot>;
  reserveLot(
    lotId: string,
    quantity: number,
    ...context: InventoryRouteActorParams
  ): Promise<InventoryLot>;
  allocateReservation(
    input: AllocateInventoryRequest,
    ...context: InventoryRouteActorParams
  ): Promise<InventoryAllocationContract>;
  releaseLot(
    lotId: string,
    quantity: number,
    ...context: InventoryRouteActorParams
  ): Promise<InventoryLot>;
  consumeLot(
    lotId: string,
    quantity: number,
    ...context: InventoryRouteActorParams
  ): Promise<InventoryLot>;
  consumeWorkOrderMaterial(
    input: ConsumeWorkOrderMaterialRequest,
    ...context: InventoryRouteActorParams
  ): Promise<WorkOrderConsumptionContract>;
  recordAdjustment(
    input: RecordInventoryAdjustmentRequest,
    ...context: InventoryRouteActorParams
  ): Promise<InventoryAdjustmentContract>;
  recordTransfer(
    input: RecordInventoryTransferRequest,
    ...context: InventoryRouteActorParams
  ): Promise<InventoryTransferContract>;
  startCycleCount(
    input: StartCycleCountSessionRequest,
    ...context: InventoryRouteActorParams
  ): Promise<CycleCountSessionContract>;
  reconcileCycleCount(
    input: ReconcileCycleCountRequest,
    ...context: InventoryRouteActorParams
  ): Promise<CycleCountReconciliationContract>;
  linkReceiptToPurchaseOrder(
    input: LinkReceiptToPurchaseOrderRequest,
    ...context: InventoryRouteActorParams
  ): Promise<PurchaseOrderInventoryLinkContract>;
  getBalances(
    query: InventoryBalanceQuery,
    ...context: InventoryRouteActorParams
  ): Promise<InventoryBalanceRecord[]>;
  getWorkOrderMaterialStatus(
    workOrderId: string,
    ...context: InventoryRouteActorParams
  ): Promise<WorkOrderMaterialStatusContract>;
  getPurchaseOrderReceiptStatus(
    purchaseOrderId: string,
    ...context: InventoryRouteActorParams
  ): Promise<PurchaseOrderInventoryLinkContract>;
  queryLedger(
    query: InventoryLedgerQuery,
    ...context: InventoryRouteActorParams
  ): Promise<InventoryLedgerQueryResponse>;
}

export type InventoryImplementedRouteMethodNames =
  | 'createPartSku'
  | 'receiveLot'
  | 'reserveLot'
  | 'releaseLot'
  | 'consumeLot';

export type InventoryImplementedRouteContract = Pick<
  InventoryApiRouteContract,
  InventoryImplementedRouteMethodNames
>;
