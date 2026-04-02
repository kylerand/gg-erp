'use client';
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { PageHeader, EmptyState } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch, listBuildSlots, type BuildSlotData } from '@/lib/api-client';

interface WoQueueItem {
  id: string;
  number: string;
  title: string;
  status: string;
  materialReadiness: string;
  age: string;
}

function getWeekDates(): { start: string; end: string; days: { date: string; label: string; dayName: string }[] } {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

  const days = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      date: d.toISOString().split('T')[0],
      label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      dayName: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][i],
    };
  });

  return { start: days[0].date, end: days[4].date, days };
}

export default function BuildSlotPlannerPage() {
  const [workOrders, setWorkOrders] = useState<WoQueueItem[]>([]);
  const [buildSlots, setBuildSlots] = useState<BuildSlotData[]>([]);
  const [loading, setLoading] = useState(true);
  const week = useMemo(() => getWeekDates(), []);

  useEffect(() => {
    Promise.all([
      apiFetch<{ items: WoQueueItem[] }>('/tickets/wo-queue?limit=50', undefined, { items: [] }),
      listBuildSlots({ startDate: week.start, endDate: week.end }),
    ]).then(([woData, slotData]) => {
      setWorkOrders(woData.items);
      setBuildSlots(slotData.items);
      setLoading(false);
    });
  }, [week.start, week.end]);

  // Group work orders across the week (round-robin into days for visualization)
  const daySlots = useMemo(() => {
    return week.days.map((day, i) => {
      const slot = buildSlots.find((s) => s.slotDate === day.date);
      const assignedWOs = workOrders.filter((_, idx) => idx % 5 === i);
      return {
        ...day,
        totalHours: slot?.capacityHours ?? 8,
        usedHours: slot?.usedHours ?? assignedWOs.length * 2,
        workOrders: assignedWOs,
      };
    });
  }, [week.days, workOrders, buildSlots]);

  const totalWOs = workOrders.length;

  if (loading) {
    return (
      <div>
        <PageHeader title="Build Slot Planner" description="Loading schedule…" />
        <div className="text-center py-16 text-gray-400 text-sm">Loading work orders and build slots…</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Build Slot Planner"
        description={`Week of ${week.days[0].label}–${week.days[4].label} · ${totalWOs} active work orders`}
        action={
          <Button
            onClick={() => toast.success('Plan published for the week')}
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold"
          >
            Publish Plan
          </Button>
        }
      />

      {totalWOs === 0 ? (
        <EmptyState
          icon="📅"
          title="No work orders"
          description="There are no active work orders to schedule this week."
        />
      ) : (
        <div className="grid grid-cols-5 gap-3">
          {daySlots.map((slot) => {
            const pct = slot.totalHours > 0 ? Math.min(100, Math.round((slot.usedHours / slot.totalHours) * 100)) : 0;
            const overCapacity = slot.usedHours > slot.totalHours;
            return (
              <Card key={slot.date} className={overCapacity ? 'border-red-400' : ''}>
                <CardHeader className="pb-2 pt-3">
                  <CardTitle className="text-xs font-semibold text-gray-700">
                    {slot.dayName} {slot.label}
                  </CardTitle>
                  <p className="text-xs text-gray-400">
                    {slot.workOrders.length} order{slot.workOrders.length !== 1 ? 's' : ''}
                  </p>
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
                      {slot.usedHours}h / {slot.totalHours}h
                    </p>
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {slot.workOrders.map((wo) => (
                      <span
                        key={wo.id}
                        className="block text-xs bg-gray-100 text-gray-700 rounded px-2 py-0.5 font-mono truncate"
                        title={wo.title}
                      >
                        #{wo.number}
                      </span>
                    ))}
                    {slot.workOrders.length === 0 && (
                      <span className="text-xs text-gray-300">Unassigned</span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 w-full text-xs h-7"
                    onClick={() => toast.info(`Assign work to ${slot.dayName}`)}
                  >
                    + Assign
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
