import { WorkOrderState } from '../../../../../packages/domain/src/model/buildPlanning.js';
import type {
  CreateWorkOrderRequest,
  ListWorkOrdersQuery,
} from './workOrder.contracts.js';

export type WorkOrderValidationRuleId =
  | 'WO-VAL-001'
  | 'WO-VAL-002'
  | 'WO-VAL-003'
  | 'WO-VAL-004';

export interface WorkOrderValidationIssue {
  ruleId: WorkOrderValidationRuleId;
  field: string;
  message: string;
}

export interface WorkOrderValidationResult {
  ok: boolean;
  issues: WorkOrderValidationIssue[];
}

export function validateCreateWorkOrderRequest(
  input: CreateWorkOrderRequest,
): WorkOrderValidationResult {
  const issues: WorkOrderValidationIssue[] = [];

  requireTrimmed(
    input.workOrderNumber,
    'workOrderNumber',
    'WO-VAL-001',
    'workOrderNumber is required.',
    issues,
  );
  requireTrimmed(input.vehicleId, 'vehicleId', 'WO-VAL-001', 'vehicleId is required.', issues);
  requireTrimmed(
    input.buildConfigurationId,
    'buildConfigurationId',
    'WO-VAL-001',
    'buildConfigurationId is required.',
    issues,
  );
  requireTrimmed(input.bomId, 'bomId', 'WO-VAL-001', 'bomId is required.', issues);

  validateIsoTimestamp(input.scheduledStartAt, 'scheduledStartAt', 'WO-VAL-002', issues);
  validateIsoTimestamp(input.scheduledEndAt, 'scheduledEndAt', 'WO-VAL-002', issues);

  if (
    input.scheduledStartAt &&
    input.scheduledEndAt &&
    !Number.isNaN(Date.parse(input.scheduledStartAt)) &&
    !Number.isNaN(Date.parse(input.scheduledEndAt)) &&
    Date.parse(input.scheduledStartAt) > Date.parse(input.scheduledEndAt)
  ) {
    issues.push({
      ruleId: 'WO-VAL-002',
      field: 'scheduledStartAt',
      message: 'scheduledStartAt cannot be after scheduledEndAt.',
    });
  }

  return buildResult(issues);
}

export function validateListWorkOrdersQuery(query: ListWorkOrdersQuery): WorkOrderValidationResult {
  const issues: WorkOrderValidationIssue[] = [];

  if (query.state && !Object.values(WorkOrderState).includes(query.state)) {
    issues.push({
      ruleId: 'WO-VAL-003',
      field: 'state',
      message: `state must be one of: ${Object.values(WorkOrderState).join(', ')}`,
    });
  }

  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit <= 0)) {
    issues.push({
      ruleId: 'WO-VAL-004',
      field: 'limit',
      message: 'limit must be a positive integer.',
    });
  }

  if (query.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0)) {
    issues.push({
      ruleId: 'WO-VAL-004',
      field: 'offset',
      message: 'offset must be a non-negative integer.',
    });
  }

  return buildResult(issues);
}

function validateIsoTimestamp(
  value: string | undefined,
  field: string,
  ruleId: WorkOrderValidationRuleId,
  issues: WorkOrderValidationIssue[],
): void {
  if (value && Number.isNaN(Date.parse(value))) {
    issues.push({
      ruleId,
      field,
      message: `${field} must be an ISO-8601 timestamp.`,
    });
  }
}

function requireTrimmed(
  value: string | undefined,
  field: string,
  ruleId: WorkOrderValidationRuleId,
  message: string,
  issues: WorkOrderValidationIssue[],
): void {
  if (!value?.trim()) {
    issues.push({ ruleId, field, message });
  }
}

function buildResult(issues: WorkOrderValidationIssue[]): WorkOrderValidationResult {
  return {
    ok: issues.length === 0,
    issues,
  };
}
