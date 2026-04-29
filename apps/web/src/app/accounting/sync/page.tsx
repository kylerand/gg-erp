'use client';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, EmptyState, LoadingSkeleton, SyncStatusBadge } from '@gg-erp/ui';
import type { SyncStatus } from '@gg-erp/ui';
import {
  listInvoiceSyncRecords,
  retryInvoiceSync,
  getQbStatus,
  listCustomerSyncs,
  listIntegrationAccounts,
  getFailureSummary,
  type InvoiceSyncRecord,
  type CustomerSyncRecord,
  type IntegrationAccount,
  type FailureSummary,
} from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { erpRoute } from '@/lib/erp-routes';

type SyncView = 'failures' | 'queue' | 'invoices' | 'customers' | 'accounts';
type StateFilter =
  | 'ALL'
  | 'FAILED'
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'SYNCED'
  | 'CANCELLED'
  | 'SKIPPED';
type PeriodFilter = 'today' | undefined;

const VIEWS: Array<{ id: SyncView; label: string; description: string }> = [
  { id: 'failures', label: 'Failures', description: 'Rows that need attention' },
  { id: 'queue', label: 'Queue', description: 'Pending or in progress' },
  { id: 'invoices', label: 'Invoices', description: 'Invoice sync records' },
  { id: 'customers', label: 'Customers', description: 'Customer sync records' },
  { id: 'accounts', label: 'Accounts', description: 'QuickBooks account mappings' },
];

const STATE_FILTERS: StateFilter[] = [
  'ALL',
  'FAILED',
  'PENDING',
  'IN_PROGRESS',
  'SYNCED',
  'CANCELLED',
  'SKIPPED',
];
const CUSTOMER_STATE_FILTERS: StateFilter[] = [
  'ALL',
  'FAILED',
  'PENDING',
  'IN_PROGRESS',
  'SYNCED',
  'SKIPPED',
];
const INVOICE_LOAD_STATES: Array<InvoiceSyncRecord['state'] | undefined> = [
  undefined,
  'FAILED',
  'PENDING',
  'IN_PROGRESS',
  'SYNCED',
  'CANCELLED',
];
const CUSTOMER_LOAD_STATES: Array<CustomerSyncRecord['state'] | undefined> = [
  undefined,
  'FAILED',
  'PENDING',
  'IN_PROGRESS',
  'SYNCED',
  'SKIPPED',
];
const EMPTY_FAILURES: FailureSummary = { invoice: 0, customer: 0, payment: 0, total: 0 };

export default function SyncMonitorPage() {
  const [invoiceRecords, setInvoiceRecords] = useState<InvoiceSyncRecord[]>([]);
  const [customerRecords, setCustomerRecords] = useState<CustomerSyncRecord[]>([]);
  const [accounts, setAccounts] = useState<IntegrationAccount[]>([]);
  const [failureSummary, setFailureSummary] = useState<FailureSummary>(EMPTY_FAILURES);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setViewState] = useState<SyncView>('failures');
  const [state, setStateFilter] = useState<StateFilter>('ALL');
  const [period, setPeriodFilter] = useState<PeriodFilter>();
  const [qbConnected, setQbConnected] = useState<boolean | null>(null);
  const [qbCompany, setQbCompany] = useState<string | undefined>();
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setViewState(normalizeView(params.get('view') ?? params.get('tab')));
    setStateFilter(normalizeState(params.get('state')));
    setPeriodFilter(params.get('period') === 'today' ? 'today' : undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const invoiceRequests = INVOICE_LOAD_STATES.map((syncState) =>
      listInvoiceSyncRecords({ state: syncState, limit: 200 }),
    );
    const customerRequests = CUSTOMER_LOAD_STATES.map((syncState) =>
      listCustomerSyncs({ state: syncState, limit: 200 }),
    );
    Promise.allSettled([
      ...invoiceRequests,
      ...customerRequests,
      listIntegrationAccounts(),
      getFailureSummary(),
      getQbStatus(),
    ])
      .then((results) => {
        if (cancelled) return;

        const invoiceRequestCount = invoiceRequests.length;
        const customerRequestCount = customerRequests.length;
        const invoiceResults = results.slice(0, invoiceRequestCount) as PromiseSettledResult<{
          items: InvoiceSyncRecord[];
        }>[];
        const customerResults = results.slice(
          invoiceRequestCount,
          invoiceRequestCount + customerRequestCount,
        ) as PromiseSettledResult<{ items: CustomerSyncRecord[] }>[];
        const [accountsResult, failureResult, statusResult] = results.slice(
          invoiceRequestCount + customerRequestCount,
        ) as [
          PromiseSettledResult<{ items: IntegrationAccount[] }>,
          PromiseSettledResult<FailureSummary>,
          PromiseSettledResult<{ connected: boolean; companyName?: string }>,
        ];

        const errs = results
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
        if (errs.length) setLoadError(errs[0]);

        const invoiceGroups = invoiceResults
          .filter(
            (r): r is PromiseFulfilledResult<{ items: InvoiceSyncRecord[] }> =>
              r.status === 'fulfilled',
          )
          .map((r) => r.value.items);
        const customerGroups = customerResults
          .filter(
            (r): r is PromiseFulfilledResult<{ items: CustomerSyncRecord[] }> =>
              r.status === 'fulfilled',
          )
          .map((r) => r.value.items);

        if (invoiceGroups.length) setInvoiceRecords(mergeById(invoiceGroups));
        if (customerGroups.length) setCustomerRecords(mergeById(customerGroups));
        if (accountsResult.status === 'fulfilled') setAccounts(accountsResult.value.items);
        if (failureResult.status === 'fulfilled') setFailureSummary(failureResult.value);
        if (statusResult.status === 'fulfilled') {
          setQbConnected(statusResult.value.connected);
          setQbCompany(statusResult.value.companyName);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function retry(id: string) {
    setRetrying(id);
    setInvoiceRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, state: 'IN_PROGRESS' as const } : r)),
    );
    try {
      await retryInvoiceSync(id);
      setInvoiceRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, state: 'PENDING' as const } : r)),
      );
      toast.success('Retry queued');
    } catch (err) {
      setInvoiceRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, state: 'FAILED' as const } : r)),
      );
      toast.error(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(null);
    }
  }

  function updateLocation(next: { view?: SyncView; state?: StateFilter; period?: PeriodFilter }) {
    const nextView = next.view ?? view;
    const nextState = next.state ?? state;
    const nextPeriod = next.period;

    setViewState(nextView);
    setStateFilter(nextState);
    setPeriodFilter(nextPeriod);

    const qs = new URLSearchParams();
    qs.set('view', nextView);
    if ((nextView === 'invoices' || nextView === 'customers') && nextState !== 'ALL') {
      qs.set('state', nextState);
    }
    if ((nextView === 'invoices' || nextView === 'customers') && nextPeriod) {
      qs.set('period', nextPeriod);
    }
    window.history.replaceState(null, '', erpRoute('accounting-sync', Object.fromEntries(qs)));
  }

  const rows = useMemo(() => {
    const invoiceFailures = invoiceRecords.filter((r) => r.state === 'FAILED');
    const customerFailures = customerRecords.filter((r) => r.state === 'FAILED');
    const invoiceQueue = invoiceRecords.filter(
      (r) => r.state === 'PENDING' || r.state === 'IN_PROGRESS',
    );
    const customerQueue = customerRecords.filter(
      (r) => r.state === 'PENDING' || r.state === 'IN_PROGRESS',
    );

    const invoiceList = invoiceRecords
      .filter((r) => state === 'ALL' || r.state === state)
      .filter((r) => !period || isToday(r.syncedAt ?? r.createdAt));
    const customerList = customerRecords
      .filter((r) => state === 'ALL' || r.state === state)
      .filter((r) => !period || isToday(r.syncedAt ?? r.createdAt));

    return {
      invoiceFailures,
      customerFailures,
      invoiceQueue,
      customerQueue,
      invoiceList,
      customerList,
    };
  }, [customerRecords, invoiceRecords, period, state]);

  const stats = {
    failures: rows.invoiceFailures.length + rows.customerFailures.length + failureSummary.payment,
    queue: rows.invoiceQueue.length + rows.customerQueue.length,
    invoices: invoiceRecords.length,
    customers: customerRecords.length,
    accounts: accounts.length,
  };

  const activeDescription =
    view === 'failures'
      ? 'Invoice and customer sync failures with retry context.'
      : view === 'queue'
        ? 'Records waiting to sync or currently in progress.'
        : view === 'invoices'
          ? 'Invoice sync history from the ERP to QuickBooks.'
          : view === 'customers'
            ? 'Customer sync history from the ERP to QuickBooks.'
            : 'Connected integration accounts and mapped QuickBooks account metadata.';

  return (
    <div>
      <PageHeader
        title="Sync Monitor"
        description={activeDescription}
        action={
          qbConnected === false ? (
            <a
              href={`${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'}/accounting/oauth/connect`}
            >
              <Button className="bg-yellow-400 hover:bg-yellow-300 text-gray-900">
                Connect QuickBooks
              </Button>
            </a>
          ) : qbConnected ? (
            <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full">
              Connected: {qbCompany}
            </span>
          ) : null
        }
      />

      {loadError && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-yellow-800">
            Could not load all sync data: {loadError}
          </p>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-5">
        {VIEWS.map((item) => {
          const active = view === item.id;
          const count = stats[item.id];
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => updateLocation({ view: item.id, state: 'ALL', period: undefined })}
              className={`rounded-lg border px-3 py-3 text-left transition-colors ${active ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-yellow-400'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{item.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${active ? 'bg-white/15 text-white' : 'bg-gray-100 text-gray-700'}`}
                >
                  {count}
                </span>
              </div>
              <div className={`mt-1 text-[11px] ${active ? 'text-white/70' : 'text-gray-500'}`}>
                {item.description}
              </div>
            </button>
          );
        })}
      </div>

      {(view === 'invoices' || view === 'customers') && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(view === 'customers' ? CUSTOMER_STATE_FILTERS : STATE_FILTERS).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => updateLocation({ state: f, period })}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${state === f ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600 hover:border-gray-400'}`}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
          {period === 'today' && (
            <button
              type="button"
              onClick={() => updateLocation({ period: undefined })}
              className="text-xs px-3 py-1.5 rounded-full border border-yellow-300 bg-yellow-50 text-yellow-800"
            >
              Today only x
            </button>
          )}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton rows={4} cols={5} />
      ) : view === 'failures' ? (
        <FailureList
          invoiceRows={rows.invoiceFailures}
          customerRows={rows.customerFailures}
          paymentFailureCount={failureSummary.payment}
          retrying={retrying}
          onRetry={retry}
        />
      ) : view === 'queue' ? (
        <QueueList invoiceRows={rows.invoiceQueue} customerRows={rows.customerQueue} />
      ) : view === 'invoices' ? (
        <InvoiceTable records={rows.invoiceList} retrying={retrying} onRetry={retry} />
      ) : view === 'customers' ? (
        <CustomerTable records={rows.customerList} />
      ) : (
        <AccountsTable accounts={accounts} />
      )}
    </div>
  );
}

function FailureList({
  invoiceRows,
  customerRows,
  paymentFailureCount,
  retrying,
  onRetry,
}: {
  invoiceRows: InvoiceSyncRecord[];
  customerRows: CustomerSyncRecord[];
  paymentFailureCount: number;
  retrying: string | null;
  onRetry: (id: string) => void;
}) {
  if (invoiceRows.length === 0 && customerRows.length === 0 && paymentFailureCount === 0) {
    return (
      <EmptyState
        icon="OK"
        title="No sync failures"
        description="Invoice and customer sync records are healthy."
      />
    );
  }
  return (
    <div className="space-y-4">
      {paymentFailureCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {paymentFailureCount} payment failure{paymentFailureCount === 1 ? '' : 's'} are counted in
          the summary. Row-level payment retry is not exposed in this monitor yet.
        </div>
      )}
      {invoiceRows.length > 0 && (
        <Section title={`Invoice failures (${invoiceRows.length})`}>
          <InvoiceTable records={invoiceRows} retrying={retrying} onRetry={onRetry} compact />
        </Section>
      )}
      {customerRows.length > 0 && (
        <Section title={`Customer failures (${customerRows.length})`}>
          <CustomerTable records={customerRows} compact />
        </Section>
      )}
    </div>
  );
}

function QueueList({
  invoiceRows,
  customerRows,
}: {
  invoiceRows: InvoiceSyncRecord[];
  customerRows: CustomerSyncRecord[];
}) {
  if (invoiceRows.length === 0 && customerRows.length === 0) {
    return (
      <EmptyState
        icon="OK"
        title="Queue is empty"
        description="No invoice or customer records are waiting to sync."
      />
    );
  }
  return (
    <div className="space-y-4">
      {invoiceRows.length > 0 && (
        <Section title={`Invoice queue (${invoiceRows.length})`}>
          <InvoiceTable records={invoiceRows} compact />
        </Section>
      )}
      {customerRows.length > 0 && (
        <Section title={`Customer queue (${customerRows.length})`}>
          <CustomerTable records={customerRows} compact />
        </Section>
      )}
    </div>
  );
}

function InvoiceTable({
  records,
  retrying,
  onRetry,
  compact,
}: {
  records: InvoiceSyncRecord[];
  retrying?: string | null;
  onRetry?: (id: string) => void;
  compact?: boolean;
}) {
  if (records.length === 0) {
    return (
      <EmptyState
        icon="OK"
        title="No invoice records"
        description="No invoices match this filter."
      />
    );
  }
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Invoice</th>
            {!compact && (
              <th className="px-4 py-3 text-left font-medium text-gray-600">Work order</th>
            )}
            <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Retries</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Synced</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Error</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {records.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <div className="font-mono text-xs font-semibold text-gray-900">
                  {r.invoiceNumber}
                </div>
                <div className="text-[11px] text-gray-400">{r.externalReference ?? r.id}</div>
              </td>
              {!compact && (
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.workOrderId}</td>
              )}
              <td className="px-4 py-3">
                <SyncState state={r.state} />
              </td>
              <td className="px-4 py-3 text-gray-500">{r.attemptCount}</td>
              <td className="px-4 py-3 text-xs text-gray-500">
                {formatDateTime(r.syncedAt ?? r.createdAt)}
              </td>
              <td className="px-4 py-3 text-xs text-red-600 max-w-xs truncate">
                {r.lastErrorMessage ?? r.lastErrorCode ?? '-'}
              </td>
              <td className="px-4 py-3 text-right">
                {onRetry && (r.state === 'FAILED' || r.state === 'CANCELLED') && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={retrying === r.id}
                    onClick={() => onRetry(r.id)}
                  >
                    {retrying === r.id ? 'Queuing...' : 'Retry'}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomerTable({ records, compact }: { records: CustomerSyncRecord[]; compact?: boolean }) {
  if (records.length === 0) {
    return (
      <EmptyState
        icon="OK"
        title="No customer records"
        description="No customer sync records match this filter."
      />
    );
  }
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
            {!compact && (
              <th className="px-4 py-3 text-left font-medium text-gray-600">Provider</th>
            )}
            <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Retries</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Synced</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {records.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <div className="font-mono text-xs font-semibold text-gray-900">{r.customerId}</div>
                <div className="text-[11px] text-gray-400">{r.externalReference ?? r.id}</div>
              </td>
              {!compact && <td className="px-4 py-3 text-gray-500">{r.provider}</td>}
              <td className="px-4 py-3">
                <SyncState state={r.state} />
              </td>
              <td className="px-4 py-3 text-gray-500">{r.attemptCount}</td>
              <td className="px-4 py-3 text-xs text-gray-500">
                {formatDateTime(r.syncedAt ?? r.createdAt)}
              </td>
              <td className="px-4 py-3 text-xs text-red-600 max-w-xs truncate">
                {r.lastErrorMessage ?? r.lastErrorCode ?? '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountsTable({ accounts }: { accounts: IntegrationAccount[] }) {
  if (accounts.length === 0) {
    return (
      <EmptyState
        icon="QB"
        title="No integration accounts"
        description="Connect QuickBooks or run account import to populate mappings."
      />
    );
  }
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Account</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Provider</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">External key</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Last synced</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {accounts.map((a) => (
            <tr key={a.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-semibold text-gray-900">
                {a.displayName ?? a.name ?? a.id}
              </td>
              <td className="px-4 py-3 text-gray-500">{a.provider ?? '-'}</td>
              <td className="px-4 py-3">
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs text-gray-700">
                  {a.accountStatus ?? a.accountType ?? 'UNKNOWN'}
                </span>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-gray-500">
                {a.accountKey ?? a.qbId ?? '-'}
              </td>
              <td className="px-4 py-3 text-xs text-gray-500">
                {formatDateTime(a.lastSyncedAt ?? a.updatedAt ?? a.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-gray-700">{title}</h2>
      {children}
    </section>
  );
}

function SyncState({ state }: { state: string }) {
  if (
    state === 'PENDING' ||
    state === 'IN_PROGRESS' ||
    state === 'SYNCED' ||
    state === 'FAILED' ||
    state === 'RETRY'
  ) {
    return <SyncStatusBadge status={state as SyncStatus} />;
  }
  return (
    <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-700">
      {state.replace('_', ' ')}
    </span>
  );
}

function normalizeView(raw: string | null): SyncView {
  if (
    raw === 'queue' ||
    raw === 'invoices' ||
    raw === 'customers' ||
    raw === 'accounts' ||
    raw === 'failures'
  ) {
    return raw;
  }
  return 'failures';
}

function normalizeState(raw: string | null): StateFilter {
  if (
    raw === 'FAILED' ||
    raw === 'PENDING' ||
    raw === 'IN_PROGRESS' ||
    raw === 'SYNCED' ||
    raw === 'CANCELLED' ||
    raw === 'SKIPPED'
  ) {
    return raw;
  }
  return 'ALL';
}

function mergeById<T extends { id: string; createdAt?: string; syncedAt?: string | null }>(
  groups: T[][],
): T[] {
  const records = new Map<string, T>();
  for (const group of groups) {
    for (const record of group) {
      records.set(record.id, record);
    }
  }
  return Array.from(records.values()).sort((a, b) => recordTime(b) - recordTime(a));
}

function recordTime(record: { createdAt?: string; syncedAt?: string | null }): number {
  return new Date(record.syncedAt ?? record.createdAt ?? 0).getTime();
}

function isToday(iso?: string | null): boolean {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
