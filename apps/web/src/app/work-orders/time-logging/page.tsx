'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { PageHeader } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api-client';
import { useRole } from '@/lib/role-context';

interface TimeEntry {
  id: string;
  workOrderId: string;
  technicianId: string;
  startedAt: string;
  endedAt?: string;
  manualHours?: number;
  description?: string;
  source: 'AUTO' | 'MANUAL' | 'ADJUSTED';
  computedHours: number;
}

type TimeEntriesResponse = { items?: TimeEntry[]; entries?: TimeEntry[] };
type TimeEntryMutationResponse = TimeEntry | { entry: TimeEntry };

function normalizeTimeEntries(data: TimeEntriesResponse): TimeEntry[] {
  return Array.isArray(data.items) ? data.items : (Array.isArray(data.entries) ? data.entries : []);
}

function unwrapTimeEntry(data: TimeEntryMutationResponse): TimeEntry {
  return 'entry' in data ? data.entry : data;
}

function checkOverlap(entries: TimeEntry[], startedAt: string, endedAt: string): boolean {
  const newStart = new Date(startedAt).getTime();
  const newEnd = new Date(endedAt).getTime();
  return entries.some(e => {
    const eStart = new Date(e.startedAt).getTime();
    const eEnd = e.endedAt ? new Date(e.endedAt).getTime() : eStart + e.computedHours * 3_600_000;
    return newStart < eEnd && newEnd > eStart;
  });
}

function TimeLoggingContent() {
  const params = useSearchParams();
  const workOrderId = params.get('workOrderId') ?? '';
  const { user, loading: roleLoading } = useRole();
  const technicianId = user?.userId ?? null;

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editHours, setEditHours] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [overlapWarning, setOverlapWarning] = useState(false);

  const [addHours, setAddHours] = useState('');
  const [addDesc, setAddDesc] = useState('');
  const [addWO, setAddWO] = useState(workOrderId || '');

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (workOrderId) qs.set('workOrderId', workOrderId);
      const data = await apiFetch<TimeEntriesResponse>(
        `/tickets/time-entries${qs.size ? `?${qs}` : ''}`,
      );
      setEntries(normalizeTimeEntries(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load time entries');
    } finally {
      setLoading(false);
    }
  }, [workOrderId]);

  useEffect(() => { void loadEntries(); }, [loadEntries]);
  useEffect(() => { if (workOrderId) setAddWO(workOrderId); }, [workOrderId]);

  async function handleAdd() {
    if (!technicianId) {
      toast.error('Sign in required to log time');
      return;
    }
    const h = parseFloat(addHours);
    if (!h || h <= 0 || h > 24) { toast.error('Enter valid hours (0.25–24)'); return; }
    if (!addDesc.trim()) { toast.error('Description is required'); return; }

    const endedAt = new Date().toISOString();
    const startedAt = new Date(Date.now() - h * 3_600_000).toISOString();
    setOverlapWarning(checkOverlap(entries, startedAt, endedAt));

    setSubmitting(true);
    try {
      const newEntry = await apiFetch<TimeEntryMutationResponse>(
        '/tickets/time-entries',
        {
          method: 'POST',
          body: JSON.stringify({
            workOrderId: addWO || workOrderId,
            technicianId,
            manualHours: h,
            description: addDesc,
            source: 'MANUAL',
            startedAt,
          }),
        },
      );
      setEntries(prev => [unwrapTimeEntry(newEntry), ...prev]);
      setAddHours('');
      setAddDesc('');
      toast.success(`${h}h logged`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log time');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveEdit(id: string) {
    const h = parseFloat(editHours);
    if (!h || h <= 0 || h > 24) { toast.error('Enter valid hours'); return; }
    try {
      await apiFetch(
        `/tickets/time-entries/${id}`,
        { method: 'PATCH', body: JSON.stringify({ manualHours: h, description: editDesc }) },
        {},
      );
      setEntries(prev => prev.map(e =>
        e.id === id ? { ...e, manualHours: h, computedHours: h, description: editDesc } : e,
      ));
      setEditingId(null);
      toast.success('Entry updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update entry');
    }
  }

  async function handleDelete(id: string) {
    try {
      await apiFetch(`/tickets/time-entries/${id}`, { method: 'DELETE' }, {});
      setEntries(prev => prev.filter(e => e.id !== id));
      setDeletingId(null);
      toast.success('Entry deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete entry');
    }
  }

  const totalHours = entries.reduce((sum, e) => sum + e.computedHours, 0);

  if (loading || roleLoading) {
    return (
      <div className="max-w-2xl space-y-6">
        <PageHeader title="Time Logging" description="Loading…" />
        <div className="animate-pulse space-y-3">
          {[1, 2].map(i => <div key={i} className="h-16 bg-gray-100 rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (!technicianId) {
    return (
      <div className="max-w-2xl space-y-6">
        <PageHeader
          title="Time Logging"
          description={`${totalHours.toFixed(1)}h total${workOrderId ? ` · WO ${workOrderId}` : ''}`}
        />
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-500">
            Sign in to log time against this work order.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Time Logging"
        description={`${totalHours.toFixed(1)}h total${workOrderId ? ` · WO ${workOrderId}` : ''}`}
      />

      {error && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="pt-4 flex items-center gap-3">
            <span className="text-red-600 text-sm flex-1">{error}</span>
            <Button size="sm" variant="outline" onClick={() => void loadEntries()}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {/* Add manual entry */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Log Manual Time</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Work Order #</Label>
              <Input value={addWO} onChange={e => setAddWO(e.target.value)} placeholder="WO-001" />
            </div>
            <div className="space-y-1.5">
              <Label>Hours</Label>
              <Input
                type="number" step="0.25" min="0.25" max="24"
                value={addHours}
                onChange={e => { setAddHours(e.target.value); setOverlapWarning(false); }}
                placeholder="1.5"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={addDesc} onChange={e => setAddDesc(e.target.value)} placeholder="What did you work on?" />
          </div>
          {overlapWarning && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              ⚠ This entry&apos;s time range may overlap with an existing entry. You can still submit.
            </p>
          )}
          <Button
            onClick={() => void handleAdd()}
            disabled={submitting}
            className="w-full bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold min-h-[48px]"
          >
            {submitting ? 'Logging…' : 'Log Time'}
          </Button>
        </CardContent>
      </Card>

      {/* Entries list */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Time Entries ({entries.length})</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-gray-400">No time entries yet.</p>
        ) : (
          <div className="space-y-2">
            {entries.map(entry => {
              if (editingId === entry.id) {
                return (
                  <div key={entry.id} className="bg-white rounded-lg border border-yellow-400 px-4 py-3 space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Hours</Label>
                        <Input
                          type="number" step="0.25" min="0.25" max="24"
                          value={editHours} onChange={e => setEditHours(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Description</Label>
                        <Input value={editDesc} onChange={e => setEditDesc(e.target.value)} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void handleSaveEdit(entry.id)} className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 min-h-[48px]">Save</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="min-h-[48px]">Cancel</Button>
                    </div>
                  </div>
                );
              }

              if (deletingId === entry.id) {
                return (
                  <div key={entry.id} className="bg-red-50 rounded-lg border border-red-300 px-4 py-3 flex items-center gap-3">
                    <span className="text-sm text-red-700 flex-1">Are you sure? This cannot be undone.</span>
                    <Button size="sm" variant="destructive" onClick={() => void handleDelete(entry.id)} className="min-h-[48px]">Delete</Button>
                    <Button size="sm" variant="outline" onClick={() => setDeletingId(null)} className="min-h-[48px]">Cancel</Button>
                  </div>
                );
              }

              return (
                <div key={entry.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center gap-4">
                  <div className="text-lg font-bold text-yellow-600 w-12 text-right flex-shrink-0">{entry.computedHours}h</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900 truncate">{entry.description ?? '—'}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        entry.source === 'AUTO'
                          ? 'bg-gray-100 text-gray-500'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {entry.source === 'AUTO' ? 'Auto-tracked' : entry.source === 'MANUAL' ? 'Manual' : 'Adjusted'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(entry.startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      {entry.endedAt && ` → ${new Date(entry.endedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
                    </p>
                  </div>
                  {entry.source !== 'AUTO' && (
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => { setEditingId(entry.id); setEditHours(String(entry.computedHours)); setEditDesc(entry.description ?? ''); }}
                        className="min-h-[48px] min-w-[48px] flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                        title="Edit entry"
                      >
                        ✏
                      </button>
                      <button
                        onClick={() => setDeletingId(entry.id)}
                        className="min-h-[48px] min-w-[48px] flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                        title="Delete entry"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TimeLoggingPage() {
  return (
    <Suspense fallback={
      <div className="max-w-2xl animate-pulse space-y-3 pt-4">
        {[1, 2].map(i => <div key={i} className="h-16 bg-gray-100 rounded-lg" />)}
      </div>
    }>
      <TimeLoggingContent />
    </Suspense>
  );
}
