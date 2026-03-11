'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface TimeEntry { id: string; workOrderNumber: string; hours: number; description: string; loggedAt: string; }

const MOCK_ENTRIES: TimeEntry[] = [
  { id: 't1', workOrderNumber: 'WO-001', hours: 2.5, description: 'Motor removal and inspection', loggedAt: '2026-03-10T14:00:00Z' },
  { id: 't2', workOrderNumber: 'WO-001', hours: 1.0, description: 'Parts cleaning', loggedAt: '2026-03-10T16:00:00Z' },
];

export default function TimeLoggingPage() {
  const [entries, setEntries] = useState(MOCK_ENTRIES);
  const [hours, setHours] = useState('');
  const [description, setDescription] = useState('');
  const [woNumber, setWoNumber] = useState('WO-001');

  function addEntry() {
    const h = parseFloat(hours);
    if (!h || h <= 0 || h > 24) { toast.error('Enter valid hours (0.1–24)'); return; }
    if (!description.trim()) { toast.error('Description is required'); return; }
    const entry: TimeEntry = { id: `t-${Date.now()}`, workOrderNumber: woNumber, hours: h, description, loggedAt: new Date().toISOString() };
    setEntries(prev => [entry, ...prev]);
    setHours('');
    setDescription('');
    toast.success(`${h}h logged to ${woNumber}`);
  }

  const total = entries.reduce((sum, e) => sum + e.hours, 0);

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Time Logging" description={`${total.toFixed(1)} hours logged today`} />

      <Card>
        <CardHeader><CardTitle className="text-sm">Log Time</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Work Order #</Label>
              <Input value={woNumber} onChange={e => setWoNumber(e.target.value)} placeholder="WO-001" />
            </div>
            <div className="space-y-1.5">
              <Label>Hours</Label>
              <Input type="number" step="0.25" min="0.25" max="24" value={hours} onChange={e => setHours(e.target.value)} placeholder="2.5" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What did you work on?" />
          </div>
          <Button onClick={addEntry} className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold">Log Time</Button>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Today&apos;s Entries</h2>
        {entries.length === 0 ? <p className="text-sm text-gray-400">No time logged yet.</p> : (
          <div className="space-y-2">
            {entries.map(e => (
              <div key={e.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center gap-4">
                <div className="text-lg font-bold text-yellow-600 w-12 text-right">{e.hours}h</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{e.description}</p>
                  <p className="text-xs text-gray-400">{e.workOrderNumber} · {new Date(e.loggedAt).toLocaleTimeString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
