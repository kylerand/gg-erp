/**
 * ShopMonkey API v3 connector
 *
 * Authenticates with email/password, fetches a bearer token, then paginates
 * through all entities needed for the migration pipeline.
 *
 * Endpoints confirmed from https://shopmonkey.dev
 *   POST /v3/auth/login  → { data: { token, user: { companyId } } }
 *   GET  /v3/customer
 *   GET  /v3/vehicle
 *   GET  /v3/order  (work orders)
 *   GET  /v3/inventory/part
 *   GET  /v3/user   (employees)
 *   GET  /v3/vendor
 */

const BASE_URL = 'https://api.shopmonkey.cloud/v3';
const DEFAULT_PAGE_SIZE = 25; // Reduced from 100 — large pages cause socket resets
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
  let offset = 0;
  let page = 1;
  // Use meta.total as a hard cap when the API provides it
  let totalKnown: number | null = null;

  while (true) {
    const params = new URLSearchParams({
      limit: String(DEFAULT_PAGE_SIZE),
      offset: String(offset),
      ...extraParams,
    });

    const res = await apiFetch<ListResponse<T>>(`${path}?${params}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    }, MAX_RETRIES);

    if (!Array.isArray(res.data) || res.data.length === 0) break;

    // Capture total from first page if available
    if (page === 1 && res.meta?.total != null) {
      totalKnown = res.meta.total;
    }

    // Detect infinite loop: stop if every record on this page is a duplicate
    const newRecords = res.data.filter(r => !seenIds.has(r.id));
    if (newRecords.length === 0) {
      console.warn(`[shopmonkey] ${path}: all ${res.data.length} records on page ${page} already seen — stopping (duplicate page detected)`);
      break;
    }

    for (const r of newRecords) seenIds.add(r.id);
    results.push(...newRecords);

    if (page === 1 || results.length % 250 === 0) {
      const progress = totalKnown ? ` / ${totalKnown}` : '';
      console.log(`[shopmonkey] ${path}: fetched ${results.length}${progress} records (page ${page})`);
    }

    // Hard cap: stop when we have everything according to meta.total
    if (totalKnown !== null && results.length >= totalKnown) break;

    const hasMore = res.meta?.hasMore ?? (res.data.length === DEFAULT_PAGE_SIZE);
    if (!hasMore) break;

    offset += DEFAULT_PAGE_SIZE;
    page++;

    // Brief pause to avoid saturating the connection pool
    await sleep(PAGE_DELAY_MS);
  }

  console.log(`[shopmonkey] ${path}: done — ${results.length} total records`);
  return results;
}

// ─── Entity fetchers ──────────────────────────────────────────────────────────

export interface SmCustomer {
  id: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  createdDate?: string;
  updatedDate?: string;
  notes?: string;
}

export interface SmVehicle {
  id: string;
  customerId?: string;
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  submodel?: string;
  color?: string;
  licensePlate?: string;
  mileageIn?: number;
  createdDate?: string;
}

export interface SmOrder {
  id: string;
  number?: string;
  customerId?: string;
  vehicleId?: string;
  assignedToUserId?: string;
  name?: string;
  note?: string;
  status?: string;
  priority?: string;
  laborTotalCents?: number;
  partsTotalCents?: number;
  totalCents?: number;
  completedDate?: string;
  createdDate?: string;
  updatedDate?: string;
  locationId?: string;
}

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

export interface SmUser {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  role?: string;
  active?: boolean;
  createdDate?: string;
}

export interface SmVendor {
  id: string;
  name?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  accountNumber?: string;
  createdDate?: string;
}

export async function fetchCustomers(session: ShopMonkeySession): Promise<SmCustomer[]> {
  return fetchAll<SmCustomer>(session, '/customer');
}

export async function fetchVehicles(session: ShopMonkeySession): Promise<SmVehicle[]> {
  return fetchAll<SmVehicle>(session, '/vehicle');
}

export async function fetchOrders(session: ShopMonkeySession): Promise<SmOrder[]> {
  return fetchAll<SmOrder>(session, '/order');
}

export async function fetchParts(session: ShopMonkeySession): Promise<SmPart[]> {
  return fetchAll<SmPart>(session, '/inventory/part');
}

export async function fetchUsers(session: ShopMonkeySession): Promise<SmUser[]> {
  return fetchAll<SmUser>(session, '/user');
}

export async function fetchVendors(session: ShopMonkeySession): Promise<SmVendor[]> {
  return fetchAll<SmVendor>(session, '/vendor');
}

// ─── Bulk export ──────────────────────────────────────────────────────────────

export interface ShopMonkeyExport {
  exportedAt: string;
  companyId: string;
  customers: SmCustomer[];
  vehicles: SmVehicle[];
  orders: SmOrder[];
  parts: SmPart[];
  users: SmUser[];
  vendors: SmVendor[];
  counts: Record<string, number>;
}

export async function exportAll(session: ShopMonkeySession): Promise<ShopMonkeyExport> {
  console.log('[shopmonkey] Fetching customers...');
  const customers = await fetchCustomers(session);
  console.log(`[shopmonkey]   → ${customers.length} customers`);

  console.log('[shopmonkey] Fetching vehicles...');
  const vehicles = await fetchVehicles(session);
  console.log(`[shopmonkey]   → ${vehicles.length} vehicles`);

  console.log('[shopmonkey] Fetching orders...');
  const orders = await fetchOrders(session);
  console.log(`[shopmonkey]   → ${orders.length} orders`);

  console.log('[shopmonkey] Fetching parts...');
  const parts = await fetchParts(session);
  console.log(`[shopmonkey]   → ${parts.length} parts`);

  console.log('[shopmonkey] Fetching users...');
  const users = await fetchUsers(session);
  console.log(`[shopmonkey]   → ${users.length} users`);

  console.log('[shopmonkey] Fetching vendors...');
  const vendors = await fetchVendors(session);
  console.log(`[shopmonkey]   → ${vendors.length} vendors`);

  return {
    exportedAt: new Date().toISOString(),
    companyId: session.companyId,
    customers,
    vehicles,
    orders,
    parts,
    users,
    vendors,
    counts: {
      customers: customers.length,
      vehicles: vehicles.length,
      orders: orders.length,
      parts: parts.length,
      users: users.length,
      vendors: vendors.length,
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
