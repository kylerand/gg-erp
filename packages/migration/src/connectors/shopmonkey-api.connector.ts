/**
 * ShopMonkey API v3 connector
 *
 * Authenticates with email/password, fetches a bearer token, then paginates
 * through all entities needed for the migration pipeline.
 *
 * NOTE: The ShopMonkey API pagination is non-deterministic — it returns
 * random subsets of records and ignores sort/filter params. We work around
 * this by making multiple full passes and deduping. For customers, we also
 * support merging with a CSV export from the ShopMonkey dashboard to ensure
 * complete coverage.
 *
 * Confirmed endpoints (from API documentation, 2026-03-11):
 *   POST /v3/auth/login            → { data: { token, user: { companyId } } }
 *   POST /v3/customer/search       → list customers (search endpoint, not GET /v3/customer)
 *   GET  /v3/customer/:id/vehicle  → vehicles per customer (no global vehicle list)
 *   GET  /v3/order                 → work orders (list)
 *   GET  /v3/order/:id/service     → service line items (labors + parts) for a single order
 *   POST /v3/inventory_part/search → inventory parts catalog
 *   GET  /v3/user                  → employees
 *   GET  /v3/vendor                → vendors
 *   GET  /v3/purchase_order        → purchase orders
 *   GET  /v3/timesheet             → timeclock entries (note: NOT /v3/timeclock)
 */

import { readFile } from 'node:fs/promises';

const BASE_URL = 'https://api.shopmonkey.cloud/v3';
const DEFAULT_PAGE_SIZE = 100;
const RATE_LIMIT_RETRY_MS = 2000;
const PAGE_DELAY_MS = 300; // Pause between pages to avoid connection saturation
const MAX_RETRIES = 5;

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface ShopMonkeySession {
  token: string;
  companyId: string;
  locationId: string | null;
  userEmail: string;
}

interface LoginResponse {
  success: boolean;
  data: {
    token: string;
    user: {
      id: string;
      email: string;
      companyId: string;
      currentLocationId?: string;
      firstName: string;
      lastName: string;
    };
  };
}

export async function login(email: string, password: string): Promise<ShopMonkeySession> {
  const res = await apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, audience: 'api' }),
  });

  if (!res.success || !res.data?.token) {
    throw new Error('ShopMonkey login failed: no token in response');
  }

  return {
    token: res.data.token,
    companyId: res.data.user.companyId,
    locationId: res.data.user.currentLocationId ?? null,
    userEmail: res.data.user.email,
  };
}

// ─── Paginated list fetcher ───────────────────────────────────────────────────

interface ListResponse<T> {
  data: T[];
  meta?: {
    hasMore?: boolean;
    total?: number;
    count?: number;
  };
}

async function fetchAll<T extends { id: string }>(
  session: ShopMonkeySession,
  path: string,
  extraParams: Record<string, string> = {},
): Promise<T[]> {
  const results: T[] = [];
  const seenIds = new Set<string>();
  let totalKnown: number | null = null;

  // The ShopMonkey API is non-deterministic: each request returns a random-ish
  // subset of records regardless of sort/filter params. The only reliable
  // strategy is to make multiple full passes over the ENTIRE offset range
  // (ignoring the unreliable `hasMore` flag), dedup by id, and stop when
  // consecutive passes yield no new records.
  const MAX_PASSES = 30;
  const MAX_EMPTY_PASSES = 3; // stop after N consecutive passes with 0 new records

  let emptyPasses = 0;

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    const countBefore = results.length;
    let offset = 0;
    let consecutiveEmptyPages = 0;

    // Always paginate through the full theoretical offset range.
    // Use total * 1.5 to account for the API's non-determinism.
    const maxOffset = totalKnown
      ? Math.ceil(totalKnown * 1.5)
      : 5000; // generous default for first pass

    while (offset < maxOffset) {
      const params = new URLSearchParams({
        limit: String(DEFAULT_PAGE_SIZE),
        offset: String(offset),
        ...extraParams,
      });

      const res = await apiFetch<ListResponse<T>>(`${path}?${params}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      }, MAX_RETRIES);

      // Capture meta on first request
      if (pass === 1 && offset === 0 && res.meta) {
        console.log(`[shopmonkey] ${path}: meta = ${JSON.stringify(res.meta)}`);
        if (res.meta.total != null) {
          totalKnown = res.meta.total;
        }
      }

      if (!Array.isArray(res.data) || res.data.length === 0) {
        consecutiveEmptyPages++;
        // 3+ consecutive empty pages — the API has no more data at higher offsets
        if (consecutiveEmptyPages >= 3) break;
        offset += DEFAULT_PAGE_SIZE;
        await sleep(PAGE_DELAY_MS);
        continue;
      }

      consecutiveEmptyPages = 0;

      for (const record of res.data) {
        if (!seenIds.has(record.id)) {
          seenIds.add(record.id);
          results.push(record);
        }
      }

      // Stop early if we've collected everything
      if (totalKnown !== null && results.length >= totalKnown) break;

      // Do NOT check hasMore — the API lies about it. Keep going until we
      // exhaust the offset range or get consecutive empty pages.

      offset += DEFAULT_PAGE_SIZE;
      await sleep(PAGE_DELAY_MS);
    }

    const newThisPass = results.length - countBefore;
    const progress = totalKnown ? ` / ${totalKnown}` : '';
    console.log(`[shopmonkey] ${path}: pass ${pass} — ${results.length}${progress} unique records (+${newThisPass} new this pass)`);

    // Stop if we have everything
    if (totalKnown !== null && results.length >= totalKnown) break;

    // Track consecutive empty passes
    if (newThisPass === 0) {
      emptyPasses++;
      if (emptyPasses >= MAX_EMPTY_PASSES) {
        console.warn(`[shopmonkey] ${path}: ${MAX_EMPTY_PASSES} consecutive passes with no new records — stopping.`);
        break;
      }
    } else {
      emptyPasses = 0;
    }
  }

  console.log(`[shopmonkey] ${path}: done — ${results.length} total unique records`);
  return results;
}

// ─── Entity types (field names match ShopMonkey API v3 exactly) ───────────────

export interface SmPhoneNumber {
  id: string;
  customerId: string;
  number?: string;
  extension?: string;
  country?: string;
  type?: string;               // 'mobile' | 'home' | 'work' | 'other'
  primary?: boolean;
}

export interface SmEmail {
  id: string;
  customerId: string;
  email?: string;
  primary?: boolean;
  subscribed?: boolean;
}

export interface SmCustomer {
  id: string;
  companyId: string;
  locationIds?: string[];
  customerType?: string;       // 'individual' | 'company'
  firstName?: string;
  lastName?: string;
  companyName?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  note?: string;
  preferredContactMethod?: string;
  taxExempt?: boolean;
  discountPercent?: number;
  website?: string;
  externalId?: string;
  imported?: boolean;
  deleted?: boolean;
  createdDate?: string;
  updatedDate?: string;
  // Nested sub-resources returned on search/get
  phoneNumbers?: SmPhoneNumber[];
  emails?: SmEmail[];
}

export interface SmVehicle {
  id: string;
  companyId: string;
  // Vehicle does NOT have a customerId on the root — owners are fetched via GET /vehicle/:id/owners
  // When fetched via GET /customer/:id/vehicle the customerId context is implicit
  customerId?: string;         // populated by our fetcher when fetching per-customer
  year?: number;
  make?: string;
  makeId?: string;
  model?: string;
  modelId?: string;
  submodel?: string;
  submodelId?: string;
  vin?: string;
  color?: string;
  unit?: string;               // unit/fleet number
  mileage?: number;
  mileageUnit?: string;        // 'mi' | 'km'
  licensePlate?: string;
  licensePlateState?: string;
  note?: string;
  type?: string;
  createdDate?: string;
  updatedDate?: string;
}

/** Labor line item within an order service */
export interface SmServiceLabor {
  id: string;
  serviceId: string;
  orderId: string;
  name?: string;
  hours?: number;
  rateCents?: number;
  technicianId?: string;
  note?: string;
  completed?: boolean;
  completedDate?: string;
  createdDate?: string;
  updatedDate?: string;
}

/** Parts line item within an order service */
export interface SmServicePart {
  id: string;
  serviceId: string;
  orderId: string;
  name?: string;
  partNumber?: string;
  quantity?: number;
  retailCostCents?: number;
  wholesaleCostCents?: number;
  binLocation?: string;
  vendorId?: string;
  inventoryPartId?: string;
  taxable?: boolean;
  note?: string;
  createdDate?: string;
  updatedDate?: string;
}

/** Service (job) on an order — contains labors and parts as nested arrays */
export interface SmService {
  id: string;
  orderId: string;
  name?: string;
  note?: string;
  totalCents?: number;
  calculatedLaborCents?: number;
  calculatedPartsCents?: number;
  ordinal?: number;
  createdDate?: string;
  updatedDate?: string;
  labors?: SmServiceLabor[];
  parts?: SmServicePart[];
}

export interface SmOrder {
  id: string;
  publicId?: string;
  companyId?: string;
  locationId?: string;
  number?: number;             // integer (not string)
  customerId?: string;
  vehicleId?: string;
  assignedTechnicianIds?: string[];  // array — was wrongly named assignedToUserId
  serviceWriterId?: string;
  name?: string;
  complaint?: string;
  recommendation?: string;
  purchaseOrderNumber?: string;
  workflowStatusId?: string;
  authorized?: boolean;
  invoiced?: boolean;
  paid?: boolean;
  archived?: boolean;
  deleted?: boolean;
  totalCostCents?: number;
  laborCents?: number;
  partsCents?: number;
  tiresCents?: number;
  subcontractsCents?: number;
  feesCents?: number;
  taxCents?: number;
  discountCents?: number;
  mileageIn?: number;
  mileageOut?: number;
  dueDate?: string;
  completedDate?: string;
  orderCreatedDate?: string;
  createdDate?: string;
  updatedDate?: string;
  // Nested — populated when fetching single order
  services?: SmService[];
}

/** Inventory part from ShopMonkey (standalone catalog item) */
export interface SmInventoryPart {
  id: string;
  companyId?: string;
  locationId?: string;
  name?: string;
  number?: string;             // part number / SKU
  note?: string;
  categoryId?: string;
  vendorId?: string;
  quantity?: number;
  binLocation?: string;
  retailCostCents?: number;
  wholesaleCostCents?: number;
  taxable?: boolean;
  deleted?: boolean;
  createdDate?: string;
  updatedDate?: string;
}

/** @deprecated Use SmInventoryPart. SmPart kept for backward-compat with parsers. */
export interface SmPart {
  id: string;
  name?: string;
  partNumber?: string;
  description?: string;
  categoryId?: string;
  retailCostCents?: number;
  wholesaleCostCents?: number;
  quantity?: number;
  binLocation?: string;
  vendorId?: string;
  createdDate?: string;
}

/** Timesheet (timeclock) entry */
export interface SmTimesheet {
  id: string;
  companyId?: string;
  locationId?: string;
  technicianId?: string;
  orderId?: string;
  serviceId?: string;
  laborId?: string;
  number?: string;
  clockIn?: string;
  clockOut?: string;
  duration?: number;           // seconds
  flatRate?: boolean;
  rateCents?: number;
  activity?: string;
  type?: string;               // 'regular' | 'overtime' etc.
  note?: string;
  inProgress?: boolean;
  createdDate?: string;
  updatedDate?: string;
}

export interface SmUser {
  id: string;
  companyId?: string;
  locationId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  calendarColor?: string;
  createdDate?: string;
  updatedDate?: string;
}

export interface SmVendor {
  id: string;
  companyId?: string;
  locationId?: string;
  name?: string;
  contactFirstName?: string;
  contactLastName?: string;
  contactEmail?: string;       // was wrongly named email
  accountNumber?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  url?: string;
  createdDate?: string;
  updatedDate?: string;
}

export interface SmPurchaseOrder {
  id: string;
  companyId?: string;
  locationId?: string;
  number?: string;
  status?: string;             // 'open' | 'ordered' | 'fulfilled' | 'cancelled'
  totalPriceCents?: number;
  invoiceNumber?: string;
  orderId?: string;
  note?: string;
  orderedDate?: string;
  fulfilledDate?: string;
  createdDate?: string;
  updatedDate?: string;
}

/** Line item assignment — kept for backward-compat; prefer SmServicePart/SmServiceLabor */
export interface SmLineItemAssignment {
  id: string;
  orderId?: string;
  serviceId?: string;
  type?: string;
  name?: string;
  partNumber?: string;
  description?: string;
  quantity?: number;
  retailCostCents?: number;
  wholesaleCostCents?: number;
  totalCostCents?: number;
  laborCents?: number;
  vendorId?: string;
  binLocation?: string;
  partId?: string;
  taxable?: boolean;
  createdDate?: string;
  updatedDate?: string;
}

// ─── Entity fetchers ──────────────────────────────────────────────────────────

/**
 * Fetch all customers using POST /v3/customer/search.
 * The search endpoint supports pagination and is the correct way to list customers.
 */
export async function fetchCustomers(session: ShopMonkeySession): Promise<SmCustomer[]> {
  return fetchAllPost<SmCustomer>(session, '/customer/search', {});
}

/**
 * Fetch all vehicles for a customer.
 * ShopMonkey vehicles are owned per-customer — there is no global /vehicle list.
 */
export async function fetchVehiclesForCustomer(
  session: ShopMonkeySession,
  customerId: string,
): Promise<SmVehicle[]> {
  const rows = await fetchAll<SmVehicle>(session, `/customer/${customerId}/vehicle`);
  return rows.map((v) => ({ ...v, customerId }));
}

/**
 * Fetch all vehicles across all customers.
 * Iterates over customers and collects vehicles per-customer.
 */
export async function fetchVehicles(session: ShopMonkeySession): Promise<SmVehicle[]> {
  const customers = await fetchCustomers(session);
  const vehicles: SmVehicle[] = [];
  const seenIds = new Set<string>();

  for (const customer of customers) {
    try {
      const customerVehicles = await fetchVehiclesForCustomer(session, customer.id);
      for (const v of customerVehicles) {
        if (!seenIds.has(v.id)) {
          seenIds.add(v.id);
          vehicles.push(v);
        }
      }
    } catch {
      console.warn(`[shopmonkey] Failed to fetch vehicles for customer ${customer.id}, skipping.`);
    }
  }
  return vehicles;
}

/**
 * Fetch all work orders from GET /v3/order (list endpoint).
 * Full service line items (labors + parts) are included when fetching a single order.
 * For the bulk fetch we get the order headers; call fetchOrderServices() per order
 * when you need the full line item breakdown.
 */
export async function fetchOrders(session: ShopMonkeySession): Promise<SmOrder[]> {
  return fetchAll<SmOrder>(session, '/order');
}

/**
 * Fetch service line items (labors + parts) for a single order.
 * Use this to populate SmOrder.services after the bulk fetch.
 */
export async function fetchOrderServices(
  session: ShopMonkeySession,
  orderId: string,
): Promise<SmService[]> {
  const res = await apiFetch<{ data: SmService[]; success: boolean }>(
    `/order/${orderId}/service`,
    { headers: { Authorization: `Bearer ${session.token}` } },
    MAX_RETRIES,
  );
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * Fetch inventory parts using POST /v3/inventory_part/search.
 * ShopMonkey v3 exposes a proper inventory parts catalog — not just line items.
 */
export async function fetchInventoryParts(session: ShopMonkeySession): Promise<SmInventoryPart[]> {
  return fetchAllPost<SmInventoryPart>(session, '/inventory_part/search', {});
}

/** @deprecated Use fetchInventoryParts(). Returns empty for backward-compat. */
export async function fetchParts(_session: ShopMonkeySession): Promise<SmPart[]> {
  return [];
}

/** @deprecated Line item assignments are now nested on each order's services[].labors/parts. */
export async function fetchLineItemAssignments(_session: ShopMonkeySession): Promise<SmLineItemAssignment[]> {
  return [];
}

export async function fetchUsers(session: ShopMonkeySession): Promise<SmUser[]> {
  return fetchAll<SmUser>(session, '/user');
}

export async function fetchVendors(session: ShopMonkeySession): Promise<SmVendor[]> {
  return fetchAll<SmVendor>(session, '/vendor');
}

/**
 * Fetch purchase orders from GET /v3/purchase_order.
 */
export async function fetchPurchaseOrders(session: ShopMonkeySession): Promise<SmPurchaseOrder[]> {
  return fetchAll<SmPurchaseOrder>(session, '/purchase_order');
}

/**
 * Fetch timesheet (timeclock) entries from GET /v3/timesheet.
 * Note: ShopMonkey renamed the endpoint from /v3/timeclock to /v3/timesheet.
 */
export async function fetchTimesheets(session: ShopMonkeySession): Promise<SmTimesheet[]> {
  return fetchAll<SmTimesheet>(session, '/timesheet');
}

// ─── Inspection Templates ────────────────────────────────────────────────────

export interface SmInspectionTemplateItem {
  id: string;
  createdDate: string;
  updatedDate: string | null;
  companyId: string;
  locationId: string;
  name: string;
  message: string | null;
  ordinal: number;
  status: string | null;
  inspectionTemplateId: string;
}

export interface SmInspectionTemplate {
  id: string;
  createdDate: string;
  updatedDate: string | null;
  companyId: string;
  locationId: string;
  name: string;
  deleted: boolean;
  items: SmInspectionTemplateItem[];
}

export async function fetchInspectionTemplates(session: ShopMonkeySession): Promise<SmInspectionTemplate[]> {
  console.log('[shopmonkey] Fetching inspection templates...');
  const templates = await fetchAll<SmInspectionTemplate>(session, '/inspection_template');
  // Fetch each template's full detail to get items (list endpoint may not include items)
  const detailed: SmInspectionTemplate[] = [];
  for (const t of templates) {
    if (t.deleted) continue;
    try {
      const res = await apiFetch<{ success: boolean; data: SmInspectionTemplate }>(
        `/inspection_template/${t.id}`,
        { headers: { Authorization: `Bearer ${session.token}` } }
      );
      if (res.success && res.data) {
        detailed.push(res.data);
      } else {
        detailed.push(t);
      }
    } catch {
      detailed.push(t);
    }
  }
  console.log(`[shopmonkey] Inspection templates: ${detailed.length}`);
  return detailed;
}

// ─── Canned Services ─────────────────────────────────────────────────────────

export interface SmCannedServiceItem {
  id: string;
  name: string;
  type: string; // 'labor' | 'part' | 'fee' | 'subcontract' | 'tire'
  quantity?: number;
  price?: number;
}

export interface SmCannedService {
  id: string;
  createdDate: string;
  updatedDate: string | null;
  name: string;
  note: string | null;
  categoryId: string | null;
  deleted: boolean;
}

export async function fetchCannedServices(session: ShopMonkeySession): Promise<SmCannedService[]> {
  console.log('[shopmonkey] Fetching canned services...');
  const services = await fetchAll<SmCannedService>(session, '/canned_service');
  const active = services.filter(s => !s.deleted);
  console.log(`[shopmonkey] Canned services: ${active.length} (${services.length - active.length} deleted)`);
  return active;
}

/**
 * Parse a ShopMonkey customer CSV export (from dashboard → Customers → Export).
 * Returns SmCustomer[] that can be merged with API results.
 *
 * CSV columns (order matters):
 *   First Name*, Last Name*, Primary Phone, Additional Phones, Primary Email,
 *   Additional Emails, Preferred Contact Method, Referral Source, Company Name,
 *   Address 1, Address 2, City, State, Zip Code, Country, DOT #, Date Created,
 *   Shopmonkey Fleet ID, Note, Tax Exempt, GST Exempt, HST Exempt, PST Exempt,
 *   Shopmonkey Customer ID, Payment Term
 */
export async function parseCustomerCsv(csvPath: string): Promise<SmCustomer[]> {
  const raw = await readFile(csvPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l: string) => l.trim().length > 0);

  // Skip the first two metadata rows ("Generation Date,..." and blank row)
  // then the header row
  let dataStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('First Name')) {
      dataStart = i + 1;
      break;
    }
  }

  const customers: SmCustomer[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 24) continue;

    const id = cols[23]?.trim();
    if (!id) continue;

    // Parse MM/DD/YYYY → ISO string
    const createdDate = parseSmDate(cols[16]?.trim());

    customers.push({
      id,
      companyId: '',        // not available in CSV export
      firstName: cols[0]?.trim() || undefined,
      lastName: cols[1]?.trim() || undefined,
      phoneNumbers: cols[2]?.trim()
        ? [{ id: `csv-${id}-phone`, customerId: id, number: cols[2].trim(), primary: true }]
        : undefined,
      emails: cols[4]?.trim()
        ? [{ id: `csv-${id}-email`, customerId: id, email: cols[4].trim(), primary: true }]
        : undefined,
      companyName: cols[8]?.trim() || undefined,
      address1: cols[9]?.trim() || undefined,
      address2: cols[10]?.trim() || undefined,
      city: cols[11]?.trim() || undefined,
      state: cols[12]?.trim() || undefined,
      postalCode: cols[13]?.trim() || undefined,
      createdDate,
      note: cols[18]?.trim() || undefined,
    });
  }

  return customers;
}

/** Minimal CSV line parser that handles quoted fields with commas */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/** Parse ShopMonkey CSV date "MM/DD/YYYY" → ISO string */
function parseSmDate(dateStr: string | undefined): string | undefined {
  if (!dateStr) return undefined;
  const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return undefined;
  return `${match[3]}-${match[1]}-${match[2]}T00:00:00.000Z`;
}

/**
 * Merge API-fetched customers with CSV-exported customers.
 * API records take precedence (richer data), CSV fills in any gaps.
 */
function mergeCustomers(apiCustomers: SmCustomer[], csvCustomers: SmCustomer[]): SmCustomer[] {
  const byId = new Map<string, SmCustomer>();
  for (const c of apiCustomers) byId.set(c.id, c);

  let csvOnly = 0;
  for (const c of csvCustomers) {
    if (!byId.has(c.id)) {
      byId.set(c.id, c);
      csvOnly++;
    }
  }

  if (csvOnly > 0) {
    console.log(`[shopmonkey] Merged ${csvOnly} additional customers from CSV (${byId.size} total)`);
  }
  return Array.from(byId.values());
}

// ─── Bulk export ──────────────────────────────────────────────────────────────

export interface ShopMonkeyExport {
  exportedAt: string;
  companyId: string;
  customers: SmCustomer[];
  vehicles: SmVehicle[];
  orders: SmOrder[];
  inventoryParts: SmInventoryPart[];
  /** @deprecated Always empty; line items are nested in orders[].services[].parts/labors */
  lineItemAssignments: SmLineItemAssignment[];
  /** @deprecated Always empty; use inventoryParts */
  parts: SmPart[];
  users: SmUser[];
  vendors: SmVendor[];
  purchaseOrders: SmPurchaseOrder[];
  timesheets: SmTimesheet[];
  counts: Record<string, number>;
}

export interface ExportOptions {
  /** Path to a ShopMonkey customer CSV export to merge with API results */
  customerCsvPath?: string;
}

export async function exportAll(session: ShopMonkeySession, options: ExportOptions = {}): Promise<ShopMonkeyExport> {
  console.log('[shopmonkey] Fetching customers...');
  let customers = await fetchCustomers(session);
  console.log(`[shopmonkey]   → ${customers.length} customers from API`);

  if (options.customerCsvPath) {
    console.log(`[shopmonkey] Loading customer CSV: ${options.customerCsvPath}`);
    const csvCustomers = await parseCustomerCsv(options.customerCsvPath);
    console.log(`[shopmonkey]   → ${csvCustomers.length} customers in CSV`);
    customers = mergeCustomers(customers, csvCustomers);
  }

  console.log('[shopmonkey] Fetching vehicles (per-customer)...');
  const vehicles = await fetchVehicles(session);
  console.log(`[shopmonkey]   → ${vehicles.length} vehicles`);

  console.log('[shopmonkey] Fetching orders...');
  const orders = await fetchOrders(session);
  console.log(`[shopmonkey]   → ${orders.length} orders`);

  console.log('[shopmonkey] Fetching inventory parts...');
  const inventoryParts = await fetchInventoryParts(session);
  console.log(`[shopmonkey]   → ${inventoryParts.length} inventory parts`);

  console.log('[shopmonkey] Fetching users...');
  const users = await fetchUsers(session);
  console.log(`[shopmonkey]   → ${users.length} users`);

  console.log('[shopmonkey] Fetching vendors...');
  const vendors = await fetchVendors(session);
  console.log(`[shopmonkey]   → ${vendors.length} vendors`);

  console.log('[shopmonkey] Fetching purchase orders...');
  const purchaseOrders = await fetchPurchaseOrders(session);
  console.log(`[shopmonkey]   → ${purchaseOrders.length} purchase orders`);

  console.log('[shopmonkey] Fetching timesheets...');
  const timesheets = await fetchTimesheets(session);
  console.log(`[shopmonkey]   → ${timesheets.length} timesheet entries`);

  return {
    exportedAt: new Date().toISOString(),
    companyId: session.companyId,
    customers,
    vehicles,
    orders,
    inventoryParts,
    lineItemAssignments: [],
    parts: [],
    users,
    vendors,
    purchaseOrders,
    timesheets,
    counts: {
      customers: customers.length,
      vehicles: vehicles.length,
      orders: orders.length,
      inventoryParts: inventoryParts.length,
      users: users.length,
      vendors: vendors.length,
      purchaseOrders: purchaseOrders.length,
      timesheets: timesheets.length,
    },
  };
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  retries = MAX_RETRIES,
): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') ?? 2);
        const waitMs = (retryAfter * 1000) || RATE_LIMIT_RETRY_MS;
        console.warn(`[shopmonkey] Rate limited — waiting ${waitMs}ms (attempt ${attempt}/${retries})`);
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`ShopMonkey API error ${res.status} on ${url}: ${body}`);
      }

      return res.json() as Promise<T>;
    } catch (err: unknown) {
      // Retry socket/network errors with exponential backoff
      const isNetworkError =
        err instanceof TypeError ||
        (err instanceof Error && ('code' in err) &&
          ['UND_ERR_SOCKET', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(
            (err as NodeJS.ErrnoException).code ?? ''
          ));

      if (isNetworkError && attempt < retries) {
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 15000);
        console.warn(`[shopmonkey] Network error on attempt ${attempt}/${retries} — retrying in ${backoff}ms: ${(err as Error).message}`);
        await sleep(backoff);
        continue;
      }

      throw err;
    }
  }

  throw new Error(`ShopMonkey API: exceeded ${retries} retries for ${url}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Paginated fetcher for POST-based search endpoints (e.g. /customer/search, /inventory_part/search).
 * Sends the filter object as JSON body and uses limit/offset for pagination.
 */
async function fetchAllPost<T extends { id: string }>(
  session: ShopMonkeySession,
  path: string,
  filter: Record<string, unknown> = {},
): Promise<T[]> {
  const results: T[] = [];
  const seenIds = new Set<string>();
  let totalKnown: number | null = null;

  // SM search endpoints are non-deterministic — try different sort fields per pass
  const SORT_VARIANTS = [
    { sort: 'createdDate', direction: 'asc' },
    { sort: 'createdDate', direction: 'desc' },
    { sort: 'updatedDate', direction: 'asc' },
    { sort: 'updatedDate', direction: 'desc' },
    { sort: 'name', direction: 'asc' },
    { sort: 'name', direction: 'desc' },
    {},
  ];

  const MAX_PASSES = 30;
  const MAX_EMPTY_PASSES = 5;
  let emptyPasses = 0;

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    const countBefore = results.length;
    let offset = 0;
    let consecutiveEmptyPages = 0;
    const sortVariant = SORT_VARIANTS[(pass - 1) % SORT_VARIANTS.length];

    const maxOffset = totalKnown
      ? Math.ceil(totalKnown * 1.5)
      : 5000;

    while (offset < maxOffset) {
      const body = JSON.stringify({
        ...filter,
        ...sortVariant,
        limit: DEFAULT_PAGE_SIZE,
        offset,
      });

      const res = await apiFetch<ListResponse<T>>(path, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
        body,
      }, MAX_RETRIES);

      if (pass === 1 && offset === 0 && res.meta) {
        console.log(`[shopmonkey] POST ${path}: meta = ${JSON.stringify(res.meta)}`);
        if (res.meta.total != null) {
          totalKnown = res.meta.total;
        }
      }

      if (!Array.isArray(res.data) || res.data.length === 0) {
        consecutiveEmptyPages++;
        if (consecutiveEmptyPages >= 3) break;
        offset += DEFAULT_PAGE_SIZE;
        await sleep(PAGE_DELAY_MS);
        continue;
      }

      consecutiveEmptyPages = 0;

      for (const record of res.data) {
        if (!seenIds.has(record.id)) {
          seenIds.add(record.id);
          results.push(record);
        }
      }

      if (totalKnown !== null && results.length >= totalKnown) break;

      offset += DEFAULT_PAGE_SIZE;
      await sleep(PAGE_DELAY_MS);
    }

    const newThisPass = results.length - countBefore;
    const progress = totalKnown ? ` / ${totalKnown}` : '';
    console.log(`[shopmonkey] POST ${path}: pass ${pass} — ${results.length}${progress} unique records (+${newThisPass} new this pass)`);

    if (totalKnown !== null && results.length >= totalKnown) break;

    if (newThisPass === 0) {
      emptyPasses++;
      if (emptyPasses >= MAX_EMPTY_PASSES) {
        console.warn(`[shopmonkey] POST ${path}: ${MAX_EMPTY_PASSES} consecutive passes with no new records — stopping.`);
        break;
      }
    } else {
      emptyPasses = 0;
    }
  }

  console.log(`[shopmonkey] POST ${path}: done — ${results.length} total unique records`);
  return results;
}
