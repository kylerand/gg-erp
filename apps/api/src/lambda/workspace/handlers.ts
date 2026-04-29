import { PrismaClient } from '@prisma/client';
import { getRequiredErpRecordRoute, getRequiredErpRoute } from '@gg-erp/domain';
import { jsonResponse, wrapHandler, type RequestContext } from '../../shared/lambda/index.js';

const prisma = new PrismaClient();

export type WorkspaceRole = 'technician' | 'manager' | 'parts' | 'trainer' | 'accounting' | 'admin';
export type TodaySeverity = 'P1' | 'P2' | 'P3';
export type TodayFreshness = 'LIVE' | 'STALE';
export type TodayModule =
  | 'work_orders'
  | 'inventory'
  | 'purchasing'
  | 'training'
  | 'accounting'
  | 'admin';

export interface WorkspaceTodayItem {
  id: string;
  module: TodayModule;
  severity: TodaySeverity;
  title: string;
  description: string;
  primaryHref: string;
  primaryAction: string;
  ownerRole: WorkspaceRole;
  dueAt?: string;
  sourceType: string;
  sourceId: string;
  freshness: TodayFreshness;
}

export interface WorkspaceTodayResponse {
  generatedAt: string;
  role: WorkspaceRole;
  summary: {
    p1: number;
    p2: number;
    p3: number;
    total: number;
  };
  items: WorkspaceTodayItem[];
  warnings: Array<{ source: string; message: string }>;
}

export interface BlockedWorkOrderRow {
  id: string;
  workOrderNumber: string;
  title: string;
  priority: number;
  dueAt: Date | null;
  updatedAt: Date;
}

export interface UnassignedTaskRow {
  id: string;
  workOrderId: string;
  routingStepId: string;
  updatedAt: Date;
}

export interface ShortagePartRow {
  id: string;
  sku: string;
  name: string;
  variant: string | null;
  reorderPoint: number | string;
  onHand: number | string;
  shortfall: number | string;
}

export interface PurchaseOrderRow {
  id: string;
  poNumber: string;
  purchaseOrderState: string;
  expectedAt: Date | null;
  vendor: { vendorName: string };
}

export interface InvoiceSyncRow {
  id: string;
  invoiceNumber: string;
  state: string;
  attemptCount: number;
  lastErrorMessage: string | null;
  createdAt: Date;
}

export interface ReworkIssueRow {
  id: string;
  workOrderId: string;
  title: string;
  severity: string;
  state: string;
  createdAt: Date;
}

export interface TrainingAssignmentRow {
  id: string;
  employeeId: string;
  dueAt: Date | null;
  assignmentStatus: string;
  module: { moduleName: string };
}

export interface AuditEventRow {
  id: string;
  action: string;
  entityType: string;
  createdAt: Date;
}

export const workspaceTodayQueries = {
  listBlockedWorkOrders(limit: number): Promise<BlockedWorkOrderRow[]> {
    return prisma.woOrder.findMany({
      where: { status: 'BLOCKED' },
      orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        workOrderNumber: true,
        title: true,
        priority: true,
        dueAt: true,
        updatedAt: true,
      },
    });
  },

  listUnassignedReadyTasks(limit: number): Promise<UnassignedTaskRow[]> {
    return prisma.technicianTask.findMany({
      where: { state: 'READY', technicianId: null },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        workOrderId: true,
        routingStepId: true,
        updatedAt: true,
      },
    });
  },

  listShortageParts(limit: number): Promise<ShortagePartRow[]> {
    return prisma.$queryRaw<ShortagePartRow[]>`
      SELECT
        p.id::text AS "id",
        p.sku AS "sku",
        p.name AS "name",
        p.variant AS "variant",
        p.reorder_point AS "reorderPoint",
        COALESCE(SUM(b.quantity_on_hand), 0) AS "onHand",
        (p.reorder_point - COALESCE(SUM(b.quantity_on_hand), 0)) AS "shortfall"
      FROM inventory.parts AS p
      LEFT JOIN inventory.stock_lots AS l
        ON l.part_id = p.id
       AND l.lot_state = 'AVAILABLE'
      LEFT JOIN inventory.inventory_balances AS b
        ON b.stock_lot_id = l.id
      WHERE p.deleted_at IS NULL
        AND p.part_state = 'ACTIVE'
        AND p.reorder_point > 0
      GROUP BY p.id, p.sku, p.name, p.variant, p.reorder_point
      HAVING COALESCE(SUM(b.quantity_on_hand), 0) < p.reorder_point
      ORDER BY "shortfall" DESC, p.sku ASC
      LIMIT ${limit}
    `;
  },

  listOpenPurchaseOrders(limit: number): Promise<PurchaseOrderRow[]> {
    return prisma.purchaseOrder.findMany({
      where: { purchaseOrderState: { in: ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'] } },
      orderBy: [{ expectedAt: 'asc' }, { updatedAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        poNumber: true,
        purchaseOrderState: true,
        expectedAt: true,
        vendor: { select: { vendorName: true } },
      },
    });
  },

  listFailedInvoiceSyncs(limit: number): Promise<InvoiceSyncRow[]> {
    return prisma.invoiceSyncRecord.findMany({
      where: { state: 'FAILED' },
      orderBy: [{ attemptCount: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        invoiceNumber: true,
        state: true,
        attemptCount: true,
        lastErrorMessage: true,
        createdAt: true,
      },
    });
  },

  listPendingInvoiceSyncs(limit: number): Promise<InvoiceSyncRow[]> {
    return prisma.invoiceSyncRecord.findMany({
      where: { state: { in: ['PENDING', 'IN_PROGRESS'] } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        invoiceNumber: true,
        state: true,
        attemptCount: true,
        lastErrorMessage: true,
        createdAt: true,
      },
    });
  },

  listOpenReworkIssues(limit: number): Promise<ReworkIssueRow[]> {
    return prisma.reworkIssue.findMany({
      where: { state: { in: ['OPEN', 'IN_REVIEW', 'REOPENED'] } },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        workOrderId: true,
        title: true,
        severity: true,
        state: true,
        createdAt: true,
      },
    });
  },

  listOverdueTrainingAssignments(limit: number, now: Date): Promise<TrainingAssignmentRow[]> {
    return prisma.trainingAssignment.findMany({
      where: {
        assignmentStatus: { in: ['ASSIGNED', 'IN_PROGRESS'] },
        dueAt: { lt: now },
      },
      orderBy: { dueAt: 'asc' },
      take: limit,
      select: {
        id: true,
        employeeId: true,
        dueAt: true,
        assignmentStatus: true,
        module: { select: { moduleName: true } },
      },
    });
  },

  listRecentAuditEvents(limit: number): Promise<AuditEventRow[]> {
    return prisma.auditEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        action: true,
        entityType: true,
        createdAt: true,
      },
    });
  },
};

export const getWorkspaceTodayHandler = wrapHandler(
  async (ctx) => {
    const role = resolveWorkspaceRole(ctx);
    const generatedAt = new Date();
    const warnings: WorkspaceTodayResponse['warnings'] = [];

    const [
      blockedWork,
      unassignedTasks,
      shortages,
      purchaseOrders,
      failedSyncs,
      pendingSyncs,
      reworkIssues,
      trainingAssignments,
      auditEvents,
    ] = await Promise.all([
      safeLoad('work_orders.blocked', warnings, () =>
        workspaceTodayQueries.listBlockedWorkOrders(8),
      ),
      safeLoad('tickets.unassigned_tasks', warnings, () =>
        workspaceTodayQueries.listUnassignedReadyTasks(8),
      ),
      safeLoad('inventory.shortages', warnings, () => workspaceTodayQueries.listShortageParts(8)),
      safeLoad('purchasing.open_orders', warnings, () =>
        workspaceTodayQueries.listOpenPurchaseOrders(8),
      ),
      safeLoad('accounting.failed_syncs', warnings, () =>
        workspaceTodayQueries.listFailedInvoiceSyncs(8),
      ),
      safeLoad('accounting.pending_syncs', warnings, () =>
        workspaceTodayQueries.listPendingInvoiceSyncs(8),
      ),
      safeLoad('tickets.rework', warnings, () => workspaceTodayQueries.listOpenReworkIssues(8)),
      safeLoad('training.overdue', warnings, () =>
        workspaceTodayQueries.listOverdueTrainingAssignments(8, generatedAt),
      ),
      safeLoad('admin.audit', warnings, () => workspaceTodayQueries.listRecentAuditEvents(5)),
    ]);

    const allItems = [
      ...blockedWork.map(toBlockedWorkItem),
      ...unassignedTasks.map(toUnassignedTaskItem),
      ...shortages.map(toShortageItem),
      ...purchaseOrders.map(toPurchaseOrderItem),
      ...failedSyncs.map(toFailedSyncItem),
      ...pendingSyncs.map(toPendingSyncItem),
      ...reworkIssues.map(toReworkItem),
      ...trainingAssignments.map(toTrainingItem),
      ...auditEvents.map(toAuditItem),
    ];

    const items = allItems
      .filter((item) => isVisibleForRole(item, role))
      .sort(sortTodayItems)
      .slice(0, 12);

    const response: WorkspaceTodayResponse = {
      generatedAt: generatedAt.toISOString(),
      role,
      summary: {
        p1: items.filter((item) => item.severity === 'P1').length,
        p2: items.filter((item) => item.severity === 'P2').length,
        p3: items.filter((item) => item.severity === 'P3').length,
        total: items.length,
      },
      items,
      warnings,
    };

    return jsonResponse(200, response);
  },
  { requireAuth: false },
);

async function safeLoad<T>(
  source: string,
  warnings: WorkspaceTodayResponse['warnings'],
  load: () => Promise<T[]>,
): Promise<T[]> {
  try {
    return await load();
  } catch (error) {
    warnings.push({
      source,
      message: error instanceof Error ? error.message : 'Read failed.',
    });
    return [];
  }
}

function resolveWorkspaceRole(ctx: RequestContext): WorkspaceRole {
  const roleParam = ctx.event.queryStringParameters?.role?.trim();
  if (isWorkspaceRole(roleParam)) return roleParam;

  const roles = ctx.actorRoles.map((role) => role.toLowerCase());
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('accounting')) return 'accounting';
  if (roles.includes('manager') || roles.includes('shop_manager')) return 'manager';
  if (roles.includes('trainer')) return 'trainer';
  if (roles.includes('parts') || roles.includes('parts_manager')) return 'parts';
  return 'technician';
}

function isWorkspaceRole(value: string | undefined): value is WorkspaceRole {
  return (
    value === 'technician' ||
    value === 'manager' ||
    value === 'parts' ||
    value === 'trainer' ||
    value === 'accounting' ||
    value === 'admin'
  );
}

function toBlockedWorkItem(row: BlockedWorkOrderRow): WorkspaceTodayItem {
  return {
    id: `blocked-work-${row.id}`,
    module: 'work_orders',
    severity: 'P1',
    title: `${row.workOrderNumber} is blocked`,
    description: row.title,
    primaryHref: getRequiredErpRoute('blocked-work'),
    primaryAction: 'Review blocker',
    ownerRole: 'manager',
    dueAt: row.dueAt?.toISOString(),
    sourceType: 'work_order',
    sourceId: row.id,
    freshness: 'LIVE',
  };
}

function toUnassignedTaskItem(row: UnassignedTaskRow): WorkspaceTodayItem {
  return {
    id: `dispatch-task-${row.id}`,
    module: 'work_orders',
    severity: 'P2',
    title: 'Task waiting for assignment',
    description: `Routing step ${row.routingStepId} is ready but has no technician.`,
    primaryHref: getRequiredErpRoute('dispatch-board'),
    primaryAction: 'Assign task',
    ownerRole: 'manager',
    sourceType: 'technician_task',
    sourceId: row.id,
    freshness: 'LIVE',
  };
}

function toShortageItem(row: ShortagePartRow): WorkspaceTodayItem {
  const shortfall = Number(row.shortfall);
  const onHand = Number(row.onHand);
  const reorderPoint = Number(row.reorderPoint);
  const name = row.variant ? `${row.name} - ${row.variant}` : row.name;

  return {
    id: `shortage-${row.id}`,
    module: 'inventory',
    severity: shortfall >= Math.max(2, reorderPoint / 2) ? 'P1' : 'P2',
    title: `${row.sku} below minimum`,
    description: `${name}: ${onHand} on hand, ${reorderPoint} minimum.`,
    primaryHref: getRequiredErpRecordRoute('part', row.id),
    primaryAction: 'Review part',
    ownerRole: 'parts',
    sourceType: 'part',
    sourceId: row.id,
    freshness: 'LIVE',
  };
}

function toPurchaseOrderItem(row: PurchaseOrderRow): WorkspaceTodayItem {
  return {
    id: `purchase-order-${row.id}`,
    module: 'purchasing',
    severity: row.expectedAt && row.expectedAt.getTime() < Date.now() ? 'P1' : 'P2',
    title: `${row.poNumber} needs receiving follow-up`,
    description: `${row.vendor.vendorName} order is ${row.purchaseOrderState.toLowerCase().replace(/_/g, ' ')}.`,
    primaryHref: getRequiredErpRoute('receiving'),
    primaryAction: 'Open receiving',
    ownerRole: 'parts',
    dueAt: row.expectedAt?.toISOString(),
    sourceType: 'purchase_order',
    sourceId: row.id,
    freshness: 'LIVE',
  };
}

function toFailedSyncItem(row: InvoiceSyncRow): WorkspaceTodayItem {
  return {
    id: `qb-failure-${row.id}`,
    module: 'accounting',
    severity: row.attemptCount >= 3 ? 'P1' : 'P2',
    title: `${row.invoiceNumber} failed QuickBooks sync`,
    description: row.lastErrorMessage ?? `${row.attemptCount} sync attempt(s) failed.`,
    primaryHref: getRequiredErpRoute('accounting-sync', { view: 'failures' }),
    primaryAction: 'Review sync',
    ownerRole: 'accounting',
    sourceType: 'invoice_sync',
    sourceId: row.id,
    freshness: 'LIVE',
  };
}

function toPendingSyncItem(row: InvoiceSyncRow): WorkspaceTodayItem {
  return {
    id: `qb-pending-${row.id}`,
    module: 'accounting',
    severity: 'P3',
    title: `${row.invoiceNumber} is queued for QuickBooks`,
    description: `Current state: ${row.state.toLowerCase().replace(/_/g, ' ')}.`,
    primaryHref: getRequiredErpRoute('accounting-sync', { view: 'queue' }),
    primaryAction: 'Open sync monitor',
    ownerRole: 'accounting',
    sourceType: 'invoice_sync',
    sourceId: row.id,
    freshness: 'LIVE',
  };
}

function toReworkItem(row: ReworkIssueRow): WorkspaceTodayItem {
  return {
    id: `rework-${row.id}`,
    module: 'work_orders',
    severity: row.severity === 'CRITICAL' || row.severity === 'HIGH' ? 'P1' : 'P2',
    title: row.title,
    description: `Rework is ${row.state.toLowerCase().replace(/_/g, ' ')} for a work order.`,
    primaryHref: getRequiredErpRoute('blocked-work'),
    primaryAction: 'Review rework',
    ownerRole: 'manager',
    sourceType: 'rework_issue',
    sourceId: row.id,
    freshness: 'LIVE',
  };
}

function toTrainingItem(row: TrainingAssignmentRow): WorkspaceTodayItem {
  return {
    id: `training-${row.id}`,
    module: 'training',
    severity: 'P2',
    title: `${row.module.moduleName} is overdue`,
    description: `Assignment is still ${row.assignmentStatus.toLowerCase().replace(/_/g, ' ')}.`,
    primaryHref: getRequiredErpRoute('training-assignment'),
    primaryAction: 'Review assignment',
    ownerRole: 'trainer',
    dueAt: row.dueAt?.toISOString(),
    sourceType: 'training_assignment',
    sourceId: row.id,
    freshness: 'LIVE',
  };
}

function toAuditItem(row: AuditEventRow): WorkspaceTodayItem {
  return {
    id: `audit-${row.id}`,
    module: 'admin',
    severity: 'P3',
    title: `${row.entityType} activity logged`,
    description: row.action,
    primaryHref: getRequiredErpRoute('audit-trail'),
    primaryAction: 'Open audit trail',
    ownerRole: 'admin',
    sourceType: 'audit_event',
    sourceId: row.id,
    freshness: 'LIVE',
  };
}

function isVisibleForRole(item: WorkspaceTodayItem, role: WorkspaceRole): boolean {
  if (role === 'admin') return true;
  if (item.ownerRole === role) return true;
  if (role === 'technician') {
    return item.module === 'work_orders' && item.severity !== 'P3';
  }
  if (role === 'manager') {
    return (
      item.module === 'work_orders' ||
      item.module === 'inventory' ||
      item.module === 'purchasing' ||
      item.module === 'training'
    );
  }
  return false;
}

function sortTodayItems(a: WorkspaceTodayItem, b: WorkspaceTodayItem): number {
  const severityDelta = severityWeight(a.severity) - severityWeight(b.severity);
  if (severityDelta !== 0) return severityDelta;
  const aDue = a.dueAt ? Date.parse(a.dueAt) : Number.MAX_SAFE_INTEGER;
  const bDue = b.dueAt ? Date.parse(b.dueAt) : Number.MAX_SAFE_INTEGER;
  if (aDue !== bDue) return aDue - bDue;
  return a.title.localeCompare(b.title);
}

function severityWeight(severity: TodaySeverity): number {
  if (severity === 'P1') return 1;
  if (severity === 'P2') return 2;
  return 3;
}
