import {
  getLiveErpQuickActions,
  type ErpCommandDestinationDescriptor,
  type ErpModuleKey,
  type ErpRouteStatus,
} from './erp-object-registry.js';

export interface ErpWorkspaceLinkDescriptor {
  key: string;
  label: string;
  description: string;
  route: string;
  status: ErpRouteStatus;
  objectKey?: string;
  keywords: readonly string[];
  includeInCommandPalette?: boolean;
}

export interface ErpWorkspaceDescriptor {
  key: ErpModuleKey;
  label: string;
  description: string;
  route: string;
  icon: ErpModuleKey;
  status: ErpRouteStatus;
  keywords: readonly string[];
  links: readonly ErpWorkspaceLinkDescriptor[];
}

export const ERP_WORKSPACES = [
  {
    key: 'work-orders',
    label: 'Work Orders',
    description: 'Open the full work-order list.',
    route: '/work-orders',
    icon: 'work-orders',
    status: 'live',
    keywords: ['wo', 'jobs', 'builds', 'orders', 'service'],
    links: [
      {
        key: 'my-work-queue',
        label: 'My Queue',
        description: 'Assigned work orders and technician tasks ready for action.',
        route: '/work-orders/my-queue',
        status: 'live',
        objectKey: 'my-work-queue',
        keywords: ['assigned', 'tech', 'queue', 'tasks'],
      },
      {
        key: 'dispatch-board',
        label: 'Dispatch Board',
        description: 'Assign and balance shop work.',
        route: '/work-orders/dispatch',
        status: 'live',
        objectKey: 'dispatch-board',
        keywords: ['dispatch', 'assign', 'schedule', 'tech'],
      },
      {
        key: 'blocked-work',
        label: 'Open / Blocked',
        description: 'Triage work orders that need attention.',
        route: '/work-orders/open',
        status: 'live',
        objectKey: 'blocked-work',
        keywords: ['blocked', 'stalled', 'triage', 'open'],
      },
      {
        key: 'time-logging',
        label: 'Time Logging',
        description: 'Record labor time against jobs and routing steps.',
        route: '/work-orders/time-logging',
        status: 'live',
        objectKey: 'time-logging',
        keywords: ['time', 'labor', 'clock', 'log'],
      },
      {
        key: 'qc-checklist',
        label: 'QC Checklists',
        description: 'Run and review quality checklists.',
        route: '/work-orders/qc-checklists',
        status: 'live',
        objectKey: 'qc-checklist',
        keywords: ['qc', 'quality', 'inspection', 'checklist'],
      },
      {
        key: 'sop-runner',
        label: 'SOP Runner',
        description: 'Execute SOP steps with evidence and signoff.',
        route: '/work-orders/sop-runner',
        status: 'live',
        objectKey: 'sop-runner',
        keywords: ['sop', 'procedure', 'runner', 'evidence'],
      },
    ],
  },
  {
    key: 'sales',
    label: 'Sales',
    description: 'Track opportunities, quotes, and customer approvals.',
    route: '/sales',
    icon: 'sales',
    status: 'live',
    keywords: ['sales', 'pipeline', 'quotes', 'forecast'],
    links: [
      {
        key: 'sales-pipeline',
        label: 'Pipeline',
        description: 'Track opportunities and follow-ups.',
        route: '/sales/pipeline',
        status: 'live',
        objectKey: 'sales-pipeline',
        keywords: ['opportunity', 'pipeline', 'lead'],
      },
      {
        key: 'quote',
        label: 'Quotes',
        description: 'Review quotes and customer approvals.',
        route: '/sales/quotes',
        status: 'live',
        objectKey: 'quote',
        keywords: ['quote', 'estimate', 'approval'],
      },
      {
        key: 'sales-forecast',
        label: 'Forecast',
        description: 'Forecast revenue and shop demand from active deals.',
        route: '/sales/forecast',
        status: 'live',
        objectKey: 'sales-forecast',
        keywords: ['forecast', 'revenue', 'projection'],
      },
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    description: 'Search stock, allocations, receiving, and material readiness.',
    route: '/inventory',
    icon: 'inventory',
    status: 'live',
    keywords: ['inventory', 'parts', 'stock', 'receiving'],
    links: [
      {
        key: 'part',
        label: 'Part Lookup',
        description: 'Search parts, stock, bins, and SKUs.',
        route: '/inventory/parts',
        status: 'live',
        objectKey: 'part',
        keywords: ['parts', 'sku', 'stock', 'bin'],
      },
      {
        key: 'inventory-reservation',
        label: 'Reservations',
        description: 'Review reserved and short parts.',
        route: '/inventory/reservations',
        status: 'live',
        objectKey: 'inventory-reservation',
        keywords: ['reserve', 'shortage', 'pick'],
      },
      {
        key: 'receiving',
        label: 'Receiving',
        description: 'Receive purchase orders and inbound parts.',
        route: '/inventory/receiving',
        status: 'live',
        objectKey: 'receiving',
        keywords: ['po', 'purchase', 'receive', 'vendor'],
      },
      {
        key: 'manufacturer',
        label: 'Manufacturers',
        description: 'Manage manufacturer reference data.',
        route: '/inventory/manufacturers',
        status: 'live',
        objectKey: 'manufacturer',
        keywords: ['manufacturer', 'brand', 'catalog'],
      },
      {
        key: 'material-planning',
        label: 'Material Planning',
        description: 'Review staged demand and material readiness.',
        route: '/inventory/planning',
        status: 'live',
        objectKey: 'material-planning',
        keywords: ['material', 'planning', 'shortage', 'demand'],
      },
    ],
  },
  {
    key: 'customers',
    label: 'Customers',
    description: 'Open customer and dealer records.',
    route: '/customer-dealers',
    icon: 'customers',
    status: 'live',
    keywords: ['customers', 'dealers', 'contacts'],
    links: [
      {
        key: 'customer',
        label: 'Customers',
        description: 'Customer records, contacts, and service history.',
        route: '/customer-dealers/customers',
        status: 'live',
        objectKey: 'customer',
        keywords: ['customer', 'contact', 'account'],
      },
      {
        key: 'dealer',
        label: 'Dealers',
        description: 'Dealer accounts and commercial relationships.',
        route: '/customer-dealers/dealers',
        status: 'live',
        objectKey: 'dealer',
        keywords: ['dealer', 'partner', 'account'],
      },
      {
        key: 'customer-relationship',
        label: 'Relationships',
        description: 'Customer, dealer, vehicle, and order relationships.',
        route: '/customer-dealers/relationships',
        status: 'live',
        objectKey: 'customer-relationship',
        keywords: ['relationship', 'link', 'account'],
      },
    ],
  },
  {
    key: 'training',
    label: 'Training',
    description: 'OJT assignments, SOPs, and shop knowledge.',
    route: '/training',
    icon: 'training',
    status: 'live',
    keywords: ['training', 'ojt', 'sop', 'knowledge'],
    links: [
      {
        key: 'my-ojt',
        label: 'My OJT',
        description: 'Personal OJT training status and evidence.',
        route: '/training/my-ojt',
        status: 'live',
        objectKey: 'my-ojt',
        keywords: ['ojt', 'training', 'progress'],
      },
      {
        key: 'training-assignment',
        label: 'Assignments',
        description: 'Review OJT assignments and evidence.',
        route: '/training/assignments',
        status: 'live',
        objectKey: 'training-assignment',
        keywords: ['training', 'ojt', 'assignment'],
      },
      {
        key: 'sop-library',
        label: 'SOP Library',
        description: 'Find procedures and shop knowledge.',
        route: '/training/sop',
        status: 'live',
        objectKey: 'sop-library',
        keywords: ['sop', 'procedure', 'knowledge'],
      },
    ],
  },
  {
    key: 'planning',
    label: 'Planning',
    description: 'Plan build slots and shop capacity.',
    route: '/planning',
    icon: 'planning',
    status: 'live',
    keywords: ['planning', 'schedule', 'capacity', 'slots'],
    links: [
      {
        key: 'build-slot',
        label: 'Build Slots',
        description: 'Plan and publish build capacity.',
        route: '/planning/slots',
        status: 'live',
        objectKey: 'build-slot',
        keywords: ['slot', 'capacity', 'planner', 'schedule'],
      },
    ],
  },
  {
    key: 'accounting',
    label: 'Accounting',
    description: 'Monitor QuickBooks sync and reconciliation workflows.',
    route: '/accounting',
    icon: 'accounting',
    status: 'live',
    keywords: ['accounting', 'quickbooks', 'sync', 'finance'],
    links: [
      {
        key: 'accounting-sync',
        label: 'Sync Monitor',
        description: 'Review QuickBooks queues and failures.',
        route: '/accounting/sync?view=failures',
        status: 'live',
        objectKey: 'accounting-sync',
        keywords: ['quickbooks', 'sync', 'failure', 'invoice'],
      },
      {
        key: 'accounting-reconciliation',
        label: 'Reconciliation',
        description: 'Compare ERP and QuickBooks records.',
        route: '/accounting/reconciliation',
        status: 'live',
        objectKey: 'accounting-reconciliation',
        keywords: ['reconcile', 'quickbooks', 'accounting'],
      },
    ],
  },
  {
    key: 'messages',
    label: 'Messages',
    description: 'Open team and customer conversations.',
    route: '/messages',
    icon: 'messages',
    status: 'live',
    keywords: ['chat', 'message', 'channel', 'thread'],
    links: [
      {
        key: 'team-channels',
        label: 'Team Channels',
        description: 'Open team channel conversations.',
        route: '/messages?type=TEAM',
        status: 'live',
        objectKey: 'message-thread',
        keywords: ['team', 'chat', 'channel'],
      },
      {
        key: 'customer-threads',
        label: 'Customer Threads',
        description: 'Open customer conversation threads.',
        route: '/messages?type=CUSTOMER',
        status: 'live',
        objectKey: 'message-thread',
        keywords: ['customer', 'chat', 'thread'],
      },
    ],
  },
  {
    key: 'reporting',
    label: 'Reporting',
    description: 'Open operational reports and alerts.',
    route: '/reporting',
    icon: 'reporting',
    status: 'live',
    keywords: ['report', 'analytics', 'dashboard'],
    links: [],
  },
  {
    key: 'admin',
    label: 'Admin',
    description: 'Manage access, audit trail, and integrations.',
    route: '/admin',
    icon: 'admin',
    status: 'live',
    keywords: ['settings', 'admin', 'access', 'audit'],
    links: [
      {
        key: 'user-access',
        label: 'User Access',
        description: 'Manage user roles, access, and permissions.',
        route: '/admin/access',
        status: 'live',
        objectKey: 'user-access',
        keywords: ['settings', 'access', 'roles', 'permissions'],
      },
      {
        key: 'audit-trail',
        label: 'Audit Trail',
        description: 'Review high-impact actions and audit events.',
        route: '/admin/audit',
        status: 'live',
        objectKey: 'audit-trail',
        keywords: ['audit', 'history', 'security'],
      },
      {
        key: 'integration-settings',
        label: 'Integrations',
        description: 'Configure QuickBooks, Google, and external connections.',
        route: '/admin/integrations',
        status: 'live',
        objectKey: 'integration-settings',
        keywords: ['integration', 'quickbooks', 'google', 'settings'],
      },
    ],
  },
] as const satisfies readonly ErpWorkspaceDescriptor[];

function workspaceToCommandDestination(
  workspace: ErpWorkspaceDescriptor,
): ErpCommandDestinationDescriptor {
  return {
    key: `workspace:${workspace.key}`,
    label: workspace.label,
    description: workspace.description,
    route: workspace.route,
    group: workspace.label,
    module: workspace.key,
    status: workspace.status,
    keywords: workspace.keywords,
    icon: workspace.icon,
  };
}

function linkToCommandDestination(
  workspace: ErpWorkspaceDescriptor,
  link: ErpWorkspaceLinkDescriptor,
): ErpCommandDestinationDescriptor {
  return {
    key: `workspace-link:${link.key}`,
    label: link.label,
    description: link.description,
    route: link.route,
    group: workspace.label,
    module: workspace.key,
    status: link.status,
    keywords: link.keywords,
    icon: workspace.icon,
  };
}

export function getLiveErpWorkspaces(): readonly ErpWorkspaceDescriptor[] {
  return ERP_WORKSPACES.filter((workspace) => workspace.status === 'live');
}

export function getLiveErpWorkspaceLinks(): readonly ErpWorkspaceLinkDescriptor[] {
  return getLiveErpWorkspaces().flatMap((workspace) =>
    workspace.links.filter((link) => link.status === 'live'),
  );
}

export function getErpCommandDestinations(): readonly ErpCommandDestinationDescriptor[] {
  const workspaceDestinations = getLiveErpWorkspaces().flatMap((workspace) => [
    workspaceToCommandDestination(workspace),
    ...workspace.links
      .filter((link) => link.status === 'live' && link.includeInCommandPalette !== false)
      .map((link) => linkToCommandDestination(workspace, link)),
  ]);

  const quickActionDestinations = getLiveErpQuickActions().map((action) => ({
    key: `quick-action:${action.key}`,
    label: action.label,
    description: action.description,
    route: action.route,
    group: 'Create',
    module: action.module,
    status: action.status,
    keywords: action.keywords,
    icon: 'plus' as const,
  }));

  return [...workspaceDestinations, ...quickActionDestinations];
}

export function getErpQuickCreateDestinations(): readonly ErpCommandDestinationDescriptor[] {
  return getErpCommandDestinations().filter((destination) => destination.group === 'Create');
}
