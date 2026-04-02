'use client';
import { useState, useEffect, useCallback } from 'react';
import { PageHeader, EmptyState } from '@gg-erp/ui';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { listAuditEvents, type AuditEventRecord } from '@/lib/api-client';

const OUTCOME_CLASSES: Record<string, string> = {
  SUCCESS: 'bg-green-100 text-green-700',
  FAILURE: 'bg-red-100 text-red-700',
  DENIED: 'bg-orange-100 text-orange-700',
};

const PAGE_SIZE = 25;

export default function AuditTrailPage() {
  const [search, setSearch] = useState('');
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (s: string, p: number, ps: number) => {
    setLoading(true);
    try {
      const data = await listAuditEvents({ search: s || undefined, limit: ps, offset: (p - 1) * ps });
      setEvents(data.items);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => void load(search, page, pageSize), 300);
    return () => clearTimeout(timeout);
  }, [search, page, pageSize, load]);

  function handleSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function inferOutcome(event: AuditEventRecord): string {
    const meta = event.metadata as Record<string, unknown>;
    if (meta?.outcome) return String(meta.outcome);
    if (event.action.includes('DENIED') || event.action.includes('deny')) return 'DENIED';
    if (event.action.includes('FAILURE') || event.action.includes('fail')) return 'FAILURE';
    return 'SUCCESS';
  }

  function inferActor(event: AuditEventRecord): string {
    const meta = event.metadata as Record<string, unknown>;
    return (meta?.actorEmail as string) ?? event.actorId ?? 'system';
  }

  return (
    <div>
      <PageHeader title="Audit Trail" description={`Privileged change history — ${total} events`} />
      <div className="mb-4">
        <Input
          placeholder="Search by action, entity type, or ID…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>
      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Loading audit events…</div>
      ) : events.length === 0 ? (
        <EmptyState
          icon="📜"
          title="No audit events"
          description={search ? 'No events match your search.' : 'No audit events have been recorded yet. Events will appear here as users interact with the system.'}
        />
      ) : (
        <>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Timestamp</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Actor</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Action</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Resource</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {events.map((e) => {
                  const outcome = inferOutcome(e);
                  return (
                    <tr key={e.id} className={`hover:bg-gray-50 ${outcome === 'DENIED' ? 'bg-orange-50' : ''}`}>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {new Date(e.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700">{inferActor(e)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{e.action}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {e.entityType}/{e.entityId.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${OUTCOME_CLASSES[outcome] ?? 'bg-gray-100 text-gray-600'}`}
                        >
                          {outcome}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={ps => { setPageSize(ps); setPage(1); }} />
        </>
      )}
    </div>
  );
}
