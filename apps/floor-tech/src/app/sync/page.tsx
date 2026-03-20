'use client';

import { useEffect, useState } from 'react';
import { OfflineQueueBanner, QueueList, SyncStatusBadge } from '@gg-erp/ui';
import { SYNC_QUEUE } from '@/lib/mock-data';

export default function SyncPage() {
  const [isOnline, setIsOnline] = useState(true);

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

  return (
    <div className="space-y-4">
      <OfflineQueueBanner isOnline={isOnline} queuedCount={SYNC_QUEUE.length} />

      <section className="tech-card p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8A4A18]">Sync status</div>
        <h1 className="mt-2 text-4xl text-[#211F1E]" data-brand-heading="true">Offline queue & replay</h1>
        <p className="mt-2 text-sm text-[#6E625A]">Technician updates stay visible, replayable, and easy to triage on shared devices.</p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[#E6DFC6] bg-[#FFF8EF] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8A4A18]">Queued</div>
            <div className="mt-2 text-3xl font-bold text-[#211F1E]">{SYNC_QUEUE.length}</div>
          </div>
          <div className="rounded-2xl border border-[#E6DFC6] bg-[#FFF8EF] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8A4A18]">Needs retry</div>
            <div className="mt-2 text-3xl font-bold text-[#211F1E]">{SYNC_QUEUE.filter((item) => item.status === 'RETRY').length}</div>
          </div>
          <div className="rounded-2xl border border-[#E6DFC6] bg-[#FFF8EF] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8A4A18]">Failed</div>
            <div className="mt-2 text-3xl font-bold text-[#211F1E]">{SYNC_QUEUE.filter((item) => item.status === 'FAILED').length}</div>
          </div>
        </div>
      </section>

      <section className="tech-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-2xl text-[#211F1E]" data-brand-heading="true">Queued updates</h2>
          <button type="button" className="tech-button bg-[#E37125] px-5 text-white">Replay now</button>
        </div>
        <QueueList
          items={SYNC_QUEUE.map((item) => ({
            id: item.id,
            number: item.number,
            title: item.title,
            status: item.status,
            age: item.age,
            priority: item.status === 'FAILED' ? 'p1' : item.status === 'RETRY' ? 'p2' : 'p3',
          }))}
          actionLabel="Review"
        />
      </section>

      <section className="tech-card p-5">
        <h2 className="text-2xl text-[#211F1E]" data-brand-heading="true">What happens next</h2>
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-[#E6DFC6] bg-[#FFF8EF] p-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-[#211F1E]">Task state update</div>
              <div className="mt-1 text-sm text-[#5F5752]">Replay when online and preserve idempotency keys.</div>
            </div>
            <SyncStatusBadge status="RETRY" />
          </div>
          <div className="rounded-2xl border border-[#E6DFC6] bg-[#FFF8EF] p-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-[#211F1E]">Photo attachment</div>
              <div className="mt-1 text-sm text-[#5F5752]">Hold locally until upload and confirmation succeed.</div>
            </div>
            <SyncStatusBadge status="PENDING" />
          </div>
        </div>
      </section>
    </div>
  );
}
