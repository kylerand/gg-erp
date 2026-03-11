import type {
  ConfigurePartSubstitutionRequest,
  ConsumeWorkOrderMaterialRequest,
  CreatePartSkuRequest,
  InventoryLedgerQuery,
  InventoryQuantitySnapshot,
  LinkReceiptToPurchaseOrderRequest,
  ReceiveLotRequest,
  ReconcileCycleCountRequest,
  RecordInventoryAdjustmentRequest,
  RecordInventoryTransferRequest,
  UpsertUnitConversionRequest,
  UpsertUnitOfMeasureRequest
} from './inventory.api.contracts.js';

export type InventoryValidationRuleId =
  | 'INV-VAL-001'
  | 'INV-VAL-002'
  | 'INV-VAL-003'
  | 'INV-VAL-004'
  | 'INV-VAL-005'
  | 'INV-VAL-006'
  | 'INV-VAL-007'
  | 'INV-VAL-008'
  | 'INV-VAL-009'
  | 'INV-VAL-010'
  | 'INV-VAL-011'
  | 'INV-VAL-012';

export interface InventoryValidationIssue {
  ruleId: InventoryValidationRuleId;
  field: string;
  message: string;
}

export interface InventoryValidationResult {
  ok: boolean;
  issues: InventoryValidationIssue[];
}

export function validateCreatePartSkuRequest(input: CreatePartSkuRequest): InventoryValidationResult {
  const issues: InventoryValidationIssue[] = [];
  requireTrimmed(input.sku, 'sku', 'INV-VAL-001', 'SKU is required.', issues);
  requireTrimmed(input.name, 'name', 'INV-VAL-001', 'Part name is required.', issues);
  requireNonNegative(input.reorderPoint, 'reorderPoint', 'INV-VAL-001', issues);
  return buildResult(issues);
}

export function validateConfigurePartSubstitutionRequest(
  input: ConfigurePartSubstitutionRequest
): InventoryValidationResult {
  const issues: InventoryValidationIssue[] = [];
  requireTrimmed(input.partSkuId, 'partSkuId', 'INV-VAL-002', 'partSkuId is required.', issues);
  requireTrimmed(
    input.substitutePartSkuId,
    'substitutePartSkuId',
    'INV-VAL-002',
    'substitutePartSkuId is required.',
    issues
  );
  if (
    input.partSkuId.trim() &&
    input.substitutePartSkuId.trim() &&
    input.partSkuId.trim() === input.substitutePartSkuId.trim()
  ) {
    issues.push({
      ruleId: 'INV-VAL-002',
      field: 'substitutePartSkuId',
      message: 'Part cannot be configured as its own substitute.'
    });
  }
  if (!Number.isInteger(input.priority) || input.priority <= 0) {
    issues.push({
      ruleId: 'INV-VAL-002',
      field: 'priority',
      message: 'priority must be a positive integer.'
    });
  }
  return buildResult(issues);
}

export function validateUpsertUnitOfMeasureRequest(
  input: UpsertUnitOfMeasureRequest
): InventoryValidationResult {
  const issues: InventoryValidationIssue[] = [];
  requireTrimmed(input.code, 'code', 'INV-VAL-003', 'Unit code is required.', issues);
  requireTrimmed(input.name, 'name', 'INV-VAL-003', 'Unit name is required.', issues);
  if (!Number.isInteger(input.precisionScale) || input.precisionScale < 0) {
    issues.push({
      ruleId: 'INV-VAL-003',
      field: 'precisionScale',
      message: 'precisionScale must be an integer >= 0.'
    });
  }
  return buildResult(issues);
}

export function validateUpsertUnitConversionRequest(
  input: UpsertUnitConversionRequest
): InventoryValidationResult {
  const issues: InventoryValidationIssue[] = [];
  requireTrimmed(input.fromUnitCode, 'fromUnitCode', 'INV-VAL-003', 'fromUnitCode is required.', issues);
  requireTrimmed(input.toUnitCode, 'toUnitCode', 'INV-VAL-003', 'toUnitCode is required.', issues);
  if (input.fromUnitCode.trim() && input.toUnitCode.trim() && input.fromUnitCode === input.toUnitCode) {
    issues.push({
      ruleId: 'INV-VAL-003',
      field: 'toUnitCode',
      message: 'toUnitCode must differ from fromUnitCode.'
    });
  }
  requirePositive(input.factor, 'factor', 'INV-VAL-003', issues);
  return buildResult(issues);
}

export function validateReceiveLotRequest(input: ReceiveLotRequest): InventoryValidationResult {
  const issues: InventoryValidationIssue[] = [];
  requireTrimmed(input.lotNumber, 'lotNumber', 'INV-VAL-010', 'lotNumber is required.', issues);
  requireTrimmed(input.partSkuId, 'partSkuId', 'INV-VAL-010', 'partSkuId is required.', issues);
  requireTrimmed(input.locationId, 'locationId', 'INV-VAL-004', 'locationId is required.', issues);
  requireTrimmed(input.binId, 'binId', 'INV-VAL-004', 'binId is required.', issues);
  requirePositive(input.quantityOnHand, 'quantityOnHand', 'INV-VAL-010', issues);

  const source = input.sourceDocument;
  if (source?.documentType === 'PURCHASE_ORDER') {
    requireTrimmed(
      source.lineId,
      'sourceDocument.lineId',
      'INV-VAL-010',
      'lineId is required for PURCHASE_ORDER receipts.',
      issues
    );
    const orderedQty = source.orderedQuantity;
    const receivedQtyToDate = source.receivedQuantityToDate ?? 0;
    if (orderedQty !== undefined && orderedQty < receivedQtyToDate + input.quantityOnHand) {
      issues.push({
        ruleId: 'INV-VAL-010',
        field: 'sourceDocument.orderedQuantity',
        message: 'Purchase-order linked receipt cannot exceed ordered quantity.'
      });
    }
  }

  return buildResult(issues);
}

export function validateInventoryQuantitySnapshot(
  quantity: InventoryQuantitySnapshot
): InventoryValidationResult {
  const issues: InventoryValidationIssue[] = [];
  requireNonNegative(quantity.onHand, 'onHand', 'INV-VAL-005', issues);
  requireNonNegative(quantity.reserved, 'reserved', 'INV-VAL-005', issues);
  requireNonNegative(quantity.allocated, 'allocated', 'INV-VAL-005', issues);
  requireNonNegative(quantity.consumed, 'consumed', 'INV-VAL-006', issues);

  if (quantity.reserved + quantity.allocated > quantity.onHand) {
    issues.push({
      ruleId: 'INV-VAL-005',
      field: 'reserved',
      message: 'reserved + allocated cannot exceed onHand.'
    });
  }
  return buildResult(issues);
}

export function validateConsumeWorkOrderMaterialRequest(
  input: ConsumeWorkOrderMaterialRequest
): InventoryValidationResult {
  const issues: InventoryValidationIssue[] = [];
  requireTrimmed(input.lotId, 'lotId', 'INV-VAL-006', 'lotId is required.', issues);
  requirePositive(input.quantity, 'quantity', 'INV-VAL-006', issues);
  requireTrimmed(input.workOrderId, 'workOrderId', 'INV-VAL-011', 'workOrderId is required.', issues);
  return buildResult(issues);
}

export function validateRecordInventoryAdjustmentRequest(
  input: RecordInventoryAdjustmentRequest
): InventoryValidationResult {
  const issues: InventoryValidationIssue[] = [];
  requireTrimmed(input.partSkuId, 'partSkuId', 'INV-VAL-008', 'partSkuId is required.', issues);
  requireTrimmed(input.locationId, 'locationId', 'INV-VAL-008', 'locationId is required.', issues);
  requireTrimmed(input.reasonCode, 'reasonCode', 'INV-VAL-008', 'reasonCode is required.', issues);
  if (!Number.isFinite(input.quantityDelta) || input.quantityDelta === 0) {
    issues.push({
      ruleId: 'INV-VAL-008',
      field: 'quantityDelta',
      message: 'quantityDelta must be a non-zero numeric value.'
    });
  }
  return buildResult(issues);
}

export function validateRecordInventoryTransferRequest(
  input: RecordInventoryTransferRequest
): InventoryValidationResult {
  const issues: InventoryValidationIssue[] = [];
  requireTrimmed(input.partSkuId, 'partSkuId', 'INV-VAL-007', 'partSkuId is required.', issues);
  requireTrimmed(input.fromLocationId, 'fromLocationId', 'INV-VAL-007', 'fromLocationId is required.', issues);
  requireTrimmed(input.toLocationId, 'toLocationId', 'INV-VAL-007', 'toLocationId is required.', issues);
  requirePositive(input.quantity, 'quantity', 'INV-VAL-007', issues);

  if (input.fromLocationId.trim() && input.fromLocationId === input.toLocationId) {
    const fromBin = input.fromBinId?.trim();
    const toBin = input.toBinId?.trim();
    if (!fromBin || !toBin || fromBin === toBin) {
      issues.push({
        ruleId: 'INV-VAL-007',
        field: 'toBinId',
        message: 'Transfer destination must differ from source.'
      });
    }
  }
  return buildResult(issues);
}

export function validateReconcileCycleCountRequest(
  input: ReconcileCycleCountRequest
): InventoryValidationResult {
  const issues: InventoryValidationIssue[] = [];
  requireTrimmed(input.sessionId, 'sessionId', 'INV-VAL-009', 'sessionId is required.', issues);
  if (input.lines.length === 0) {
    issues.push({
      ruleId: 'INV-VAL-009',
      field: 'lines',
      message: 'At least one cycle count line is required.'
    });
  }
  const tolerancePercent = input.tolerancePercent ?? 0;
  if (tolerancePercent < 0) {
    issues.push({
      ruleId: 'INV-VAL-009',
      field: 'tolerancePercent',
      message: 'tolerancePercent must be >= 0.'
    });
  }

  input.lines.forEach((line, index) => {
    requireTrimmed(
      line.partSkuId,
      `lines[${index}].partSkuId`,
      'INV-VAL-009',
      'partSkuId is required.',
      issues
    );
    if (!Number.isFinite(line.expectedQuantity) || line.expectedQuantity < 0) {
      issues.push({
        ruleId: 'INV-VAL-009',
        field: `lines[${index}].expectedQuantity`,
        message: 'expectedQuantity must be >= 0.'
      });
    }
    if (!Number.isFinite(line.countedQuantity) || line.countedQuantity < 0) {
      issues.push({
        ruleId: 'INV-VAL-009',
        field: `lines[${index}].countedQuantity`,
        message: 'countedQuantity must be >= 0.'
      });
    }

    const absoluteVariance = Math.abs(line.expectedQuantity - line.countedQuantity);
    if (
      line.expectedQuantity > 0 &&
      (absoluteVariance / line.expectedQuantity) * 100 > tolerancePercent &&
      !input.supervisorOverrideActorId?.trim()
    ) {
      issues.push({
        ruleId: 'INV-VAL-009',
        field: `lines[${index}]`,
        message: 'Supervisor override is required for variances above tolerancePercent.'
      });
    }
  });

  return buildResult(issues);
}

export function validateLinkReceiptToPurchaseOrderRequest(
  input: LinkReceiptToPurchaseOrderRequest
): InventoryValidationResult {
  const issues: InventoryValidationIssue[] = [];
  requireTrimmed(
    input.purchaseOrderId,
    'purchaseOrderId',
    'INV-VAL-010',
    'purchaseOrderId is required.',
    issues
  );
  requireTrimmed(
    input.purchaseOrderLineId,
    'purchaseOrderLineId',
    'INV-VAL-010',
    'purchaseOrderLineId is required.',
    issues
  );
  requireTrimmed(input.lotId, 'lotId', 'INV-VAL-010', 'lotId is required.', issues);
  requirePositive(input.quantityReceived, 'quantityReceived', 'INV-VAL-010', issues);
  return buildResult(issues);
}

export function validateInventoryLedgerQuery(query: InventoryLedgerQuery): InventoryValidationResult {
  const issues: InventoryValidationIssue[] = [];
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit <= 0)) {
    issues.push({
      ruleId: 'INV-VAL-012',
      field: 'limit',
      message: 'limit must be a positive integer.'
    });
  }

  if (query.effectiveFrom && Number.isNaN(Date.parse(query.effectiveFrom))) {
    issues.push({
      ruleId: 'INV-VAL-012',
      field: 'effectiveFrom',
      message: 'effectiveFrom must be an ISO-8601 timestamp.'
    });
  }
  if (query.effectiveTo && Number.isNaN(Date.parse(query.effectiveTo))) {
    issues.push({
      ruleId: 'INV-VAL-012',
      field: 'effectiveTo',
      message: 'effectiveTo must be an ISO-8601 timestamp.'
    });
  }
  if (
    query.effectiveFrom &&
    query.effectiveTo &&
    !Number.isNaN(Date.parse(query.effectiveFrom)) &&
    !Number.isNaN(Date.parse(query.effectiveTo)) &&
    Date.parse(query.effectiveFrom) > Date.parse(query.effectiveTo)
  ) {
    issues.push({
      ruleId: 'INV-VAL-012',
      field: 'effectiveFrom',
      message: 'effectiveFrom cannot be after effectiveTo.'
    });
  }
  return buildResult(issues);
}

function buildResult(issues: InventoryValidationIssue[]): InventoryValidationResult {
  return {
    ok: issues.length === 0,
    issues
  };
}

function requireTrimmed(
  value: string | undefined,
  field: string,
  ruleId: InventoryValidationRuleId,
  message: string,
  issues: InventoryValidationIssue[]
): void {
  if (!value?.trim()) {
    issues.push({ ruleId, field, message });
  }
}

function requirePositive(
  value: number,
  field: string,
  ruleId: InventoryValidationRuleId,
  issues: InventoryValidationIssue[]
): void {
  if (!Number.isFinite(value) || value <= 0) {
    issues.push({
      ruleId,
      field,
      message: `${field} must be > 0.`
    });
  }
}

function requireNonNegative(
  value: number,
  field: string,
  ruleId: InventoryValidationRuleId,
  issues: InventoryValidationIssue[]
): void {
  if (!Number.isFinite(value) || value < 0) {
    issues.push({
      ruleId,
      field,
      message: `${field} must be >= 0.`
    });
  }
}
