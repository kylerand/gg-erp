'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, RefreshCw, Siren } from 'lucide-react';
import { PageHeader } from '@gg-erp/ui';
import type { ErpBlockedAlert, ErpBlockedAlertFeed, ErpBlockedAlertTriageActionType } from '@gg-erp/domain';
import { getBlockedAlerts, recordBlockedAlertTriageAction } from '@/lib/api-client';
import { Button } from '@/components/ui/button';

const STRICT_LIVE_DATA = { allowMockFallback: false } as const;

function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function severityClasses(severity: string): string {
  if (severity === 'P1') return 'border-red-200 bg-red-50 text-red-700';
  if (severity === 'P2') return 'border-yellow-200 bg-yellow-50 text-yellow-800';
  return 'border-gray-200 bg-gray-50 text-gray-700';
}

function triageClasses(state: string): string {
  if (state === 'ESCALATED') return 'border-red-200 bg-red-50 text-red-700';
  if (state === 'ACKNOWLEDGED') return 'border-green-200 bg-green-50 text-green-700';
  return 'border-gray-200 bg-white text-gray-600';
}

function actionLabel(action: ErpBlockedAlertTriageActionType): string {
  return action === 'ESCALATE' ? 'Escalate' : 'Acknowledge';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Blocked alert action failed.';
}

const EMPTY_FEED: ErpBlockedAlertFeed = {
  generatedAt: '',
  summary: {
    total: 0,
    p1: 0,
    p2: 0,
    p3: 0,
    unowned: 0,
    acknowledged: 0,
    escalated: 0,
    averageAgeMinutes: 0,
    oldestAgeMinutes: 0,
  },
  items: [],
};

export default function BlockedAlertsPage() {
  const [feed, setFeed] = useState<ErpBlockedAlertFeed>(EMPTY_FEED);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [notesByAlert, setNotesByAlert] = useState<Record<string, string>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const nextFeed = await getBlockedAlerts({ limit: 50 }, STRICT_LIVE_DATA);
      setFeed(nextFeed);
    } catch (error) {
      setLoadError(errorMessage(error));
      setFeed(EMPTY_FEED);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  async function handleTriage(item: ErpBlockedAlert, action: ErpBlockedAlertTriageActionType) {
    const key = `${item.id}:${action}`;
    setBusyAction(key);
    setActionError(null);
    setActionMessage(null);
    try {
      const note = notesByAlert[item.id]?.trim() || undefined;
      await recordBlockedAlertTriageAction(
        item.id,
        action,
        { note, ownerRole: item.ownerRole },
        STRICT_LIVE_DATA,
      );
      setActionMessage(`${actionLabel(action)} recorded for ${item.workOrderNumber}.`);
      setNotesByAlert((current) => ({ ...current, [item.id]: '' }));
      await loadFeed();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  const summary = feed.summary;
  const items = feed.items;

  return (
    <div>
      <PageHeader
        title="Blocked Alerts"
        description={`${summary.total} active blocker${summary.total === 1 ? '' : 's'} requiring owner follow-up`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void loadFeed()} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        {feed.generatedAt && (
          <span className="text-xs font-medium text-gray-500">
            Updated {new Date(feed.generatedAt).toLocaleString()}
          </span>
        )}
      </div>

      {loadError && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{loadError}</span>
        </div>
      )}

      {actionError && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{actionError}</span>
        </div>
      )}

      {actionMessage && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4" />
          <span>{actionMessage}</span>
        </div>
      )}

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{summary.total}</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-600">P1</p>
          <p className="mt-2 text-2xl font-semibold text-red-700">{summary.p1}</p>
        </div>
        <div className="rounded-lg border border-yellow-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-yellow-700">P2</p>
          <p className="mt-2 text-2xl font-semibold text-yellow-800">{summary.p2}</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Escalated</p>
          <p className="mt-2 text-2xl font-semibold text-red-700">{summary.escalated}</p>
        </div>
        <div className="rounded-lg border border-green-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Acknowledged</p>
          <p className="mt-2 text-2xl font-semibold text-green-800">{summary.acknowledged}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Oldest</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">
            {formatAge(summary.oldestAgeMinutes)}
          </p>
        </div>
      </section>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-40 animate-pulse rounded-lg border border-gray-200 bg-gray-50" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm font-semibold text-gray-900">No active blockers</p>
          <p className="mt-1 text-sm text-gray-500">Work orders, tasks, operations, and part demand are clear.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${severityClasses(
                        item.severity,
                      )}`}
                    >
                      {item.severity}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${triageClasses(
                        item.triageState,
                      )}`}
                    >
                      {item.triageState}
                    </span>
                    <span className="font-mono text-xs text-gray-500">{item.workOrderNumber}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                      {item.sourceType.replaceAll('_', ' ')}
                    </span>
                    <span className="text-xs text-gray-500">{formatAge(item.ageMinutes)}</span>
                  </div>
                  <Link href={item.route} className="text-sm font-semibold text-gray-900 hover:text-[#B1581B]">
                    {item.workOrderTitle}
                  </Link>
                  <p className="mt-1 text-sm text-gray-600">{item.reason}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                    <span className="rounded-full bg-gray-50 px-2 py-1">{item.ownerLabel}</span>
                    <span className="rounded-full bg-gray-50 px-2 py-1">{item.reasonCode}</span>
                    {item.customerReference && (
                      <span className="rounded-full bg-gray-50 px-2 py-1">{item.customerReference}</span>
                    )}
                    {item.assetReference && (
                      <span className="rounded-full bg-gray-50 px-2 py-1">{item.assetReference}</span>
                    )}
                  </div>
                  <p className="mt-3 text-sm font-medium text-gray-800">{item.nextAction}</p>
                  {item.lastTriagedAt && (
                    <p className="mt-2 text-xs text-gray-500">
                      Last {item.lastTriageAction?.toLowerCase()} at{' '}
                      {new Date(item.lastTriagedAt).toLocaleString()}
                      {item.lastTriageNote ? `: ${item.lastTriageNote}` : ''}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.actions.map((action) => (
                      <Link
                        key={`${item.id}:${action.label}`}
                        href={action.href}
                        className="rounded border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-yellow-400 hover:bg-yellow-50"
                      >
                        {action.label}
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Triage note
                    <textarea
                      value={notesByAlert[item.id] ?? ''}
                      onChange={(event) =>
                        setNotesByAlert((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                      rows={3}
                      maxLength={1000}
                      className="mt-2 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-gray-800 focus:border-yellow-400 focus:outline-none"
                    />
                  </label>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyAction !== null}
                      onClick={() => void handleTriage(item, 'ACKNOWLEDGE')}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      {busyAction === `${item.id}:ACKNOWLEDGE` ? 'Saving...' : 'Acknowledge'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyAction !== null}
                      onClick={() => void handleTriage(item, 'ESCALATE')}
                    >
                      <Siren className="mr-2 h-4 w-4" />
                      {busyAction === `${item.id}:ESCALATE` ? 'Saving...' : 'Escalate'}
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
