import type { EntityDesign } from './shared.js';
import { CustomerDesign } from './customer.js';
import {
  PartSkuDesign,
  InventoryBinDesign,
  InventoryLocationDesign,
  InventoryLotDesign
} from './inventory.js';
import { VendorDesign, PurchaseOrderDesign } from './procurement.js';
import {
  CartVehicleDesign,
  BuildConfigurationDesign,
  BomDesign,
  RoutingSopStepDesign,
  WorkOrderDesign,
  BuildSlotDesign,
  LaborCapacityDesign
} from './buildPlanning.js';
import { TechnicianTaskDesign, TicketReworkIssueDesign, FileAttachmentDesign } from './tickets.js';
import { InvoiceSyncRecordDesign } from './accounting.js';
import { AuditEventDesign } from './auditEvent.js';

export const CANONICAL_ENTITY_DESIGNS: Record<string, EntityDesign<string>> = {
  Customer: CustomerDesign,
  PartSku: PartSkuDesign,
  InventoryLocation: InventoryLocationDesign,
  InventoryBin: InventoryBinDesign,
  InventoryLot: InventoryLotDesign,
  Vendor: VendorDesign,
  PurchaseOrder: PurchaseOrderDesign,
  CartVehicle: CartVehicleDesign,
  BuildConfiguration: BuildConfigurationDesign,
  BOM: BomDesign,
  RoutingSopStep: RoutingSopStepDesign,
  WorkOrder: WorkOrderDesign,
  BuildSlot: BuildSlotDesign,
  LaborCapacity: LaborCapacityDesign,
  TechnicianTask: TechnicianTaskDesign,
  TicketReworkIssue: TicketReworkIssueDesign,
  FileAttachment: FileAttachmentDesign,
  InvoiceSyncRecord: InvoiceSyncRecordDesign,
  AuditEvent: AuditEventDesign
};

export interface ApiOperationDescriptor {
  entity: string;
  method: string;
  path: string;
  summary: string;
}

export const CANONICAL_API_OPERATIONS: ApiOperationDescriptor[] = Object.values(
  CANONICAL_ENTITY_DESIGNS
).flatMap((design) =>
  design.apiOperations.map((operation) => ({
    entity: design.entity,
    method: operation.method,
    path: operation.path,
    summary: operation.summary
  }))
);
