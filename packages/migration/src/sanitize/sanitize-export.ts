/**
 * ShopMonkey data sanitization pipeline.
 *
 * Takes a ShopMonkeyExport (from the API connector) and sanitizes/normalizes
 * each entity for loading into the ERP database.
 *
 * Usage:
 *   npx tsx packages/migration/src/sanitize/sanitize-export.ts shopmonkey-export-<ts>.json
 */

import type {
  SmCustomer,
  SmVehicle,
  SmOrder,
  SmLineItemAssignment,
  SmUser,
  SmVendor,
  SmInventoryPart,
  SmPurchaseOrder,
  ShopMonkeyExport,
} from '../connectors/shopmonkey-api.connector.js';

// ─── Sanitized entity types ───────────────────────────────────────────────────

export interface SanitizedCustomer {
  smId: string;
  fullName: string;
  companyName?: string;
  email?: string;
  phone?: string;
  validationWarnings: string[];
  skip: boolean;
}

export interface SanitizedVehicle {
  smId: string;
  smCustomerId?: string;
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  color?: string;
  validationWarnings: string[];
  skip: boolean;
}

export interface SanitizedOrder {
  smId: string;
  orderNumber?: string;
  smCustomerId?: string;
  smVehicleId?: string;
  status?: string;
  totalCents?: number;
  completedDate?: string;
  createdDate?: string;
  validationWarnings: string[];
  skip: boolean;
}

export interface SanitizedLineItemAssignment {
  smId: string;
  smOrderId?: string;
  smServiceId?: string;
  type?: string;
  name: string;
  partNumber?: string;
  quantity: number;
  retailCostCents?: number;
  wholesaleCostCents?: number;
  totalCostCents?: number;
  vendorId?: string;
  validationWarnings: string[];
  skip: boolean;
}

export interface SanitizedVendor {
  smId: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  accountNumber?: string;
  validationWarnings: string[];
  skip: boolean;
}

export interface SanitizedPart {
  smId: string;
  sku: string;
  name: string;
  smVendorId?: string;
  retailCostCents?: number;
  wholesaleCostCents?: number;
  quantityOnHand: number;
  binLocation?: string;
  validationWarnings: string[];
  skip: boolean;
}

export interface SanitizedPurchaseOrder {
  smId: string;
  poNumber: string;
  status: string;
  notes?: string;
  orderedDate?: string;
  fulfilledDate?: string;
  validationWarnings: string[];
  skip: boolean;
}

export interface SanitizedUser {
  smId: string;
  fullName: string;
  email?: string;
  role?: string;
  active: boolean;
  validationWarnings: string[];
  skip: boolean;
}

export interface SanitizationReport {
  sanitizedAt: string;
  sourceFile: string;
  counts: {
    customers: { total: number; valid: number; warned: number; skipped: number };
    vehicles: { total: number; valid: number; warned: number; skipped: number };
    orders: { total: number; valid: number; warned: number; skipped: number };
    lineItemAssignments: { total: number; valid: number; warned: number; skipped: number };
    vendors: { total: number; valid: number; warned: number; skipped: number };
    parts: { total: number; valid: number; warned: number; skipped: number };
    purchaseOrders: { total: number; valid: number; warned: number; skipped: number };
    users: { total: number; valid: number; warned: number; skipped: number };
  };
  customers: SanitizedCustomer[];
  vehicles: SanitizedVehicle[];
  orders: SanitizedOrder[];
  lineItemAssignments: SanitizedLineItemAssignment[];
  vendors: SanitizedVendor[];
  parts: SanitizedPart[];
  purchaseOrders: SanitizedPurchaseOrder[];
  users: SanitizedUser[];
}

// ─── Phone normalization ──────────────────────────────────────────────────────

function normalizePhone(raw?: string): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.length >= 7 ? digits : undefined; // keep partial if >= 7 digits
}

// ─── Email normalization ──────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const lower = raw.trim().toLowerCase();
  return EMAIL_RE.test(lower) ? lower : undefined;
}

// ─── Sanitizers ───────────────────────────────────────────────────────────────

function sanitizeCustomer(c: SmCustomer): SanitizedCustomer {
  const warnings: string[] = [];
  const firstName = c.firstName?.trim() ?? '';
  const lastName = c.lastName?.trim() ?? '';
  const companyName = c.companyName?.trim();

  let fullName = [firstName, lastName].filter(Boolean).join(' ');
  if (!fullName && companyName) fullName = companyName;
  if (!fullName) {
    warnings.push('No name or company — will be imported as "Unknown Customer"');
    fullName = 'Unknown Customer';
  }

  // API returns phoneNumbers[]/emails[] arrays; pick the primary or first entry
  const primaryEmail = c.emails?.find((e) => e.primary)?.email ?? c.emails?.[0]?.email;
  const primaryPhone = c.phoneNumbers?.find((p) => p.primary)?.number ?? c.phoneNumbers?.[0]?.number;

  const email = normalizeEmail(primaryEmail);
  if (primaryEmail && !email) warnings.push(`Invalid email: "${primaryEmail}" — omitted`);

  const phone = normalizePhone(primaryPhone);
  if (primaryPhone && !phone) warnings.push(`Could not normalize phone: "${primaryPhone}" — omitted`);

  // Skip entirely if no identifying info at all
  const skip = !fullName || fullName === 'Unknown Customer' && !email && !phone && !companyName;

  return { smId: c.id, fullName, companyName, email, phone, validationWarnings: warnings, skip };
}

function sanitizeVehicle(v: SmVehicle): SanitizedVehicle {
  const warnings: string[] = [];

  if (!v.customerId) warnings.push('No customerId — will be orphaned');
  if (!v.make && !v.model) warnings.push('No make/model');

  const year = v.year && v.year > 1900 && v.year <= new Date().getFullYear() + 2
    ? v.year : undefined;
  if (v.year && !year) warnings.push(`Invalid year: ${v.year} — omitted`);

  return {
    smId: v.id,
    smCustomerId: v.customerId,
    vin: v.vin?.trim() || undefined,
    year,
    make: v.make?.trim() || undefined,
    model: v.model?.trim() || undefined,
    color: v.color?.trim() || undefined,
    validationWarnings: warnings,
    skip: false,
  };
}

// Status is derived from authorized/invoiced flags — see sanitizeOrder()

function sanitizeOrder(o: SmOrder): SanitizedOrder {
  const warnings: string[] = [];

  if (!o.customerId) warnings.push('No customerId');

  // SM uses workflowStatusId (UUID) not a plain string status; best we can do
  // without fetching the workflow status definitions is default to DRAFT.
  // Maps to work_orders.WoStatus enum: DRAFT | READY | SCHEDULED | IN_PROGRESS | BLOCKED | COMPLETED | CANCELLED
  const mappedStatus = o.invoiced ? 'COMPLETED'
    : o.authorized ? 'READY'
    : 'DRAFT';

  return {
    smId: o.id,
    orderNumber: o.number != null ? String(o.number) : undefined,  // convert int → string
    smCustomerId: o.customerId,
    smVehicleId: o.vehicleId,
    status: mappedStatus,
    totalCents: o.totalCostCents,   // was wrongly named totalCents
    completedDate: o.completedDate,
    createdDate: o.orderCreatedDate ?? o.createdDate,
    validationWarnings: warnings,
    skip: false,
  };
}

function sanitizeLineItemAssignment(li: SmLineItemAssignment): SanitizedLineItemAssignment {
  const warnings: string[] = [];
  const name = li.name?.trim();
  if (!name) warnings.push('No line item name');

  const qty = typeof li.quantity === 'number' && li.quantity >= 0 ? li.quantity : 0;
  if (typeof li.quantity !== 'number') warnings.push(`Invalid quantity: ${li.quantity} — defaulting to 0`);

  return {
    smId: li.id,
    smOrderId: li.orderId,
    smServiceId: li.serviceId,
    type: li.type,
    name: name ?? `LINEITEM-${li.id}`,
    partNumber: li.partNumber?.trim() || undefined,
    quantity: qty,
    retailCostCents: li.retailCostCents,
    wholesaleCostCents: li.wholesaleCostCents,
    totalCostCents: li.totalCostCents,
    vendorId: li.vendorId,
    validationWarnings: warnings,
    skip: !name && !li.partNumber,
  };
}

function sanitizeVendor(v: SmVendor): SanitizedVendor {
  const warnings: string[] = [];
  const name = v.name?.trim();
  if (!name) warnings.push('No vendor name — will be skipped');

  // contactEmail is the correct field name (API has contactEmail, not email)
  const email = normalizeEmail(v.contactEmail);
  if (v.contactEmail && !email) warnings.push(`Invalid email: "${v.contactEmail}" — omitted`);

  // Build contact name from first/last fields
  const contactName = [v.contactFirstName?.trim(), v.contactLastName?.trim()]
    .filter(Boolean)
    .join(' ') || undefined;

  return {
    smId: v.id,
    name: name ?? '',
    contactName,
    email,
    phone: undefined, // ShopMonkey v3 vendor has no phone field
    accountNumber: v.accountNumber?.trim() || undefined,
    validationWarnings: warnings,
    skip: !name,
  };
}

function sanitizeUser(u: SmUser): SanitizedUser {
  const warnings: string[] = [];
  const firstName = u.firstName?.trim() ?? '';
  const lastName = u.lastName?.trim() ?? '';
  let fullName = [firstName, lastName].filter(Boolean).join(' ');
  if (!fullName) {
    warnings.push('No name — will be imported as ID');
    fullName = u.id;
  }

  // Use email if present in API response; otherwise leave undefined (loader will generate placeholder).
  const email = u.email ? normalizeEmail(u.email) : undefined;
  if (u.email && !email) warnings.push(`Invalid email: "${u.email}" — omitted`);

  return {
    smId: u.id,
    fullName,
    email,
    role: undefined,
    active: true, // default to active; SM v3 doesn't return active status on user list
    validationWarnings: warnings,
    skip: false,
  };
}

function sanitizeInventoryPart(p: SmInventoryPart): SanitizedPart {
  const warnings: string[] = [];
  const name = p.name?.trim();
  if (!name) warnings.push('No part name — will be skipped');

  // Prefer part number as SKU; fall back to SM id to guarantee uniqueness
  const sku = p.number?.trim() || p.id;

  return {
    smId: p.id,
    sku,
    name: name ?? '',
    smVendorId: p.vendorId,
    retailCostCents: p.retailCostCents,
    wholesaleCostCents: p.wholesaleCostCents,
    quantityOnHand: p.quantity ?? 0,
    binLocation: p.binLocation?.trim() || undefined,
    validationWarnings: warnings,
    skip: !name,
  };
}

const SM_PO_STATUS_MAP: Record<string, string> = {
  open: 'APPROVED',
  ordered: 'SENT',
  fulfilled: 'RECEIVED',
  cancelled: 'CANCELLED',
};

function sanitizePurchaseOrder(po: SmPurchaseOrder): SanitizedPurchaseOrder {
  const warnings: string[] = [];
  const poNumber = po.number?.trim();
  if (!poNumber) warnings.push('No PO number — will use SM id as fallback');

  const rawStatus = (po.status ?? '').toLowerCase();
  const status = SM_PO_STATUS_MAP[rawStatus] ?? 'DRAFT';
  if (rawStatus && !SM_PO_STATUS_MAP[rawStatus]) {
    warnings.push(`Unknown PO status "${po.status}" — defaulting to DRAFT`);
  }

  return {
    smId: po.id,
    poNumber: poNumber ?? po.id,
    status,
    notes: po.note?.trim() || undefined,
    orderedDate: po.orderedDate,
    fulfilledDate: po.fulfilledDate,
    validationWarnings: warnings,
    skip: false,
  };
}

// ─── Count helper ─────────────────────────────────────────────────────────────

function countResults<T extends { skip: boolean; validationWarnings: string[] }>(items: T[]) {
  const skipped = items.filter(i => i.skip).length;
  const warned = items.filter(i => !i.skip && i.validationWarnings.length > 0).length;
  const valid = items.length - skipped - warned;
  return { total: items.length, valid, warned, skipped };
}

// ─── Main sanitize function ───────────────────────────────────────────────────

export function sanitizeExport(data: ShopMonkeyExport, sourceFile: string): SanitizationReport {
  const customers = data.customers.map(sanitizeCustomer);
  const vehicles = data.vehicles.map(sanitizeVehicle);
  const orders = data.orders.map(sanitizeOrder);
  const lineItemAssignments = (data.lineItemAssignments ?? []).map(sanitizeLineItemAssignment);
  const vendors = data.vendors.map(sanitizeVendor);
  const parts = (data.inventoryParts ?? []).map(sanitizeInventoryPart);
  const purchaseOrders = (data.purchaseOrders ?? []).map(sanitizePurchaseOrder);
  const users = data.users.map(sanitizeUser);

  return {
    sanitizedAt: new Date().toISOString(),
    sourceFile,
    counts: {
      customers: countResults(customers),
      vehicles: countResults(vehicles),
      orders: countResults(orders),
      lineItemAssignments: countResults(lineItemAssignments),
      vendors: countResults(vendors),
      parts: countResults(parts),
      purchaseOrders: countResults(purchaseOrders),
      users: countResults(users),
    },
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
