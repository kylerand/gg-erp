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
  'app/planning/slots/page.tsx',
  'app/reporting/page.tsx',
  'app/admin/accounting/page.tsx',
  'app/admin/audit/page.tsx',
  'app/admin/integrations/page.tsx',
  'app/training/page.tsx',
  'app/training/[moduleId]/page.tsx',
  'app/training/[moduleId]/quiz/page.tsx',
  'app/training/[moduleId]/step/[stepId]/page.tsx',
  'app/training/admin/page.tsx',
  'app/training/assignments/page.tsx',
  'app/training/my-ojt/page.tsx',
  'app/work-orders/[id]/page.tsx',
  'app/work-orders/dispatch/DispatchClient.tsx',
  'app/work-orders/new/page.tsx',
  'app/sales/opportunities/[id]/page.tsx',
  'app/sales/opportunities/new/page.tsx',
  'app/sales/quotes/[id]/page.tsx',
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
    'listEmployees(undefined, { allowMockFallback: false })',
    'employeeById={employeeById}',
    'employeeDisplayName(technician)',
    'technicianDisplayName(entry.technicianId, employeeById)',
    'listWorkOrderQcGates',
    'submitWorkOrderQcGates',
    'transitionWoOperation',
    'getOperationActions',
    'CustomerProfileDrawer',
    'CartProfileDrawer',
    'updateCustomer',
    'updateCartVehicle',
    'SalesContextPanel',
    "erpRoute('create-quote'",
    "erpRoute('quote'",
    'useSearchParams',
    "searchParams.get('operationId')",
    'operationElementId',
    'Planner focus',
    'scrollIntoView',
    'allowMockFallback: false',
  ];

  assert.deepEqual(
    requiredCalls.filter((call) => !source.includes(call)),
    [],
  );
  assert.equal(/will appear here/i.test(source), false);
  assert.equal(source.includes('<span>{entry.technicianId}</span>'), false);
  assert.equal(source.includes('entry.description ?? entry.technicianId'), false);
});

test('create forms use live selectors instead of raw ID entry fields', () => {
  const workOrderSource = readSource('app/work-orders/new/page.tsx');
  const timeLoggingSource = readSource('app/work-orders/time-logging/page.tsx');
  const opportunitySource = readSource('app/sales/opportunities/new/page.tsx');
  const quoteSource = readSource('app/sales/quotes/new/page.tsx');
  const reservationsSource = readSource('app/inventory/reservations/page.tsx');

  assert.deepEqual(
    [
      'listCustomers',
      'listCartVehicles',
      'listWorkOrders',
      'workOrderVehicleDisplayName',
      'workOrderCustomerDisplayName',
      'SearchableSelect',
    ].filter((call) => !workOrderSource.includes(call)),
    [],
  );
  assert.deepEqual(
    ['listCustomers', 'getCustomer', 'listOpportunities', 'listParts', 'SearchableSelect'].filter(
      (call) => !quoteSource.includes(call),
    ),
    [],
  );
  assert.deepEqual(
    ['listCustomers', 'getCustomer', 'SearchableSelect', 'allowMockFallback: false'].filter(
      (call) => !opportunitySource.includes(call),
    ),
    [],
  );
  assert.deepEqual(
    [
      'listWorkOrders',
      'workOrderVehicleDisplayName',
      'workOrderCustomerDisplayName',
      'SearchableSelect',
      'allowMockFallback: false',
    ].filter((call) => !timeLoggingSource.includes(call)),
    [],
  );
  assert.deepEqual(
    [
      'listWorkOrders({ limit: 200 }, { allowMockFallback: false })',
      'workOrderOption',
      'workOrderVehicleDisplayName',
      'workOrderCustomerDisplayName',
      'selectedWorkOrderId',
      'SearchableSelect',
    ].filter((call) => !reservationsSource.includes(call)),
    [],
  );
  assert.equal(timeLoggingSource.includes('placeholder="WO-001"'), false);
  assert.equal(timeLoggingSource.includes('Cart ${workOrder.vehicleId}'), false);
  assert.equal(workOrderSource.includes('Configuration ${workOrder.buildConfigurationId}'), false);
  assert.equal(workOrderSource.includes('vehicle ${workOrder.vehicleId}'), false);
  assert.equal(reservationsSource.includes('Work Order ID'), false);

  const rawIdLabels = [
    /Customer ID/i,
    /Vehicle ID/i,
    /Build Config ID/i,
    /BOM ID/i,
    /Opportunity ID/i,
    /Part ID/i,
    /Work Order ID/i,
  ];
  const rawIdUses = rawIdLabels.flatMap((pattern) =>
    [
      ['app/work-orders/new/page.tsx', workOrderSource] as const,
      ['app/sales/opportunities/new/page.tsx', opportunitySource] as const,
      ['app/sales/quotes/new/page.tsx', quoteSource] as const,
      ['app/inventory/reservations/page.tsx', reservationsSource] as const,
    ]
      .filter(([, source]) => pattern.test(source))
      .map(([page]) => ({ page, pattern: pattern.source })),
  );

  assert.deepEqual(rawIdUses, []);
});

test('messages attach files through saved communication attachments', () => {
  const source = readSource('app/messages/page.tsx');
  const apiClientSource = readSource('lib/api-client.ts');
  const communicationHandlersSource = readFileSync(
    path.resolve(WEB_SRC_DIR, '../../../apps/api/src/lambda/communication/handlers.ts'),
    'utf8',
  );

  assert.deepEqual(
    [
      'uploadAttachment',
      'getAttachmentDownloadUrl',
      'listEmployees',
      'authorDisplayName',
      'authorInitials',
      'SearchableSelect',
      'attachmentIds',
      'onOpenAttachment',
      'todoAssigneeId',
      'employeeNameById',
      'formatFileSize',
      'allowMockFallback: false',
    ].filter((snippet) => !source.includes(snippet)),
    [],
  );
  assert.deepEqual(
    [
      'attachmentIds?: string[]',
      'author?: ChannelMessageAuthor',
      '/attachments/${id}/download',
    ].filter((snippet) => !apiClientSource.includes(snippet)),
    [],
  );
  assert.deepEqual(
    ['loadAuthorProfiles', 'author: authorProfiles.get(m.authorId)'].filter(
      (snippet) => !communicationHandlersSource.includes(snippet),
    ),
    [],
  );
  assert.equal(source.includes('TODO: Upload files'), false);
  assert.equal(source.includes('Avatar placeholder'), false);
  assert.equal(source.includes('todo.assigneeId.slice'), false);
  assert.equal(source.includes('message.authorId.slice'), false);
});

test('quote detail exposes live conversion into shop execution', () => {
  const source = readSource('app/sales/quotes/[id]/page.tsx');
  const requiredCalls = [
    'convertQuoteToWorkOrder',
    "erpRecordRoute('work-order'",
    'Convert to Work Order',
    'allowMockFallback: false',
  ];

  assert.deepEqual(
    requiredCalls.filter((call) => !source.includes(call)),
    [],
  );
});

test('sales quote and opportunity views resolve customer and user display profiles', () => {
  const quotesSource = readSource('app/sales/quotes/page.tsx');
  const quoteDetailSource = readSource('app/sales/quotes/[id]/page.tsx');
  const quoteCreateSource = readSource('app/sales/quotes/new/page.tsx');
  const opportunityDetailSource = readSource('app/sales/opportunities/[id]/page.tsx');
  const opportunityInsightsSource = readSource('components/sales/OpportunityInsights.tsx');
  const pricingIntelligenceSource = readSource('components/sales/PricingIntelligence.tsx');
  const apiClientSource = readSource('lib/api-client.ts');
  const salesHandlersSource = readFileSync(
    path.resolve(WEB_SRC_DIR, '../../../apps/api/src/lambda/sales/handlers.ts'),
    'utf8',
  );

  assert.deepEqual(
    [
      'salesCustomerDisplayName(q.customerProfile)',
      'getCustomer(customerId, { allowMockFallback: false })',
      'Filtered to customer',
    ].filter((snippet) => !quotesSource.includes(snippet)),
    [],
  );
  assert.deepEqual(
    [
      'salesCustomerDisplayName(quote.customerProfile)',
      'salesUserDisplayName(quote.createdByUser)',
      "erpRecordRoute('sales-opportunity'",
      'applyQuoteUpdate',
    ].filter((snippet) => !quoteDetailSource.includes(snippet)),
    [],
  );
  assert.deepEqual(
    [
      'getWoOrder(sourceWorkOrderId, { allowMockFallback: false })',
      'sourceWorkOrderDisplayName',
      'sourceWorkOrderCustomerDisplayName',
      'sourceWorkOrderCartDisplayName',
      'Open source work order',
    ].filter((snippet) => !quoteCreateSource.includes(snippet)),
    [],
  );
  assert.deepEqual(
    [
      'getOpportunity(params.id, { allowMockFallback: false })',
      'salesCustomerDisplayName(opportunity.customerProfile)',
      'salesUserDisplayName(opportunity.assignedToUser)',
      'customerName={customerName}',
    ].filter((snippet) => !opportunityDetailSource.includes(snippet)),
    [],
  );
  assert.deepEqual(
    [
      'SalesCustomerProfile',
      'SalesUserProfile',
      'customerProfile?: SalesCustomerProfile',
      'assignedToUser?: SalesUserProfile',
      'createdByUser?: SalesUserProfile',
      'salesCustomerDisplayName',
      'const data = await apiFetch<{',
      'return data.opportunity',
    ].filter((snippet) => !apiClientSource.includes(snippet)),
    [],
  );
  assert.deepEqual(
    [
      'loadCustomerProfiles',
      'loadUserProfiles',
      'customerProfile',
      'assignedToUser',
      'createdByUser',
    ].filter((snippet) => !salesHandlersSource.includes(snippet)),
    [],
  );

  assert.equal(quotesSource.includes('{q.customerId}</td>'), false);
  assert.equal(quotesSource.includes('Filtered to customer ${customerIdFilter}'), false);
  assert.equal(quoteDetailSource.includes("{ label: 'Customer', value: quote.customerId }"), false);
  assert.equal(
    quoteDetailSource.includes("{ label: 'Created By', value: quote.createdByUserId"),
    false,
  );
  assert.equal(quoteCreateSource.includes('Prepared from work order ${sourceWorkOrderId}'), false);
  assert.equal(quoteCreateSource.includes('Source work order: {sourceWorkOrderId}'), false);
  assert.equal(
    opportunityDetailSource.includes("{ label: 'Customer', value: opportunity.customerId }"),
    false,
  );
  assert.equal(opportunityDetailSource.includes('customerName={opportunity.customerId}'), false);
  assert.equal(opportunityInsightsSource.includes('Customer ID'), false);
  assert.equal(pricingIntelligenceSource.includes('Customer ID'), false);
});

test('build-slot planner renders live demand projection instead of visualization filler', () => {
  const source = readSource('app/planning/slots/page.tsx');

  assert.deepEqual(
    [
      'getSchedulePreview',
      'listScheduleAssignments',
      'publishSchedule',
      'listCapacitySlots',
      'createCapacitySlot',
      'importCapacitySlots',
      'cancelCapacitySlot',
      'allowMockFallback: false',
      "erpRecordRoute('work-order'",
      'workOrderOperationHref',
      'workOrderOperationHref(item)',
      'workOrderOperationHref(assignment)',
      'operationId: item.operationId',
      "erpRoute('dispatch-board')",
      'Unscheduled demand',
      'Capacity management',
      'Schedule publication',
      'Published assignments',
      'Import CSV',
    ].filter((snippet) => !source.includes(snippet)),
    [],
  );
  assert.equal(source.includes('idx % 5'), false);
  assert.equal(source.includes("toast.success('Plan published"), false);
  assert.equal(source.includes('Assign work to'), false);
});

test('dispatch board executes published schedule assignments from live APIs', () => {
  const source = readSource('app/work-orders/dispatch/DispatchClient.tsx');
  const apiClientSource = readSource('lib/api-client.ts');

  assert.deepEqual(
    [
      'listScheduleAssignments',
      'transitionWoOperation',
      'listTechnicianTasks',
      'listEmployees',
      'STRICT_LIVE_DATA',
      'allowMockFallback: false',
      'Published schedule',
      'Action queue',
      'Start operation',
      'Complete',
      'Block Operation',
      "erpRoute('build-slot')",
      "erpRecordRoute('work-order'",
    ].filter((snippet) => !source.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'export async function listEmployees(',
      'export async function listTechnicianTasks(',
      'transitionWoOperation(',
      'workOrderTitle?: string',
      'routingStepCode?: string',
      'options?: ApiDataOptions',
    ].filter((snippet) => !apiClientSource.includes(snippet)),
    [],
  );
  assert.equal(source.includes('{ task: { ...selectedTask'), false);
  assert.equal(source.includes('task.workOrderNumber ?? task.workOrderId'), false);
  assert.equal(source.includes('task.routingStepTitle ?? task.routingStepId'), false);
  assert.equal(source.includes('selectedTask.workOrderNumber ?? selectedTask.workOrderId'), false);
  assert.equal(source.includes('{selectedTask.routingStepTitle}'), false);
});

test('floor execution pages resolve task and work-order context instead of raw IDs', () => {
  const myQueueSource = readSource('app/work-orders/my-queue/page.tsx');
  const qcSource = readSource('app/work-orders/qc-checklists/page.tsx');
  const sopSource = readSource('app/work-orders/sop-runner/page.tsx');
  const apiClientSource = readSource('lib/api-client.ts');
  const ticketHandlersSource = readFileSync(
    path.resolve(WEB_SRC_DIR, '../../../apps/api/src/lambda/tickets/handlers.ts'),
    'utf8',
  );

  assert.match(
    myQueueSource,
    /erpRoute\('sop-runner',[\s\S]*\{[\s\S]*taskId: task\.id,[\s\S]*workOrderId: task\.workOrderId[\s\S]*\}/,
  );

  assert.deepEqual(
    [
      'getWoOrder(workOrderId, { allowMockFallback: false })',
      "erpRoute('my-work-queue')",
      "erpRecordRoute('work-order', workOrderId)",
      'workOrderContextDescription',
    ].filter((snippet) => !qcSource.includes(snippet)),
    [],
  );
  assert.deepEqual(
    [
      'getWoOrder(workOrderId, { allowMockFallback: false })',
      "erpRecordRoute('work-order', workOrderId)",
      'workOrderContextDescription',
    ].filter((snippet) => !sopSource.includes(snippet)),
    [],
  );
  assert.deepEqual(
    ['workOrderTitle?: string', 'routingStepCode?: string'].filter(
      (snippet) => !apiClientSource.includes(snippet),
    ),
    [],
  );
  assert.deepEqual(
    ['buildTaskResponses', 'workOrderNumber', 'workOrderTitle', 'routingStepTitle'].filter(
      (snippet) => !ticketHandlersSource.includes(snippet),
    ),
    [],
  );

  assert.equal(myQueueSource.includes('Step ${task.routingStepId}'), false);
  assert.equal(myQueueSource.includes('Step ${blockDialogTask.routingStepId}'), false);
  assert.equal(qcSource.includes('WO ${workOrderId}'), false);
  assert.equal(sopSource.includes('WO ${workOrderId}'), false);
  assert.equal(sopSource.includes('Task ${taskId}'), false);
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
  const reportingExportSource = readSource('app/reporting/ReportingExportActions.tsx');
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
      'ERP_SAVED_REPORT_VIEWS',
      'saved-report-daily-shop-pulse',
      'saved-report-accounting-exceptions',
      '/training/assignments?status=OVERDUE',
      '/admin/audit?search=DENIED',
    ].filter((snippet) => !reportRegistrySource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'getLiveErpReports',
      'getErpSavedReportViews',
      'ReportingExportActions',
      'Saved Views',
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
      'downloadCsv',
      'Export visible reports',
      'Export saved views',
      'Copy drill-through links',
    ].filter((snippet) => !reportingExportSource.includes(snippet)),
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
      'AUDIT_RESOURCE_DESTINATIONS',
      'resolveAuditResource',
      "erpRecordRoute('work-order'",
      "erpRecordRoute('purchase-order'",
      "erpRoute('customer', { search: event.entityId })",
      'No direct workspace route yet',
      'allowMockFallback: false',
    ].filter((snippet) => !auditSource.includes(snippet)),
    [],
  );
  assert.equal(auditSource.includes('entityId.slice(0, 8)'), false);
});

test('training content keeps notes, bookmarks, and media wired to live APIs', () => {
  const moduleSource = readSource('app/training/[moduleId]/page.tsx');
  const stepSource = readSource('app/training/[moduleId]/step/[stepId]/page.tsx');
  const quizSource = readSource('app/training/[moduleId]/quiz/page.tsx');
  const myOjtSource = readSource('app/training/my-ojt/page.tsx');
  const assignmentsSource = readSource('app/training/assignments/page.tsx');
  const apiClientSource = readSource('lib/api-client.ts');
  const sopHandlersSource = readFileSync(
    path.resolve(WEB_SRC_DIR, '../../../apps/api/src/lambda/sop/handlers.ts'),
    'utf8',
  );
  const seedSource = readFileSync(
    path.resolve(WEB_SRC_DIR, '../../../packages/db/prisma/seed.ts'),
    'utf8',
  );

  assert.deepEqual(
    ['href={steps[0] ? erpNestedRoute', 'href="#"'].filter((snippet) =>
      moduleSource.includes(snippet),
    ),
    [],
  );

  assert.deepEqual(
    [
      'getTrainingModule(moduleId, { allowMockFallback: false })',
      'getModuleProgress(mod.id, employeeId, { allowMockFallback: false })',
      'listNotes(employeeId, mod.id, { allowMockFallback: false })',
      'listBookmarks(employeeId, mod.id, { allowMockFallback: false })',
      'saveNote(employeeId, module.id, content, stepId,',
      'toggleBookmark(employeeId, module.id, stepId,',
      'Progress tools did not load. Lesson content is still available.',
    ].filter((snippet) => !stepSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'getTrainingModule(moduleId, { allowMockFallback: false })',
      'submitQuiz(moduleId, employeeId, answers, { allowMockFallback: false })',
    ].filter((snippet) => !quizSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'listMyAssignments(employeeId, {}, { allowMockFallback: false })',
      'completeAssignment(id, undefined, { allowMockFallback: false })',
    ].filter((snippet) => !myOjtSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      "listMyAssignments('', {}, { allowMockFallback: false })",
      'listEmployees(undefined, { allowMockFallback: false })',
      'const employeeById = useMemo',
      "formatEmployeeName(employee) ?? 'Unresolved employee'",
      'employee?.employeeNumber',
    ].filter((snippet) => !assignmentsSource.includes(snippet)),
    [],
  );
  assert.equal(assignmentsSource.includes('{assignment.employeeId}</p>'), false);

  assert.deepEqual(
    [
      'options?: ApiDataOptions',
      'listNotes(',
      'listBookmarks(',
      'toggleBookmark(',
      'completeAssignment(',
    ].filter((snippet) => !apiClientSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'trainingStateQueries',
      'findModuleReference',
      'resolveTrainingStateModule',
      'moduleId: moduleResult.moduleId',
      'employeeId must be a valid UUID',
    ].filter((snippet) => !sopHandlersSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'OJT-BUILD-BASICS',
      "thumbnailUrl: '/images/modules/ojt-basic-cart-build.svg'",
      'trainingAssignment.upsert',
    ].filter((snippet) => !seedSource.includes(snippet)),
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

test('admin configuration catalog is registry-backed with live settings destinations', () => {
  const adminSource = readSource('app/admin/page.tsx');
  const adminConfigSource = readFileSync(
    path.resolve(WEB_SRC_DIR, '../../../packages/domain/src/erp-admin-config.ts'),
    'utf8',
  );

  assert.deepEqual(
    [
      'ERP_ADMIN_CONFIGURATION_DOMAINS',
      'admin-config-user-access',
      'admin-config-accounting-settings',
      'admin-config-integration-health',
      'admin-config-audit-trail',
      '/admin/access',
      '/admin/accounting',
      '/admin/integrations',
      '/admin/audit',
    ].filter((snippet) => !adminConfigSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'getLiveErpAdminConfigurationDomains',
      'AdminConfigCard',
      'Live Signals',
      'Actions',
      'Live admin destinations',
    ].filter((snippet) => !adminSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    ['href="#"', 'TODO', 'placeholder'].filter(
      (snippet) => adminSource.includes(snippet) || adminConfigSource.includes(snippet),
    ),
    [],
  );
});

test('accounting sync monitor exposes live purchase-order payable handoff', () => {
  const accountingSource = readSource('app/accounting/page.tsx');
  const syncSource = readSource('app/accounting/sync/page.tsx');
  const apiClientSource = readSource('lib/api-client.ts');
  const workspaceSource = readFileSync(
    path.resolve(WEB_SRC_DIR, '../../../packages/domain/src/erp-workspaces.ts'),
    'utf8',
  );
  const registrySource = readFileSync(
    path.resolve(WEB_SRC_DIR, '../../../packages/domain/src/erp-object-registry.ts'),
    'utf8',
  );

  assert.deepEqual(
    [
      'ACCOUNTING_LINKS.payables',
      'summarizePayables',
      'const STRICT_LIVE_DATA = { allowMockFallback: false } as const',
      'getQbStatus(STRICT_LIVE_DATA)',
      'listInvoiceSyncRecords(undefined, STRICT_LIVE_DATA)',
      "listInvoiceSyncRecords({ state: 'FAILED' }, STRICT_LIVE_DATA)",
      'listCustomerSyncs(undefined, STRICT_LIVE_DATA)',
      'listReconciliationRuns({ limit: 1 }, STRICT_LIVE_DATA)',
      'listIntegrationAccounts(STRICT_LIVE_DATA)',
      'getFailureSummary(STRICT_LIVE_DATA)',
      'listPurchaseOrders({ pageSize: 200 }, STRICT_LIVE_DATA)',
      'LiveDataWarning',
      'PO bill review',
    ].filter((snippet) => !accountingSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      "view === 'payables'",
      'buildPayableRows',
      'PayablesList',
      "erpRecordRoute('purchase-order'",
      "erpRoute('receiving')",
      "erpRecordRoute('work-order'",
      "erpRoute('customer'",
      'invoiceSyncWorkOrderDisplayName',
      'customerSyncDisplayName',
      'const STRICT_LIVE_DATA = { allowMockFallback: false } as const',
      'listInvoiceSyncRecords({ state: syncState, limit: 200 }, STRICT_LIVE_DATA)',
      'listCustomerSyncs({ state: syncState, limit: 200 }, STRICT_LIVE_DATA)',
      'listPurchaseOrders({ pageSize: 200 }, STRICT_LIVE_DATA)',
      'listIntegrationAccounts(STRICT_LIVE_DATA)',
      'getFailureSummary(STRICT_LIVE_DATA)',
      'getQbStatus(STRICT_LIVE_DATA)',
    ].filter((snippet) => !syncSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    ['{r.workOrderId}', '{r.customerId}'].filter((snippet) => syncSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    ['vendor-payable', '/accounting/sync?view=payables'].filter(
      (snippet) => !workspaceSource.includes(snippet) || !registrySource.includes(snippet),
    ),
    [],
  );

  assert.deepEqual(
    ['export async function getFailureSummary(options?: ApiDataOptions)'].filter(
      (snippet) => !apiClientSource.includes(snippet),
    ),
    [],
  );
});

test('inventory procurement drill-in uses live PO/vendor reads and focused receiving links', () => {
  const inventorySource = readSource('app/inventory/page.tsx');
  const partsSource = readSource('app/inventory/parts/page.tsx');
  const purchaseOrdersSource = readSource('app/inventory/purchase-orders/page.tsx');
  const purchaseOrderDetailSource = readSource('app/inventory/purchase-orders/[id]/page.tsx');
  const receivingSource = readSource('app/inventory/receiving/page.tsx');
  const reservationsSource = readSource('app/inventory/reservations/page.tsx');
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
      'SearchableSelect',
      'Search active vendors',
      'Search active parts',
      'useSearchParams',
      "erpRecordRoute('purchase-order'",
      'allowMockFallback: false',
      'selectedPurchaseOrderIds',
      'exportPurchaseOrders',
      'Copy PO numbers',
    ].filter((snippet) => !purchaseOrdersSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'downloadCsv',
      'parseCsv',
      'createPart',
      'selectedPartIds',
      'handlePartImport',
      'Create valid parts',
      'accept=".csv,text/csv"',
    ].filter((snippet) => !partsSource.includes(snippet)),
    [],
  );

  assert.deepEqual(
    [
      'getPurchaseOrder',
      'getVendor',
      'updatePurchaseOrder',
      'SearchableSelect',
      'Search active vendors',
      'Search active parts',
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
      "erpRecordRoute('part'",
      'Receiving variance report',
      'partDisplayLabel',
      'SKU missing. Open part detail to repair catalog mapping.',
      'rejectedQuantity',
      'receiveInventoryLot',
    ].filter((snippet) => !receivingSource.includes(snippet)),
    [],
  );
  assert.equal(receivingSource.includes('?? row.line.partId'), false);
  assert.equal(receivingSource.includes('?? line.partId'), false);

  assert.deepEqual(
    [
      'reservationWorkOrderLabel',
      'reservationWorkOrderDetail',
      'Unresolved work order',
      'Work-order number missing. Open detail to repair context.',
      "erpRecordRoute('work-order', reservation.workOrderId)",
    ].filter((snippet) => !reservationsSource.includes(snippet)),
    [],
  );
  assert.equal(reservationsSource.includes('?? reservation.workOrderId'), false);

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
      'export async function createPart',
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
