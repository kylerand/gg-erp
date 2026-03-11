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
  SmPart,
  SmUser,
  SmVendor,
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

export interface SanitizedPart {
  smId: string;
  name: string;
  partNumber?: string;
  description?: string;
  retailCostCents?: number;
  wholesaleCostCents?: number;
  quantity: number;
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
    parts: { total: number; valid: number; warned: number; skipped: number };
    vendors: { total: number; valid: number; warned: number; skipped: number };
    users: { total: number; valid: number; warned: number; skipped: number };
  };
  customers: SanitizedCustomer[];
  vehicles: SanitizedVehicle[];
  orders: SanitizedOrder[];
  parts: SanitizedPart[];
  vendors: SanitizedVendor[];
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

  const email = normalizeEmail(c.email);
  if (c.email && !email) warnings.push(`Invalid email: "${c.email}" — omitted`);

  const phone = normalizePhone(c.phone);
  if (c.phone && !phone) warnings.push(`Could not normalize phone: "${c.phone}" — omitted`);

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

const SM_STATUS_MAP: Record<string, string> = {
  estimate: 'PLANNED',
  'work-order': 'RELEASED',
  'in-progress': 'IN_PROGRESS',
  completed: 'COMPLETED',
  'picked-up': 'COMPLETED',
  cancelled: 'CANCELLED',
};

function sanitizeOrder(o: SmOrder): SanitizedOrder {
  const warnings: string[] = [];

  if (!o.customerId) warnings.push('No customerId');
  const rawStatus = (o.status ?? '').toLowerCase();
  const mappedStatus = SM_STATUS_MAP[rawStatus];
  if (o.status && !mappedStatus) warnings.push(`Unknown status "${o.status}" — will map to PLANNED`);

  return {
    smId: o.id,
    orderNumber: o.number,
    smCustomerId: o.customerId,
    smVehicleId: o.vehicleId,
    status: mappedStatus ?? 'PLANNED',
    totalCents: o.totalCents,
    completedDate: o.completedDate,
    createdDate: o.createdDate,
    validationWarnings: warnings,
    skip: false,
  };
}

function sanitizePart(p: SmPart): SanitizedPart {
  const warnings: string[] = [];
  const name = p.name?.trim();
  if (!name) warnings.push('No part name');

  const qty = typeof p.quantity === 'number' && p.quantity >= 0 ? p.quantity : 0;
  if (typeof p.quantity !== 'number') warnings.push(`Invalid quantity: ${p.quantity} — defaulting to 0`);

  return {
    smId: p.id,
    name: name ?? `PART-${p.id}`,
    partNumber: p.partNumber?.trim() || undefined,
    description: p.description?.trim() || undefined,
    retailCostCents: p.retailCostCents,
    wholesaleCostCents: p.wholesaleCostCents,
    quantity: qty,
    validationWarnings: warnings,
    skip: !name && !p.partNumber,
  };
}

function sanitizeVendor(v: SmVendor): SanitizedVendor {
  const warnings: string[] = [];
  const name = v.name?.trim();
  if (!name) warnings.push('No vendor name — will be skipped');

  const email = normalizeEmail(v.email);
  if (v.email && !email) warnings.push(`Invalid email: "${v.email}" — omitted`);

  return {
    smId: v.id,
    name: name ?? '',
    contactName: v.contactName?.trim() || undefined,
    email,
    phone: normalizePhone(v.phone),
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
    warnings.push('No name — will be imported as email or ID');
    fullName = u.email ?? u.id;
  }

  const email = normalizeEmail(u.email);
  if (u.email && !email) warnings.push(`Invalid email: "${u.email}" — omitted`);

  return {
    smId: u.id,
    fullName,
    email,
    role: u.role,
    active: u.active !== false,
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
  const parts = data.parts.map(sanitizePart);
  const vendors = data.vendors.map(sanitizeVendor);
  const users = data.users.map(sanitizeUser);

  return {
    sanitizedAt: new Date().toISOString(),
    sourceFile,
    counts: {
      customers: countResults(customers),
      vehicles: countResults(vehicles),
      orders: countResults(orders),
      parts: countResults(parts),
      vendors: countResults(vendors),
      users: countResults(users),
    },
    customers,
    vehicles,
    orders,
    parts,
    vendors,
    users,
  };
}
