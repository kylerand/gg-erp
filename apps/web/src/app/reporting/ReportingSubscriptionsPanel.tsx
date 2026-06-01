'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bell, BellOff, Download, Play } from 'lucide-react';
import type {
  ErpReportExportRun,
  ErpReportSubscription,
  ErpReportSubscriptionCadence,
  ErpSavedReportViewDescriptor,
} from '@gg-erp/domain';
import { Button } from '@/components/ui/button';
import {
  createReportSubscription,
  getReportExportRuns,
  getReportSubscriptions,
  runReportExportNow,
  updateReportSubscription,
} from '@/lib/api-client';

interface ReportingSubscriptionsPanelProps {
  savedViews: readonly ErpSavedReportViewDescriptor[];
  initialSubscriptions: readonly ErpReportSubscription[];
  initialExportRuns: readonly ErpReportExportRun[];
}

function scheduledCadence(value: string): ErpReportSubscriptionCadence {
  return value === 'weekly' || value === 'monthly' ? value : 'daily';
}

function shortDate(value?: string): string {
  if (!value) return 'Not scheduled';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusClasses(status?: string): string {
  if (status === 'SUCCEEDED') return 'bg-green-50 text-green-700';
  if (status === 'FAILED') return 'bg-red-50 text-red-700';
  if (status === 'RUNNING') return 'bg-yellow-50 text-yellow-700';
  return 'bg-gray-100 text-gray-600';
}

function downloadCsvText(run: ErpReportExportRun): void {
  if (!run.csvText) return;
  const blob = new Blob([run.csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = run.filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ReportingSubscriptionsPanel({
  savedViews,
  initialSubscriptions,
  initialExportRuns,
}: ReportingSubscriptionsPanelProps) {
  const [subscriptions, setSubscriptions] = useState([...initialSubscriptions]);
  const [exportRuns, setExportRuns] = useState([...initialExportRuns]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function refreshAutomation() {
      try {
        const [subscriptionResult, exportResult] = await Promise.all([
          getReportSubscriptions({ allowMockFallback: false }),
          getReportExportRuns({ limit: 20 }, { allowMockFallback: false }),
        ]);
        if (cancelled) return;
        setSubscriptions(subscriptionResult.items);
        setExportRuns(exportResult.items);
      } catch {
        // The server-rendered fallback already keeps the reporting page usable.
      }
    }
    void refreshAutomation();
    return () => {
      cancelled = true;
    };
  }, []);

  const subscriptionByView = useMemo(() => {
    const map = new Map<string, ErpReportSubscription>();
    for (const subscription of subscriptions) {
      if (!map.has(subscription.viewKey)) map.set(subscription.viewKey, subscription);
    }
    return map;
  }, [subscriptions]);

  const latestRunByView = useMemo(() => {
    const map = new Map<string, ErpReportExportRun>();
    for (const run of exportRuns) {
      if (!map.has(run.viewKey)) map.set(run.viewKey, run);
    }
    return map;
  }, [exportRuns]);

  async function saveSubscription(view: ErpSavedReportViewDescriptor) {
    setBusyKey(`subscribe:${view.key}`);
    setMessage(null);
    try {
      const subscription = await createReportSubscription(
        {
          viewKey: view.key,
          cadence: scheduledCadence(view.cadence),
          timezone: 'America/New_York',
          enabled: true,
        },
        { allowMockFallback: false },
      );
      setSubscriptions((current) => [
        subscription,
        ...current.filter((item) => item.id !== subscription.id),
      ]);
      setMessage(`${view.label} subscription saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Subscription save failed.');
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleSubscription(subscription: ErpReportSubscription) {
    setBusyKey(`toggle:${subscription.id}`);
    setMessage(null);
    try {
      const updated = await updateReportSubscription(
        subscription.id,
        { enabled: !subscription.enabled },
        { allowMockFallback: false },
      );
      setSubscriptions((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setMessage(`${updated.viewLabel} ${updated.enabled ? 'enabled' : 'paused'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Subscription update failed.');
    } finally {
      setBusyKey(null);
    }
  }

  async function runExport(
    view: ErpSavedReportViewDescriptor,
    subscription?: ErpReportSubscription,
  ) {
    setBusyKey(`run:${view.key}`);
    setMessage(null);
    try {
      const run = await runReportExportNow(
        subscription ? { subscriptionId: subscription.id } : { viewKey: view.key },
        { allowMockFallback: false },
      );
      setExportRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setMessage(`${view.label} export ${run.status.toLowerCase()}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Report export failed.');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Report Subscriptions
          </h2>
          <p className="mt-1 text-sm text-gray-600">In-app CSV schedules for saved report views.</p>
        </div>
        {message && <span className="text-xs font-medium text-gray-600">{message}</span>}
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="grid grid-cols-[1.3fr_0.8fr_0.9fr_0.8fr_1fr] border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          <span>View</span>
          <span>Cadence</span>
          <span>Next Run</span>
          <span>Last Run</span>
          <span className="text-right">Actions</span>
        </div>
        {savedViews.map((view) => {
          const subscription = subscriptionByView.get(view.key);
          const latestRun = latestRunByView.get(view.key);
          const busy =
            busyKey === `subscribe:${view.key}` ||
            busyKey === `run:${view.key}` ||
            busyKey === `toggle:${subscription?.id}`;
          return (
            <div
              key={view.key}
              className="grid grid-cols-[1.3fr_0.8fr_0.9fr_0.8fr_1fr] items-center gap-3 border-b border-gray-100 px-4 py-3 text-sm last:border-b-0"
            >
              <div className="min-w-0">
                <div className="font-semibold text-gray-900">{view.label}</div>
                <div className="truncate text-xs text-gray-500">{view.ownerContext}</div>
              </div>
              <span className="text-gray-700">
                {subscription?.cadence ?? scheduledCadence(view.cadence)}
              </span>
              <span className="text-gray-600">{shortDate(subscription?.nextRunAt)}</span>
              <span
                className={`w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${statusClasses(latestRun?.status)}`}
              >
                {latestRun?.status ?? 'No runs'}
              </span>
              <div className="flex justify-end gap-2">
                {subscription ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    title={subscription.enabled ? 'Pause subscription' : 'Enable subscription'}
                    onClick={() => void toggleSubscription(subscription)}
                  >
                    {subscription.enabled ? (
                      <BellOff data-icon="inline-start" />
                    ) : (
                      <Bell data-icon="inline-start" />
                    )}
                    {subscription.enabled ? 'Pause' : 'Enable'}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    title="Subscribe to saved view"
                    onClick={() => void saveSubscription(view)}
                  >
                    <Bell data-icon="inline-start" />
                    Subscribe
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  title="Run export now"
                  onClick={() => void runExport(view, subscription)}
                >
                  <Play data-icon="inline-start" />
                  Run
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!latestRun?.csvText}
                  title="Download latest CSV"
                  onClick={() => latestRun && downloadCsvText(latestRun)}
                >
                  <Download data-icon="inline-start" />
                  CSV
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
