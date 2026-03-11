import { parseCsvFile } from './base.parser.js';
import type { ParseResult, RawWorkOrderRow, RawWorkOrderOperationRow, RawWorkOrderPartRow } from '../types.js';

const WO_REQUIRED = ['id', 'customerId', 'title', 'status'];
const OP_REQUIRED = ['id', 'workOrderId', 'name'];
const PART_REQUIRED = ['id', 'workOrderId', 'partId', 'quantity'];

export async function parseWorkOrdersCsv(filePath: string): Promise<ParseResult<RawWorkOrderRow>> {
  return parseCsvFile<RawWorkOrderRow>(
    filePath,
    WO_REQUIRED,
    (row, rowNum) => {
      if (!row.id?.trim()) return { row: rowNum, field: 'id', message: 'id is required' };
      if (!row.customerId?.trim()) return { row: rowNum, field: 'customerId', message: 'customerId is required', rawValue: row.id };
      return {
        id: row.id.trim(),
        customerId: row.customerId.trim(),
        assetId: row.assetId?.trim() || undefined,
        assignedEmployeeId: row.assignedEmployeeId?.trim() || undefined,
        title: row.title?.trim() ?? '',
        description: row.description?.trim() || undefined,
        status: row.status?.trim() ?? 'Open',
        priority: row.priority?.trim() || undefined,
        laborTotal: row.laborTotal?.trim() || undefined,
        partsTotal: row.partsTotal?.trim() || undefined,
        createdAt: row.createdAt?.trim() || undefined,
        completedAt: row.completedAt?.trim() || undefined,
      };
    },
  );
}

export async function parseWorkOrderOperationsCsv(filePath: string): Promise<ParseResult<RawWorkOrderOperationRow>> {
  return parseCsvFile<RawWorkOrderOperationRow>(
    filePath,
    OP_REQUIRED,
    (row, rowNum) => {
      if (!row.id?.trim()) return { row: rowNum, field: 'id', message: 'id is required' };
      if (!row.workOrderId?.trim()) return { row: rowNum, field: 'workOrderId', message: 'workOrderId is required', rawValue: row.id };
      return {
        id: row.id.trim(),
        workOrderId: row.workOrderId.trim(),
        name: row.name?.trim() ?? '',
        description: row.description?.trim() || undefined,
        laborHours: row.laborHours?.trim() || undefined,
        laborRate: row.laborRate?.trim() || undefined,
        technicianId: row.technicianId?.trim() || undefined,
      };
    },
  );
}

export async function parseWorkOrderPartsCsv(filePath: string): Promise<ParseResult<RawWorkOrderPartRow>> {
  return parseCsvFile<RawWorkOrderPartRow>(
    filePath,
    PART_REQUIRED,
    (row, rowNum) => {
      if (!row.id?.trim()) return { row: rowNum, field: 'id', message: 'id is required' };
      if (!row.workOrderId?.trim()) return { row: rowNum, field: 'workOrderId', message: 'workOrderId is required', rawValue: row.id };
      return {
        id: row.id.trim(),
        workOrderId: row.workOrderId.trim(),
        partId: row.partId?.trim() ?? '',
        quantity: row.quantity?.trim() ?? '0',
        unitPrice: row.unitPrice?.trim() || undefined,
        notes: row.notes?.trim() || undefined,
      };
    },
  );
}
