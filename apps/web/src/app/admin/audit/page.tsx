'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader, EmptyState } from '@gg-erp/ui';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { listAuditEvents, type AuditEventRecord } from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';

const OUTCOME_CLASSES: Record<string, string> = {
  SUCCESS: 'bg-green-100 text-green-700',
  FAILURE: 'bg-red-100 text-red-700',
  DENIED: 'bg-orange-100 text-orange-700',
};

const PAGE_SIZE = 25;

type AuditResourceDestination = {
  label: string;
  labelKeys: string[];
  href: (event: AuditEventRecord) => string;
  actionLabel: string;
  description: string;
};

const AUDIT_RESOURCE_DESTINATIONS: Record<string, AuditResourceDestination> = {
  WorkOrder: {
    label: 'Work order',
    labelKeys: ['workOrderNumber', 'workOrder.workOrderNumber'],
    href: (event) => erpRecordRoute('work-order', event.entityId),
    actionLabel: 'Open detail',
    description: 'Work-order command center',
  },
  PurchaseOrder: {
    label: 'Purchase order',
    labelKeys: ['poNumber', 'purchaseOrder.poNumber'],
    href: (event) => erpRecordRoute('purchase-order', event.entityId),
    actionLabel: 'Open PO',
    description: 'Purchasing and receiving detail',
  },
  Customer: {
    label: 'Customer',
    labelKeys: ['fullName', 'customerName', 'companyName', 'email'],
    href: (event) => erpRoute('customer', { search: event.entityId }),
    actionLabel: 'Find customer',
    description: 'Filtered customer list',
  },
  Quote: {
    label: 'Quote',
    labelKeys: ['quoteNumber', 'quote.quoteNumber'],
    href: (event) => erpRecordRoute('quote', event.entityId),
    actionLabel: 'Open quote',
    description: 'Quote detail and approvals',
  },
  SalesOpportunity: {
    label: 'Opportunity',
    labelKeys: ['opportunityName', 'name', 'opportunity.opportunityName'],
    href: (event) => erpRecordRoute('sales-opportunity', event.entityId),
    actionLabel: 'Open opportunity',
    description: 'Sales pipeline detail',
  },
  PartSku: {
    label: 'Part',
    labelKeys: ['sku', 'partSku', 'part.sku'],
    href: (event) => erpRecordRoute('part', event.entityId),
    actionLabel: 'Open part',
    description: 'Inventory part detail',
  },
  InventoryReservation: {
    label: 'Reservation',
    labelKeys: ['reservationNumber', 'workOrderNumber', 'partSku'],
    href: (event) => erpRoute('inventory-reservation', { search: event.entityId }),
    actionLabel: 'Find reservation',
    description: 'Filtered inventory reservations',
  },
  InventoryLot: {
    label: 'Inventory lot',
    labelKeys: ['lotCode', 'lotNumber', 'partSku'],
    href: (event) => erpRoute('part', { search: event.entityId }),
    actionLabel: 'Find lot',
    description: 'Filtered inventory parts',
  },
  BuildSlot: {
    label: 'Build slot',
    labelKeys: ['slotDate', 'workstationCode'],
    href: () => erpRoute('build-slot'),
    actionLabel: 'Open planner',
    description: 'Build-slot planning board',
  },
  TechnicianTask: {
    label: 'Technician task',
    labelKeys: ['workOrderNumber', 'routingStepTitle', 'taskTitle'],
    href: () => erpRoute('my-work-queue'),
    actionLabel: 'Open queue',
    description: 'Technician work queue',
  },
  TicketReworkIssue: {
    label: 'Rework issue',
    labelKeys: ['workOrderNumber', 'issueTitle', 'reason'],
    href: () => erpRoute('blocked-work', { status: 'BLOCKED' }),
    actionLabel: 'Review blockers',
    description: 'Blocked work and rework follow-up',
  },
  InvoiceSyncRecord: {
    label: 'Invoice sync',
    labelKeys: ['docNumber', 'invoiceNumber', 'workOrderNumber'],
    href: () => erpRoute('accounting-sync', { view: 'invoices' }),
    actionLabel: 'Open invoices',
    description: 'Accounting sync monitor',
  },
  CustomerSyncRecord: {
    label: 'Customer sync',
    labelKeys: ['customerName', 'fullName', 'email'],
    href: () => erpRoute('accounting-sync', { view: 'customers' }),
    actionLabel: 'Open customers',
    description: 'Accounting sync monitor',
  },
  PaymentSyncRecord: {
    label: 'Payment sync',
    labelKeys: ['paymentNumber', 'docNumber', 'customerName'],
    href: () => erpRoute('accounting-sync', { view: 'failures' }),
    actionLabel: 'Open failures',
    description: 'Accounting sync monitor',
  },
  ReconciliationRun: {
    label: 'Reconciliation',
    labelKeys: ['runName', 'provider', 'period'],
    href: () => erpRoute('accounting-reconciliation'),
    actionLabel: 'Open reconciliation',
    description: 'Accounting reconciliation workspace',
  },
  IntegrationAccount: {
    label: 'Integration account',
    labelKeys: ['provider', 'accountName', 'companyName'],
    href: () => erpRoute('integration-settings'),
    actionLabel: 'Open integrations',
    description: 'Integration health and settings',
  },
  EntityMapping: {
    label: 'Accounting mapping',
    labelKeys: ['mappingType', 'internalCode', 'externalId'],
    href: () => erpRoute('accounting-settings'),
    actionLabel: 'Open settings',
    description: 'QuickBooks mapping settings',
  },
  AuthorizationGuard: {
    label: 'Authorization guard',
    labelKeys: ['reasonCode', 'scope', 'route'],
    href: (event) => buildAuditHref(event.action),
    actionLabel: 'Filter action',
    description: 'Access-control decision',
  },
  Authentication: {
    label: 'Authentication',
    labelKeys: ['actorEmail', 'reasonCode', 'source'],
    href: (event) => buildAuditHref(event.action),
    actionLabel: 'Filter action',
    description: 'Sign-in and token event',
  },
  'communication-message': {
    label: 'Message',
    labelKeys: ['threadTitle', 'channelName', 'authorName'],
    href: () => erpRoute('messages'),
    actionLabel: 'Open messages',
    description: 'Communication thread',
  },
};

function buildAuditHref(search: string): string {
  const params = new URLSearchParams();
  if (search.trim()) params.set('search', search.trim());
  const qs = params.toString();
  return `${erpRoute('audit-trail')}${qs ? `?${qs}` : ''}`;
}

function humanizeEntityType(entityType: string): string {
  return entityType
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function metadataValue(metadata: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadataPathValue(metadata, key);
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function metadataPathValue(metadata: Record<string, unknown>, path: string): unknown {
  let value: unknown = metadata;
  for (const segment of path.split('.')) {
    if (!value || typeof value !== 'object' || !(segment in value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function resolveAuditResource(event: AuditEventRecord): {
  label: string;
  description: string;
  href: string;
  actionLabel: string;
} {
  const metadata = event.metadata ?? {};
  const destination = AUDIT_RESOURCE_DESTINATIONS[event.entityType];
  if (destination) {
    const displayName = metadataValue(metadata, destination.labelKeys);
    return {
      label: displayName ? `${destination.label}: ${displayName}` : `${destination.label} record`,
      description: destination.description,
      href: destination.href(event),
      actionLabel: destination.actionLabel,
    };
  }

  const label = `${humanizeEntityType(event.entityType) || 'Audit'} record`;
  return {
    label,
    description: 'No direct workspace route yet',
    href: buildAuditHref(event.entityId),
    actionLabel: 'Filter events',
  };
}

export default function AuditTrailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSearch = searchParams.get('search') ?? '';
  const [search, setSearch] = useState(activeSearch);
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (s: string, p: number, ps: number) => {
    setLoading(true);
    try {
      const data = await listAuditEvents(
        { search: s || undefined, limit: ps, offset: (p - 1) * ps },
        { allowMockFallback: false },
      );
      setEvents(data.items);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSearch(activeSearch);
    setPage(1);
  }, [activeSearch]);

  useEffect(() => {
    void load(activeSearch, page, pageSize);
  }, [activeSearch, page, pageSize, load]);

  function applySearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(buildAuditHref(search));
  }

  function inferOutcome(event: AuditEventRecord): string {
    const meta = event.metadata as Record<string, unknown>;
    if (meta?.outcome) return String(meta.outcome);
    if (event.action.includes('DENIED') || event.action.includes('deny')) return 'DENIED';
    if (event.action.includes('FAILURE') || event.action.includes('fail')) return 'FAILURE';
    return 'SUCCESS';
  }

  function inferActor(event: AuditEventRecord): string {
    const meta = event.metadata as Record<string, unknown>;
    return (meta?.actorEmail as string) ?? event.actorId ?? 'system';
  }

  return (
    <div>
      <PageHeader title="Audit Trail" description={`Privileged change history — ${total} events`} />
      <form onSubmit={applySearch} className="mb-4 flex w-full gap-2 lg:max-w-lg">
        <Input
          placeholder="Search by action, resource type, or resource ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9"
        />
        <Button type="submit" className="h-9 bg-yellow-400 text-gray-900 hover:bg-yellow-300">
          Search
        </Button>
        {activeSearch && (
          <Link
            href={erpRoute('audit-trail')}
            className="inline-flex h-9 items-center rounded-md border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 hover:border-yellow-400"
          >
            Reset
          </Link>
        )}
      </form>
      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Loading audit events…</div>
      ) : events.length === 0 ? (
        <EmptyState
          icon="📜"
          title="No audit events"
          description={
            search
              ? 'No events match your search.'
              : 'No audit events have been recorded yet. Events will appear here as users interact with the system.'
          }
        />
      ) : (
        <>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Timestamp</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Actor</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Action</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Resource</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {events.map((e) => {
                  const outcome = inferOutcome(e);
                  const resource = resolveAuditResource(e);
                  return (
                    <tr
                      key={e.id}
                      className={`hover:bg-gray-50 ${outcome === 'DENIED' ? 'bg-orange-50' : ''}`}
                    >
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {new Date(e.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700">{inferActor(e)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{e.action}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        <div className="min-w-44">
                          <Link
                            href={resource.href}
                            className="font-semibold text-gray-800 hover:text-yellow-600 hover:underline"
                            title={`Resource type: ${e.entityType}`}
                          >
                            {resource.label}
                          </Link>
                          <div className="mt-0.5 text-[11px] text-gray-400">
                            {resource.description}
                          </div>
                          <Link
                            href={resource.href}
                            className="mt-1 inline-flex rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:border-yellow-400 hover:text-gray-900"
                          >
                            {resource.actionLabel}
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${OUTCOME_CLASSES[outcome] ?? 'bg-gray-100 text-gray-600'}`}
                        >
                          {outcome}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(ps) => {
              setPageSize(ps);
              setPage(1);
            }}
          />
        </>
      )}
    </div>
  );
}
