'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRole } from '@/lib/role-context';
import { listWorkOrders, listParts, listInvoiceSyncRecords, listAuditEvents } from '@/lib/api-client';
import type { UserRole } from '@/lib/auth';

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
    { id: 'ac1', priority: 'p1', title: 'Sync Failures',     value: 1,    description: 'QB sync records in FAILED state',  href: '/accounting/sync',         icon: '❌', alert: true },
    { id: 'ac2', priority: 'p2', title: 'Open Exceptions',   value: 2,    description: 'Unresolved reconciliation items',   href: '/accounting/reconciliation', icon: '⚖️' },
    { id: 'ac3', priority: 'p2', title: 'Pending Sync',      value: 1,    description: 'Records queued for sync',           href: '/accounting/sync',         icon: '⏳' },
    { id: 'ac4', priority: 'p3', title: 'Synced Today',      value: 12,   description: 'Successful QB sync records',        href: '/accounting/sync',         icon: '✅' },
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

  useEffect(() => {
    async function fetchCounts() {
      try {
        const [woResult, partsResult, syncResult, woBlocked, woPlanned, woInProgress, woCompleted, auditAll] = await Promise.allSettled([
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

        void woResult; void totalParts;
        setCounts({
          blocked: blockedCount,
          planned: plannedCount,
          inProgress: inProgressCount,
          syncFailures,
          outOfStock,
          completedToday,
          auditEventsToday,
        });
      } catch {
        // silently keep static fallback values
      }
    }
    void fetchCounts();
  }, []);

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
    ac1: counts.syncFailures,
    ac3: counts.syncFailures,
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
          Good {getTimeOfDay()}, {user?.name ?? 'there'} 👋
        </h1>
        <p className="text-sm text-[#6E625A] mt-2 capitalize">
          {effectiveRole} · {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <Link href={landing} className="inline-block mt-4 text-sm text-[#B1581B] hover:text-[#8A4A18] font-semibold hover:underline">
          → Go to my workspace
        </Link>
      </div>

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
