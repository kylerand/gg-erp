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
  type QbOverview,
} from '@/lib/api-client';

interface AccountingMetrics {
  qb: { connected: boolean; companyName?: string; realmId?: string; overview?: QbOverview } | null;
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

const ACCOUNTING_LINKS = {
  failures: '/accounting/sync?view=failures',
  queue: '/accounting/sync?view=queue',
  invoices: '/accounting/sync?view=invoices',
  invoicesSyncedToday: '/accounting/sync?view=invoices&state=SYNCED&period=today',
  customers: '/accounting/sync?view=customers',
  customersSynced: '/accounting/sync?view=customers&state=SYNCED',
  accounts: '/accounting/sync?view=accounts',
  recentInvoices: '/accounting#recent-invoices',
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
  const ov = m.qb?.overview;
  const actions = buildActionQueue(m, connected);
  const todayState = summarizeState(m, connected, actions.length);

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

      {/* Today's state — single sentence the user reads first */}
      <TodayBanner state={todayState} loading={loading} />

      {/* Action queue — prioritized list of things to do */}
      {connected && (
        <ActionQueue actions={actions} loading={loading} />
      )}

      {/* Reference: live QB data straight from QuickBooks (read-only) */}
      {connected && (
        <details className="mb-6 group" open>
          <summary className="cursor-pointer text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span>Reference: live QuickBooks data</span>
            <span className="group-open:rotate-90 transition-transform inline-block">▸</span>
          </summary>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <KpiCard
            label="QB customers"
            value={ov?.customerCount ?? '—'}
            tone="neutral"
            subline="Total in QuickBooks"
            href={ACCOUNTING_LINKS.customers}
            loading={loading}
          />
          <KpiCard
            label="Open AR"
            value={ov?.openInvoiceBalance != null ? formatUsd(ov.openInvoiceBalance) : '—'}
            tone={ov?.openInvoiceBalance && ov.openInvoiceBalance > 0 ? 'amber' : 'neutral'}
            subline={`${ov?.openInvoiceCount ?? 0} unpaid invoice${ov?.openInvoiceCount === 1 ? '' : 's'}`}
            href={ACCOUNTING_LINKS.recentInvoices}
            loading={loading}
          />
          <KpiCard
            label="Chart of accounts"
            value={ov?.accountsTotal ?? '—'}
            tone="neutral"
            subline={
              ov?.accountsByType
                ? Object.entries(ov.accountsByType)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([t, n]) => `${n} ${t}`)
                    .join(' · ')
                : 'Loading…'
            }
            href={ACCOUNTING_LINKS.accounts}
            loading={loading}
          />
          <KpiCard
            label="Recent invoices"
            value={ov?.recentInvoices?.length ?? '—'}
            tone="green"
            subline={
              ov?.recentInvoices?.[0]?.txnDate
                ? `Newest: ${ov.recentInvoices[0].txnDate}`
                : 'No recent activity'
            }
            href={ACCOUNTING_LINKS.recentInvoices}
            loading={loading}
          />
        </div>
        </details>
      )}

      {/* Recent invoices table — straight from QuickBooks */}
      {connected && ov?.recentInvoices && ov.recentInvoices.length > 0 && (
        <SectionCard id="recent-invoices" title="Recent invoices in QuickBooks" action={`Last ${ov.recentInvoices.length}`}>
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase">
              <tr className="text-left">
                <th className="py-2 pr-3">Invoice</th>
                <th className="py-2 pr-3">Customer</th>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3 text-right">Total</th>
                <th className="py-2 pl-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ov.recentInvoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="py-2 pr-3 font-medium text-gray-900">#{inv.docNumber ?? inv.id}</td>
                  <td className="py-2 pr-3 text-gray-700">{inv.customerName ?? '—'}</td>
                  <td className="py-2 pr-3 text-gray-500">{inv.txnDate ?? '—'}</td>
                  <td className="py-2 pr-3 text-right text-gray-900">{formatUsd(inv.totalAmount)}</td>
                  <td className="py-2 pl-3 text-right">
                    {inv.balance > 0 ? (
                      <span className="text-amber-700 font-semibold">{formatUsd(inv.balance)}</span>
                    ) : (
                      <span className="text-green-700">paid</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      )}

      {/* Notice when overview fetch failed (token expired, network, etc.) */}
      {connected && ov?.error && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
          QuickBooks live data unavailable: {ov.error}. Sync state below is from the local cache.
        </div>
      )}

      {/* Top-level KPI grid */}
      <details className="mb-6 group">
        <summary className="cursor-pointer text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <span>Local sync state</span>
          <span className="group-open:rotate-90 transition-transform inline-block">▸</span>
        </summary>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Total failures"
          value={m.failureSummary.total}
          tone={m.failureSummary.total > 0 ? 'red' : 'neutral'}
          subline={`${m.failureSummary.invoice} invoice · ${m.failureSummary.customer} customer · ${m.failureSummary.payment} payment`}
          href={ACCOUNTING_LINKS.failures}
          loading={loading}
        />
        <KpiCard
          label="Pending sync"
          value={m.invoicePending + m.customerPending}
          tone={m.invoicePending + m.customerPending > 0 ? 'amber' : 'neutral'}
          subline={`${m.invoicePending} invoice · ${m.customerPending} customer`}
          href={ACCOUNTING_LINKS.queue}
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
          href={ACCOUNTING_LINKS.invoicesSyncedToday}
          loading={loading}
        />
        <KpiCard
          label="Customers in sync"
          value={m.customersSyncedTotal - m.customerFailed - m.customerPending}
          tone="neutral"
          subline={`${m.customersSyncedTotal} total · ${m.customerFailed} failed`}
          href={ACCOUNTING_LINKS.customersSynced}
          loading={loading}
        />
      </div>
      </details>

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
          { label: 'Sync Monitor', description: 'Per-record sync status and retry', href: ACCOUNTING_LINKS.failures, icon: '🔄' },
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
  id, title, href, action, children,
}: {
  id?: string;
  title: string;
  href?: string;
  action?: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="bg-white rounded-lg border border-gray-200 p-5 mb-4 scroll-mt-24">
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

// ─── Action queue / today's state ───────────────────────────────────────────

interface QueuedAction {
  severity: 'high' | 'medium' | 'low' | 'info';
  title: string;
  detail: string;
  cta: string;
  href: string;
}

function buildActionQueue(m: AccountingMetrics, connected: boolean): QueuedAction[] {
  const out: QueuedAction[] = [];
  if (!connected) return out;

  if (m.failureSummary.total > 0) {
    out.push({
      severity: 'high',
      title: `${m.failureSummary.total} sync failure${m.failureSummary.total === 1 ? '' : 's'} need attention`,
      detail: `${m.failureSummary.invoice} invoice · ${m.failureSummary.customer} customer · ${m.failureSummary.payment} payment. Each failure has an error message; retry once you know the cause is resolved.`,
      cta: 'Review failures →',
      href: ACCOUNTING_LINKS.failures,
    });
  }

  const pending = m.invoicePending + m.customerPending;
  if (pending > 0) {
    out.push({
      severity: 'medium',
      title: `${pending} record${pending === 1 ? '' : 's'} waiting to sync`,
      detail: 'These ran into a transient error or are queued for the next batch. Usually self-resolves within an hour.',
      cta: 'View queue →',
      href: ACCOUNTING_LINKS.queue,
    });
  }

  const lastRecon = m.lastReconciliation;
  const ageDays = lastRecon
    ? Math.floor((Date.now() - new Date(lastRecon.startedAt).getTime()) / 86_400_000)
    : null;
  if (!lastRecon) {
    out.push({
      severity: 'medium',
      title: 'No reconciliation has ever run',
      detail: 'Reconciliation compares ERP invoices to QuickBooks records and surfaces mismatches. Runs nightly automatically; trigger one now to bootstrap history.',
      cta: 'Open reconciliation →',
      href: '/accounting/reconciliation',
    });
  } else if (ageDays !== null && ageDays > 2) {
    out.push({
      severity: 'medium',
      title: `Reconciliation is ${ageDays} days old`,
      detail: `Last run ${formatDateTime(lastRecon.startedAt)}. Nightly runs may have stalled — trigger one and check the schedule.`,
      cta: 'Open reconciliation →',
      href: '/accounting/reconciliation',
    });
  } else if (lastRecon.mismatchCount && lastRecon.mismatchCount > 0) {
    out.push({
      severity: 'medium',
      title: `${lastRecon.mismatchCount} reconciliation mismatch${lastRecon.mismatchCount === 1 ? '' : 'es'} unresolved`,
      detail: `Last run ${formatRelative(lastRecon.startedAt)}. Each mismatch is a record where ERP and QB disagree.`,
      cta: 'Resolve →',
      href: '/accounting/reconciliation',
    });
  }

  if (out.length === 0) {
    out.push({
      severity: 'info',
      title: 'Nothing needs attention right now',
      detail: 'All sync records are healthy and reconciliation is current. Check back tomorrow or after the next batch of work orders complete.',
      cta: 'See sync history →',
      href: ACCOUNTING_LINKS.invoices,
    });
  }

  return out;
}

interface TodayState {
  tone: 'green' | 'amber' | 'red' | 'neutral';
  headline: string;
  subhead: string;
}

function summarizeState(m: AccountingMetrics, connected: boolean, actionCount: number): TodayState {
  if (!connected) {
    return {
      tone: 'amber',
      headline: 'QuickBooks isn\'t connected',
      subhead: 'Connect to start syncing invoices, customers, and payments.',
    };
  }
  if (m.failureSummary.total > 0) {
    return {
      tone: 'red',
      headline: `${m.failureSummary.total} thing${m.failureSummary.total === 1 ? '' : 's'} need attention today`,
      subhead: 'Sync failures below — each row tells you what went wrong and how to retry.',
    };
  }
  if (actionCount > 1) {
    return {
      tone: 'amber',
      headline: `${actionCount - 1} item${actionCount - 1 === 1 ? '' : 's'} to review`,
      subhead: 'No failures, but a few things worth checking. Action queue below.',
    };
  }
  return {
    tone: 'green',
    headline: 'All quiet on the accounting front.',
    subhead: 'Sync is healthy, reconciliation is current. Nothing requires your attention right now.',
  };
}

function TodayBanner({ state, loading }: { state: TodayState; loading: boolean }) {
  if (loading) {
    return (
      <div className="mb-6 bg-gray-50 border border-gray-200 rounded-lg p-4 animate-pulse">
        <div className="h-5 w-64 bg-gray-200 rounded" />
        <div className="h-3 w-96 bg-gray-100 rounded mt-2" />
      </div>
    );
  }
  const toneStyles: Record<TodayState['tone'], string> = {
    green: 'bg-green-50 border-green-200 text-green-900',
    amber: 'bg-yellow-50 border-yellow-200 text-yellow-900',
    red: 'bg-red-50 border-red-200 text-red-900',
    neutral: 'bg-gray-50 border-gray-200 text-gray-900',
  };
  return (
    <div className={`mb-4 border rounded-lg p-4 ${toneStyles[state.tone]}`}>
      <div className="font-semibold text-base">{state.headline}</div>
      <div className="text-sm mt-1 opacity-80">{state.subhead}</div>
    </div>
  );
}

function ActionQueue({ actions, loading }: { actions: QueuedAction[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="mb-6 space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-4 animate-pulse">
            <div className="h-4 w-72 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="mb-6 space-y-2">
      {actions.map((a, i) => (
        <ActionRow key={i} action={a} />
      ))}
    </div>
  );
}

function ActionRow({ action }: { action: QueuedAction }) {
  const styles: Record<QueuedAction['severity'], { dot: string; border: string }> = {
    high: { dot: 'bg-red-500', border: 'border-red-200 bg-red-50/50' },
    medium: { dot: 'bg-amber-500', border: 'border-amber-200 bg-amber-50/50' },
    low: { dot: 'bg-blue-500', border: 'border-blue-200 bg-blue-50/50' },
    info: { dot: 'bg-green-500', border: 'border-green-200 bg-green-50/30' },
  };
  const s = styles[action.severity];
  return (
    <div className={`border rounded-lg p-4 flex items-start gap-3 ${s.border}`}>
      <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${s.dot}`} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-gray-900">{action.title}</div>
        <p className="text-xs text-gray-600 mt-1">{action.detail}</p>
      </div>
      <Link
        href={action.href}
        className="flex-shrink-0 text-xs font-semibold text-gray-900 bg-white border border-gray-300 rounded-md px-3 py-1.5 hover:border-gray-500 hover:bg-gray-50"
      >
        {action.cta}
      </Link>
    </div>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
