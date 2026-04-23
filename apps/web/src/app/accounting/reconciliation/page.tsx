'use client';
import { useEffect, useState } from 'react';
import { PageHeader, EmptyState, LoadingSkeleton } from '@gg-erp/ui';
import { Card, CardContent } from '@/components/ui/card';
import { listReconciliationRuns, type ReconciliationRun } from '@/lib/api-client';

const STATUS_CLASSES: Record<string, string> = {
  RUNNING: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-700',
};

export default function ReconciliationPage() {
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listReconciliationRuns({ limit: 50 })
      .then((res) => {
        if (!cancelled) setRuns(res.items ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div>
        <PageHeader title="Reconciliation" description="QuickBooks sync reconciliation runs" />
        <LoadingSkeleton rows={4} cols={4} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Reconciliation" description="QuickBooks sync reconciliation runs" />
      {error && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
          Could not load runs: {error}
        </div>
      )}
      {runs.length === 0 ? (
        <EmptyState
          icon="✅"
          title="No reconciliation runs"
          description="Connect QuickBooks and trigger a reconciliation run to compare ERP invoices against QB records."
        />
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Recent runs ({runs.length})</h2>
          {runs.map((run) => (
            <Card key={run.id}>
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${STATUS_CLASSES[run.status] ?? 'bg-gray-100 text-gray-700'}`}>
                        {run.status.replace('_', ' ')}
                      </span>
                      {run.mismatchCount !== undefined && (
                        <span className="text-xs font-semibold text-gray-700">
                          {run.mismatchCount} mismatch{run.mismatchCount === 1 ? '' : 'es'}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-900">
                      Started {new Date(run.startedAt).toLocaleString()}
                      {run.completedAt && ` • Completed ${new Date(run.completedAt).toLocaleString()}`}
                    </p>
                    {run.summary && <p className="text-xs text-gray-500 mt-1">{run.summary}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
