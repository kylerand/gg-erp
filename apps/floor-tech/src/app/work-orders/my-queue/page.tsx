'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronRight, PackageCheck, TriangleAlert } from 'lucide-react';
import {
  MaterialReadinessBadge,
  OfflineQueueBanner,
  ReworkLoopBadge,
  StatusBadge,
  SyncStatusBadge,
} from '@gg-erp/ui';
import type { TechQueueItem } from '@/lib/mock-data';
import { fetchQueue } from '@/lib/api-client';

export default function MyQueuePage() {
  const [isOnline, setIsOnline] = useState(true);
  const [queue, setQueue] = useState<TechQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    fetchQueue()
      .then(setQueue)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load queue'))
      .finally(() => setLoading(false));
  }, []);

  const queuedOffline = queue.filter((item) => item.syncStatus === 'FAILED' || item.syncStatus === 'RETRY').length;

  return (
    <div className="space-y-4">
      <OfflineQueueBanner isOnline={isOnline} queuedCount={queuedOffline} />

      <section className="tech-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8A4A18]">My queue</div>
            <h1 className="mt-2 text-4xl text-[#211F1E]" data-brand-heading="true">Ready for the floor</h1>
            <p className="mt-2 text-sm text-[#6E625A]">Prioritized work orders with touch-first actions for the next step.</p>
          </div>
          <div className="rounded-2xl border border-[#F6D1B7] bg-[#FFF3E8] px-3 py-2 text-right text-xs font-semibold text-[#8A4A18]">
            {loading ? '…' : `${queue.length} active jobs`}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="tech-card p-4">
          <div className="flex items-center gap-2 text-[#8A4A18]"><PackageCheck size={18} /><span className="text-xs font-semibold uppercase tracking-[0.16em]">Ready now</span></div>
          <div className="mt-3 text-3xl font-bold text-[#211F1E]">{queue.filter((item) => item.status === 'READY').length}</div>
          <p className="mt-1 text-sm text-[#6E625A]">Jobs you can start immediately.</p>
        </div>
        <div className="tech-card p-4">
          <div className="flex items-center gap-2 text-[#8A4A18]"><TriangleAlert size={18} /><span className="text-xs font-semibold uppercase tracking-[0.16em]">Blocked</span></div>
          <div className="mt-3 text-3xl font-bold text-[#211F1E]">{queue.filter((item) => item.status === 'BLOCKED').length}</div>
          <p className="mt-1 text-sm text-[#6E625A]">Needs parts, approval, or escalation.</p>
        </div>
        <div className="tech-card p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8A4A18]">Sync attention</div>
          <div className="mt-3 text-3xl font-bold text-[#211F1E]">{queuedOffline}</div>
          <p className="mt-1 text-sm text-[#6E625A]">Updates waiting to replay or retry.</p>
        </div>
      </section>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="tech-card p-4 animate-pulse">
              <div className="h-5 w-1/3 rounded-full bg-[#EDE3D5]" />
              <div className="mt-3 h-6 w-2/3 rounded-full bg-[#EDE3D5]" />
              <div className="mt-2 h-4 w-1/2 rounded-full bg-[#EDE3D5]" />
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="tech-card p-5 border border-red-200 bg-red-50">
          <p className="text-sm font-semibold text-red-700">Could not load queue: {error}</p>
          <p className="mt-1 text-xs text-red-600">Please try refreshing the page or contact support.</p>
        </div>
      )}

      {!loading && !error && queue.length === 0 && (
        <div className="tech-card p-8 text-center">
          <PackageCheck className="mx-auto text-[#C4B49A]" size={40} />
          <h2 className="mt-4 text-xl font-semibold text-[#211F1E]">No assigned work</h2>
          <p className="mt-2 text-sm text-[#6E625A]">Check with your dispatcher for the next assignment.</p>
        </div>
      )}

      {!loading && queue.length > 0 && (
        <div className="space-y-3">
          {queue.map((item) => (
            <Link key={item.id} href={`/work-orders/${item.id}`} className="tech-card block p-4 active:scale-[0.99] transition-transform">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded-full bg-[#F7F0E6] px-2.5 py-1 text-xs font-semibold text-[#5F5752]">{item.number}</span>
                    <StatusBadge status={item.status} />
                    <SyncStatusBadge status={item.syncStatus} />
                  </div>
                  <h2 className="mt-3 text-xl font-semibold text-[#211F1E]">{item.title}</h2>
                  <p className="mt-1 text-sm text-[#5F5752]">{item.customer} · {item.cart} · {item.bay}</p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <MaterialReadinessBadge status={item.materialReadiness} shortageCount={item.shortageCount} />
                    <ReworkLoopBadge current={item.reworkLoop} />
                  </div>

                  <div className="mt-4 grid gap-3 rounded-2xl bg-[#FFF8EF] p-3 text-sm text-[#4F4641] sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8A4A18]">Progress</div>
                      <div className="mt-1 font-medium">{item.checklistCompletion}</div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8A4A18]">Next action</div>
                      <div className="mt-1 font-medium">{item.nextAction}</div>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl bg-[#E37125] text-white">
                  <ChevronRight size={20} />
                </div>
              </div>
              <div className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-[#85776F]">{item.age}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
