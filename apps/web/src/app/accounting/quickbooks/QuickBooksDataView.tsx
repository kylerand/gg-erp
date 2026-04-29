'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { EmptyState, LoadingSkeleton, PageHeader } from '@gg-erp/ui';
import {
  getQbStatus,
  type QbAccountSummary,
  type QbCustomerSummary,
  type QbInvoiceSummary,
  type QbOverview,
} from '@/lib/api-client';

type QuickBooksView = 'customers' | 'accounts' | 'invoices';

interface QuickBooksDataViewProps {
  view: QuickBooksView;
}

interface QbState {
  connected: boolean;
  companyName?: string;
  realmId?: string;
  overview?: QbOverview;
}

const VIEW_COPY: Record<QuickBooksView, { title: string; description: string; emptyTitle: string; emptyDescription: string }> = {
  customers: {
    title: 'QuickBooks Customers',
    description: 'Live read-only customer list from QuickBooks.',
    emptyTitle: 'No QuickBooks customers returned',
    emptyDescription: 'QuickBooks is connected, but the latest overview did not include customer rows.',
  },
  accounts: {
    title: 'QuickBooks Chart of Accounts',
    description: 'Live read-only chart of accounts from QuickBooks.',
    emptyTitle: 'No QuickBooks accounts returned',
    emptyDescription: 'QuickBooks is connected, but the latest overview did not include chart-of-accounts rows.',
  },
  invoices: {
    title: 'QuickBooks Invoices',
    description: 'Live read-only invoice activity and open AR summary from QuickBooks.',
    emptyTitle: 'No QuickBooks invoices returned',
    emptyDescription: 'QuickBooks is connected, but the latest overview did not include invoice rows.',
  },
};

export function QuickBooksDataView({ view }: QuickBooksDataViewProps) {
  const [qb, setQb] = useState<QbState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ALL');

  useEffect(() => {
    setQuery('');
    setFilter('ALL');
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getQbStatus()
      .then((status) => {
        if (!cancelled) setQb(status);
      })
      .catch((err) => {
        if (!cancelled) {
          setQb(null);
          setError(err instanceof Error ? err.message : 'Could not load QuickBooks data.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const copy = VIEW_COPY[view];
  const overview = qb?.overview;

  const customerRows = useMemo(() => {
    const rows = overview?.customers ?? [];
    const needle = query.trim().toLowerCase();
    return rows
      .filter((row) => filter === 'ALL' || (filter === 'ACTIVE' ? row.active : !row.active))
      .filter((row) => {
        if (!needle) return true;
        return matchesQuery([row.displayName, row.companyName, row.id], needle);
      });
  }, [filter, overview?.customers, query]);

  const accountRows = useMemo(() => {
    const rows = overview?.accounts ?? [];
    const needle = query.trim().toLowerCase();
    return rows
      .filter((row) => filter === 'ALL' || row.accountType === filter)
      .filter((row) => {
        if (!needle) return true;
        return matchesQuery([row.name, row.accountType, row.accountSubType, row.id], needle);
      });
  }, [filter, overview?.accounts, query]);

  const invoiceRows = useMemo(() => {
    const rows = overview?.recentInvoices ?? [];
    const needle = query.trim().toLowerCase();
    return rows
      .filter((row) => filter === 'ALL' || (filter === 'OPEN' ? row.balance > 0 : row.balance <= 0))
      .filter((row) => {
        if (!needle) return true;
        return matchesQuery([row.docNumber, row.customerName, row.txnDate, row.id], needle);
      });
  }, [filter, overview?.recentInvoices, query]);

  const accountTypeFilters = useMemo(() => {
    const types = new Set((overview?.accounts ?? []).map((account) => account.accountType).filter(Boolean));
    return ['ALL', ...Array.from(types).sort()];
  }, [overview?.accounts]);

  const filterOptions =
    view === 'customers' ? ['ALL', 'ACTIVE', 'INACTIVE']
    : view === 'invoices' ? ['ALL', 'OPEN', 'PAID']
    : accountTypeFilters;

  const visibleCount =
    view === 'customers' ? customerRows.length
    : view === 'accounts' ? accountRows.length
    : invoiceRows.length;

  return (
    <div>
      <PageHeader
        title={copy.title}
        description={copy.description}
        action={
          <Link href="/accounting" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:border-yellow-400">
            Accounting home
          </Link>
        }
      />

      <nav className="mb-5 flex flex-wrap gap-2" aria-label="QuickBooks accounting data">
        <NavPill href="/accounting/quickbooks/customers" active={view === 'customers'}>Customers</NavPill>
        <NavPill href="/accounting/quickbooks/invoices" active={view === 'invoices'}>Invoices</NavPill>
        <NavPill href="/accounting/quickbooks/chart-of-accounts" active={view === 'accounts'}>Chart of accounts</NavPill>
        <NavPill href="/accounting/sync?view=failures" active={false}>Sync monitor</NavPill>
        <NavPill href="/accounting/reconciliation" active={false}>Reconciliation</NavPill>
      </nav>

      {loading ? (
        <LoadingSkeleton rows={5} cols={5} />
      ) : error ? (
        <EmptyState icon="QB" title="Could not load QuickBooks data" description={error} />
      ) : !qb?.connected ? (
        <ConnectQuickBooks companyName={qb?.companyName} />
      ) : (
        <>
          <div className="mb-5 rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="text-sm font-semibold text-green-900">
              Connected to QuickBooks{qb.companyName ? `: ${qb.companyName}` : ''}
            </div>
            {qb.realmId && <div className="mt-1 text-xs text-green-800">Realm ID: <code>{qb.realmId}</code></div>}
            {overview?.error && <div className="mt-2 text-sm text-yellow-800">QuickBooks overview warning: {overview.error}</div>}
          </div>

          {view === 'invoices' && (
            <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
              <Metric label="Open AR" value={formatUsd(overview?.openInvoiceBalance ?? 0)} />
              <Metric label="Open invoices" value={overview?.openInvoiceCount ?? 0} />
              <Metric label="Rows shown" value={visibleCount} />
            </div>
          )}

          <div className="mb-4 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 md:flex-row md:items-center md:justify-between">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${copy.title.toLowerCase()}`}
              className="min-h-10 rounded-md border border-gray-300 px-3 text-sm outline-none focus:border-yellow-400 md:w-80"
            />
            <div className="flex flex-wrap gap-2">
              {filterOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFilter(option)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    filter === option
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-300 bg-white text-gray-600 hover:border-yellow-400'
                  }`}
                >
                  {formatFilterLabel(option)}
                </button>
              ))}
            </div>
          </div>

          {view === 'customers' ? (
            <CustomersTable rows={customerRows} emptyTitle={copy.emptyTitle} emptyDescription={copy.emptyDescription} />
          ) : view === 'accounts' ? (
            <AccountsTable rows={accountRows} emptyTitle={copy.emptyTitle} emptyDescription={copy.emptyDescription} />
          ) : (
            <InvoicesTable rows={invoiceRows} emptyTitle={copy.emptyTitle} emptyDescription={copy.emptyDescription} />
          )}
        </>
      )}
    </div>
  );
}

function NavPill({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'border-[#E37125] bg-[#E37125] text-white'
          : 'border-gray-300 bg-white text-gray-600 hover:border-yellow-400'
      }`}
    >
      {children}
    </Link>
  );
}

function ConnectQuickBooks({ companyName }: { companyName?: string }) {
  return (
    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-5">
      <div className="text-sm font-semibold text-yellow-900">
        QuickBooks is not connected{companyName ? ` for ${companyName}` : ''}.
      </div>
      <p className="mt-1 text-sm text-yellow-800">
        Connect QuickBooks to populate live customers, invoices, and chart-of-accounts lists.
      </p>
      <a
        href={`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/accounting/oauth/connect`}
        className="mt-4 inline-flex rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-yellow-300"
      >
        Connect QuickBooks
      </a>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="mt-1 text-xs font-semibold text-gray-500">{label}</div>
    </div>
  );
}

function CustomersTable({
  rows,
  emptyTitle,
  emptyDescription,
}: {
  rows: QbCustomerSummary[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (rows.length === 0) return <EmptyState icon="QB" title={emptyTitle} description={emptyDescription} />;
  return (
    <Table>
      <thead className="bg-gray-50 text-xs uppercase text-gray-500">
        <tr>
          <Th>Customer</Th>
          <Th>Company</Th>
          <Th>QuickBooks ID</Th>
          <Th align="right">Status</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((customer) => (
          <tr key={customer.id} className="hover:bg-gray-50">
            <Td strong>{customer.displayName}</Td>
            <Td>{customer.companyName ?? '-'}</Td>
            <Td mono>{customer.id}</Td>
            <Td align="right"><Status active={customer.active} /></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function AccountsTable({
  rows,
  emptyTitle,
  emptyDescription,
}: {
  rows: QbAccountSummary[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (rows.length === 0) return <EmptyState icon="QB" title={emptyTitle} description={emptyDescription} />;
  return (
    <Table>
      <thead className="bg-gray-50 text-xs uppercase text-gray-500">
        <tr>
          <Th>Account</Th>
          <Th>Type</Th>
          <Th>Subtype</Th>
          <Th>QuickBooks ID</Th>
          <Th align="right">Status</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((account) => (
          <tr key={account.id} className="hover:bg-gray-50">
            <Td strong>{account.name}</Td>
            <Td>{account.accountType}</Td>
            <Td>{account.accountSubType ?? '-'}</Td>
            <Td mono>{account.id}</Td>
            <Td align="right"><Status active={account.active} /></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function InvoicesTable({
  rows,
  emptyTitle,
  emptyDescription,
}: {
  rows: QbInvoiceSummary[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (rows.length === 0) return <EmptyState icon="QB" title={emptyTitle} description={emptyDescription} />;
  return (
    <Table>
      <thead className="bg-gray-50 text-xs uppercase text-gray-500">
        <tr>
          <Th>Invoice</Th>
          <Th>Customer</Th>
          <Th>Date</Th>
          <Th>Due</Th>
          <Th align="right">Total</Th>
          <Th align="right">Balance</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((invoice) => (
          <tr key={invoice.id} className="hover:bg-gray-50">
            <Td strong>#{invoice.docNumber ?? invoice.id}</Td>
            <Td>{invoice.customerName ?? '-'}</Td>
            <Td>{invoice.txnDate ?? '-'}</Td>
            <Td>{invoice.dueDate ?? '-'}</Td>
            <Td align="right">{formatUsd(invoice.totalAmount)}</Td>
            <Td align="right">
              {invoice.balance > 0 ? (
                <span className="font-semibold text-amber-700">{formatUsd(invoice.balance)}</span>
              ) : (
                <span className="font-semibold text-green-700">Paid</span>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">{children}</table>
      </div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: string; align?: 'left' | 'right' }) {
  return <th className={`px-4 py-3 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>;
}

function Td({
  children,
  strong,
  mono,
  align = 'left',
}: {
  children: ReactNode;
  strong?: boolean;
  mono?: boolean;
  align?: 'left' | 'right';
}) {
  return (
    <td
      className={`px-4 py-3 text-gray-700 ${align === 'right' ? 'text-right' : 'text-left'} ${
        strong ? 'font-semibold text-gray-900' : ''
      } ${mono ? 'font-mono text-xs text-gray-500' : ''}`}
    >
      {children}
    </td>
  );
}

function Status({ active }: { active: boolean }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function formatFilterLabel(value: string): string {
  if (value === 'ALL') return 'All';
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function matchesQuery(values: Array<string | undefined>, query: string): boolean {
  return values.some((value) => value?.toLowerCase().includes(query));
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}
