'use client';
import { useState } from 'react';
import { PageHeader, EmptyState } from '@gg-erp/ui';
import { Input } from '@/components/ui/input';

interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  resource: string;
  resourceId: string;
  timestamp: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  ipAddress?: string;
}

const MOCK_EVENTS: AuditEvent[] = [
  { id: 'ae1', actor: 'james@golfingarage.com', action: 'WORK_ORDER_REASSIGN', resource: 'WorkOrder', resourceId: 'WO-002', timestamp: '2026-03-10T09:15:00Z', outcome: 'SUCCESS', ipAddress: '192.168.1.10' },
  { id: 'ae2', actor: 'lisa@golfingarage.com', action: 'INVOICE_SYNC_RETRY', resource: 'SyncRecord', resourceId: 's-1', timestamp: '2026-03-10T08:45:00Z', outcome: 'SUCCESS' },
  { id: 'ae3', actor: 'unknown', action: 'ADMIN_ACCESS_ATTEMPT', resource: 'Admin', resourceId: 'user-mgmt', timestamp: '2026-03-09T23:00:00Z', outcome: 'DENIED', ipAddress: '203.0.113.99' },
  { id: 'ae4', actor: 'marcus@golfingarage.com', action: 'WORK_ORDER_COMPLETE', resource: 'WorkOrder', resourceId: 'WO-001', timestamp: '2026-03-09T17:30:00Z', outcome: 'SUCCESS' },
];

const OUTCOME_CLASSES: Record<AuditEvent['outcome'], string> = {
  SUCCESS: 'bg-green-100 text-green-700',
  FAILURE: 'bg-red-100 text-red-700',
  DENIED:  'bg-orange-100 text-orange-700',
};

export default function AuditTrailPage() {
  const [search, setSearch] = useState('');
  const filtered = MOCK_EVENTS.filter(e =>
    search === '' ||
    e.actor.includes(search) ||
    e.action.toLowerCase().includes(search.toLowerCase()) ||
    e.resourceId.includes(search)
  );

  return (
    <div>
      <PageHeader title="Audit Trail" description="Privileged change history" />
      <div className="mb-4">
        <Input
          placeholder="Search by actor, action, or resource…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon="📜" title="No events" description="No audit events match your search." />
      ) : (
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
              {filtered.map(e => (
                <tr key={e.id} className={`hover:bg-gray-50 ${e.outcome === 'DENIED' ? 'bg-orange-50' : ''}`}>
                  <td className="px-4 py-3 text-xs text-gray-400">{new Date(e.timestamp).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">{e.actor}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{e.action}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{e.resource}/{e.resourceId}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${OUTCOME_CLASSES[e.outcome]}`}>{e.outcome}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
