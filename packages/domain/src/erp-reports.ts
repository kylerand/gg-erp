import type { ErpModuleKey, ErpRouteStatus } from './erp-object-registry.js';

export type ErpReportCategory =
  | 'operations'
  | 'inventory'
  | 'sales'
  | 'accounting'
  | 'training'
  | 'admin';

export type ErpReportCadence = 'live' | 'daily' | 'weekly' | 'monthly';

export interface ErpReportDescriptor {
  key: string;
  label: string;
  description: string;
  category: ErpReportCategory;
  module: ErpModuleKey;
  ownerContext: string;
  route: string;
  drillThroughLabel: string;
  cadence: ErpReportCadence;
  status: ErpRouteStatus;
  metricLabel: string;
  sourceObjectKeys: readonly string[];
  keywords: readonly string[];
}

export const ERP_REPORTS = [
  {
    key: 'report-work-order-blockers',
    label: 'Work Order Blockers',
    description:
      'Blocked and stalled work orders that need manager triage before shop flow recovers.',
    category: 'operations',
    module: 'work-orders',
    ownerContext: 'build-planning',
    route: '/work-orders/open?status=BLOCKED',
    drillThroughLabel: 'Triage blockers',
    cadence: 'live',
    status: 'live',
    metricLabel: 'blocked work orders',
    sourceObjectKeys: ['work-order', 'blocked-work'],
    keywords: ['blocked', 'stalled', 'triage', 'work orders', 'operations'],
  },
  {
    key: 'report-active-shop-load',
    label: 'Active Shop Load',
    description: 'In-progress work orders currently consuming technician and bay capacity.',
    category: 'operations',
    module: 'work-orders',
    ownerContext: 'build-planning',
    route: '/work-orders?status=IN_PROGRESS',
    drillThroughLabel: 'Review active work',
    cadence: 'live',
    status: 'live',
    metricLabel: 'in progress',
    sourceObjectKeys: ['work-order', 'dispatch-board'],
    keywords: ['active', 'load', 'in progress', 'capacity', 'shop'],
  },
  {
    key: 'report-completed-work-orders',
    label: 'Completed Work Orders',
    description:
      'Closed work orders ready for review, invoicing, or operational throughput checks.',
    category: 'operations',
    module: 'work-orders',
    ownerContext: 'build-planning',
    route: '/work-orders?status=COMPLETED',
    drillThroughLabel: 'Review completions',
    cadence: 'live',
    status: 'live',
    metricLabel: 'completed',
    sourceObjectKeys: ['work-order'],
    keywords: ['completed', 'closed', 'throughput', 'work orders'],
  },
  {
    key: 'report-material-shortages',
    label: 'Material Shortages',
    description: 'Parts with no available stock that can block builds, picks, or fulfillment.',
    category: 'inventory',
    module: 'inventory',
    ownerContext: 'inventory',
    route: '/inventory/parts?stock=OUT',
    drillThroughLabel: 'Open short parts',
    cadence: 'live',
    status: 'live',
    metricLabel: 'out of stock',
    sourceObjectKeys: ['part', 'material-planning'],
    keywords: ['shortage', 'out of stock', 'parts', 'inventory', 'material'],
  },
  {
    key: 'report-open-reservations',
    label: 'Open Reservations',
    description: 'Unfulfilled inventory reservations that still need picking, release, or review.',
    category: 'inventory',
    module: 'inventory',
    ownerContext: 'inventory',
    route: '/inventory/reservations?status=OPEN',
    drillThroughLabel: 'Review reservations',
    cadence: 'live',
    status: 'live',
    metricLabel: 'open reservations',
    sourceObjectKeys: ['inventory-reservation'],
    keywords: ['reservations', 'open', 'pick', 'allocation', 'inventory'],
  },
  {
    key: 'report-sales-forecast',
    label: 'Sales Forecast',
    description: 'Revenue forecast and weighted pipeline values feeding shop demand planning.',
    category: 'sales',
    module: 'sales',
    ownerContext: 'sales',
    route: '/sales/forecast',
    drillThroughLabel: 'Open forecast',
    cadence: 'live',
    status: 'live',
    metricLabel: 'forecast',
    sourceObjectKeys: ['sales-forecast', 'sales-opportunity', 'quote'],
    keywords: ['sales', 'forecast', 'pipeline', 'revenue'],
  },
  {
    key: 'report-open-accounts-receivable',
    label: 'Open Accounts Receivable',
    description: 'Open QuickBooks invoices and AR balance for accounting follow-up.',
    category: 'accounting',
    module: 'accounting',
    ownerContext: 'accounting',
    route: '/accounting/quickbooks/invoices?filter=OPEN',
    drillThroughLabel: 'Review open AR',
    cadence: 'live',
    status: 'live',
    metricLabel: 'open AR',
    sourceObjectKeys: ['quickbooks-invoice'],
    keywords: ['quickbooks', 'invoice', 'ar', 'accounts receivable', 'open'],
  },
  {
    key: 'report-quickbooks-sync-failures',
    label: 'QuickBooks Sync Failures',
    description:
      'Failed accounting sync records that need retry, repair, or external reconciliation.',
    category: 'accounting',
    module: 'accounting',
    ownerContext: 'accounting',
    route: '/accounting/sync?view=failures',
    drillThroughLabel: 'Open sync failures',
    cadence: 'live',
    status: 'live',
    metricLabel: 'failed syncs',
    sourceObjectKeys: ['accounting-sync'],
    keywords: ['quickbooks', 'sync', 'failure', 'accounting'],
  },
  {
    key: 'report-overdue-training',
    label: 'Overdue Training',
    description: 'Training assignments past due that can create certification or quality risk.',
    category: 'training',
    module: 'training',
    ownerContext: 'sop-ojt',
    route: '/training/assignments?status=OVERDUE',
    drillThroughLabel: 'Review overdue training',
    cadence: 'live',
    status: 'live',
    metricLabel: 'overdue assignments',
    sourceObjectKeys: ['training-assignment'],
    keywords: ['training', 'ojt', 'overdue', 'assignment'],
  },
  {
    key: 'report-audit-events',
    label: 'Audit Events',
    description: 'Privileged actions, denials, and high-impact changes for admin review.',
    category: 'admin',
    module: 'admin',
    ownerContext: 'audit',
    route: '/admin/audit?search=DENIED',
    drillThroughLabel: 'Review audit events',
    cadence: 'live',
    status: 'live',
    metricLabel: 'audit events',
    sourceObjectKeys: ['audit-trail'],
    keywords: ['audit', 'denied', 'admin', 'security'],
  },
] as const satisfies readonly ErpReportDescriptor[];

export const ERP_REPORTS_BY_KEY = Object.fromEntries(
  ERP_REPORTS.map((report) => [report.key, report]),
) as Record<(typeof ERP_REPORTS)[number]['key'], (typeof ERP_REPORTS)[number]>;

export function getErpReportByKey(key: string): ErpReportDescriptor | undefined {
  return ERP_REPORTS.find((report) => report.key === key);
}

export function getLiveErpReports(): readonly ErpReportDescriptor[] {
  return ERP_REPORTS.filter((report) => report.status === 'live');
}

export function getLiveErpReportsByCategory(
  category: ErpReportCategory,
): readonly ErpReportDescriptor[] {
  return getLiveErpReports().filter((report) => report.category === category);
}
