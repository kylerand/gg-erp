export type ErpModuleKey =
  | 'work-orders'
  | 'sales'
  | 'inventory'
  | 'customers'
  | 'training'
  | 'planning'
  | 'accounting'
  | 'messages'
  | 'reporting'
  | 'admin';

export type ErpObjectKind =
  | 'document'
  | 'master'
  | 'queue'
  | 'workspace'
  | 'report'
  | 'integration'
  | 'settings'
  | 'communication';

export type ErpRouteStatus = 'live' | 'planned';

export interface ErpObjectQuickActionDescriptor {
  key: string;
  label: string;
  description: string;
  module: ErpModuleKey;
  objectKey: string;
  route: string;
  action: 'create' | 'open' | 'review' | 'sync';
  status: ErpRouteStatus;
  keywords: readonly string[];
}

export interface ErpObjectDescriptor {
  key: string;
  label: string;
  pluralLabel: string;
  description: string;
  module: ErpModuleKey;
  kind: ErpObjectKind;
  ownerContext: string;
  route: string;
  status: ErpRouteStatus;
  primaryStatusField?: string;
  searchFields?: readonly string[];
  numberSeries?: string;
  listColumns?: readonly string[];
  keywords?: readonly string[];
  quickActions?: readonly ErpObjectQuickActionDescriptor[];
}

export interface ErpCommandDestinationDescriptor {
  key: string;
  label: string;
  description: string;
  route: string;
  group: string;
  module: ErpModuleKey;
  status: ErpRouteStatus;
  keywords: readonly string[];
  icon: ErpModuleKey | 'plus';
}

export const ERP_OBJECTS = [
  {
    key: 'work-order',
    label: 'Work Order',
    pluralLabel: 'Work Orders',
    description: 'Build and service jobs from intake through closeout.',
    module: 'work-orders',
    kind: 'document',
    ownerContext: 'build-planning',
    route: '/work-orders',
    status: 'live',
    primaryStatusField: 'workOrderStatus',
    searchFields: ['workOrderNumber', 'customerName', 'vehicleVin', 'cartSerial'],
    numberSeries: 'WO-.#####',
    listColumns: ['workOrderNumber', 'customerName', 'status', 'dueDate', 'assignedTech'],
    keywords: ['wo', 'jobs', 'builds', 'service', 'orders'],
    quickActions: [
      {
        key: 'create-work-order',
        label: 'New Work Order',
        description: 'Create a build or service job.',
        module: 'work-orders',
        objectKey: 'work-order',
        route: '/work-orders/new',
        action: 'create',
        status: 'live',
        keywords: ['new', 'create', 'job', 'build', 'service'],
      },
    ],
  },
  {
    key: 'my-work-queue',
    label: 'My Queue',
    pluralLabel: 'My Queue',
    description: 'Assigned work orders and technician tasks ready for action.',
    module: 'work-orders',
    kind: 'queue',
    ownerContext: 'tickets',
    route: '/work-orders/my-queue',
    status: 'live',
    primaryStatusField: 'taskStatus',
    searchFields: ['workOrderNumber', 'taskName', 'assignedTech'],
    listColumns: ['priority', 'workOrderNumber', 'taskName', 'status'],
    keywords: ['assigned', 'tech', 'queue', 'tasks'],
  },
  {
    key: 'dispatch-board',
    label: 'Dispatch Board',
    pluralLabel: 'Dispatch Boards',
    description: 'Balance and assign shop work across technicians.',
    module: 'work-orders',
    kind: 'workspace',
    ownerContext: 'build-planning',
    route: '/work-orders/dispatch',
    status: 'live',
    searchFields: ['technician', 'workOrderNumber', 'bay'],
    listColumns: ['technician', 'currentLoad', 'blockedWork', 'availableCapacity'],
    keywords: ['dispatch', 'assign', 'schedule', 'tech'],
  },
  {
    key: 'blocked-work',
    label: 'Open / Blocked Work',
    pluralLabel: 'Open / Blocked Work',
    description: 'Open work orders filtered for blockers and stalled jobs.',
    module: 'work-orders',
    kind: 'queue',
    ownerContext: 'build-planning',
    route: '/work-orders/open',
    status: 'live',
    primaryStatusField: 'workOrderStatus',
    searchFields: ['workOrderNumber', 'blockerReason', 'customerName'],
    listColumns: ['workOrderNumber', 'status', 'blockerReason', 'age'],
    keywords: ['blocked', 'stalled', 'triage', 'open'],
  },
  {
    key: 'time-logging',
    label: 'Time Logging',
    pluralLabel: 'Time Logs',
    description: 'Record labor time against jobs and routing steps.',
    module: 'work-orders',
    kind: 'document',
    ownerContext: 'tickets',
    route: '/work-orders/time-logging',
    status: 'live',
    primaryStatusField: 'timeLogStatus',
    searchFields: ['workOrderNumber', 'employeeName', 'routingStep'],
    listColumns: ['employeeName', 'workOrderNumber', 'routingStep', 'minutes'],
    keywords: ['time', 'labor', 'clock', 'log'],
  },
  {
    key: 'qc-checklist',
    label: 'QC Checklist',
    pluralLabel: 'QC Checklists',
    description: 'Run and review quality checklists for shop work.',
    module: 'work-orders',
    kind: 'document',
    ownerContext: 'tickets',
    route: '/work-orders/qc-checklists',
    status: 'live',
    primaryStatusField: 'checklistStatus',
    searchFields: ['workOrderNumber', 'checklistName', 'inspector'],
    listColumns: ['workOrderNumber', 'checklistName', 'status', 'inspector'],
    keywords: ['qc', 'quality', 'inspection', 'checklist'],
  },
  {
    key: 'sop-runner',
    label: 'SOP Runner',
    pluralLabel: 'SOP Runs',
    description: 'Execute SOP steps with evidence and signoff.',
    module: 'work-orders',
    kind: 'workspace',
    ownerContext: 'sop-ojt',
    route: '/work-orders/sop-runner',
    status: 'live',
    searchFields: ['workOrderNumber', 'sopCode', 'stepName'],
    listColumns: ['workOrderNumber', 'sopCode', 'currentStep', 'status'],
    keywords: ['sop', 'procedure', 'runner', 'evidence'],
  },
  {
    key: 'sales-pipeline',
    label: 'Sales Pipeline',
    pluralLabel: 'Sales Pipelines',
    description: 'Track opportunities, follow-ups, and deal stages.',
    module: 'sales',
    kind: 'workspace',
    ownerContext: 'sales',
    route: '/sales/pipeline',
    status: 'live',
    primaryStatusField: 'stage',
    searchFields: ['opportunityName', 'customerName', 'ownerName'],
    listColumns: ['opportunityName', 'customerName', 'stage', 'expectedCloseDate'],
    keywords: ['opportunity', 'pipeline', 'lead', 'deal'],
  },
  {
    key: 'quote',
    label: 'Quote',
    pluralLabel: 'Quotes',
    description: 'Customer estimates and approvals before work is opened.',
    module: 'sales',
    kind: 'document',
    ownerContext: 'sales',
    route: '/sales/quotes',
    status: 'live',
    primaryStatusField: 'quoteStatus',
    searchFields: ['quoteNumber', 'customerName', 'salesOwner'],
    numberSeries: 'QT-.#####',
    listColumns: ['quoteNumber', 'customerName', 'status', 'total', 'expiresAt'],
    keywords: ['quote', 'estimate', 'approval'],
    quickActions: [
      {
        key: 'create-quote',
        label: 'New Quote',
        description: 'Start a customer quote.',
        module: 'sales',
        objectKey: 'quote',
        route: '/sales/quotes/new',
        action: 'create',
        status: 'live',
        keywords: ['new', 'quote', 'estimate'],
      },
    ],
  },
  {
    key: 'sales-forecast',
    label: 'Sales Forecast',
    pluralLabel: 'Sales Forecasts',
    description: 'Forecast revenue and shop demand from active deals.',
    module: 'sales',
    kind: 'report',
    ownerContext: 'sales',
    route: '/sales/forecast',
    status: 'live',
    searchFields: ['period', 'ownerName', 'stage'],
    listColumns: ['period', 'pipelineValue', 'weightedValue', 'capacityImpact'],
    keywords: ['forecast', 'revenue', 'pipeline', 'projection'],
  },
  {
    key: 'part',
    label: 'Part',
    pluralLabel: 'Parts',
    description: 'Search parts, stock, bins, and SKUs.',
    module: 'inventory',
    kind: 'master',
    ownerContext: 'inventory',
    route: '/inventory/parts',
    status: 'live',
    primaryStatusField: 'partStatus',
    searchFields: ['partNumber', 'sku', 'description', 'binLocation'],
    numberSeries: 'SKU',
    listColumns: ['sku', 'description', 'onHand', 'available', 'binLocation'],
    keywords: ['parts', 'sku', 'stock', 'bin'],
  },
  {
    key: 'inventory-reservation',
    label: 'Reservation',
    pluralLabel: 'Reservations',
    description: 'Review reserved, short, and allocated parts.',
    module: 'inventory',
    kind: 'document',
    ownerContext: 'inventory',
    route: '/inventory/reservations',
    status: 'live',
    primaryStatusField: 'reservationStatus',
    searchFields: ['workOrderNumber', 'sku', 'partDescription'],
    listColumns: ['workOrderNumber', 'sku', 'reservedQty', 'status'],
    keywords: ['reserve', 'shortage', 'pick', 'allocation'],
  },
  {
    key: 'receiving',
    label: 'Receiving',
    pluralLabel: 'Receiving',
    description: 'Receive purchase orders and inbound parts.',
    module: 'inventory',
    kind: 'workspace',
    ownerContext: 'procurement',
    route: '/inventory/receiving',
    status: 'live',
    primaryStatusField: 'receiptStatus',
    searchFields: ['purchaseOrderNumber', 'vendorName', 'sku'],
    listColumns: ['purchaseOrderNumber', 'vendorName', 'expectedDate', 'status'],
    keywords: ['po', 'purchase', 'receive', 'vendor'],
  },
  {
    key: 'manufacturer',
    label: 'Manufacturer',
    pluralLabel: 'Manufacturers',
    description: 'Manage manufacturer reference data for catalog parts.',
    module: 'inventory',
    kind: 'master',
    ownerContext: 'inventory',
    route: '/inventory/manufacturers',
    status: 'live',
    searchFields: ['manufacturerName', 'brand', 'contactEmail'],
    listColumns: ['manufacturerName', 'brand', 'status'],
    keywords: ['manufacturer', 'brand', 'catalog'],
  },
  {
    key: 'material-planning',
    label: 'Material Planning',
    pluralLabel: 'Material Plans',
    description: 'Review staged demand and material readiness for builds.',
    module: 'inventory',
    kind: 'report',
    ownerContext: 'inventory',
    route: '/inventory/planning',
    status: 'live',
    searchFields: ['buildStage', 'sku', 'workOrderNumber'],
    listColumns: ['buildStage', 'sku', 'requiredQty', 'availableQty'],
    keywords: ['material', 'planning', 'shortage', 'demand'],
  },
  {
    key: 'customer',
    label: 'Customer',
    pluralLabel: 'Customers',
    description: 'Customer records, contacts, and service history.',
    module: 'customers',
    kind: 'master',
    ownerContext: 'customers',
    route: '/customer-dealers/customers',
    status: 'live',
    searchFields: ['customerName', 'email', 'phone'],
    listColumns: ['customerName', 'email', 'phone', 'lastActivity'],
    keywords: ['customer', 'contact', 'account'],
  },
  {
    key: 'dealer',
    label: 'Dealer',
    pluralLabel: 'Dealers',
    description: 'Dealer accounts and commercial relationships.',
    module: 'customers',
    kind: 'master',
    ownerContext: 'customers',
    route: '/customer-dealers/dealers',
    status: 'live',
    searchFields: ['dealerName', 'email', 'phone'],
    listColumns: ['dealerName', 'primaryContact', 'phone', 'status'],
    keywords: ['dealer', 'partner', 'account'],
  },
  {
    key: 'customer-relationship',
    label: 'Relationship',
    pluralLabel: 'Relationships',
    description: 'Customer, dealer, vehicle, and order relationships.',
    module: 'customers',
    kind: 'workspace',
    ownerContext: 'customers',
    route: '/customer-dealers/relationships',
    status: 'live',
    searchFields: ['customerName', 'dealerName', 'vehicleVin'],
    listColumns: ['customerName', 'dealerName', 'relationshipType', 'updatedAt'],
    keywords: ['relationship', 'link', 'account'],
  },
  {
    key: 'my-ojt',
    label: 'My OJT',
    pluralLabel: 'My OJT',
    description: 'Personal OJT training status and evidence.',
    module: 'training',
    kind: 'queue',
    ownerContext: 'sop-ojt',
    route: '/training/my-ojt',
    status: 'live',
    primaryStatusField: 'assignmentStatus',
    searchFields: ['moduleName', 'stepName', 'trainerName'],
    listColumns: ['moduleName', 'status', 'dueDate', 'trainerName'],
    keywords: ['ojt', 'training', 'progress'],
  },
  {
    key: 'training-assignment',
    label: 'Training Assignment',
    pluralLabel: 'Training Assignments',
    description: 'Assigned training modules and certification evidence.',
    module: 'training',
    kind: 'document',
    ownerContext: 'sop-ojt',
    route: '/training/assignments',
    status: 'live',
    primaryStatusField: 'assignmentStatus',
    searchFields: ['employeeName', 'moduleName', 'trainerName'],
    listColumns: ['employeeName', 'moduleName', 'status', 'dueDate'],
    keywords: ['training', 'ojt', 'assignment'],
  },
  {
    key: 'sop-library',
    label: 'SOP Library',
    pluralLabel: 'SOP Library',
    description: 'Procedures, shop knowledge, and training source material.',
    module: 'training',
    kind: 'master',
    ownerContext: 'sop-ojt',
    route: '/training/sop',
    status: 'live',
    searchFields: ['sopCode', 'title', 'tag'],
    listColumns: ['sopCode', 'title', 'version', 'status'],
    keywords: ['sop', 'procedure', 'knowledge'],
  },
  {
    key: 'build-slot',
    label: 'Build Slot',
    pluralLabel: 'Build Slots',
    description: 'Capacity slots for build scheduling and shop planning.',
    module: 'planning',
    kind: 'document',
    ownerContext: 'build-planning',
    route: '/planning/slots',
    status: 'live',
    primaryStatusField: 'slotStatus',
    searchFields: ['slotDate', 'bayName', 'workOrderNumber'],
    listColumns: ['slotDate', 'bayName', 'capacityHours', 'allocatedHours'],
    keywords: ['slot', 'capacity', 'planner', 'schedule'],
  },
  {
    key: 'accounting-sync',
    label: 'Sync Monitor',
    pluralLabel: 'Sync Monitors',
    description: 'Review QuickBooks queues, failures, and retry status.',
    module: 'accounting',
    kind: 'integration',
    ownerContext: 'accounting',
    route: '/accounting/sync?view=failures',
    status: 'live',
    primaryStatusField: 'syncStatus',
    searchFields: ['entityType', 'externalId', 'failureReason'],
    listColumns: ['entityType', 'externalId', 'syncStatus', 'lastAttemptAt'],
    keywords: ['quickbooks', 'sync', 'failure', 'invoice'],
  },
  {
    key: 'accounting-reconciliation',
    label: 'Reconciliation',
    pluralLabel: 'Reconciliations',
    description: 'Compare ERP and QuickBooks financial records.',
    module: 'accounting',
    kind: 'workspace',
    ownerContext: 'accounting',
    route: '/accounting/reconciliation',
    status: 'live',
    searchFields: ['entityType', 'erpRecord', 'quickBooksRecord'],
    listColumns: ['entityType', 'erpTotal', 'quickBooksTotal', 'variance'],
    keywords: ['reconcile', 'quickbooks', 'accounting'],
  },
  {
    key: 'message-thread',
    label: 'Message Thread',
    pluralLabel: 'Messages',
    description: 'Team and customer conversations.',
    module: 'messages',
    kind: 'communication',
    ownerContext: 'communication',
    route: '/messages',
    status: 'live',
    searchFields: ['threadTitle', 'participantName', 'customerName'],
    listColumns: ['threadTitle', 'participantName', 'lastMessageAt'],
    keywords: ['chat', 'message', 'channel', 'thread'],
    quickActions: [
      {
        key: 'create-message-thread',
        label: 'New Message',
        description: 'Open channels and start a thread.',
        module: 'messages',
        objectKey: 'message-thread',
        route: '/messages',
        action: 'create',
        status: 'live',
        keywords: ['new', 'message', 'chat', 'thread'],
      },
    ],
  },
  {
    key: 'reporting-hub',
    label: 'Reporting',
    pluralLabel: 'Reports',
    description: 'Operational reports, alerts, and management dashboards.',
    module: 'reporting',
    kind: 'report',
    ownerContext: 'reporting',
    route: '/reporting',
    status: 'live',
    searchFields: ['reportName', 'metricName', 'ownerContext'],
    listColumns: ['reportName', 'metricName', 'currentValue', 'updatedAt'],
    keywords: ['report', 'analytics', 'dashboard'],
  },
  {
    key: 'user-access',
    label: 'User Access',
    pluralLabel: 'User Access',
    description: 'Manage user roles, access, and permissions.',
    module: 'admin',
    kind: 'settings',
    ownerContext: 'identity',
    route: '/admin/access',
    status: 'live',
    searchFields: ['userName', 'email', 'roleName'],
    listColumns: ['userName', 'email', 'roleName', 'status'],
    keywords: ['settings', 'access', 'roles', 'permissions'],
  },
  {
    key: 'audit-trail',
    label: 'Audit Trail',
    pluralLabel: 'Audit Trail',
    description: 'Review high-impact actions and system audit events.',
    module: 'admin',
    kind: 'report',
    ownerContext: 'audit',
    route: '/admin/audit',
    status: 'live',
    searchFields: ['actorName', 'entityType', 'action'],
    listColumns: ['occurredAt', 'actorName', 'entityType', 'action'],
    keywords: ['audit', 'history', 'security'],
  },
  {
    key: 'integration-settings',
    label: 'Integrations',
    pluralLabel: 'Integrations',
    description: 'Configure QuickBooks, Google, and external system connections.',
    module: 'admin',
    kind: 'settings',
    ownerContext: 'integrations',
    route: '/admin/integrations',
    status: 'live',
    searchFields: ['integrationName', 'provider', 'status'],
    listColumns: ['integrationName', 'provider', 'status', 'lastSyncAt'],
    keywords: ['integration', 'quickbooks', 'google', 'settings'],
  },
] as const satisfies readonly ErpObjectDescriptor[];

export const ERP_OBJECTS_BY_KEY = Object.fromEntries(
  ERP_OBJECTS.map((object) => [object.key, object]),
) as Record<(typeof ERP_OBJECTS)[number]['key'], (typeof ERP_OBJECTS)[number]>;

export function normalizeErpRoute(route: string): string {
  const [path] = route.split(/[?#]/);
  return path || '/';
}

export function erpRouteMatchesPath(pathname: string, route: string): boolean {
  const routePath = normalizeErpRoute(route);
  return pathname === routePath || (routePath !== '/' && pathname.startsWith(`${routePath}/`));
}

export function getLiveErpObjects(): readonly ErpObjectDescriptor[] {
  return ERP_OBJECTS.filter((object) => object.status === 'live');
}

export function getErpObjectByKey(key: string): ErpObjectDescriptor | undefined {
  return ERP_OBJECTS.find((object) => object.key === key);
}

export function findLiveErpObjectByRoute(route: string): ErpObjectDescriptor | undefined {
  const routePath = normalizeErpRoute(route);
  return getLiveErpObjects().find((object) => normalizeErpRoute(object.route) === routePath);
}

export function getLiveErpQuickActions(): readonly ErpObjectQuickActionDescriptor[] {
  return getLiveErpObjects().flatMap((object) =>
    (object.quickActions ?? []).filter((action) => action.status === 'live'),
  );
}
