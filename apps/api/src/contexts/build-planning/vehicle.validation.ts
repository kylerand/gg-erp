import { MODEL_YEAR_CODES } from '../../../../../packages/domain/src/vin/vin-generator.js';
import type { RegisterVehicleRequest } from './vehicle.contracts.js';

export type VehicleValidationRuleId =
  | 'VEH-VAL-001'
  | 'VEH-VAL-002'
  | 'VEH-VAL-003'
  | 'VEH-VAL-004';

export interface VehicleValidationIssue {
  ruleId: VehicleValidationRuleId;
  field: string;
  message: string;
}

export interface VehicleValidationResult {
  ok: boolean;
  issues: VehicleValidationIssue[];
}

const SUPPORTED_YEARS = Object.keys(MODEL_YEAR_CODES).map(Number);
const MIN_YEAR = Math.min(...SUPPORTED_YEARS);
const MAX_YEAR = Math.max(...SUPPORTED_YEARS);

export function validateRegisterVehicleRequest(
  input: RegisterVehicleRequest,
): VehicleValidationResult {
  const issues: VehicleValidationIssue[] = [];

  requireTrimmed(input.customerId, 'customerId', 'VEH-VAL-001', 'customerId is required.', issues);
  requireTrimmed(
    input.serialNumber,
    'serialNumber',
    'VEH-VAL-002',
    'serialNumber is required.',
    issues,
  );
  requireTrimmed(input.modelCode, 'modelCode', 'VEH-VAL-003', 'modelCode is required.', issues);

  if (!Number.isInteger(input.modelYear)) {
    issues.push({
      ruleId: 'VEH-VAL-004',
      field: 'modelYear',
      message: 'modelYear must be an integer.',
    });
  } else if (input.modelYear < MIN_YEAR || input.modelYear > MAX_YEAR) {
    issues.push({
      ruleId: 'VEH-VAL-004',
      field: 'modelYear',
      message: `modelYear must be between ${MIN_YEAR} and ${MAX_YEAR}.`,
    });
  }

  return { ok: issues.length === 0, issues };
}

function requireTrimmed(
  value: string | undefined,
  field: string,
  ruleId: VehicleValidationRuleId,
  message: string,
  issues: VehicleValidationIssue[],
): void {
  if (!value || !value.trim()) {
    issues.push({ ruleId, field, message });
  }
}
