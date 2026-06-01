import type { ErpRouteStatus } from './erp-object-registry.js';

export type ErpAdminConfigurationCategory =
  | 'access'
  | 'accounting'
  | 'integrations'
  | 'audit';

export interface ErpAdminConfigurationDescriptor {
  key: string;
  label: string;
  description: string;
  category: ErpAdminConfigurationCategory;
  ownerContext: string;
  route: string;
  ctaLabel: string;
  objectKey: string;
  status: ErpRouteStatus;
  liveSignals: readonly string[];
  actions: readonly string[];
  keywords: readonly string[];
}

export const ERP_ADMIN_CONFIGURATION_DOMAINS = [
  {
    key: 'admin-config-user-access',
    label: 'User Access',
    description: 'User list, role assignment, invitation, and account controls.',
    category: 'access',
    ownerContext: 'identity',
    route: '/admin/access',
    ctaLabel: 'Manage users',
    objectKey: 'user-access',
    status: 'live',
    liveSignals: ['Cognito users', 'role assignments', 'account status'],
    actions: ['Invite users', 'Edit roles', 'Disable accounts'],
    keywords: ['access', 'users', 'roles', 'identity', 'permissions'],
  },
  {
    key: 'admin-config-accounting-settings',
    label: 'Accounting Settings',
    description: 'QuickBooks export dimensions, AR accounts, income accounts, and tax mappings.',
    category: 'accounting',
    ownerContext: 'accounting',
    route: '/admin/accounting',
    ctaLabel: 'Configure mappings',
    objectKey: 'accounting-settings',
    status: 'live',
    liveSignals: ['QuickBooks account references', 'dimension mappings', 'tax mappings'],
    actions: ['Map dimensions', 'Map tax codes', 'Review export readiness'],
    keywords: ['accounting', 'quickbooks', 'mapping', 'tax', 'export'],
  },
  {
    key: 'admin-config-integration-health',
    label: 'Integration Health',
    description: 'Connection status for QuickBooks, sync queues, and reconciliation.',
    category: 'integrations',
    ownerContext: 'integrations',
    route: '/admin/integrations',
    ctaLabel: 'Review integrations',
    objectKey: 'integration-settings',
    status: 'live',
    liveSignals: ['QuickBooks status', 'sync failures', 'reconciliation runs'],
    actions: ['Open failed syncs', 'Review accounts', 'Check reconciliation'],
    keywords: ['integrations', 'quickbooks', 'sync', 'reconciliation', 'health'],
  },
  {
    key: 'admin-config-migration-cutover',
    label: 'Migration Cutover',
    description: 'ShopMonkey rehearsal batches, cutover gates, and imported-domain inspection.',
    category: 'integrations',
    ownerContext: 'migration',
    route: '/admin/migration',
    ctaLabel: 'Review cutover',
    objectKey: 'migration-cutover',
    status: 'live',
    liveSignals: ['ShopMonkey batches', 'record coverage', 'error queue'],
    actions: ['Review latest rehearsal', 'Inspect imported domains', 'Clear cutover blockers'],
    keywords: ['migration', 'shopmonkey', 'cutover', 'backfill', 'rehearsal'],
  },
  {
    key: 'admin-config-audit-trail',
    label: 'Audit Trail',
    description: 'Searchable high-impact changes, denials, and privileged activity.',
    category: 'audit',
    ownerContext: 'audit',
    route: '/admin/audit',
    ctaLabel: 'Search audit events',
    objectKey: 'audit-trail',
    status: 'live',
    liveSignals: ['audit events', 'actor search', 'denial filters'],
    actions: ['Search events', 'Review denials', 'Open entity history'],
    keywords: ['audit', 'history', 'security', 'denied', 'activity'],
  },
] as const satisfies readonly ErpAdminConfigurationDescriptor[];

export function getLiveErpAdminConfigurationDomains(): readonly ErpAdminConfigurationDescriptor[] {
  return ERP_ADMIN_CONFIGURATION_DOMAINS.filter((domain) => domain.status === 'live');
}
