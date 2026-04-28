'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRole } from '@/lib/role-context';
import {
  listWorkOrders, listParts, listInvoiceSyncRecords, listAuditEvents,
  getQbStatus, listReconciliationRuns, getFailureSummary,
  getWorkspaceToday,
} from '@/lib/api-client';
import type { UserRole } from '@/lib/auth';
import type { WorkspaceTodayItem, WorkspaceTodayResponse } from '@/lib/api-client';

interface DashboardCard {
  id: string;
  priority: 'p1' | 'p2' | 'p3';
  title: string;
  value: string | number;
  description: string;
  href: string;
  icon: string;
  alert?: boolean;
}

const PRIORITY_CONFIG = {
  p1: { label: 'P1 — Immediate', icon: '🔴', shape: '▲', classes: 'border-red-300 bg-red-50' },
  p2: { label: 'P2 — Soon',      icon: '🟡', shape: '◆', classes: 'border-yellow-300 bg-yellow-50' },
  p3: { label: 'P3 — Today',     icon: '🔵', shape: '●', classes: 'border-blue-200 bg-blue-50' },
};

const CARDS_BY_ROLE: Record<UserRole, DashboardCard[]> = {
  technician: [
    { id: 't1', priority: 'p1', title: 'Blocked Jobs',       value: 1,    description: 'Active jobs blocked on parts',        href: '/work-orders/open',        icon: '🚧', alert: true },
    { id: 't2', priority: 'p2', title: 'My Queue',           value: 3,    description: 'Work orders assigned to you',         href: '/work-orders/my-queue',    icon: '📋' },
    { id: 't3', priority: 'p2', title: 'Overdue Training',   value: 1,    description: 'OJT modules past due date',           href: '/training/my-ojt',         icon: '📚' },
    { id: 't4', priority: 'p3', title: 'Completed Today',    value: 2,    description: 'Work orders finished today',          href: '/work-orders',             icon: '✅' },
  ],
  manager: [
    { id: 'm1', priority: 'p1', title: 'Blocked Work',       value: 2,    description: 'Work orders needing triage',         href: '/work-orders/open',        icon: '🚧', alert: true },
    { id: 'm2', priority: 'p2', title: 'Dispatch Queue',     value: 5,    description: 'Unassigned work orders',             href: '/work-orders/dispatch',    icon: '🗂️' },
    { id: 'm3', priority: 'p2', title: 'Overdue OJT',        value: 1,    description: 'Team members with overdue training', href: '/training/assignments',    icon: '📚' },
    { id: 'm4', priority: 'p3', title: 'Throughput',         value: '87%', description: 'Slot utilization this week',        href: '/planning/slots',          icon: '📊' },
  ],
  parts: [
    { id: 'p1c', priority: 'p1', title: 'Shortages',         value: 1,    description: 'Active reservations with no stock', href: '/inventory/reservations',  icon: '⚠️', alert: true },
    { id: 'p2c', priority: 'p2', title: 'Open Receives',     value: 2,    description: 'POs awaiting receipt',              href: '/inventory/receiving',     icon: '📥' },
    { id: 'p3c', priority: 'p2', title: 'Out of Stock',      value: 1,    description: 'SKUs at zero quantity',             href: '/inventory/parts',         icon: '📦' },
    { id: 'p4c', priority: 'p3', title: 'Pending Picks',     value: 2,    description: 'Reservations not yet picked',       href: '/inventory/reservations',  icon: '📋' },
  ],
  trainer: [
    { id: 'tr1', priority: 'p1', title: 'Overdue Assignments', value: 1,  description: 'Team members past due date',        href: '/training/assignments',    icon: '⚠️', alert: true },
    { id: 'tr2', priority: 'p2', title: 'In Progress',        value: 3,   description: 'Modules actively being completed',  href: '/training/assignments',    icon: '🔄' },
    { id: 'tr3', priority: 'p2', title: 'Evidence Backlog',   value: 2,   description: 'Submitted evidence awaiting review', href: '/training/assignments',   icon: '📎' },
    { id: 'tr4', priority: 'p3', title: 'SOP Drafts',         value: 1,   description: 'SOPs pending review and publish',   href: '/training/sop',            icon: '📖' },
  ],
  accounting: [
    // Static values are 0; the real counts are filled in by fetchCounts → VALUE_OVERRIDES.
    { id: 'ac0', priority: 'p1', title: 'QB Connection',     value: '…',  description: 'QuickBooks integration status',     href: '/accounting',              icon: '🔌' },
    { id: 'ac1', priority: 'p1', title: 'Sync Failures',     value: 0,    description: 'Invoice + customer + payment failures', href: '/accounting/sync',     icon: '❌', alert: true },
    { id: 'ac2', priority: 'p2', title: 'Latest Reconcile',  value: '—',  description: 'Most recent reconciliation run',    href: '/accounting/reconciliation', icon: '⚖️' },
    { id: 'ac3', priority: 'p2', title: 'Pending Sync',      value: 0,    description: 'Records queued for sync',           href: '/accounting/sync',         icon: '⏳' },
    { id: 'ac4', priority: 'p3', title: 'Synced Today',      value: 0,    description: 'Invoices synced in last 24h',       href: '/accounting/sync',         icon: '✅' },
  ],
  admin: [
    { id: 'ad1', priority: 'p1', title: 'Auth Failures',     value: 1,    description: 'Denied access attempts in last 24h', href: '/admin/audit',           icon: '🔐', alert: true },
    { id: 'ad2', priority: 'p2', title: 'Integration Health', value: '3/4', description: 'Active connectors',               href: '/admin/integrations',      icon: '🔌' },
    { id: 'ad3', priority: 'p2', title: 'Active Users',      value: 4,    description: 'Users active today',               href: '/admin/access',            icon: '👥' },
    // Static value is 0; the real count is filled in by fetchCounts → VALUE_OVERRIDES.ad4.
    { id: 'ad4', priority: 'p3', title: 'Audit Events',      value: 0,    description: 'Events logged today',              href: '/admin/audit',             icon: '📜' },
  ],
};

const DEFAULT_ROLE_LANDING: Record<UserRole, string> = {
  technician: '/work-orders/my-queue',
  manager:    '/work-orders/dispatch',
  parts:      '/inventory/reservations',
  trainer:    '/training/assignments',
  accounting: '/accounting/reconciliation',
  admin:      '/admin',
};

export function RoleDashboard() {
  const { role, user, loading } = useRole();
  const [counts, setCounts] = useState<Record<string, number | string>>({});
  const [today, setToday] = useState<WorkspaceTodayResponse | null>(null);

  useEffect(() => {
    async function fetchCounts() {
      try {
        const [
          woResult, partsResult, syncResult,
          woBlocked, woPlanned, woInProgress, woCompleted,
          auditAll,
          qbStatus, qbFailureSummary, qbInvoiceSynced, qbReconRuns,
        ] = await Promise.allSettled([
          listWorkOrders({ limit: 1 }),
          listParts({ limit: 1 }),
          listInvoiceSyncRecords({ state: 'FAILED' }),
          listWorkOrders({ state: 'BLOCKED', limit: 100 }),
          listWorkOrders({ state: 'PLANNED', limit: 100 }),
          listWorkOrders({ state: 'IN_PROGRESS', limit: 100 }),
          listWorkOrders({ state: 'COMPLETED', limit: 100 }),
          // Audit events: page through up to 200 recent rows and count those
          // dated today client-side. The /audit/events endpoint doesn't have
          // a since= filter today, but 200 rows is more than a busy
          // shop's daily volume, so this is accurate in practice.
          listAuditEvents({ limit: 200 }),
          // QuickBooks integration cards (accounting role).
          getQbStatus(),
          getFailureSummary(),
          listInvoiceSyncRecords({ state: 'SYNCED' }),
          listReconciliationRuns({ limit: 1 }),
        ]);

        const blockedCount = woBlocked.status === 'fulfilled' ? woBlocked.value.total : 0;
        const plannedCount = woPlanned.status === 'fulfilled' ? woPlanned.value.total : 0;
        const inProgressCount = woInProgress.status === 'fulfilled' ? woInProgress.value.total : 0;
        const syncFailures = syncResult.status === 'fulfilled' ? syncResult.value.items.length : 0;
        const totalParts = partsResult.status === 'fulfilled' ? partsResult.value.total : 0;

        const outOfStock = partsResult.status === 'fulfilled'
          ? partsResult.value.items.filter((p) => (p.quantityOnHand ?? 0) === 0).length
          : 0;

        const today = new Date().toDateString();
        const completedToday = woCompleted.status === 'fulfilled'
          ? woCompleted.value.items.filter(w => w.completedAt && new Date(w.completedAt).toDateString() === today).length
          : 0;
        const auditEventsToday = auditAll.status === 'fulfilled'
          ? auditAll.value.items.filter((e) => new Date(e.createdAt).toDateString() === today).length
          : 0;

        // QuickBooks integration counts.
        const qbConnected = qbStatus.status === 'fulfilled' && qbStatus.value.connected;
        const qbConnectionLabel = qbConnected
          ? (qbStatus.status === 'fulfilled' && qbStatus.value.companyName) || '✓ Connected'
          : 'Disconnected';
        const totalSyncFailures = qbFailureSummary.status === 'fulfilled' ? qbFailureSummary.value.total : syncFailures;
        const invoicesSyncedToday = qbInvoiceSynced.status === 'fulfilled'
          ? qbInvoiceSynced.value.items.filter((r) => r.syncedAt && new Date(r.syncedAt).toDateString() === today).length
          : 0;
        const lastReconLabel = qbReconRuns.status === 'fulfilled' && qbReconRuns.value.items[0]
          ? `${qbReconRuns.value.items[0].status} · ${formatRelative(qbReconRuns.value.items[0].startedAt)}`
          : 'No runs yet';

        void woResult; void totalParts;
        setCounts({
          blocked: blockedCount,
          planned: plannedCount,
          inProgress: inProgressCount,
          syncFailures,
          outOfStock,
          completedToday,
          auditEventsToday,
          qbConnectionLabel,
          totalSyncFailures,
          invoicesSyncedToday,
          lastReconLabel,
        });
      } catch {
        // silently keep static fallback values
      }
    }
    void fetchCounts();
  }, []);

  useEffect(() => {
    if (loading) return;
    const effectiveRole: UserRole = role ?? 'technician';
    async function fetchToday() {
      try {
        const nextToday = await getWorkspaceToday(effectiveRole);
        setToday(nextToday);
      } catch {
        setToday(null);
      }
    }
    void fetchToday();
  }, [loading, role]);

  if (loading) {
    return (
      <div>
        <div className="h-8 bg-gray-200 rounded w-48 mb-2 animate-pulse" />
        <div className="h-4 bg-gray-100 rounded w-32 mb-8 animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      </div>
    );
  }

  const effectiveRole: UserRole = role ?? 'technician';
  const staticCards = CARDS_BY_ROLE[effectiveRole] ?? CARDS_BY_ROLE.technician;

  // Merge real counts into cards by id
  const VALUE_OVERRIDES: Record<string, number | string | undefined> = {
    t1: counts.blocked,
    t2: counts.inProgress,
    t4: counts.completedToday,
    m1: counts.blocked,
    m2: counts.planned,
    m4: counts.inProgress !== undefined ? `${counts.inProgress}` : undefined,
    p3c: counts.outOfStock,
    ac0: counts.qbConnectionLabel,
    ac1: counts.totalSyncFailures,
    ac2: counts.lastReconLabel,
    ac3: counts.syncFailures,
    ac4: counts.invoicesSyncedToday,
    ad4: counts.auditEventsToday,
  };

  const cards = staticCards.map(c =>
    VALUE_OVERRIDES[c.id] !== undefined ? { ...c, value: VALUE_OVERRIDES[c.id]! } : c
  );

  const landing = DEFAULT_ROLE_LANDING[effectiveRole];
  const p1Cards = cards.filter(c => c.priority === 'p1');
  const p2Cards = cards.filter(c => c.priority === 'p2');
  const p3Cards = cards.filter(c => c.priority === 'p3');

  return (
    <div>
      <div className="mb-8 brand-panel p-6">
        <div className="brand-pill border-[#F6D1B7] bg-[#FFF3E8] text-[#8A4A18]">Today at a glance</div>
        <h1 className="mt-4 text-4xl text-[#211F1E]" data-brand-heading="true">
          Good {getTimeOfDay()}, {user?.name ?? 'there'}
        </h1>
        <p className="text-sm text-[#6E625A] mt-2 capitalize">
          {effectiveRole} · {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <Link href={landing} className="inline-block mt-4 text-sm text-[#B1581B] hover:text-[#8A4A18] font-semibold hover:underline">
          Go to my workspace
        </Link>
      </div>

      <TodayQueue today={today} className="mb-8" />

      {p1Cards.length > 0 && (
        <section className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-red-500">▲</span>
            <span className="text-xs font-semibold text-red-600 uppercase tracking-wide">P1 — Requires immediate attention</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {p1Cards.map(card => <DashCard key={card.id} card={card} />)}
          </div>
        </section>
      )}

      {p2Cards.length > 0 && (
        <section className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-yellow-500">◆</span>
            <span className="text-xs font-semibold text-yellow-700 uppercase tracking-wide">P2 — Action needed soon</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {p2Cards.map(card => <DashCard key={card.id} card={card} />)}
          </div>
        </section>
      )}

      {p3Cards.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-blue-400">●</span>
            <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">P3 — Informational</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {p3Cards.map(card => <DashCard key={card.id} card={card} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function TodayQueue({ today, className }: { today: WorkspaceTodayResponse | null; className?: string }) {
  const items = today?.items ?? [];
  return (
    <section className={`brand-panel p-5 ${className ?? ''}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="brand-pill border-[#D9CCBE] bg-white text-[#6E625A]">Operator worklist</div>
          <h2 className="mt-3 text-2xl text-[#211F1E]" data-brand-heading="true">What needs attention next</h2>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          <MiniCount label="Total" value={today?.summary.total ?? 0} />
          <MiniCount label="P1" value={today?.summary.p1 ?? 0} tone="red" />
          <MiniCount label="P2" value={today?.summary.p2 ?? 0} tone="amber" />
          <MiniCount label="P3" value={today?.summary.p3 ?? 0} tone="blue" />
        </div>
      </div>

      <div className="mt-4 divide-y divide-[#E4D8CB] overflow-hidden rounded-xl border border-[#E4D8CB] bg-white">
        {items.length > 0 ? (
          items.slice(0, 6).map((item) => <TodayQueueItem key={item.id} item={item} />)
        ) : (
          <div className="px-4 py-8 text-sm text-[#6E625A]">
            No urgent work surfaced for this role right now.
          </div>
        )}
      </div>

      {today && today.warnings.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Some worklist sources could not be refreshed. Showing the available live items.
        </div>
      )}
    </section>
  );
}

function TodayQueueItem({ item }: { item: WorkspaceTodayItem }) {
  const cfg = severityConfig(item.severity);
  return (
    <Link href={item.primaryHref} className="grid gap-3 px-4 py-3 transition-colors hover:bg-[#FFF7EE] md:grid-cols-[7rem_1fr_auto] md:items-center">
      <div className={`inline-flex h-8 w-20 items-center justify-center rounded-lg border text-xs font-bold ${cfg.classes}`}>
        {item.severity}
      </div>
      <div>
        <div className="text-sm font-semibold text-[#211F1E]">{item.title}</div>
        <div className="mt-0.5 text-xs text-[#6E625A]">{item.description}</div>
      </div>
      <div className="text-xs font-semibold text-[#B1581B]">{item.primaryAction}</div>
    </Link>
  );
}

function MiniCount({ label, value, tone }: { label: string; value: number; tone?: 'red' | 'amber' | 'blue' }) {
  const classes = tone === 'red'
    ? 'border-red-200 bg-red-50 text-red-700'
    : tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : tone === 'blue'
        ? 'border-blue-200 bg-blue-50 text-blue-700'
        : 'border-[#E4D8CB] bg-white text-[#211F1E]';
  return (
    <div className={`min-w-16 rounded-xl border px-3 py-2 ${classes}`}>
      <div className="text-lg font-bold leading-none">{value}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase">{label}</div>
    </div>
  );
}

function severityConfig(severity: WorkspaceTodayItem['severity']) {
  if (severity === 'P1') return { classes: 'border-red-200 bg-red-50 text-red-700' };
  if (severity === 'P2') return { classes: 'border-amber-200 bg-amber-50 text-amber-700' };
  return { classes: 'border-blue-200 bg-blue-50 text-blue-700' };
}

function DashCard({ card }: { card: DashboardCard }) {
  const cfg = PRIORITY_CONFIG[card.priority];
  return (
    <Link
      href={card.href}
      className={`block p-5 rounded-[1.4rem] border-2 hover:shadow-brand transition-all ${cfg.classes}`}
      aria-label={`${card.title}: ${card.value}. ${card.description}. Priority: ${cfg.label}`}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-xl">{card.icon}</span>
        <span className="text-xs font-semibold opacity-60" aria-hidden>{cfg.shape}</span>
      </div>
      <div className="text-3xl font-bold text-gray-900 mb-1">{card.value}</div>
      <div className="text-sm font-semibold text-gray-800">{card.title}</div>
      <div className="text-xs text-gray-600 mt-1">{card.description}</div>
    </Link>
  );
}

function getTimeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

/** Compact relative timestamp — e.g. "2h ago", "3d ago". For dashboard cards. */
function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
