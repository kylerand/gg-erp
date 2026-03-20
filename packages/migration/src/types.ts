// Shared types for the ShopMonkey migration pipeline

export type ImportEntityType =
  | 'ORGANIZATION'
  | 'EMPLOYEE'
  | 'PART'
  | 'INVENTORY_LOT'
  | 'CUSTOMER'
  | 'ASSET'
  | 'WORK_ORDER'
  | 'WORK_ORDER_OPERATION'
  | 'WORK_ORDER_PART'
  | 'VENDOR';

export type ImportBatchStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type ValidationStatus = 'VALID' | 'WARN' | 'INVALID';

export interface ParseResult<T> {
  records: T[];
  errors: ParseError[];
  totalRows: number;
}

export interface ParseError {
  row: number;
  field?: string;
  message: string;
  rawValue?: string;
}

export interface TransformResult<T> {
  ok: boolean;
  data?: T;
  warnings: string[];
  errors: TransformError[];
}

export interface TransformError {
  field: string;
  message: string;
  value?: unknown;
}

export interface ValidationResult {
  status: ValidationStatus;
  warnings: string[];
  errors: string[];
}

// Raw CSV row shapes (all fields string from CSV)
export interface RawCustomerRow {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  createdAt?: string;
}

export interface RawAssetRow {
  id: string;
  customerId: string;
  vin?: string;
  year?: string;
  make?: string;
  model?: string;
  color?: string;
  licensePlate?: string;
  mileage?: string;
}

export interface RawEmployeeRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  phone?: string;
  hireDate?: string;
  active?: string;
}

export interface RawPartRow {
  id: string;
  sku: string;
  name: string;
  description?: string;
  category?: string;
  unitPrice?: string;
  costPrice?: string;
  unitOfMeasure?: string;
  vendorId?: string;
}

export interface RawInventoryLotRow {
  id: string;
  partId: string;
  quantity: string;
  locationBin?: string;
  unitCost?: string;
  receivedAt?: string;
}

export interface RawWorkOrderRow {
  id: string;
  customerId: string;
  assetId?: string;
  assignedEmployeeId?: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  laborTotal?: string;
  partsTotal?: string;
  createdAt?: string;
  completedAt?: string;
}

export interface RawWorkOrderOperationRow {
  id: string;
  workOrderId: string;
  name: string;
  description?: string;
  laborHours?: string;
  laborRate?: string;
  technicianId?: string;
}

export interface RawWorkOrderPartRow {
  id: string;
  workOrderId: string;
  partId: string;
  quantity: string;
  unitPrice?: string;
  notes?: string;
}

export interface RawVendorRow {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  accountNumber?: string;
}
