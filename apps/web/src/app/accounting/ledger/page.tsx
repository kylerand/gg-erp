'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { EmptyState, LoadingSkeleton, PageHeader } from '@gg-erp/ui';
import {
  getAccountingClosePackage,
  getAccountingTrialBalance,
  listAccountingPeriodLocks,
  listAccountingJournals,
  listOperationalLedger,
  lockAccountingPeriod,
  postOperationalLedgerJournals,
  reverseAccountingJournal,
  type AccountingCloseCheck,
  type AccountingClosePackageAction,
  type AccountingClosePackageEvidence,
  type AccountingClosePackageInvoice,
  type AccountingClosePackagePayment,
  type AccountingClosePackageResponse,
  type AccountingCloseStatus,
  type AccountingJournalEntry,
  type AccountingJournalResponse,
  type AccountingPeriodLock,
  type AccountingTrialBalanceLine,
  type AccountingTrialBalanceResponse,
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
  'WARRANTY_REIMBURSEMENT',
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

const DEFAULT_PERIOD = currentMonthRange();

export default function AccountingLedgerPage() {
  const [sourceType, setSourceType] = useState<'ALL' | OperationalLedgerSourceType>(() =>
    initialSourceFilter(),
  );
  const [status, setStatus] = useState<'ALL' | OperationalLedgerStatus>('ALL');
  const [periodFrom, setPeriodFrom] = useState(() =>
    initialPeriodValue('from', DEFAULT_PERIOD.from),
  );
  const [periodTo, setPeriodTo] = useState(() => initialPeriodValue('to', DEFAULT_PERIOD.to));
  const [lockReason, setLockReason] = useState('Month-end close reviewed in ERP.');
  const [ledger, setLedger] = useState<OperationalLedgerResponse | null>(null);
  const [journals, setJournals] = useState<AccountingJournalResponse | null>(null);
  const [trialBalance, setTrialBalance] = useState<AccountingTrialBalanceResponse | null>(null);
  const [closePackage, setClosePackage] = useState<AccountingClosePackageResponse | null>(null);
  const [periodLocks, setPeriodLocks] = useState<AccountingPeriodLock[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [locking, setLocking] = useState(false);
  const [reversingJournalId, setReversingJournalId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [postResult, setPostResult] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const sourceFilter = sourceType === 'ALL' ? undefined : sourceType;
    const [ledgerData, journalData, trialBalanceData, closePackageData, periodLockData] =
      await Promise.all([
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
          },
          STRICT_LIVE_DATA,
        ),
        getAccountingTrialBalance({ from: periodFrom, to: periodTo }, STRICT_LIVE_DATA),
        getAccountingClosePackage(
          { from: periodFrom, to: periodTo, documentLimit: 50, journalLimit: 50 },
          STRICT_LIVE_DATA,
        ),
        listAccountingPeriodLocks({ limit: 12 }, STRICT_LIVE_DATA),
      ]);
    return { ledgerData, journalData, trialBalanceData, closePackageData, periodLockData };
  }, [periodFrom, periodTo, sourceType, status]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const { ledgerData, journalData, trialBalanceData, closePackageData, periodLockData } =
          await loadData();
        if (!cancelled) {
          setLedger(ledgerData);
          setJournals(journalData);
          setTrialBalance(trialBalanceData);
          setClosePackage(closePackageData);
          setPeriodLocks(periodLockData.items);
        }
      } catch (error) {
        if (!cancelled) {
          setLedger(null);
          setJournals(null);
          setTrialBalance(null);
          setClosePackage(null);
          setPeriodLocks([]);
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
        `${result.postedCount} new journals posted · ${result.skipped.existing} already posted · ${result.skipped.lockedPeriod} locked · ${result.skipped.notPostable} held for review`,
      );
      const { ledgerData, journalData, trialBalanceData, closePackageData, periodLockData } =
        await loadData();
      setLedger(ledgerData);
      setJournals(journalData);
      setTrialBalance(trialBalanceData);
      setClosePackage(closePackageData);
      setPeriodLocks(periodLockData.items);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Journal posting failed.');
    } finally {
      setPosting(false);
    }
  }

  async function handleLockPeriod() {
    setLocking(true);
    setLoadError(null);
    setPostResult(null);
    try {
      const result = await lockAccountingPeriod(
        {
          from: periodFrom,
          to: periodTo,
          reason: lockReason,
          allowWarnings: trialBalance?.summary.closeStatus === 'NEEDS_REVIEW',
        },
        STRICT_LIVE_DATA,
      );
      setPostResult(
        `Locked ${formatDate(result.lock.periodStart)} to ${formatDate(
          result.lock.periodEnd,
        )} · ${closeStatusLabel(result.closeStatus)}`,
      );
      const { ledgerData, journalData, trialBalanceData, closePackageData, periodLockData } =
        await loadData();
      setLedger(ledgerData);
      setJournals(journalData);
      setTrialBalance(trialBalanceData);
      setClosePackage(closePackageData);
      setPeriodLocks(periodLockData.items);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Period lock failed.');
    } finally {
      setLocking(false);
    }
  }

  async function handleReverseJournal(entry: AccountingJournalEntry) {
    const reason = window.prompt(`Reason for reversing ${entry.journalNumber}?`);
    if (!reason?.trim()) return;
    setReversingJournalId(entry.id);
    setLoadError(null);
    setPostResult(null);
    try {
      const result = await reverseAccountingJournal(
        entry.id,
        { reason: reason.trim() },
        STRICT_LIVE_DATA,
      );
      setPostResult(
        `${result.original.journalNumber} reversed with ${result.reversal.journalNumber}.`,
      );
      const { ledgerData, journalData, trialBalanceData, closePackageData, periodLockData } =
        await loadData();
      setLedger(ledgerData);
      setJournals(journalData);
      setTrialBalance(trialBalanceData);
      setClosePackage(closePackageData);
      setPeriodLocks(periodLockData.items);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Journal reversal failed.');
    } finally {
      setReversingJournalId(null);
    }
  }

  function handleDownloadClosePackage() {
    if (!closePackage) return;
    const blob = new Blob([JSON.stringify(closePackage, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${closePackage.packageNumber.toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
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
        description="Operational accounting entries, posting rules, and immutable journal consequences from live payables, payments, warranty reimbursements, and reconciliation variance."
      />

      {loadError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
          <p className="font-semibold text-red-900">Ledger data could not be loaded.</p>
          <p className="mt-1 text-sm text-red-800">{loadError}</p>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
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
        <MetricCard
          label="Close status"
          value={closeStatusLabel(trialBalance?.summary.closeStatus ?? 'READY')}
          detail={`${trialBalance?.summary.accountCount ?? 0} trial balance accounts`}
          loading={loading}
          tone={closeStatusTone(trialBalance?.summary.closeStatus ?? 'READY')}
        />
      </div>

      <FilterBar
        sourceType={sourceType}
        status={status}
        onSourceTypeChange={setSourceType}
        onStatusChange={setStatus}
      />

      <PeriodControlPanel
        periodFrom={periodFrom}
        periodTo={periodTo}
        lockReason={lockReason}
        locks={periodLocks}
        loading={loading}
        locking={locking}
        closeStatus={trialBalance?.summary.closeStatus ?? 'READY'}
        onPeriodFromChange={setPeriodFrom}
        onPeriodToChange={setPeriodTo}
        onLockReasonChange={setLockReason}
        onLockPeriod={handleLockPeriod}
      />

      <ClosePackagePanel
        closePackage={closePackage}
        loading={loading}
        periodFrom={periodFrom}
        periodTo={periodTo}
        onDownload={handleDownloadClosePackage}
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
            {postResult && (
              <p className="mt-2 text-xs font-semibold text-green-700">{postResult}</p>
            )}
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

      <div className="mb-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {SOURCE_FILTERS.filter(
          (source): source is OperationalLedgerSourceType => source !== 'ALL',
        ).map((source) => {
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
        })}
      </div>

      <div className="mb-8 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1.3fr)]">
        <CloseReadinessPanel report={trialBalance} loading={loading} />
        <TrialBalancePanel report={trialBalance} loading={loading} />
      </div>

      {loading ? (
        <LoadingSkeleton rows={6} cols={7} />
      ) : !ledger || ledger.items.length === 0 ? (
        <EmptyState
          title="No ledger entries match these filters"
          description="Received purchase orders, customer payments, approved warranty claims, or reconciliation mismatches will appear here after they exist in the live system."
        />
      ) : (
        <LedgerTable entries={ledger.items} />
      )}

      <div id="posted-journals" className="mt-8">
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
            description="Use Post ready journals after live payable receipts, approved warranty reimbursements, or posted customer payments are available."
          />
        ) : (
          <JournalTable
            entries={journals.items}
            reversingJournalId={reversingJournalId}
            onReverse={handleReverseJournal}
          />
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

function PeriodControlPanel({
  periodFrom,
  periodTo,
  lockReason,
  locks,
  loading,
  locking,
  closeStatus,
  onPeriodFromChange,
  onPeriodToChange,
  onLockReasonChange,
  onLockPeriod,
}: {
  periodFrom: string;
  periodTo: string;
  lockReason: string;
  locks: AccountingPeriodLock[];
  loading: boolean;
  locking: boolean;
  closeStatus: AccountingCloseStatus;
  onPeriodFromChange: (next: string) => void;
  onPeriodToChange: (next: string) => void;
  onLockReasonChange: (next: string) => void;
  onLockPeriod: () => void;
}) {
  const disabled = loading || locking || !periodFrom || !periodTo || !lockReason.trim();

  return (
    <section id="accounting-period" className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Accounting period</h2>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${closeStatusClass(closeStatus)}`}
            >
              {closeStatusLabel(closeStatus)}
            </span>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[160px_160px_minmax(220px,1fr)]">
            <label className="text-xs font-semibold text-gray-600">
              From
              <input
                type="date"
                value={periodFrom}
                onChange={(event) => onPeriodFromChange(event.target.value)}
                className="mt-1 block min-h-10 w-full rounded-md border border-gray-300 px-3 text-sm text-gray-900"
              />
            </label>
            <label className="text-xs font-semibold text-gray-600">
              To
              <input
                type="date"
                value={periodTo}
                onChange={(event) => onPeriodToChange(event.target.value)}
                className="mt-1 block min-h-10 w-full rounded-md border border-gray-300 px-3 text-sm text-gray-900"
              />
            </label>
            <label className="text-xs font-semibold text-gray-600">
              Close note
              <input
                type="text"
                value={lockReason}
                onChange={(event) => onLockReasonChange(event.target.value)}
                className="mt-1 block min-h-10 w-full rounded-md border border-gray-300 px-3 text-sm text-gray-900"
              />
            </label>
          </div>
        </div>
        <div className="flex flex-col gap-3 xl:w-80">
          <button
            type="button"
            onClick={onLockPeriod}
            disabled={disabled}
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {locking ? 'Locking period...' : 'Lock period'}
          </button>
          <div className="rounded-md bg-gray-50 px-3 py-2">
            <div className="text-xs font-semibold text-gray-500">Recent locks</div>
            {locks.length === 0 ? (
              <div className="mt-1 text-xs text-gray-400">No locked accounting periods.</div>
            ) : (
              <div className="mt-2 space-y-1">
                {locks.slice(0, 3).map((lock) => (
                  <div key={lock.id} className="text-xs text-gray-700">
                    <span className="font-semibold">
                      {formatDate(lock.periodStart)} to {formatDate(lock.periodEnd)}
                    </span>
                    <span className="text-gray-400"> · {lock.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ClosePackagePanel({
  closePackage,
  loading,
  periodFrom,
  periodTo,
  onDownload,
}: {
  closePackage: AccountingClosePackageResponse | null;
  loading: boolean;
  periodFrom: string;
  periodTo: string;
  onDownload: () => void;
}) {
  const packageHref = erpRoute('accounting-close-package', { from: periodFrom, to: periodTo });

  return (
    <section id="close-package" className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Close package</h2>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                closePackage?.readyForExternalReview
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : closeStatusClass(closePackage?.closeStatus ?? 'READY')
              }`}
            >
              {closePackage?.readyForExternalReview
                ? 'External ready'
                : closeStatusLabel(closePackage?.closeStatus ?? 'READY')}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {loading
              ? 'Loading close evidence.'
              : `${closePackage?.packageNumber ?? 'CLOSE'} · ${formatDate(periodFrom)} to ${formatDate(periodTo)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={packageHref}
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-[#B1581B] hover:text-[#B1581B]"
          >
            Package link
          </Link>
          <button
            type="button"
            onClick={onDownload}
            disabled={loading || !closePackage}
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Export JSON
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-4">
          <LoadingSkeleton rows={4} cols={4} />
        </div>
      ) : !closePackage ? (
        <div className="mt-4 rounded-md border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500">
          Close package data is not available for this period.
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <CloseMetric
              label="Blockers"
              value={closePackage.summary.blockerCount}
              detail="Checks and documents"
            />
            <CloseMetric
              label="Journals"
              value={closePackage.summary.journalEvidenceCount}
              detail={formatUsdCents(closePackage.summary.totalDebitCents)}
            />
            <CloseMetric
              label="Invoices"
              value={closePackage.summary.invoiceDocumentCount}
              detail={`${closePackage.documents.invoices.length} shown`}
            />
            <CloseMetric
              label="Payments"
              value={closePackage.summary.paymentDocumentCount}
              detail={`${closePackage.documents.payments.length} shown`}
            />
            <CloseMetric
              label="Period lock"
              value={closePackage.periodLock ? 'Locked' : 'Open'}
              detail={
                closePackage.periodLock
                  ? formatDate(closePackage.periodLock.lockedAt)
                  : 'Not locked'
              }
            />
          </div>

          {closePackage.summary.truncated && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Package evidence is truncated by the current report limits. Narrow the period or
              export after increasing server-side limits.
            </div>
          )}

          <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
            <EvidenceList items={closePackage.evidence} />
            <ClosePackageActions actions={closePackage.actions} />
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <ClosePackageInvoiceList invoices={closePackage.documents.invoices} />
            <ClosePackagePaymentList payments={closePackage.documents.payments} />
          </div>
        </>
      )}
    </section>
  );
}

function EvidenceList({ items }: { items: AccountingClosePackageEvidence[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Evidence</h3>
      <div className="mt-2 divide-y divide-gray-100 rounded-md border border-gray-200">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-gray-50"
          >
            <span>
              <span className="font-semibold text-gray-900">{item.label}</span>
              <span className="ml-2 text-xs text-gray-500">{item.value}</span>
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs ${actionStatusClass(item.status)}`}
            >
              {actionStatusLabel(item.status)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ClosePackageActions({ actions }: { actions: AccountingClosePackageAction[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Next actions</h3>
      <div className="mt-2 space-y-2">
        {actions.map((action) => (
          <Link
            key={action.key}
            href={action.href}
            className="block rounded-md border border-gray-200 px-3 py-2 transition-colors hover:border-[#B1581B]"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-gray-900">{action.label}</span>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs ${actionStatusClass(action.status)}`}
              >
                {actionStatusLabel(action.status)}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">{action.detail}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ClosePackageInvoiceList({ invoices }: { invoices: AccountingClosePackageInvoice[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Invoice documents
      </h3>
      {invoices.length === 0 ? (
        <div className="mt-2 rounded-md border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
          No invoice sync documents are in this package period.
        </div>
      ) : (
        <div className="mt-2 max-h-72 overflow-auto rounded-md border border-gray-200">
          {invoices.map((invoice) => (
            <Link
              key={invoice.id}
              href={invoice.evidenceHref}
              className="block border-b border-gray-100 px-3 py-2 last:border-b-0 hover:bg-gray-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900">{invoice.documentNumber}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {invoice.workOrder?.workOrderNumber ?? invoice.workOrderId}
                  </div>
                </div>
                <DocumentStatusPill status={invoice.documentStatus} />
              </div>
              <div className="mt-1 text-xs text-gray-400">
                {invoice.exportedAt
                  ? `Exported ${formatDate(invoice.exportedAt)}`
                  : `Created ${formatDate(invoice.createdAt)}`}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function ClosePackagePaymentList({ payments }: { payments: AccountingClosePackagePayment[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Payment documents
      </h3>
      {payments.length === 0 ? (
        <div className="mt-2 rounded-md border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
          No payment sync documents are in this package period.
        </div>
      ) : (
        <div className="mt-2 max-h-72 overflow-auto rounded-md border border-gray-200">
          {payments.map((payment) => (
            <Link
              key={payment.id}
              href={payment.evidenceHref}
              className="block border-b border-gray-100 px-3 py-2 last:border-b-0 hover:bg-gray-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900">{payment.documentNumber}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {payment.customer?.displayName ?? payment.customerId}
                  </div>
                </div>
                <DocumentStatusPill status={payment.documentStatus} />
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-xs text-gray-400">
                <span>
                  {payment.paymentDate
                    ? formatDate(payment.paymentDate)
                    : formatDate(payment.updatedAt)}
                </span>
                <span className="font-semibold text-gray-700">
                  {formatUsdCents(payment.amountCents)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CloseReadinessPanel({
  report,
  loading,
}: {
  report: AccountingTrialBalanceResponse | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-4 h-5 w-44 animate-pulse rounded bg-gray-200" />
        <LoadingSkeleton rows={4} cols={2} />
      </div>
    );
  }

  const summary = report?.summary;
  const closeStatus = summary?.closeStatus ?? 'READY';

  return (
    <section id="trial-balance" className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Period close readiness</h2>
          <p className="mt-1 text-xs text-gray-500">
            Live trial balance, unposted ledger entries, and sync exceptions.
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${closeStatusClass(closeStatus)}`}
        >
          {closeStatusLabel(closeStatus)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <CloseMetric
          label="Posted journals"
          value={summary?.postedJournalCount ?? 0}
          detail={formatUsdCents(summary?.totalDebitCents ?? 0)}
        />
        <CloseMetric
          label="Unposted ready"
          value={summary?.unpostedOperationalCount ?? 0}
          detail={formatUsdCents(summary?.unpostedOperationalAmountCents ?? 0)}
        />
        <CloseMetric
          label="Review items"
          value={summary?.reviewItemCount ?? 0}
          detail="Ledger rows"
        />
        <CloseMetric
          label="Sync exceptions"
          value={summary?.integrationExceptionCount ?? 0}
          detail="Open queue"
        />
      </div>

      {summary?.truncated && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Trial balance includes the newest 2,000 posted journals. Narrow the period before using it
          as final close evidence.
        </div>
      )}

      <div className="mt-4 divide-y divide-gray-100">
        {(report?.closeChecks ?? []).map((check) => (
          <CloseCheckRow key={check.key} check={check} />
        ))}
      </div>
    </section>
  );
}

function CloseMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="rounded-md bg-gray-50 px-3 py-2">
      <div className="text-lg font-semibold text-gray-900">{value}</div>
      <div className="font-semibold text-gray-500">{label}</div>
      <div className="mt-0.5 text-[11px] text-gray-400">{detail}</div>
    </div>
  );
}

function CloseCheckRow({ check }: { check: AccountingCloseCheck }) {
  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              check.ok
                ? 'bg-green-500'
                : check.severity === 'critical'
                  ? 'bg-red-500'
                  : 'bg-amber-500'
            }`}
          />
          <p className="text-sm font-semibold text-gray-900">{check.label}</p>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
            {check.value}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500">{check.detail}</p>
      </div>
      {!check.ok && (
        <Link
          href={check.actionHref}
          className="shrink-0 text-xs font-semibold text-[#B1581B] hover:text-[#7A3B12]"
        >
          {check.actionLabel}
        </Link>
      )}
    </div>
  );
}

function TrialBalancePanel({
  report,
  loading,
}: {
  report: AccountingTrialBalanceResponse | null;
  loading: boolean;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Trial balance</h2>
          <p className="mt-1 text-xs text-gray-500">
            Posted journal lines grouped by account for the selected ledger period.
          </p>
        </div>
        <div className="text-right text-xs text-gray-500">
          <div>{formatUsdCents(report?.summary.totalDebitCents ?? 0)} debit</div>
          <div>{formatUsdCents(report?.summary.totalCreditCents ?? 0)} credit</div>
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={5} cols={5} />
      ) : !report || report.accountLines.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500">
          No posted journals are available for a trial balance yet.
        </div>
      ) : (
        <TrialBalanceTable lines={report.accountLines} />
      )}
    </section>
  );
}

function TrialBalanceTable({ lines }: { lines: AccountingTrialBalanceLine[] }) {
  return (
    <div className="max-h-[420px] overflow-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2">Account</th>
            <th className="px-3 py-2 text-right">Debits</th>
            <th className="px-3 py-2 text-right">Credits</th>
            <th className="px-3 py-2 text-right">Net</th>
            <th className="px-3 py-2">Latest</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {lines.map((line) => (
            <tr key={`${line.accountCode}:${line.accountName}`}>
              <td className="px-3 py-2">
                <div className="font-semibold text-gray-900">{line.accountName}</div>
                <div className="mt-0.5 text-xs text-gray-400">
                  {line.accountCode} · {line.journalLineCount} line
                  {line.journalLineCount === 1 ? '' : 's'}
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">
                {formatUsdCents(line.debitCents)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right text-gray-700">
                {formatUsdCents(line.creditCents)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-gray-900">
                {line.balanceSide === 'BALANCED'
                  ? '$0'
                  : `${formatUsdCents(
                      line.balanceSide === 'DEBIT' ? line.netDebitCents : line.netCreditCents,
                    )} ${line.balanceSide.toLowerCase()}`}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                {line.latestLedgerDate ? formatDate(line.latestLedgerDate) : 'No date'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

function JournalTable({
  entries,
  reversingJournalId,
  onReverse,
}: {
  entries: AccountingJournalEntry[];
  reversingJournalId: string | null;
  onReverse: (entry: AccountingJournalEntry) => void;
}) {
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
            <th className="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {entries.map((entry) => {
            const debit = entry.lines.find((line) => line.debitCents > 0);
            const credit = entry.lines.find((line) => line.creditCents > 0);
            const isReversal = Boolean(entry.reversalOfJournalId);
            const canReverse = entry.status === 'POSTED' && !isReversal;
            return (
              <tr key={entry.id} className="align-top">
                <td className="px-4 py-3">
                  <div className="font-semibold text-gray-900">{entry.journalNumber}</div>
                  <div className="mt-1 text-xs text-gray-500">{entry.memo}</div>
                  <div className="mt-1 text-xs text-gray-400">
                    {entry.sourceDocumentNumber} · {entry.counterparty ?? 'No counterparty'}
                  </div>
                  {entry.reversalReason && (
                    <div className="mt-1 text-xs text-amber-700">{entry.reversalReason}</div>
                  )}
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
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${
                      entry.status === 'REVERSED'
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-green-200 bg-green-50 text-green-700'
                    }`}
                  >
                    {entry.status}
                  </span>
                  {isReversal && (
                    <div className="mt-1 text-xs font-semibold text-gray-500">Reversal journal</div>
                  )}
                  <div className="mt-1 text-xs text-gray-400">{formatDate(entry.postedAt)}</div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onReverse(entry)}
                    disabled={!canReverse || reversingJournalId === entry.id}
                    className="inline-flex min-h-9 items-center justify-center rounded-md border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-700 transition-colors hover:border-[#B1581B] hover:text-[#B1581B] disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
                  >
                    {reversingJournalId === entry.id
                      ? 'Reversing...'
                      : isReversal
                        ? 'Reversal'
                        : entry.status === 'REVERSED'
                          ? 'Reversed'
                          : 'Reverse'}
                  </button>
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
        {loading ? (
          <span className="inline-block h-7 w-20 animate-pulse rounded bg-gray-200" />
        ) : (
          value
        )}
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

function DocumentStatusPill({
  status,
}: {
  status:
    | AccountingClosePackageInvoice['documentStatus']
    | AccountingClosePackagePayment['documentStatus'];
}) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${documentStatusClass(status)}`}
    >
      {documentStatusLabel(status)}
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
  if (entry.relatedRecordType === 'warranty-claim') {
    return erpRoute('warranty-claim', { claimId: entry.relatedRecordId });
  }
  return erpRoute('accounting-reconciliation');
}

function sourceLabel(sourceType: OperationalLedgerSourceType): string {
  return {
    PAYABLE_RECEIPT: 'Payable receipts',
    CUSTOMER_PAYMENT: 'Customer payments',
    RECONCILIATION_VARIANCE: 'Reconciliation variance',
    WARRANTY_REIMBURSEMENT: 'Warranty reimbursements',
  }[sourceType];
}

function initialSourceFilter(): 'ALL' | OperationalLedgerSourceType {
  if (typeof window === 'undefined') return 'ALL';
  const value = new URLSearchParams(window.location.search).get('sourceType');
  return SOURCE_FILTERS.includes(value as OperationalLedgerSourceType)
    ? (value as OperationalLedgerSourceType)
    : 'ALL';
}

function documentStatusLabel(status: AccountingClosePackageInvoice['documentStatus']): string {
  return {
    EXPORTED: 'Exported',
    MATCHED: 'Matched',
    RECONCILED: 'Reconciled',
    QUEUED: 'Queued',
    NEEDS_REVIEW: 'Needs review',
  }[status];
}

function documentStatusClass(status: AccountingClosePackageInvoice['documentStatus']): string {
  return {
    EXPORTED: 'border-green-200 bg-green-50 text-green-700',
    MATCHED: 'border-green-200 bg-green-50 text-green-700',
    RECONCILED: 'border-blue-200 bg-blue-50 text-blue-700',
    QUEUED: 'border-gray-200 bg-gray-50 text-gray-700',
    NEEDS_REVIEW: 'border-amber-200 bg-amber-50 text-amber-800',
  }[status];
}

function actionStatusLabel(status: AccountingClosePackageAction['status']): string {
  return {
    DONE: 'Done',
    OPEN: 'Open',
    BLOCKED: 'Blocked',
  }[status];
}

function actionStatusClass(status: AccountingClosePackageAction['status']): string {
  return {
    DONE: 'border-green-200 bg-green-50 text-green-700',
    OPEN: 'border-amber-200 bg-amber-50 text-amber-800',
    BLOCKED: 'border-red-200 bg-red-50 text-red-700',
  }[status];
}

function statusLabel(status: OperationalLedgerStatus): string {
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(' ');
}

function closeStatusLabel(status: AccountingCloseStatus): string {
  return {
    READY: 'Ready',
    NEEDS_REVIEW: 'Needs review',
    BLOCKED: 'Blocked',
  }[status];
}

function closeStatusTone(status: AccountingCloseStatus): 'green' | 'amber' | 'red' {
  return (
    {
      READY: 'green',
      NEEDS_REVIEW: 'amber',
      BLOCKED: 'red',
    } as const
  )[status];
}

function closeStatusClass(status: AccountingCloseStatus): string {
  return {
    READY: 'border-green-200 bg-green-50 text-green-700',
    NEEDS_REVIEW: 'border-amber-200 bg-amber-50 text-amber-800',
    BLOCKED: 'border-red-200 bg-red-50 text-red-700',
  }[status];
}

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function initialPeriodValue(key: 'from' | 'to', fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return new URLSearchParams(window.location.search).get(key) ?? fallback;
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
