import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC_DIR = path.resolve(__dirname, '..');

const truthCriticalPages = [
  'app/customer-dealers/page.tsx',
  'app/inventory/page.tsx',
  'app/inventory/planning/page.tsx',
  'app/inventory/purchase-orders/page.tsx',
  'app/inventory/purchase-orders/[id]/page.tsx',
  'app/inventory/receiving/page.tsx',
  'app/inventory/reservations/page.tsx',
  'app/reporting/page.tsx',
  'app/admin/accounting/page.tsx',
  'app/admin/audit/page.tsx',
  'app/admin/integrations/page.tsx',
  'app/training/page.tsx',
  'app/training/admin/page.tsx',
  'app/training/assignments/page.tsx',
  'app/work-orders/[id]/page.tsx',
  'app/work-orders/new/page.tsx',
  'app/sales/quotes/new/page.tsx',
] as const;

function readSource(relativePath: string): string {
  return readFileSync(path.join(WEB_SRC_DIR, relativePath), 'utf8');
}

test('truth-critical pages opt out of local mock fallback data', () => {
  const missingStrictMode = truthCriticalPages.filter((relativePath) => {
    const source = readSource(relativePath);
    return !source.includes('allowMockFallback: false');
  });

  assert.deepEqual(missingStrictMode, []);
});

test('truth-critical pages do not render placeholder stat values', () => {
  const placeholderPatterns = [
    /value:\s*['"`]\u2014['"`]/,
    /value:\s*['"`]TBD['"`]/i,
    /value:\s*['"`]N\/A['"`]/i,
    /not connected/i,
    /placeholder\s+(data|values?|content|screen)/i,
  ];

  const placeholderUses = truthCriticalPages.flatMap((relativePath) => {
    const source = readSource(relativePath);
    return placeholderPatterns
      .filter((pattern) => pattern.test(source))
      .map((pattern) => ({ page: relativePath, pattern: pattern.source }));
  });

  assert.deepEqual(placeholderUses, []);
});

test('apiFetch can reject local mock fallback data for truth-critical calls', async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001';
  const { apiFetch } = await import('./api-client.js');
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];

  globalThis.fetch = async () => {
    throw new TypeError('offline');
  };
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    await assert.rejects(
      apiFetch('/missing-route', undefined, { ok: true }, { allowMockFallback: false }),
      /offline/,
    );
    assert.deepEqual(warnings, []);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('work-order detail page wires live execution panels', () => {
  const source = readSource('app/work-orders/[id]/page.tsx');
  const requiredCalls = [
    'listWorkOrderTimeEntries',
    'createLaborTimeEntry',
    'listWorkOrderQcGates',
    'submitWorkOrderQcGates',
    'CustomerProfileDrawer',
    'CartProfileDrawer',
    'SalesContextPanel',
    "erpRoute('create-quote'",
    "erpRoute('quote'",
    'allowMockFallback: false',
  ];

  assert.deepEqual(
    requiredCalls.filter((call) => !source.includes(call)),
    [],
  );
  assert.equal(/will appear here/i.test(source), false);
});

test('create forms use live selectors instead of raw ID entry fields', () => {
  const workOrderSource = readSource('app/work-orders/new/page.tsx');
  const quoteSource = readSource('app/sales/quotes/new/page.tsx');

  assert.deepEqual(
    ['listCustomers', 'listCartVehicles', 'listWorkOrders', 'SearchableSelect'].filter(
      (call) => !workOrderSource.includes(call),
    ),
    [],
  );
  assert.deepEqual(
    ['listCustomers', 'getCustomer', 'listOpportunities', 'listParts', 'SearchableSelect'].filter(
      (call) => !quoteSource.includes(call),
    ),
    [],
  );

  const rawIdLabels = [
    /Customer ID/i,
    /Vehicle ID/i,
    /Build Config ID/i,
    /BOM ID/i,
    /Opportunity ID/i,
    /Part ID/i,
  ];
  const rawIdUses = rawIdLabels.flatMap((pattern) =>
    [
      ['app/work-orders/new/page.tsx', workOrderSource] as const,
      ['app/sales/quotes/new/page.tsx', quoteSource] as const,
    ]
      .filter(([, source]) => pattern.test(source))
      .map(([page]) => ({ page, pattern: pattern.source })),
  );

  assert.deepEqual(rawIdUses, []);
});

test('dashboard KPI cards deep-link to filtered destination views', () => {
  const roleDashboardSource = readSource('components/RoleDashboard.tsx');
  const inventorySource = readSource('app/inventory/page.tsx');
  const partsSource = readSource('app/inventory/parts/page.tsx');
  const reservationsSource = readSource('app/inventory/reservations/page.tsx');
  const reportingSource = readSource('app/reporting/page.tsx');
  const quickBooksSource = readSource('app/accounting/quickbooks/QuickBooksDataView.tsx');

  assert.deepEqual(
    [
      "erpRoute('blocked-work', { status: 'BLOCKED' })",
      "erpRoute('work-order', { status: 'COMPLETED' })",
      "erpRoute('part', { stock: 'OUT' })",
      "erpRoute('inventory-reservation', { status: 'OPEN' })",
    ].filter((snippet) => !roleDashboardSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      "listParts({ partState: 'ACTIVE'",
      "listParts({ stock: 'OUT'",
      "erpRoute('part', { partState: 'ACTIVE' })",
      "erpRoute('part', { stock: 'OUT' })",
      "erpRoute('inventory-reservation', { status: 'OPEN' })",
    ].filter((snippet) => !inventorySource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'useSearchParams',
      "searchParams.get('partState')",
      "searchParams.get('stock')",
      'router.push(buildPartsHref',
    ].filter((snippet) => !partsSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    ['useSearchParams', "searchParams.get('status')", 'router.push(buildReservationsHref'].filter(
      (snippet) => !reservationsSource.includes(snippet),
    ),
    [],
  );

  assert.deepEqual(
    [
      'getLiveErpReports',
      'loadReportSignals',
      "erpRoute('blocked-work', { status: 'BLOCKED' })",
    ].filter((snippet) => !reportingSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    ['normalizeInitialFilter', 'replaceQuickBooksLocation', "filter: filter === 'ALL'"].filter(
      (snippet) => !quickBooksSource.includes(snippet),
    ),
    [],
  );
});

test('reporting catalog is registry-backed with filtered drill-through destinations', () => {
  const reportingSource = readSource('app/reporting/page.tsx');
  const assignmentsSource = readSource('app/training/assignments/page.tsx');
  const auditSource = readSource('app/admin/audit/page.tsx');
  const reportRegistrySource = readFileSync(
    path.resolve(WEB_SRC_DIR, '../../../packages/domain/src/erp-reports.ts'),
    'utf8',
  );

  assert.deepEqual(
    [
      'ERP_REPORTS',
      'report-work-order-blockers',
      'report-material-shortages',
      'report-open-accounts-receivable',
      'report-overdue-training',
      'report-audit-events',
      '/training/assignments?status=OVERDUE',
      '/admin/audit?search=DENIED',
    ].filter((snippet) => !reportRegistrySource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'getLiveErpReports',
      'reportingHref',
      'ReportCard',
      'allowMockFallback: false',
      'listParts({ stock: ',
      "listInventoryReservations(\n        { status: 'OPEN'",
      "listAuditEvents({ search: 'DENIED'",
    ].filter((snippet) => !reportingSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'useSearchParams',
      "searchParams.get('status')",
      "searchParams.get('search')",
      'parseAssignmentFilter',
      'buildAssignmentsHref',
      'allowMockFallback: false',
    ].filter((snippet) => !assignmentsSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'useSearchParams',
      "searchParams.get('search')",
      'buildAuditHref',
      'allowMockFallback: false',
    ].filter((snippet) => !auditSource.includes(snippet)),
    [],
  );
});

test('admin integration health uses live strict sources instead of static connector fixtures', () => {
  const integrationsSource = readSource('app/admin/integrations/page.tsx');

  assert.deepEqual(
    [
      'getQbStatus',
      'listIntegrationAccounts',
      'listInvoiceSyncRecords',
      'listCustomerSyncs',
      'listReconciliationRuns',
      'allowMockFallback: false',
      "erpRoute('accounting-sync', { view: 'failures' })",
    ].filter((snippet) => !integrationsSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    ['const INTEGRATIONS', '2026-03-10', 'ShopMonkey Migration', 'AWS EventBridge'].filter(
      (snippet) => integrationsSource.includes(snippet),
    ),
    [],
  );
});

test('admin accounting settings expose live mapping configuration actions', () => {
  const accountingSettingsSource = readSource('app/admin/accounting/page.tsx');
  const adminWorkspaceSource = readFileSync(
    path.resolve(WEB_SRC_DIR, '../../../packages/domain/src/erp-workspaces.ts'),
    'utf8',
  );
  const apiClientSource = readSource('lib/api-client.ts');

  assert.deepEqual(
    [
      'listIntegrationAccounts',
      'listDimensionMappings',
      'listTaxMappings',
      'upsertDimensionMapping',
      'upsertTaxMapping',
      'allowMockFallback: false',
      "erpRoute('accounting-settings'",
      'Invoice Export Readiness',
    ].filter((snippet) => !accountingSettingsSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'accounting-settings',
      '/admin/accounting',
      'Configure QuickBooks export mappings and tax codes',
    ].filter((snippet) => !adminWorkspaceSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'export async function listDimensionMappings',
      'export async function upsertDimensionMapping',
      'export async function listTaxMappings',
      'export async function upsertTaxMapping',
    ].filter((snippet) => !apiClientSource.includes(snippet)),
    [],
  );
});

test('inventory procurement drill-in uses live PO/vendor reads and focused receiving links', () => {
  const inventorySource = readSource('app/inventory/page.tsx');
  const purchaseOrdersSource = readSource('app/inventory/purchase-orders/page.tsx');
  const purchaseOrderDetailSource = readSource('app/inventory/purchase-orders/[id]/page.tsx');
  const receivingSource = readSource('app/inventory/receiving/page.tsx');
  const planningSource = readSource('app/inventory/planning/page.tsx');
  const apiClientSource = readSource('lib/api-client.ts');

  assert.deepEqual(
    [
      "listPurchaseOrders({ status: 'SENT'",
      "erpRoute('purchase-order', { status: 'SENT' })",
    ].filter((snippet) => !inventorySource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'listPurchaseOrders(',
      'listVendors(',
      'createPurchaseOrder',
      'listParts(',
      'useSearchParams',
      "erpRecordRoute('purchase-order'",
      'allowMockFallback: false',
    ].filter((snippet) => !purchaseOrdersSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'getPurchaseOrder',
      'getVendor',
      'updatePurchaseOrder',
      'approvePurchaseOrder',
      'sendPurchaseOrder',
      'cancelPurchaseOrder',
      'closePurchaseOrder',
      "erpRoute('receiving')",
      'allowMockFallback: false',
      "erpRecordRoute('part'",
    ].filter((snippet) => !purchaseOrderDetailSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      "searchParams.get('purchaseOrderId')",
      "searchParams.get('lineId')",
      "erpRecordRoute('purchase-order'",
    ].filter((snippet) => !receivingSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    ["erpRoute('purchase-order'", 'defaultVendorId'].filter(
      (snippet) => !planningSource.includes(snippet),
    ),
    [],
  );

  assert.deepEqual(
    [
      'export async function getPurchaseOrder',
      'export async function getVendor',
      'export async function createPurchaseOrder',
      'export async function updatePurchaseOrder',
      'export function approvePurchaseOrder',
      'export function sendPurchaseOrder',
      'export function cancelPurchaseOrder',
      'export function closePurchaseOrder',
      'vendorId',
    ].filter((snippet) => !apiClientSource.includes(snippet)),
    [],
  );
});
