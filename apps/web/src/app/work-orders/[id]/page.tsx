'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  MessageCircle,
  Package,
  Printer,
  Receipt,
  Send,
  ShieldCheck,
  Timer,
  Wrench,
} from 'lucide-react';
import {
  getWoOrder,
  type WoOrderDetail,
  type WoOrderPartLine,
} from '@/lib/api-client';
import {
  MaterialReadinessBadge,
  PageHeader,
  StatusBadge,
  SyncStatusBadge,
} from '@gg-erp/ui';
import { Button } from '@/components/ui/button';

const ORDER_TABS = [
  { id: 'services', label: 'Services', icon: Wrench },
  { id: 'parts', label: 'Parts', icon: Package },
  { id: 'time', label: 'Time', icon: Timer },
  { id: 'qc', label: 'QC', icon: ShieldCheck },
  { id: 'messages', label: 'Messages', icon: MessageCircle },
  { id: 'accounting', label: 'Accounting', icon: Receipt },
];

export default function WorkOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [workOrder, setWorkOrder] = useState<WoOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const nextWorkOrder = await getWoOrder(id);
        if (!cancelled) setWorkOrder(nextWorkOrder);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load work order');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
        <div className="h-40 animate-pulse rounded-lg bg-gray-100" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-56 animate-pulse rounded-lg bg-gray-100 lg:col-span-2" />
          <div className="h-56 animate-pulse rounded-lg bg-gray-100" />
        </div>
      </div>
    );
  }

  if (error || !workOrder) {
    return (
      <div>
        <PageHeader title="Work Order" description="Unable to load work-order detail" />
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error ?? 'Work order not found.'}
        </div>
        <Link href="/work-orders" className="mt-4 inline-block text-sm font-semibold text-[#B1581B] hover:underline">
          Back to work orders
        </Link>
      </div>
    );
  }

  const doneCount = workOrder.checklist.filter((item) => item.done).length;
  const serviceProgress =
    workOrder.checklist.length > 0
      ? Math.round((doneCount / workOrder.checklist.length) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <PageHeader title={`${workOrder.number}: ${workOrder.title}`} description={`${workOrder.customer} · ${workOrder.cart}`} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Printer size={15} />
            Print
          </Button>
          <LinkButton href={`/messages?workOrder=${encodeURIComponent(workOrder.id)}`}>
            <Send size={15} />
            Send
          </LinkButton>
          <LinkButton href={`/messages?workOrder=${encodeURIComponent(workOrder.id)}`}>
            <MessageCircle size={15} />
            Message
          </LinkButton>
        </div>
      </div>

      <section className="rounded-lg border border-[#D9CCBE] bg-white p-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <SummaryItem label="Status"><StatusBadge status={workOrder.status} /></SummaryItem>
          <SummaryItem label="Material"><MaterialReadinessBadge status={workOrder.materialReadiness} shortageCount={workOrder.shortageCount} /></SummaryItem>
          <SummaryItem label="Accounting"><SyncStatusBadge status={workOrder.syncStatus} /></SummaryItem>
          <SummaryItem label="Bay" value={workOrder.bay} />
          <SummaryItem label="Due" value={workOrder.eta} />
          <SummaryItem label="Service Progress" value={`${serviceProgress}%`} />
        </div>
      </section>

      <nav className="flex gap-2 overflow-x-auto border-b border-[#D9CCBE] pb-2">
        {ORDER_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <a
              key={tab.id}
              href={`#${tab.id}`}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-[#D9CCBE] bg-white px-3 py-2 text-sm font-semibold text-[#4F4641] hover:border-[#E37125] hover:text-[#211F1E]"
            >
              <Icon size={15} />
              {tab.label}
            </a>
          );
        })}
      </nav>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <section id="services" className="rounded-lg border border-gray-200 bg-white">
            <SectionHeader
              icon={Wrench}
              title="Services"
              actionHref={`/work-orders/sop-runner?workOrderId=${encodeURIComponent(workOrder.id)}`}
              actionLabel="Open SOP Runner"
            />
            <div className="divide-y divide-gray-100">
              {workOrder.checklist.length > 0 ? (
                workOrder.checklist.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                    <CheckCircle2
                      size={18}
                      className={item.done ? 'text-green-600' : 'text-gray-300'}
                    />
                    <span className="text-sm font-medium text-gray-800">{item.label}</span>
                    <span className="ml-auto text-xs text-gray-500">
                      {item.done ? 'Done' : 'Open'}
                    </span>
                  </div>
                ))
              ) : (
                <EmptyPanel text="No service operations are attached to this work order yet." />
              )}
            </div>
          </section>

          <section id="parts" className="rounded-lg border border-gray-200 bg-white">
            <SectionHeader
              icon={Package}
              title="Parts and Reservations"
              actionHref={`/inventory/reservations?workOrderId=${encodeURIComponent(workOrder.id)}`}
              actionLabel="Manage Reservations"
            />
            {workOrder.parts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-200 bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">Part</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">Qty</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {workOrder.parts.map((part) => (
                      <PartRow key={part.id} part={part} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyPanel text="No parts are reserved for this work order." />
            )}
          </section>

          <section id="time" className="rounded-lg border border-gray-200 bg-white">
            <SectionHeader
              icon={Timer}
              title="Time"
              actionHref={`/work-orders/time-logging?workOrderId=${encodeURIComponent(workOrder.id)}`}
              actionLabel="Log Time"
            />
            <EmptyPanel text="Time entries will appear here after technicians clock time to this work order." />
          </section>

          <section id="qc" className="rounded-lg border border-gray-200 bg-white">
            <SectionHeader
              icon={ShieldCheck}
              title="Quality Control"
              actionHref={`/work-orders/qc-checklists?workOrderId=${encodeURIComponent(workOrder.id)}`}
              actionLabel="Open QC"
            />
            <EmptyPanel text="QC gates and inspection results will appear here as the build progresses." />
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-900">Order Details</h2>
            <div className="mt-4 space-y-3 text-sm">
              <DetailLine label="Customer" value={workOrder.customer} />
              <DetailLine label="Cart" value={workOrder.cart} />
              <DetailLine label="Bay" value={workOrder.bay} />
              <DetailLine label="Rework Loop" value={String(workOrder.reworkLoop)} />
            </div>
          </section>

          <section id="messages" className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <MessageCircle size={15} />
              Messages and Notes
            </h2>
            <div className="mt-4 space-y-3">
              {workOrder.notes.length > 0 ? (
                workOrder.notes.map((note) => (
                  <div key={note.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
                    <div className="font-semibold text-gray-800">{note.author}</div>
                    <p className="mt-1 text-gray-600">{note.message}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">No notes yet.</p>
              )}
              <Link href={`/messages?workOrder=${encodeURIComponent(workOrder.id)}`} className="inline-flex text-sm font-semibold text-[#B1581B] hover:underline">
                Open message thread
              </Link>
            </div>
          </section>

          <section id="accounting" className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Receipt size={15} />
              Accounting
            </h2>
            <div className="mt-4 space-y-3 text-sm">
              <Link href="/accounting/sync?view=invoices" className="flex items-center gap-2 text-[#B1581B] hover:underline">
                <FileText size={14} />
                Invoice sync history
              </Link>
              <Link href="/accounting/reconciliation" className="flex items-center gap-2 text-[#B1581B] hover:underline">
                <ClipboardCheck size={14} />
                Reconciliation runs
              </Link>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Clock size={15} />
              Activity
            </h2>
            <p className="mt-3 text-sm text-gray-500">
              Activity events will appear here once the work-order event stream is exposed to the web app.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50"
    >
      {children}
    </Link>
  );
}

function SummaryItem({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 text-sm font-semibold text-gray-900">{children ?? value ?? '-'}</div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  actionHref,
  actionLabel,
}: {
  icon: typeof Wrench;
  title: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Icon size={16} />
        {title}
      </h2>
      <Link href={actionHref} className="text-xs font-semibold text-[#B1581B] hover:underline">
        {actionLabel}
      </Link>
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return <div className="px-4 py-8 text-sm text-gray-500">{text}</div>;
}

function PartRow({ part }: { part: WoOrderPartLine }) {
  return (
    <tr>
      <td className="px-4 py-3 font-medium text-gray-900">{part.name}</td>
      <td className="px-4 py-3 text-gray-600">{part.qty}</td>
      <td className="px-4 py-3">
        <StatusBadge status={part.state}>{part.state.replace(/_/g, ' ')}</StatusBadge>
      </td>
    </tr>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className="text-right font-medium text-gray-900">{value}</span>
    </div>
  );
}
