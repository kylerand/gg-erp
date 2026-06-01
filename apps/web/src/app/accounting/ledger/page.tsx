'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { EmptyState, LoadingSkeleton, PageHeader } from '@gg-erp/ui';
import {
  listAccountingJournals,
  listOperationalLedger,
  postOperationalLedgerJournals,
  type AccountingJournalEntry,
  type AccountingJournalResponse,
  type OperationalLedgerEntry,
  type OperationalLedgerResponse,
  type OperationalLedgerSourceType,
  type OperationalLedgerStatus,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';

const STRICT_LIVE_DATA = { allowMockFallback: false } as const;

const SOURCE_FILTERS: Array<'ALL' | OperationalLedgerSourceType> = [
  'ALL',
  'PAYABLE_RECEIPT',
  'CUSTOMER_PAYMENT',
  'RECONCILIATION_VARIANCE',
];
const STATUS_FILTERS: Array<'ALL' | OperationalLedgerStatus> = [
  'ALL',
  'READY_FOR_REVIEW',
  'NEEDS_REVIEW',
  'POSTED',
  'PENDING',
  'FAILED',
  'MISMATCH',
  'RESOLVED',
];

export default function AccountingLedgerPage() {
  const [sourceType, setSourceType] = useState<'ALL' | OperationalLedgerSourceType>('ALL');
  const [status, setStatus] = useState<'ALL' | OperationalLedgerStatus>('ALL');
  const [ledger, setLedger] = useState<OperationalLedgerResponse | null>(null);
  const [journals, setJournals] = useState<AccountingJournalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [postResult, setPostResult] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const sourceFilter = sourceType === 'ALL' ? undefined : sourceType;
    const [ledgerData, journalData] = await Promise.all([
      listOperationalLedger(
        {
          limit: 100,
          sourceType: sourceFilter,
          status: status === 'ALL' ? undefined : status,
        },
        STRICT_LIVE_DATA,
      ),
      listAccountingJournals(
        {
          limit: 50,
          sourceType: sourceFilter,
          status: 'POSTED',
        },
        STRICT_LIVE_DATA,
      ),
    ]);
    return { ledgerData, journalData };
  }, [sourceType, status]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const { ledgerData, journalData } = await loadData();
        if (!cancelled) {
          setLedger(ledgerData);
          setJournals(journalData);
        }
      } catch (error) {
        if (!cancelled) {
          setLedger(null);
          setJournals(null);
          setLoadError(error instanceof Error ? error.message : 'Ledger data failed to load.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  async function handlePostReadyJournals() {
    setPosting(true);
    setLoadError(null);
    setPostResult(null);
    try {
      const result = await postOperationalLedgerJournals(
        {
          sourceType: sourceType === 'ALL' ? undefined : sourceType,
          limit: 100,
        },
        STRICT_LIVE_DATA,
      );
      setPostResult(
        `${result.postedCount} new journals posted · ${result.skipped.existing} already posted · ${result.skipped.notPostable} held for review`,
      );
      const { ledgerData, journalData } = await loadData();
      setLedger(ledgerData);
      setJournals(journalData);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Journal posting failed.');
    } finally {
      setPosting(false);
    }
  }

  const summary = ledger?.summary;
  const journalSummary = journals?.summary;
  const totalExceptions = summary
    ? summary.exceptions.invoice +
      summary.exceptions.customer +
      summary.exceptions.payment +
      summary.exceptions.reconciliation
    : 0;
  const balanced = summary ? summary.totalDebitCents === summary.totalCreditCents : true;
  const rulesBySource = useMemo(
    () => new Map((ledger?.postingRules ?? []).map((rule) => [rule.sourceType, rule])),
    [ledger?.postingRules],
  );

  return (
    <div>
      <PageHeader
        title="Accounting Ledger"
        description="Operational accounting entries, posting rules, and immutable journal consequences from live payables, payments, and reconciliation variance."
      />

      {loadError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
          <p className="font-semibold text-red-900">Ledger data could not be loaded.</p>
          <p className="mt-1 text-sm text-red-800">{loadError}</p>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Entries"
          value={summary?.entryCount ?? 0}
          detail={`${ledger?.total ?? 0} matching filters`}
          loading={loading}
        />
        <MetricCard
          label="Debit/Credit"
          value={balanced ? 'Balanced' : 'Out of balance'}
          detail={`${formatUsdCents(summary?.totalDebitCents ?? 0)} debits`}
          loading={loading}
          tone={balanced ? 'green' : 'red'}
        />
        <MetricCard
          label="Review items"
          value={totalExceptions}
          detail={`${summary?.exceptions.invoice ?? 0} invoice · ${summary?.exceptions.payment ?? 0} payment`}
          loading={loading}
          tone={totalExceptions > 0 ? 'amber' : 'green'}
        />
        <MetricCard
          label="Posted journals"
          value={journalSummary?.entryCount ?? 0}
          detail={`${formatUsdCents(journalSummary?.totalDebitCents ?? 0)} journal value`}
          loading={loading}
        />
      </div>

      <FilterBar
        sourceType={sourceType}
        status={status}
        onSourceTypeChange={setSourceType}
        onStatusChange={setStatus}
      />

      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Journal posting</h2>
            <p className="mt-1 text-sm text-gray-500">
              Post balanced ready entries into immutable journal headers and debit/credit lines.
              Entries needing review, failed syncs, pending payments, and mismatches stay in the
              operational ledger.
            </p>
            {postResult && <p className="mt-2 text-xs font-semibold text-green-700">{postResult}</p>}
          </div>
          <button
            type="button"
            onClick={handlePostReadyJournals}
            disabled={loading || posting}
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-[#E37125] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#B1581B] disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {posting ? 'Posting journals...' : 'Post ready journals'}
          </button>
        </div>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        {SOURCE_FILTERS.filter((source): source is OperationalLedgerSourceType => source !== 'ALL').map(
          (source) => {
            const rule = rulesBySource.get(source);
            const total = summary?.sourceTotals[source];
            return (
              <button
                key={source}
                type="button"
                onClick={() => setSourceType(source)}
                className={`rounded-lg border bg-white p-4 text-left transition-colors ${
                  sourceType === source
                    ? 'border-gray-900'
                    : 'border-gray-200 hover:border-yellow-400'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{sourceLabel(source)}</p>
                    <p className="mt-1 text-xs text-gray-500">{rule?.trigger}</p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                    {total?.count ?? 0}
                  </span>
                </div>
                <div className="mt-3 text-xs text-gray-600">
                  <span className="font-semibold text-gray-900">{rule?.debitAccount}</span>
                  <span className="mx-1 text-gray-400">to</span>
                  <span className="font-semibold text-gray-900">{rule?.creditAccount}</span>
                </div>
                <div className="mt-2 text-lg font-semibold text-gray-900">
                  {formatUsdCents(total?.amountCents ?? 0)}
                </div>
              </button>
            );
          },
        )}
      </div>

      {loading ? (
        <LoadingSkeleton rows={6} cols={7} />
      ) : !ledger || ledger.items.length === 0 ? (
        <EmptyState
          title="No ledger entries match these filters"
          description="Received purchase orders, customer payments, or reconciliation mismatches will appear here after they exist in the live system."
        />
      ) : (
        <LedgerTable entries={ledger.items} />
      )}

      <div className="mt-8">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Posted journals</h2>
            <p className="mt-1 text-sm text-gray-500">
              Immutable accounting consequences posted from the operational ledger.
            </p>
          </div>
          <div className="text-right text-xs text-gray-500">
            {journalSummary ? formatUsdCents(journalSummary.totalDebitCents) : '$0'} posted
          </div>
        </div>
        {loading ? (
          <LoadingSkeleton rows={4} cols={6} />
        ) : !journals || journals.items.length === 0 ? (
          <EmptyState
            title="No journals posted yet"
            description="Use Post ready journals after live payable receipts or posted customer payments are available."
          />
        ) : (
          <JournalTable entries={journals.items} />
        )}
      </div>
    </div>
  );
}

function FilterBar({
  sourceType,
  status,
  onSourceTypeChange,
  onStatusChange,
}: {
  sourceType: 'ALL' | OperationalLedgerSourceType;
  status: 'ALL' | OperationalLedgerStatus;
  onSourceTypeChange: (next: 'ALL' | OperationalLedgerSourceType) => void;
  onStatusChange: (next: 'ALL' | OperationalLedgerStatus) => void;
}) {
  return (
    <div className="mb-5 space-y-3">
      <div className="flex flex-wrap gap-2">
        {SOURCE_FILTERS.map((source) => (
          <button
            key={source}
            type="button"
            onClick={() => onSourceTypeChange(source)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              sourceType === source
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-300 text-gray-600 hover:border-gray-500'
            }`}
          >
            {source === 'ALL' ? 'All sources' : sourceLabel(source)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((nextStatus) => (
          <button
            key={nextStatus}
            type="button"
            onClick={() => onStatusChange(nextStatus)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              status === nextStatus
                ? 'border-[#B1581B] bg-yellow-50 text-[#7A3B12]'
                : 'border-gray-300 text-gray-600 hover:border-gray-500'
            }`}
          >
            {nextStatus === 'ALL' ? 'All statuses' : statusLabel(nextStatus)}
          </button>
        ))}
      </div>
    </div>
  );
}

function LedgerTable({ entries }: { entries: OperationalLedgerEntry[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Document</th>
            <th className="px-4 py-3">Source</th>
            <th className="px-4 py-3">Debit</th>
            <th className="px-4 py-3">Credit</th>
            <th className="px-4 py-3 text-right">Amount</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {entries.map((entry) => (
            <tr key={entry.id} className="align-top">
              <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                {formatDate(entry.ledgerDate)}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={relatedHref(entry)}
                  className="font-semibold text-gray-900 hover:text-[#B1581B]"
                >
                  {entry.documentNumber}
                </Link>
                <div className="mt-1 max-w-sm text-xs text-gray-500">{entry.memo}</div>
                <div className="mt-1 text-xs text-gray-400">{entry.counterparty}</div>
              </td>
              <td className="px-4 py-3 text-gray-700">{sourceLabel(entry.sourceType)}</td>
              <td className="px-4 py-3 text-gray-700">{entry.accountDebit}</td>
              <td className="px-4 py-3 text-gray-700">{entry.accountCredit}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-gray-900">
                {formatUsdCents(entry.amountCents)}
              </td>
              <td className="px-4 py-3">
                <StatusPill status={entry.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JournalTable({ entries }: { entries: AccountingJournalEntry[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3">Journal</th>
            <th className="px-4 py-3">Source</th>
            <th className="px-4 py-3">Debit line</th>
            <th className="px-4 py-3">Credit line</th>
            <th className="px-4 py-3 text-right">Amount</th>
            <th className="px-4 py-3">Posted</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {entries.map((entry) => {
            const debit = entry.lines.find((line) => line.debitCents > 0);
            const credit = entry.lines.find((line) => line.creditCents > 0);
            return (
              <tr key={entry.id} className="align-top">
                <td className="px-4 py-3">
                  <div className="font-semibold text-gray-900">{entry.journalNumber}</div>
                  <div className="mt-1 text-xs text-gray-500">{entry.memo}</div>
                  <div className="mt-1 text-xs text-gray-400">
                    {entry.sourceDocumentNumber} · {entry.counterparty ?? 'No counterparty'}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-700">{sourceLabel(entry.sourceType)}</td>
                <td className="px-4 py-3 text-gray-700">
                  <div className="font-medium">{debit?.accountName ?? 'Debit line missing'}</div>
                  <div className="mt-1 text-xs text-gray-400">
                    {formatUsdCents(debit?.debitCents ?? 0)}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  <div className="font-medium">{credit?.accountName ?? 'Credit line missing'}</div>
                  <div className="mt-1 text-xs text-gray-400">
                    {formatUsdCents(credit?.creditCents ?? 0)}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-gray-900">
                  {formatUsdCents(entry.totalDebitCents)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                  <span className="inline-flex rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-700">
                    {entry.status}
                  </span>
                  <div className="mt-1 text-xs text-gray-400">{formatDate(entry.postedAt)}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  loading,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  detail: string;
  loading: boolean;
  tone?: 'neutral' | 'green' | 'amber' | 'red';
}) {
  const toneClass = {
    neutral: 'text-gray-900',
    green: 'text-green-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
  }[tone];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className={`text-2xl font-semibold ${toneClass}`}>
        {loading ? <span className="inline-block h-7 w-20 animate-pulse rounded bg-gray-200" /> : value}
      </div>
      <div className="mt-1 text-xs font-semibold text-gray-500">{label}</div>
      <div className="mt-1 text-[11px] text-gray-400">{detail}</div>
    </div>
  );
}

function StatusPill({ status }: { status: OperationalLedgerStatus }) {
  const classes: Record<OperationalLedgerStatus, string> = {
    READY_FOR_REVIEW: 'bg-green-50 text-green-700 border-green-200',
    NEEDS_REVIEW: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    POSTED: 'bg-green-50 text-green-700 border-green-200',
    PENDING: 'bg-gray-50 text-gray-700 border-gray-200',
    FAILED: 'bg-red-50 text-red-700 border-red-200',
    MISMATCH: 'bg-red-50 text-red-700 border-red-200',
    RESOLVED: 'bg-blue-50 text-blue-700 border-blue-200',
  };

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${classes[status]}`}>
      {statusLabel(status)}
    </span>
  );
}

function relatedHref(entry: OperationalLedgerEntry): string {
  if (entry.relatedRecordType === 'purchase-order') {
    return erpRecordRoute('purchase-order', entry.relatedRecordId);
  }
  if (entry.relatedRecordType === 'payment-sync') {
    return erpRoute('accounting-sync', { view: 'payments' });
  }
  return erpRoute('accounting-reconciliation');
}

function sourceLabel(sourceType: OperationalLedgerSourceType): string {
  return {
    PAYABLE_RECEIPT: 'Payable receipts',
    CUSTOMER_PAYMENT: 'Customer payments',
    RECONCILIATION_VARIANCE: 'Reconciliation variance',
  }[sourceType];
}

function statusLabel(status: OperationalLedgerStatus): string {
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(' ');
}

function formatUsdCents(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}
