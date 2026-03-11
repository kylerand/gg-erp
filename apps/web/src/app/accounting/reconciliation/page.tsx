'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, EmptyState } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

interface ReconciliationException {
  id: string;
  type: string;
  description: string;
  amount?: number;
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED';
  assignedTo?: string;
  createdAt: string;
}

const MOCK: ReconciliationException[] = [
  { id: 'ex1', type: 'Invoice Mismatch', description: 'INV-2026-008 total differs from QB by $45.00', amount: 45, status: 'OPEN', createdAt: '2026-03-08T10:00:00Z' },
  { id: 'ex2', type: 'Duplicate Payment', description: 'Payment PAY-0023 appears twice in QB', amount: 320, status: 'IN_REVIEW', assignedTo: 'finance@golfingarage.com', createdAt: '2026-03-07T14:00:00Z' },
  { id: 'ex3', type: 'Missing Invoice', description: 'WO-2026-005 has no corresponding QB invoice', status: 'OPEN', createdAt: '2026-03-06T09:00:00Z' },
];

const STATUS_CLASSES: Record<string, string> = {
  OPEN:      'bg-red-100 text-red-800',
  IN_REVIEW: 'bg-yellow-100 text-yellow-800',
  RESOLVED:  'bg-green-100 text-green-800',
};

export default function ReconciliationPage() {
  const [exceptions, setExceptions] = useState(MOCK);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  function resolve(id: string) {
    if (!notes[id]?.trim()) { toast.error('Add a resolution note before resolving'); return; }
    setExceptions(prev => prev.map(e => e.id === id ? { ...e, status: 'RESOLVED' as const } : e));
    toast.success('Exception resolved');
    setExpanded(null);
  }

  const open = exceptions.filter(e => e.status !== 'RESOLVED');
  const resolved = exceptions.filter(e => e.status === 'RESOLVED');

  return (
    <div>
      <PageHeader title="Reconciliation" description="Financial exception handling" />
      {open.length === 0 ? (
        <EmptyState icon="✅" title="No open exceptions" description="All reconciliation items resolved." />
      ) : (
        <div className="space-y-3 mb-8">
          <h2 className="text-sm font-semibold text-gray-700">Open Exceptions ({open.length})</h2>
          {open.map(ex => (
            <Card key={ex.id} className={ex.status === 'OPEN' ? 'border-red-200' : ''}>
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${STATUS_CLASSES[ex.status]}`}>
                        {ex.status.replace('_', ' ')}
                      </span>
                      <span className="text-xs text-gray-400">{ex.type}</span>
                      {ex.amount && <span className="text-xs font-semibold text-gray-700">${ex.amount.toFixed(2)}</span>}
                    </div>
                    <p className="text-sm text-gray-900">{ex.description}</p>
                    {ex.assignedTo && <p className="text-xs text-gray-400 mt-0.5">Assigned: {ex.assignedTo}</p>}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setExpanded(expanded === ex.id ? null : ex.id)}>
                    {expanded === ex.id ? 'Collapse' : 'Resolve'}
                  </Button>
                </div>
                {expanded === ex.id && (
                  <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
                    <Textarea
                      placeholder="Resolution note…"
                      value={notes[ex.id] ?? ''}
                      onChange={e => setNotes(prev => ({ ...prev, [ex.id]: e.target.value }))}
                      rows={2}
                    />
                    <Button size="sm" onClick={() => resolve(ex.id)} className="bg-green-600 hover:bg-green-500 text-white">
                      Mark Resolved
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {resolved.length > 0 && (
        <div className="opacity-60">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Resolved ({resolved.length})</h2>
          {resolved.map(ex => (
            <div key={ex.id} className="bg-white rounded-lg border border-gray-100 p-3 mb-2 flex items-center gap-3">
              <span className="text-green-500">✅</span>
              <div className="flex-1 text-sm text-gray-500">{ex.type} — {ex.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
