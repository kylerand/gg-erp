'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SyncStatusBadge } from '@gg-erp/ui';
import { fetchTimeEntries, type TimeEntry } from '@/lib/api-client';

function TimeLoggingContent() {
  const searchParams = useSearchParams();
  const workOrderId = searchParams.get('workOrderId') ?? undefined;
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [clockedIn, setClockedIn] = useState(false);

  useEffect(() => {
    fetchTimeEntries({ workOrderId })
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [workOrderId]);

  const totalHours = useMemo(() => entries.reduce((sum, e) => sum + e.computedHours, 0), [entries]);

  return (
    <div className="space-y-4">
      <section className="tech-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8A4A18]">Time logging</div>
            <h1 className="mt-2 text-4xl text-[#211F1E]" data-brand-heading="true">Track labor fast</h1>
            <p className="mt-2 text-sm text-[#6E625A]">Optimized for quick adjustments between active jobs.</p>
          </div>
          <div className="rounded-2xl border border-[#D9CCBE] bg-white px-4 py-3 text-right">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8A4A18]">Total</div>
            <div className="mt-1 text-2xl font-bold text-[#211F1E]">{totalHours.toFixed(1)}h</div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setClockedIn((value) => !value)}
            className={`tech-button w-full ${clockedIn ? 'bg-[#211F1E] text-white' : 'bg-[#E37125] text-white'}`}
          >
            {clockedIn ? 'Stop active timer' : 'Start active timer'}
          </button>
          <button type="button" className="tech-button w-full border border-[#D9CCBE] bg-white text-[#211F1E]">
            Add manual entry
          </button>
        </div>
      </section>

      {loading && (
        <div className="space-y-3 animate-pulse">
          {[1, 2].map((i) => (
            <div key={i} className="tech-card p-4">
              <div className="h-16 rounded-2xl bg-[#EDE3D5]" />
            </div>
          ))}
        </div>
      )}

      {!loading && entries.length === 0 && (
        <div className="tech-card p-8 text-center">
          <p className="text-sm font-semibold text-[#5F5752]">No time entries yet.</p>
          <p className="mt-1 text-xs text-[#85776F]">Start a timer or add a manual entry to begin tracking.</p>
        </div>
      )}

      <div className="space-y-3">
        {entries.map((entry) => (
          <div key={entry.id} className="tech-card p-4">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-[#FFF3E8] px-4 py-3 text-center text-[#B1581B] min-w-[84px]">
                <div className="text-2xl font-bold leading-none">{entry.computedHours.toFixed(1)}</div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-[0.14em]">Hours</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="rounded-full bg-[#F7F0E6] px-2.5 py-1 text-xs font-semibold text-[#5F5752]">{entry.workOrderId.slice(0, 8)}</span>
                  <SyncStatusBadge status="SYNCED" />
                </div>
                <h2 className="mt-3 text-lg font-semibold text-[#211F1E]">{entry.description ?? 'Labor entry'}</h2>
                <p className="mt-1 text-sm text-[#5F5752]">
                  {new Date(entry.startedAt).toLocaleTimeString()}
                  {entry.endedAt ? ` → ${new Date(entry.endedAt).toLocaleTimeString()}` : ' (in progress)'}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TimeLoggingPage() {
  return (
    <Suspense fallback={<div className="tech-card p-5 animate-pulse"><div className="h-32 rounded-2xl bg-[#EDE3D5]" /></div>}>
      <TimeLoggingContent />
    </Suspense>
  );
}
