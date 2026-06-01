import { readFile } from 'node:fs/promises';
import type { ShopMonkeyExport } from '../connectors/shopmonkey-api.connector.js';
import {
  sanitizeExport,
  type SanitizationReport,
  type SanitizedCustomer,
  type SanitizedLineItemAssignment,
  type SanitizedOrder,
  type SanitizedPart,
  type SanitizedPurchaseOrder,
  type SanitizedUser,
  type SanitizedVehicle,
  type SanitizedVendor,
} from '../sanitize/sanitize-export.js';

type EntityCount = SanitizationReport['counts']['customers'];
type CountKey = keyof SanitizationReport['counts'];

const COUNT_KEYS: CountKey[] = [
  'customers',
  'vehicles',
  'orders',
  'lineItemAssignments',
  'vendors',
  'parts',
  'purchaseOrders',
  'users',
];

export interface ShopMonkeySource {
  sourceFile: string;
  sourceKind: 'raw-export' | 'sanitized-report';
  rawExport: ShopMonkeyExport;
  report: SanitizationReport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function getArray<T>(source: Record<string, unknown>, key: string): T[] {
  const value = source[key];
  return Array.isArray(value) ? value as T[] : [];
}

function countFromArray(value: unknown): EntityCount {
  if (!Array.isArray(value)) return { total: 0, valid: 0, warned: 0, skipped: 0 };
  const skipped = value.filter((item) => isRecord(item) && item.skip === true).length;
  const warned = value.filter(
    (item) =>
      isRecord(item) &&
      Array.isArray(item.validationWarnings) &&
      item.validationWarnings.length > 0 &&
      item.skip !== true,
  ).length;

  return {
    total: value.length,
    valid: Math.max(0, value.length - skipped - warned),
    warned,
    skipped,
  };
}

function countFromSummary(source: Record<string, unknown>, key: CountKey, fallbackItems: unknown): EntityCount {
  const counts = isRecord(source.counts) ? source.counts : {};
  const summary = isRecord(counts[key]) ? counts[key] : undefined;
  if (!summary) return countFromArray(fallbackItems);

  return {
    total: toNumber(summary.total),
    valid: toNumber(summary.valid),
    warned: toNumber(summary.warned),
    skipped: toNumber(summary.skipped),
  };
}

function normalizeSanitizedReport(source: Record<string, unknown>, sourceFile: string): SanitizationReport {
  const customers = getArray<SanitizedCustomer>(source, 'customers');
  const vehicles = getArray<SanitizedVehicle>(source, 'vehicles');
  const orders = getArray<SanitizedOrder>(source, 'orders');
  const lineItemAssignments = getArray<SanitizedLineItemAssignment>(source, 'lineItemAssignments');
  const vendors = getArray<SanitizedVendor>(source, 'vendors');
  const parts = getArray<SanitizedPart>(source, 'parts');
  const purchaseOrders = getArray<SanitizedPurchaseOrder>(source, 'purchaseOrders');
  const users = getArray<SanitizedUser>(source, 'users');
  const arrays = { customers, vehicles, orders, lineItemAssignments, vendors, parts, purchaseOrders, users };
  const counts = Object.fromEntries(
    COUNT_KEYS.map((key) => [key, countFromSummary(source, key, arrays[key])]),
  ) as SanitizationReport['counts'];

  return {
    sanitizedAt: typeof source.sanitizedAt === 'string' ? source.sanitizedAt : new Date().toISOString(),
    sourceFile: typeof source.sourceFile === 'string' ? source.sourceFile : sourceFile,
    counts,
    customers,
    vehicles,
    orders,
    lineItemAssignments,
    vendors,
    parts,
    purchaseOrders,
    users,
  };
}

function normalizeRawExport(source: Record<string, unknown>): ShopMonkeyExport {
  return {
    ...source,
    customers: getArray(source, 'customers'),
    vehicles: getArray(source, 'vehicles'),
    orders: getArray(source, 'orders'),
    lineItemAssignments: getArray(source, 'lineItemAssignments'),
    vendors: getArray(source, 'vendors'),
    inventoryParts: getArray(source, 'inventoryParts'),
    purchaseOrders: getArray(source, 'purchaseOrders'),
    users: getArray(source, 'users'),
  } as ShopMonkeyExport;
}

function isSanitizedReport(source: Record<string, unknown>): boolean {
  const sampleCustomer = getArray<Record<string, unknown>>(source, 'customers')[0];
  const sampleOrder = getArray<Record<string, unknown>>(source, 'orders')[0];
  return (
    isRecord(source.counts) &&
    (isRecord(sampleCustomer) && typeof sampleCustomer.smId === 'string' ||
      isRecord(sampleOrder) && typeof sampleOrder.smId === 'string')
  );
}

export async function readShopMonkeySource(sourceFile: string): Promise<ShopMonkeySource> {
  const source = JSON.parse(await readFile(sourceFile, 'utf8')) as Record<string, unknown>;

  if (isSanitizedReport(source)) {
    return {
      sourceFile,
      sourceKind: 'sanitized-report',
      rawExport: normalizeRawExport({}),
      report: normalizeSanitizedReport(source, sourceFile),
    };
  }

  const rawExport = normalizeRawExport(source);
  return {
    sourceFile,
    sourceKind: 'raw-export',
    rawExport,
    report: sanitizeExport(rawExport, sourceFile),
  };
}
