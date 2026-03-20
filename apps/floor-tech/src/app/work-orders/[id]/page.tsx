'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  BlockedReasonDialog,
  EvidenceUploadSlot,
  MaterialReadinessBadge,
  ReworkLoopBadge,
  StatusBadge,
  SyncStatusBadge,
  type EvidenceFile,
  type BlockedReasonPayload,
} from '@gg-erp/ui';
import type { WorkOrderDetail } from '@/lib/mock-data';
import { fetchWorkOrder } from '@/lib/api-client';

export default function WorkOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<WorkOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [checklist, setChecklist] = useState(order?.checklist ?? []);
  const [notes, setNotes] = useState(order?.notes ?? []);
  const [newNote, setNewNote] = useState('');
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blockedReason, setBlockedReason] = useState<BlockedReasonPayload | null>(null);

  useEffect(() => {
    fetchWorkOrder(params.id)
      .then((data) => {
        setOrder(data);
        setChecklist(data.checklist ?? []);
        setNotes(data.notes ?? []);
      })
      .catch((err: unknown) => setFetchError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [params.id]);

  const timeLoggingHref = useMemo(
    () => `/work-orders/time-logging?workOrderId=${params.id}`,
    [params.id],
  );

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="tech-card p-5">
          <div className="h-5 w-32 rounded-full bg-[#EDE3D5]" />
          <div className="mt-4 h-8 w-2/3 rounded-full bg-[#EDE3D5]" />
          <div className="mt-3 h-4 w-1/2 rounded-full bg-[#EDE3D5]" />
        </div>
        <div className="tech-card p-5"><div className="h-48 rounded-2xl bg-[#EDE3D5]" /></div>
      </div>
    );
  }

  if (fetchError || !order) {
    return (
      <div className="tech-card p-5">
        <h1 className="text-2xl text-[#211F1E]" data-brand-heading="true">Work order not found</h1>
        {fetchError && <p className="mt-2 text-sm text-red-600">{fetchError}</p>}
        <Link href="/work-orders/my-queue" className="mt-4 inline-flex min-h-[52px] items-center rounded-2xl bg-[#E37125] px-4 text-sm font-semibold text-white">
          Back to queue
        </Link>
      </div>
    );
  }

  function handleToggleChecklist(id: string) {
    setChecklist((current) => current.map((item) => (item.id === id ? { ...item, done: !item.done } : item)));
  }

  function handleAddNote() {
    if (!newNote.trim()) return;
    setNotes((current) => [
      { id: crypto.randomUUID(), author: 'You', message: newNote.trim(), createdAt: 'Just now' },
      ...current,
    ]);
    setNewNote('');
  }

  function handleFilesSelected(selected: File[]) {
    setFiles((current) => [
      ...selected.map((file) => ({ id: crypto.randomUUID(), fileName: file.name, uploadState: 'done' as const })),
      ...current,
    ]);
  }

  return (
    <div className="space-y-4 pb-6">
      <section className="tech-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#F7F0E6] px-2.5 py-1 text-xs font-semibold text-[#5F5752]">{order.number}</span>
          <StatusBadge status={blockedReason ? 'BLOCKED' : order.status} />
          <SyncStatusBadge status={order.syncStatus} />
        </div>
        <h1 className="mt-4 text-3xl leading-tight text-[#211F1E]" data-brand-heading="true">{order.title}</h1>
        <p className="mt-2 text-sm text-[#5F5752]">{order.customer} · {order.cart} · {order.bay} · {order.eta}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <MaterialReadinessBadge status={order.materialReadiness} shortageCount={order.shortageCount} />
          <ReworkLoopBadge current={order.reworkLoop} />
        </div>

        {blockedReason && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <div className="font-semibold">Blocked: {blockedReason.reasonCode.replace(/_/g, ' ')}</div>
            <div className="mt-1">{blockedReason.reasonText || 'Awaiting follow-up.'}</div>
          </div>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button type="button" className="tech-button bg-[#E37125] text-white" onClick={() => setBlockedOpen(true)}>
            Mark blocked
          </button>
          <Link href={timeLoggingHref} className="tech-button border border-[#D9CCBE] bg-white text-[#211F1E]">
            Open time logging
          </Link>
        </div>
      </section>

      <section className="tech-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl text-[#211F1E]" data-brand-heading="true">Checklist</h2>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8A4A18]">
            {checklist.filter((item) => item.done).length} / {checklist.length} done
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {checklist.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleToggleChecklist(item.id)}
              className={`flex min-h-[64px] w-full items-center gap-4 rounded-2xl border px-4 py-3 text-left ${item.done ? 'border-green-200 bg-green-50' : 'border-[#E6DFC6] bg-[#FFF8EF]'}`}
            >
              <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${item.done ? 'bg-green-600 text-white' : 'bg-white text-[#85776F] border border-[#D9CCBE]'}`}>
                {item.done ? '✓' : ''}
              </span>
              <span className="text-base font-medium text-[#211F1E]">{item.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="tech-card p-5">
          <h2 className="text-2xl text-[#211F1E]" data-brand-heading="true">Parts requests</h2>
          <div className="mt-4 space-y-3">
            {order.parts.map((part) => (
              <div key={part.id} className="rounded-2xl border border-[#E6DFC6] bg-[#FFF8EF] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-[#211F1E]">{part.name}</div>
                    <div className="mt-1 text-sm text-[#5F5752]">Qty {part.qty}</div>
                  </div>
                  <SyncStatusBadge status={part.state} />
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="tech-button mt-4 w-full border border-[#D9CCBE] bg-white text-[#211F1E]">
            Request additional parts
          </button>
        </div>

        <div className="tech-card p-5">
          <h2 className="text-2xl text-[#211F1E]" data-brand-heading="true">Notes & photos</h2>
          <textarea
            value={newNote}
            onChange={(event) => setNewNote(event.target.value)}
            rows={4}
            placeholder="Add a quick update for dispatch, parts, or the next technician…"
            className="mt-4 w-full rounded-2xl border border-[#D9CCBE] bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#E37125]"
          />
          <button type="button" onClick={handleAddNote} className="tech-button mt-3 w-full bg-[#E37125] text-white">
            Save note
          </button>

          <div className="mt-4">
            <EvidenceUploadSlot files={files} onFilesSelected={handleFilesSelected} onRemoveFile={(id) => setFiles((current) => current.filter((file) => file.id !== id))} />
          </div>

          <div className="mt-4 space-y-3">
            {notes.map((note) => (
              <div key={note.id} className="rounded-2xl border border-[#E6DFC6] bg-[#FFF8EF] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-[#211F1E]">{note.author}</div>
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#85776F]">{note.createdAt}</div>
                </div>
                <p className="mt-2 text-sm text-[#4F4641]">{note.message}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <BlockedReasonDialog
        open={blockedOpen}
        onCancel={() => setBlockedOpen(false)}
        onConfirm={(payload) => {
          setBlockedReason(payload);
          setBlockedOpen(false);
        }}
      />
    </div>
  );
}
