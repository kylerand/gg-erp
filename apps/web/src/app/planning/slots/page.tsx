'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Slot {
  id: string;
  day: string;
  date: string;
  totalHours: number;
  allocatedHours: number;
  technician: string;
  assignedWOs: string[];
}

const MOCK_SLOTS: Slot[] = [
  { id: 's1', day: 'Mon', date: '2026-03-09', totalHours: 8, allocatedHours: 6, technician: 'Marcus J.', assignedWOs: ['WO-001'] },
  { id: 's2', day: 'Tue', date: '2026-03-10', totalHours: 8, allocatedHours: 8, technician: 'Marcus J.', assignedWOs: ['WO-002', 'WO-003'] },
  { id: 's3', day: 'Wed', date: '2026-03-11', totalHours: 8, allocatedHours: 3, technician: 'Sarah K.', assignedWOs: ['WO-001'] },
  { id: 's4', day: 'Thu', date: '2026-03-12', totalHours: 8, allocatedHours: 0, technician: 'Sarah K.', assignedWOs: [] },
  { id: 's5', day: 'Fri', date: '2026-03-13', totalHours: 8, allocatedHours: 5, technician: 'Derek W.', assignedWOs: ['WO-003'] },
];

export default function BuildSlotPlannerPage() {
  const [slots] = useState(MOCK_SLOTS);
  const [published, setPublished] = useState(false);

  function publish() {
    const overCapacity = slots.filter(s => s.allocatedHours > s.totalHours);
    if (overCapacity.length > 0) {
      toast.error(`Capacity conflict on ${overCapacity.map(s => s.day).join(', ')} — reduce allocation before publishing`);
      return;
    }
    setPublished(true);
    toast.success('Plan published for the week');
  }

  function revert() {
    setPublished(false);
    toast.info('Plan reverted to draft');
  }

  return (
    <div>
      <PageHeader
        title="Build Slot Planner"
        description="Week of Mar 9–13, 2026"
        action={
          published
            ? <Button variant="outline" onClick={revert}>Revert to Draft</Button>
            : <Button onClick={publish} className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold">Publish Plan</Button>
        }
      />
      {published && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 font-medium">
          ✅ Plan published — technicians can see their schedule
        </div>
      )}
      <div className="grid grid-cols-5 gap-3">
        {slots.map(slot => {
          const pct = Math.min(100, Math.round((slot.allocatedHours / slot.totalHours) * 100));
          const overCapacity = slot.allocatedHours > slot.totalHours;
          return (
            <Card key={slot.id} className={overCapacity ? 'border-red-400' : ''}>
              <CardHeader className="pb-2 pt-3">
                <CardTitle className="text-xs font-semibold text-gray-700">
                  {slot.day} {new Date(slot.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </CardTitle>
                <p className="text-xs text-gray-400">{slot.technician}</p>
              </CardHeader>
              <CardContent>
                <div className="mb-2">
                  <div className={`w-full rounded-full h-2 ${overCapacity ? 'bg-red-200' : 'bg-gray-200'}`}>
                    <div
                      className={`h-2 rounded-full transition-all ${overCapacity ? 'bg-red-500' : pct >= 100 ? 'bg-yellow-400' : 'bg-green-400'}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <p className={`text-xs mt-1 ${overCapacity ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                    {slot.allocatedHours}h / {slot.totalHours}h
                  </p>
                </div>
                <div className="space-y-1">
                  {slot.assignedWOs.map(wo => (
                    <span key={wo} className="block text-xs bg-gray-100 text-gray-700 rounded px-2 py-0.5 font-mono">{wo}</span>
                  ))}
                  {slot.assignedWOs.length === 0 && <span className="text-xs text-gray-300">Unassigned</span>}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full text-xs h-7"
                  onClick={() => toast.info(`Assign work to ${slot.day} (coming soon)`)}
                >
                  + Assign
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
