'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';
import {
  getQbStatus,
  listInvoiceSyncRecords,
  listReconciliationRuns,
  listCustomerSyncs,
  listIntegrationAccounts,
  getFailureSummary,
  type InvoiceSyncRecord,
  type ReconciliationRun,
  type FailureSummary,
} from '@/lib/api-client';

interface AccountingMetrics {
  qb: { connected: boolean; companyName?: string; realmId?: string } | null;
  invoiceFailed: number;
  invoicePending: number;
  invoiceSyncedRecent: InvoiceSyncRecord[];
  customerFailed: number;
  customerPending: number;
  customersSyncedTotal: number;
  failureSummary: FailureSummary;
  lastReconciliation?: ReconciliationRun;
  reconciliationRunCount: number;
  integrationAccountsCount: number;
}

const EMPTY: AccountingMetrics = {
  qb: null,
  invoiceFailed: 0,
  invoicePending: 0,
  invoiceSyncedRecent: [],
  customerFailed: 0,
  customerPending: 0,
  customersSyncedTotal: 0,
  failureSummary: { invoice: 0, customer: 0, payment: 0, total: 0 },
  reconciliationRunCount: 0,
  integrationAccountsCount: 0,
};

export default function AccountingPage() {
  const [m, setM] = useState<AccountingMetrics>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [
        qb,
        invoiceAll,
        invoiceFailed,
        invoicePending,
        invoiceSynced,
        customerAll,
        customerFailed,
        customerPending,
        recons,
        accounts,
        failureSummary,
      ] = await Promise.allSettled([
        getQbStatus(),
        listInvoiceSyncRecords(),
        listInvoiceSyncRecords({ state: 'FAILED' }),
        listInvoiceSyncRecords({ state: 'PENDING' }),
        listInvoiceSyncRecords({ state: 'SYNCED' }),
        listCustomerSyncs(),
        listCustomerSyncs({ state: 'FAILED' }),
        listCustomerSyncs({ state: 'PENDING' }),
        listReconciliationRuns({ limit: 1 }),
        listIntegrationAccounts(),
        getFailureSummary(),
      ]);

      if (cancelled) return;

      const ok = <T,>(r: PromiseSettledResult<T>): T | undefined =>
        r.status === 'fulfilled' ? r.value : undefined;

      const invoiceSyncedItems = ok(invoiceSynced)?.items ?? [];
      const today = new Date().toDateString();

      void invoiceAll; void customerAll;

      setM({
        qb: ok(qb) ?? null,
        invoiceFailed: ok(invoiceFailed)?.items.length ?? 0,
        invoicePending: ok(invoicePending)?.items.length ?? 0,
        invoiceSyncedRecent: invoiceSyncedItems
          .filter((r) => r.syncedAt && new Date(r.syncedAt).toDateString() === today)
          .slice(0, 5),
        customerFailed: ok(customerFailed)?.items.length ?? 0,
        customerPending: ok(customerPending)?.items.length ?? 0,
        customersSyncedTotal: ok(customerAll)?.total ?? 0,
        failureSummary: ok(failureSummary) ?? EMPTY.failureSummary,
        lastReconciliation: ok(recons)?.items[0],
        reconciliationRunCount: ok(recons)?.total ?? 0,
        integrationAccountsCount: ok(accounts)?.total ?? 0,
      });
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const connected = !!m.qb?.connected;

  return (
    <div>
      <PageHeader title="Accounting" description="QuickBooks integration health, sync state, reconciliation" />

      {/* Connection status — top of fold */}
      <ConnectionCard
        connected={connected}
        companyName={m.qb?.companyName}
        realmId={m.qb?.realmId}
        loading={loading}
      />

      {/* Top-level KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Total failures"
          value={m.failureSummary.total}
          tone={m.failureSummary.total > 0 ? 'red' : 'neutral'}
          subline={`${m.failureSummary.invoice} invoice · ${m.failureSummary.customer} customer · ${m.failureSummary.payment} payment`}
          href="/accounting/sync"
          loading={loading}
        />
        <KpiCard
          label="Pending sync"
          value={m.invoicePending + m.customerPending}
          tone={m.invoicePending + m.customerPending > 0 ? 'amber' : 'neutral'}
          subline={`${m.invoicePending} invoice · ${m.customerPending} customer`}
          href="/accounting/sync"
          loading={loading}
        />
        <KpiCard
          label="Synced today"
          value={m.invoiceSyncedRecent.length}
          tone="green"
          subline={
            m.invoiceSyncedRecent.length === 0
              ? 'No invoices synced yet today'
              : `Last: ${formatTime(m.invoiceSyncedRecent[0]?.syncedAt)}`
          }
          href="/accounting/sync"
          loading={loading}
        />
        <KpiCard
          label="Customers in sync"
          value={m.customersSyncedTotal - m.customerFailed - m.customerPending}
          tone="neutral"
          subline={`${m.customersSyncedTotal} total · ${m.customerFailed} failed`}
          href="/accounting/sync"
          loading={loading}
        />
      </div>

      {/* Reconciliation card */}
      <SectionCard
        title="Latest reconciliation"
        href="/accounting/reconciliation"
        action="View all runs →"
      >
        {loading ? (
          <SkeletonRows rows={2} />
        ) : !m.lastReconciliation ? (
          <p className="text-sm text-gray-500">No reconciliation runs yet. Runs are triggered nightly + on demand.</p>
        ) : (
          <div className="text-sm">
            <div className="flex items-center gap-3">
              <StatusPill status={m.lastReconciliation.status} />
              <span className="text-gray-700">Started {formatDateTime(m.lastReconciliation.startedAt)}</span>
            </div>
            {typeof m.lastReconciliation.mismatchCount === 'number' && (
              <p className="mt-2 text-gray-700">
                <span className={m.lastReconciliation.mismatchCount > 0 ? 'font-semibold text-amber-700' : 'font-semibold text-gray-900'}>
                  {m.lastReconciliation.mismatchCount}
                </span>{' '}
                mismatches detected
              </p>
            )}
            {m.lastReconciliation.summary && (
              <p className="mt-1 text-gray-500">{m.lastReconciliation.summary}</p>
            )}
            <p className="mt-2 text-xs text-gray-400">{m.reconciliationRunCount} total runs in history</p>
          </div>
        )}
      </SectionCard>

      {/* Chart of accounts visibility */}
      <SectionCard
        title="QuickBooks chart of accounts"
        action={`${m.integrationAccountsCount} mapped`}
      >
        {loading ? (
          <SkeletonRows rows={1} />
        ) : m.integrationAccountsCount === 0 ? (
          <p className="text-sm text-gray-500">
            No accounts imported yet. They populate after the first successful sync.
          </p>
        ) : (
          <p className="text-sm text-gray-600">
            {m.integrationAccountsCount} QuickBooks accounts mapped to ERP entries (Income, COGS, Liability, Asset).
            Used by the invoice-sync handler when posting line items.
          </p>
        )}
      </SectionCard>

      {/* Sub-page navigation tiles */}
      <div className="grid grid-cols-2 gap-4 mt-6 max-w-2xl">
        {[
          { label: 'Sync Monitor', description: 'Per-record sync status and retry', href: '/accounting/sync', icon: '🔄' },
          { label: 'Reconciliation', description: 'Mismatch resolution history', href: '/accounting/reconciliation', icon: '⚖️' },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="bg-white rounded-lg border border-gray-200 p-5 hover:border-yellow-400 hover:shadow-sm transition-all"
          >
            <div className="text-2xl mb-2">{item.icon}</div>
            <div className="font-semibold text-sm text-gray-900">{item.label}</div>
            <div className="text-xs text-gray-500 mt-0.5">{item.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function ConnectionCard({
  connected, companyName, realmId, loading,
}: {
  connected: boolean;
  companyName?: string;
  realmId?: string;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="mb-6 bg-gray-50 border border-gray-200 rounded-lg p-4 animate-pulse">
        <div className="h-4 w-32 bg-gray-200 rounded" />
      </div>
    );
  }
  if (!connected) {
    return (
      <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center justify-between">
        <div>
          <p className="font-semibold text-yellow-900">QuickBooks is not connected.</p>
          <p className="text-sm text-yellow-800 mt-1">
            Sync, reconciliation, and chart-of-accounts data are unavailable until an admin connects.
          </p>
        </div>
        <a
          href={`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/accounting/oauth/connect`}
          className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold px-4 py-2 rounded-lg"
        >
          Connect QuickBooks
        </a>
      </div>
    );
  }
  return (
    <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
      <div>
        <p className="font-semibold text-green-900">
          ✓ Connected to QuickBooks{companyName ? ` — ${companyName}` : ''}
        </p>
        {realmId && (
          <p className="text-xs text-green-800 mt-1">Realm ID: <code className="font-mono">{realmId}</code></p>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  label, value, tone, subline, href, loading,
}: {
  label: string;
  value: number | string;
  tone: 'red' | 'amber' | 'green' | 'neutral';
  subline: string;
  href: string;
  loading: boolean;
}) {
  const toneClass: Record<typeof tone, string> = {
    red: 'text-red-600',
    amber: 'text-amber-700',
    green: 'text-green-700',
    neutral: 'text-gray-900',
  };
  return (
    <Link
      href={href}
      className="bg-white rounded-lg border border-gray-200 p-4 hover:border-yellow-400 transition-colors block"
    >
      <div className={`text-2xl font-bold ${toneClass[tone]}`}>
        {loading ? <span className="inline-block h-6 w-10 bg-gray-200 rounded animate-pulse" /> : value}
      </div>
      <div className="text-xs text-gray-500 mt-1 font-semibold">{label}</div>
      <div className="text-[11px] text-gray-400 mt-1">{subline}</div>
    </Link>
  );
}

function SectionCard({
  title, href, action, children,
}: {
  title: string;
  href?: string;
  action?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-gray-900">{title}</h3>
        {action &&
          (href ? (
            <Link href={href} className="text-xs text-blue-600 hover:underline">
              {action}
            </Link>
          ) : (
            <span className="text-xs text-gray-500">{action}</span>
          ))}
      </div>
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'COMPLETED' ? 'bg-green-100 text-green-800'
    : status === 'RUNNING' ? 'bg-blue-100 text-blue-800'
    : status === 'FAILED' ? 'bg-red-100 text-red-800'
    : 'bg-gray-100 text-gray-700';
  return <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${cls}`}>{status}</span>;
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${60 + i * 10}%` }} />
      ))}
    </div>
  );
}

function formatTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
