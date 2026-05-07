import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { PageHeader, SyncStatusBadge } from '@gg-erp/ui';
import type { SyncStatus } from '@gg-erp/ui';
import {
  getQbStatus,
  listCustomerSyncs,
  listIntegrationAccounts,
  listInvoiceSyncRecords,
  listReconciliationRuns,
  type ReconciliationRun,
} from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';

interface IntegrationHealthCard {
  id: string;
  name: string;
  description: string;
  href: string;
  cta: string;
  status: SyncStatus;
  primary: string;
  secondary?: string;
  details: string[];
}

interface IntegrationHealth {
  cards: IntegrationHealthCard[];
  warnings: string[];
}

async function safeLoad<T>(
  label: string,
  warnings: string[],
  load: () => Promise<T>,
): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    warnings.push(error instanceof Error ? `${label}: ${error.message}` : `${label}: unavailable`);
    return null;
  }
}

function pluralize(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatDate(value?: string | null): string | undefined {
  return value ? new Date(value).toLocaleString() : undefined;
}

function reconcileStatus(run?: ReconciliationRun): SyncStatus {
  if (!run) return 'PENDING';
  if (run.status === 'COMPLETED') return 'SYNCED';
  if (run.status === 'FAILED') return 'FAILED';
  if (run.status === 'RUNNING' || run.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  return 'PENDING';
}

async function loadIntegrationHealth(): Promise<IntegrationHealth> {
  const warnings: string[] = [];
  const [
    qbStatus,
    integrationAccounts,
    failedInvoiceSyncs,
    pendingCustomerSyncs,
    failedCustomerSyncs,
    reconciliationRuns,
  ] = await Promise.all([
    safeLoad('QuickBooks status', warnings, () => getQbStatus({ allowMockFallback: false })),
    safeLoad('integration accounts', warnings, () =>
      listIntegrationAccounts({ allowMockFallback: false }),
    ),
    safeLoad('invoice sync failures', warnings, () =>
      listInvoiceSyncRecords({ state: 'FAILED', limit: 100 }, { allowMockFallback: false }),
    ),
    safeLoad('customer sync queue', warnings, () =>
      listCustomerSyncs({ state: 'PENDING', limit: 1 }, { allowMockFallback: false }),
    ),
    safeLoad('customer sync failures', warnings, () =>
      listCustomerSyncs({ state: 'FAILED', limit: 1 }, { allowMockFallback: false }),
    ),
    safeLoad('reconciliation runs', warnings, () =>
      listReconciliationRuns({ limit: 1 }, { allowMockFallback: false }),
    ),
  ]);

  const activeAccounts =
    integrationAccounts?.items.filter((account) =>
      ['ACTIVE', 'CONNECTED', 'SYNCED'].includes(String(account.accountStatus ?? '').toUpperCase()),
    ).length ?? 0;
  const latestReconciliation = reconciliationRuns?.items[0];
  const failedInvoices = failedInvoiceSyncs?.items.length ?? 0;
  const failedCustomers = failedCustomerSyncs?.total ?? 0;
  const pendingCustomers = pendingCustomerSyncs?.total ?? 0;
  const openInvoiceCount = qbStatus?.overview?.openInvoiceCount;
  const accountsTotal = qbStatus?.overview?.accountsTotal;

  return {
    warnings,
    cards: [
      {
        id: 'quickbooks',
        name: 'QuickBooks Online',
        description: 'Connection and live reference-data availability from the QuickBooks API.',
        href: erpRoute('accounting'),
        cta: 'Open accounting',
        status: qbStatus?.connected ? 'SYNCED' : 'FAILED',
        primary: qbStatus?.companyName ?? qbStatus?.message ?? 'QuickBooks connection unavailable',
        secondary: qbStatus?.realmId ? `Realm ${qbStatus.realmId}` : undefined,
        details: [
          openInvoiceCount !== undefined ? pluralize(openInvoiceCount, 'open invoice') : undefined,
          accountsTotal !== undefined ? pluralize(accountsTotal, 'chart account') : undefined,
          qbStatus?.overview?.customerCount !== undefined
            ? pluralize(qbStatus.overview.customerCount, 'customer')
            : undefined,
        ].filter(Boolean) as string[],
      },
      {
        id: 'integration-accounts',
        name: 'Integration Accounts',
        description: 'Provider account records backing accounting sync and reconciliation.',
        href: erpRoute('accounting-reconciliation'),
        cta: 'Open reconciliation',
        status: integrationAccounts
          ? integrationAccounts.total > 0 && integrationAccounts.total === activeAccounts
            ? 'SYNCED'
            : 'PENDING'
          : 'FAILED',
        primary: integrationAccounts
          ? pluralize(integrationAccounts.total, 'configured account')
          : 'Integration accounts unavailable',
        secondary: integrationAccounts ? `${activeAccounts} active` : undefined,
        details:
          integrationAccounts?.items
            .slice(0, 3)
            .map(
              (account) =>
                `${account.displayName ?? account.name ?? account.provider ?? account.id}: ${
                  account.accountStatus ?? 'UNKNOWN'
                }`,
            ) ?? [],
      },
      {
        id: 'invoice-sync',
        name: 'Invoice Sync Failures',
        description: 'QuickBooks invoice sync records needing retry or data repair.',
        href: erpRoute('accounting-sync', { view: 'failures' }),
        cta: 'Open failures',
        status: failedInvoices > 0 ? 'FAILED' : 'SYNCED',
        primary: pluralize(failedInvoices, 'failed invoice sync'),
        details:
          failedInvoiceSyncs?.items.slice(0, 3).map((record) => {
            const suffix = record.lastErrorMessage ? ` - ${record.lastErrorMessage}` : '';
            return `${record.invoiceNumber}${suffix}`;
          }) ?? [],
      },
      {
        id: 'customer-sync',
        name: 'Customer Sync Queue',
        description: 'Customer sync backlog and failures moving ERP contacts to QuickBooks.',
        href: erpRoute('accounting-sync', { view: 'customers' }),
        cta: 'Open customer sync',
        status: failedCustomers > 0 ? 'FAILED' : pendingCustomers > 0 ? 'PENDING' : 'SYNCED',
        primary: `${pluralize(pendingCustomers, 'pending customer')} / ${pluralize(
          failedCustomers,
          'failed customer',
        )}`,
        details: [],
      },
      {
        id: 'reconciliation',
        name: 'Reconciliation Runs',
        description: 'Latest ERP-to-QuickBooks reconciliation run status and mismatch count.',
        href: erpRoute('accounting-reconciliation'),
        cta: 'Open reconciliation',
        status: reconcileStatus(latestReconciliation),
        primary: latestReconciliation
          ? (latestReconciliation.summary ?? latestReconciliation.status)
          : 'No reconciliation run returned',
        secondary: formatDate(latestReconciliation?.startedAt),
        details: [
          latestReconciliation?.mismatchCount !== undefined
            ? pluralize(latestReconciliation.mismatchCount, 'mismatch', 'mismatches')
            : undefined,
          reconciliationRuns ? pluralize(reconciliationRuns.total, 'run') : undefined,
        ].filter(Boolean) as string[],
      },
    ],
  };
}

export default async function IntegrationsPage() {
  const health = await loadIntegrationHealth();

  return (
    <div>
      <PageHeader
        title="Integration Health"
        description="Live connector status, queues, failures, and reconciliation activity"
      />
      {health.warnings.length > 0 && (
        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
          Some integration checks could not be loaded. Cards with unavailable sources are marked
          directly.
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {health.cards.map((card) => (
          <HealthCard key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}

function HealthCard({ card }: { card: IntegrationHealthCard }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{card.name}</p>
          <p className="mt-1 text-xs leading-5 text-gray-500">{card.description}</p>
        </div>
        <SyncStatusBadge status={card.status} />
      </div>
      <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
        <div className="text-sm font-semibold text-gray-900">{card.primary}</div>
        {card.secondary && <div className="mt-0.5 text-xs text-gray-500">{card.secondary}</div>}
      </div>
      {card.details.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-gray-500">
          {card.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
      <Link
        href={card.href}
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#B1581B] hover:underline"
      >
        {card.cta}
        <ExternalLink size={14} />
      </Link>
    </section>
  );
}
