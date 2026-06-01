import { PrismaClient, type WoStatus } from '@prisma/client';
import {
  type ErpBlockedAlert,
  type ErpBlockedAlertFeed,
  type ErpBlockedAlertSeverity,
  getLiveErpReports,
  getMissingReportingSnapshotKeys,
  type ErpReportBlockedWorkOrder,
  type ErpReportMetricTone,
  type ErpReportingSnapshot,
} from '@gg-erp/domain';
import { qbStatusHandler } from '../accounting/handlers.js';
import { jsonResponse, wrapHandler } from '../../shared/lambda/index.js';

const prisma = new PrismaClient();

type Warning = ErpReportingSnapshot['warnings'][number];

export interface ReportingBlockedWorkOrderRow {
  id: string;
  workOrderNumber: string;
  title: string;
}

export interface ReportingSalesForecastSummary {
  dealCount: number;
  weightedForecast: number;
}

export interface ReportingOpenArSummary {
  openInvoiceCount: number;
  openInvoiceBalance: number;
}

interface BlockedAlertSourceRow {
  id: string;
  sourceType: ErpBlockedAlert['sourceType'];
  workOrderId: string;
  workOrderNumber: string;
  workOrderTitle: string;
  customerReference?: string | null;
  assetReference?: string | null;
  reason?: string | null;
  reasonCode: string;
  ownerRole: string;
  ownerLabel: string;
  updatedAt: Date;
}

interface CountRow {
  count: number | bigint | string;
}

const OPEN_OPPORTUNITY_STAGES = ['PROSPECT', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION'] as const;

export const reportingSnapshotQueries = {
  countWorkOrders(status: WoStatus): Promise<number> {
    return prisma.woOrder.count({ where: { status } });
  },

  listBlockedWorkOrders(limit: number): Promise<ReportingBlockedWorkOrderRow[]> {
    return prisma.woOrder.findMany({
      where: { status: 'BLOCKED' },
      orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        workOrderNumber: true,
        title: true,
      },
    });
  },

  async listBlockedAlerts(limit: number): Promise<ErpBlockedAlert[]> {
    const [blockedOrders, blockedOperations, blockedTasks, shortParts] = await Promise.all([
      prisma.woOrder.findMany({
        where: { status: 'BLOCKED' },
        orderBy: [{ priority: 'asc' }, { updatedAt: 'asc' }],
        take: limit,
        select: {
          id: true,
          workOrderNumber: true,
          title: true,
          customerReference: true,
          assetReference: true,
          priority: true,
          updatedAt: true,
        },
      }),
      prisma.woOperation.findMany({
        where: { operationStatus: 'BLOCKED' },
        orderBy: [{ updatedAt: 'asc' }],
        take: limit,
        select: {
          id: true,
          operationCode: true,
          operationName: true,
          blockingReason: true,
          requiredSkillCode: true,
          updatedAt: true,
          workOrder: {
            select: {
              id: true,
              workOrderNumber: true,
              title: true,
              customerReference: true,
              assetReference: true,
              priority: true,
            },
          },
        },
      }),
      prisma.technicianTask.findMany({
        where: { state: 'BLOCKED' },
        orderBy: [{ updatedAt: 'asc' }],
        take: limit,
        select: {
          id: true,
          workOrderId: true,
          routingStepId: true,
          technicianId: true,
          blockedReason: true,
          updatedAt: true,
        },
      }),
      prisma.woPartLine.findMany({
        where: { partStatus: 'SHORT' },
        orderBy: [{ updatedAt: 'asc' }],
        take: limit,
        select: {
          id: true,
          shortageReason: true,
          updatedAt: true,
          part: { select: { sku: true, name: true } },
          workOrder: {
            select: {
              id: true,
              workOrderNumber: true,
              title: true,
              customerReference: true,
              assetReference: true,
              priority: true,
            },
          },
        },
      }),
    ]);

    const blockedTaskWorkOrderIds = [...new Set(blockedTasks.map((task) => task.workOrderId))];
    const taskWorkOrders =
      blockedTaskWorkOrderIds.length === 0
        ? []
        : await prisma.woOrder.findMany({
            where: { id: { in: blockedTaskWorkOrderIds } },
            select: {
              id: true,
              workOrderNumber: true,
              title: true,
              customerReference: true,
              assetReference: true,
              priority: true,
            },
          });
    const taskWorkOrdersById = new Map(taskWorkOrders.map((workOrder) => [workOrder.id, workOrder]));

    const rows: BlockedAlertSourceRow[] = [
      ...blockedOrders.map((workOrder) => ({
        id: workOrder.id,
        sourceType: 'WORK_ORDER' as const,
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        workOrderTitle: workOrder.title,
        customerReference: workOrder.customerReference,
        assetReference: workOrder.assetReference,
        reason: 'Work order is blocked.',
        reasonCode: 'WORK_ORDER_BLOCKED',
        ownerRole: 'shop_manager',
        ownerLabel: 'Shop Manager',
        updatedAt: workOrder.updatedAt,
      })),
      ...blockedOperations.map((operation) => ({
        id: operation.id,
        sourceType: 'OPERATION' as const,
        workOrderId: operation.workOrder.id,
        workOrderNumber: operation.workOrder.workOrderNumber,
        workOrderTitle: workOrderLabel(operation.workOrder.title, operation.operationName),
        customerReference: operation.workOrder.customerReference,
        assetReference: operation.workOrder.assetReference,
        reason:
          operation.blockingReason ??
          `${operation.operationName || operation.operationCode} is blocked.`,
        reasonCode: classifyBlockedReason(operation.blockingReason ?? operation.requiredSkillCode),
        ...ownerForReason(operation.blockingReason ?? operation.requiredSkillCode),
        updatedAt: operation.updatedAt,
      })),
      ...blockedTasks.flatMap((task) => {
        const workOrder = taskWorkOrdersById.get(task.workOrderId);
        if (!workOrder) return [];
        return [
          {
            id: task.id,
            sourceType: 'TECHNICIAN_TASK' as const,
            workOrderId: workOrder.id,
            workOrderNumber: workOrder.workOrderNumber,
            workOrderTitle: workOrderLabel(workOrder.title, `Task ${task.routingStepId}`),
            customerReference: workOrder.customerReference,
            assetReference: workOrder.assetReference,
            reason: task.blockedReason ?? 'Technician task is blocked.',
            reasonCode: classifyBlockedReason(task.blockedReason),
            ownerRole: task.technicianId ? 'technician' : 'shop_manager',
            ownerLabel: task.technicianId ? 'Assigned Technician' : 'Shop Manager',
            updatedAt: task.updatedAt,
          },
        ];
      }),
      ...shortParts.map((partLine) => ({
        id: partLine.id,
        sourceType: 'PART_SHORTAGE' as const,
        workOrderId: partLine.workOrder.id,
        workOrderNumber: partLine.workOrder.workOrderNumber,
        workOrderTitle: workOrderLabel(partLine.workOrder.title, partLine.part.name),
        customerReference: partLine.workOrder.customerReference,
        assetReference: partLine.workOrder.assetReference,
        reason: partLine.shortageReason ?? `${partLine.part.sku} is short for this work order.`,
        reasonCode: 'WAITING_PARTS',
        ownerRole: 'parts_coordinator',
        ownerLabel: 'Parts Coordinator',
        updatedAt: partLine.updatedAt,
      })),
    ];

    return rows
      .map(toBlockedAlert)
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.ageMinutes - a.ageMinutes)
      .slice(0, limit);
  },

  async countShortageParts(): Promise<number> {
    const rows = await prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*) AS "count"
      FROM (
        SELECT p.id
        FROM inventory.parts AS p
        LEFT JOIN inventory.stock_lots AS l
          ON l.part_id = p.id
         AND l.lot_state = 'AVAILABLE'
        LEFT JOIN inventory.inventory_balances AS b
          ON b.stock_lot_id = l.id
        WHERE p.deleted_at IS NULL
          AND p.part_state = 'ACTIVE'
          AND p.reorder_point > 0
        GROUP BY p.id, p.reorder_point
        HAVING COALESCE(SUM(b.quantity_on_hand), 0) < p.reorder_point
      ) shortages
    `;
    return numberFromCountRows(rows);
  },

  async countOpenReservations(): Promise<number> {
    const rows = await prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*) AS "count"
      FROM inventory.inventory_reservations
      WHERE reservation_status IN ('ACTIVE', 'PARTIALLY_CONSUMED')
    `;
    return numberFromCountRows(rows);
  },

  async getSalesForecast(): Promise<ReportingSalesForecastSummary> {
    const opportunities = await prisma.salesOpportunity.findMany({
      where: {
        stage: { in: [...OPEN_OPPORTUNITY_STAGES] },
        expectedCloseDate: { not: null },
      },
      select: {
        estimatedValue: true,
        probability: true,
      },
    });

    return {
      dealCount: opportunities.length,
      weightedForecast: opportunities.reduce(
        (sum, opportunity) =>
          sum + Number(opportunity.estimatedValue ?? 0) * (opportunity.probability / 100),
        0,
      ),
    };
  },

  async getOpenAccountsReceivable(): Promise<ReportingOpenArSummary> {
    const response = await qbStatusHandler({
      httpMethod: 'GET',
      path: '/accounting/status',
      queryStringParameters: {},
    });
    if (response.statusCode >= 400) {
      throw new Error(`QuickBooks status returned HTTP ${response.statusCode}`);
    }

    const body = JSON.parse(response.body) as {
      connected: boolean;
      message?: string;
      overview?: {
        openInvoiceCount?: number;
        openInvoiceBalance?: number;
        error?: string;
      };
    };

    if (!body.connected) {
      throw new Error(body.message ?? 'QuickBooks is not connected.');
    }
    if (body.overview?.openInvoiceCount === undefined) {
      throw new Error(body.overview?.error ?? 'QuickBooks open AR summary unavailable.');
    }

    return {
      openInvoiceCount: body.overview.openInvoiceCount,
      openInvoiceBalance: body.overview.openInvoiceBalance ?? 0,
    };
  },

  countFailedInvoiceSyncs(): Promise<number> {
    return prisma.invoiceSyncRecord.count({ where: { state: 'FAILED' } });
  },

  countOverdueTrainingAssignments(now: Date): Promise<number> {
    return prisma.trainingAssignment.count({
      where: {
        assignmentStatus: { in: ['ASSIGNED', 'IN_PROGRESS'] },
        dueAt: { lt: now },
      },
    });
  },

  countDeniedAuditEvents(): Promise<number> {
    return prisma.auditEvent.count({
      where: { action: { contains: 'DENIED' } },
    });
  },
};

export const getReportingSnapshotHandler = wrapHandler(
  async () => {
    const generatedAt = new Date();
    const generatedAtIso = generatedAt.toISOString();
    const metrics: ErpReportingSnapshot['metrics'] = {};
    const freshness = Object.fromEntries(
      getLiveErpReports().map((report) => [
        report.key,
        {
          reportKey: report.key,
          source: report.sourceObjectKeys.join(','),
          status: 'STALE',
          generatedAt: generatedAtIso,
          message: 'Report source was not evaluated.',
        },
      ]),
    ) as ErpReportingSnapshot['freshness'];
    const warnings: Warning[] = [];
    const blockedWorkOrders: ErpReportBlockedWorkOrder[] = [];

    await Promise.all([
      captureMetric(
        'report-work-order-blockers',
        'work_orders.blocked',
        generatedAtIso,
        metrics,
        freshness,
        warnings,
        async () => {
          const [blockedRows, blockedCount] = await Promise.all([
            reportingSnapshotQueries.listBlockedWorkOrders(5),
            reportingSnapshotQueries.countWorkOrders('BLOCKED'),
          ]);
          blockedWorkOrders.push(
            ...blockedRows.map((row) => ({
              id: row.id,
              workOrderNumber: row.workOrderNumber,
              title: row.title,
            })),
          );
          return {
            value: String(blockedCount),
            label: 'blocked',
            tone: blockedCount > 0 ? 'red' : 'green',
          };
        },
      ),
      captureMetric(
        'report-active-shop-load',
        'work_orders.in_progress',
        generatedAtIso,
        metrics,
        freshness,
        warnings,
        async () => {
          const count = await reportingSnapshotQueries.countWorkOrders('IN_PROGRESS');
          return {
            value: String(count),
            label: 'in progress',
            tone: count > 0 ? 'amber' : 'green',
          };
        },
      ),
      captureMetric(
        'report-completed-work-orders',
        'work_orders.completed',
        generatedAtIso,
        metrics,
        freshness,
        warnings,
        async () => {
          const count = await reportingSnapshotQueries.countWorkOrders('COMPLETED');
          return {
            value: String(count),
            label: 'completed',
            tone: 'green',
          };
        },
      ),
      captureMetric(
        'report-material-shortages',
        'inventory.shortages',
        generatedAtIso,
        metrics,
        freshness,
        warnings,
        async () => {
          const count = await reportingSnapshotQueries.countShortageParts();
          return {
            value: String(count),
            label: 'below minimum',
            tone: count > 0 ? 'red' : 'green',
          };
        },
      ),
      captureMetric(
        'report-open-reservations',
        'inventory.reservations',
        generatedAtIso,
        metrics,
        freshness,
        warnings,
        async () => {
          const count = await reportingSnapshotQueries.countOpenReservations();
          return {
            value: String(count),
            label: 'open reservations',
            tone: count > 0 ? 'amber' : 'green',
          };
        },
      ),
      captureMetric(
        'report-sales-forecast',
        'sales.forecast',
        generatedAtIso,
        metrics,
        freshness,
        warnings,
        async () => {
          const forecast = await reportingSnapshotQueries.getSalesForecast();
          return {
            value:
              forecast.weightedForecast > 0
                ? formatCurrency(forecast.weightedForecast)
                : String(forecast.dealCount),
            label: forecast.weightedForecast > 0 ? 'weighted forecast' : 'forecast deals',
            tone: forecast.dealCount > 0 ? 'green' : 'neutral',
          };
        },
      ),
      captureMetric(
        'report-open-accounts-receivable',
        'quickbooks.open_ar',
        generatedAtIso,
        metrics,
        freshness,
        warnings,
        async () => {
          const ar = await reportingSnapshotQueries.getOpenAccountsReceivable();
          return {
            value: `${ar.openInvoiceCount} / ${formatCurrency(ar.openInvoiceBalance)}`,
            label: 'open invoices / balance',
            tone: ar.openInvoiceCount > 0 ? 'amber' : 'green',
          };
        },
      ),
      captureMetric(
        'report-quickbooks-sync-failures',
        'accounting.invoice_sync',
        generatedAtIso,
        metrics,
        freshness,
        warnings,
        async () => {
          const count = await reportingSnapshotQueries.countFailedInvoiceSyncs();
          return {
            value: String(count),
            label: 'failed syncs',
            tone: count > 0 ? 'red' : 'green',
          };
        },
      ),
      captureMetric(
        'report-overdue-training',
        'training.assignments',
        generatedAtIso,
        metrics,
        freshness,
        warnings,
        async () => {
          const count = await reportingSnapshotQueries.countOverdueTrainingAssignments(generatedAt);
          return {
            value: String(count),
            label: 'overdue',
            tone: count > 0 ? 'red' : 'green',
          };
        },
      ),
      captureMetric(
        'report-audit-events',
        'admin.audit',
        generatedAtIso,
        metrics,
        freshness,
        warnings,
        async () => {
          const count = await reportingSnapshotQueries.countDeniedAuditEvents();
          return {
            value: String(count),
            label: 'denied events',
            tone: count > 0 ? 'amber' : 'green',
          };
        },
      ),
    ]);

    const missingKeys = getMissingReportingSnapshotKeys({ metrics, freshness });
    if (missingKeys.length > 0) {
      warnings.push({
        source: 'reporting.coverage',
        message: `Snapshot missing report coverage for ${missingKeys.join(', ')}`,
      });
    }

    const response: ErpReportingSnapshot = {
      generatedAt: generatedAtIso,
      metrics,
      freshness,
      blockedWorkOrders,
      warnings,
    };

    return jsonResponse(200, response);
  },
  { requireAuth: false },
);

export const getBlockedAlertsHandler = wrapHandler(
  async (ctx) => {
    const limit = clampInt(ctx.event.queryStringParameters?.limit, 1, 100, 50);
    const items = await reportingSnapshotQueries.listBlockedAlerts(limit);
    const generatedAt = new Date().toISOString();
    const totalAge = items.reduce((sum, item) => sum + item.ageMinutes, 0);
    const summary: ErpBlockedAlertFeed['summary'] = {
      total: items.length,
      p1: items.filter((item) => item.severity === 'P1').length,
      p2: items.filter((item) => item.severity === 'P2').length,
      p3: items.filter((item) => item.severity === 'P3').length,
      unowned: items.filter((item) => item.ownerRole === 'shop_manager').length,
      averageAgeMinutes: items.length > 0 ? Math.round(totalAge / items.length) : 0,
      oldestAgeMinutes: items.reduce((oldest, item) => Math.max(oldest, item.ageMinutes), 0),
    };

    return jsonResponse(200, { generatedAt, summary, items } satisfies ErpBlockedAlertFeed);
  },
  { requireAuth: false },
);

function toBlockedAlert(row: BlockedAlertSourceRow): ErpBlockedAlert {
  const updatedAt = row.updatedAt.toISOString();
  const ageMinutes = Math.max(0, Math.floor((Date.now() - row.updatedAt.getTime()) / 60_000));
  const severity = blockedAlertSeverity(ageMinutes, row.reasonCode);
  const route = `/work-orders/${row.workOrderId}`;
  return {
    id: `${row.sourceType}:${row.id}`,
    sourceType: row.sourceType,
    sourceId: row.id,
    workOrderId: row.workOrderId,
    workOrderNumber: row.workOrderNumber,
    workOrderTitle: row.workOrderTitle,
    customerReference: row.customerReference ?? undefined,
    assetReference: row.assetReference ?? undefined,
    reason: row.reason?.trim() || 'Blocked item needs triage.',
    reasonCode: row.reasonCode,
    ownerRole: row.ownerRole,
    ownerLabel: row.ownerLabel,
    severity,
    ageMinutes,
    updatedAt,
    nextAction: nextBlockedAlertAction(row.reasonCode, row.sourceType),
    route,
    actions: blockedAlertActions(row.workOrderId, row.reasonCode),
  };
}

function blockedAlertActions(workOrderId: string, reasonCode: string) {
  const actions = [
    { label: 'Open work order', href: `/work-orders/${workOrderId}` },
    { label: 'Message team', href: `/messages?workOrder=${encodeURIComponent(workOrderId)}` },
  ];
  if (reasonCode === 'WAITING_PARTS') {
    actions.splice(1, 0, { label: 'Review parts', href: '/inventory/planning' });
  } else {
    actions.splice(1, 0, { label: 'Review dispatch', href: '/work-orders/dispatch' });
  }
  return actions;
}

function nextBlockedAlertAction(reasonCode: string, sourceType: ErpBlockedAlert['sourceType']): string {
  if (reasonCode === 'WAITING_PARTS') return 'Confirm part availability, PO status, or substitution path.';
  if (reasonCode === 'CUSTOMER_HOLD') return 'Confirm customer decision or sales/account owner follow-up.';
  if (reasonCode === 'SAFETY_CONCERN') return 'Escalate to shop manager before restarting work.';
  if (sourceType === 'TECHNICIAN_TASK') return 'Assign owner and resolve the technician task blocker.';
  return 'Assign an owner, resolve the blocker, then move the work back into execution.';
}

function blockedAlertSeverity(ageMinutes: number, reasonCode: string): ErpBlockedAlertSeverity {
  if (reasonCode === 'SAFETY_CONCERN' || ageMinutes >= 240) return 'P1';
  if (ageMinutes >= 60 || reasonCode === 'WAITING_PARTS') return 'P2';
  return 'P3';
}

function severityRank(severity: ErpBlockedAlertSeverity): number {
  if (severity === 'P1') return 1;
  if (severity === 'P2') return 2;
  return 3;
}

function ownerForReason(reason?: string | null): Pick<BlockedAlertSourceRow, 'ownerRole' | 'ownerLabel'> {
  const code = classifyBlockedReason(reason);
  if (code === 'WAITING_PARTS') return { ownerRole: 'parts_coordinator', ownerLabel: 'Parts Coordinator' };
  if (code === 'CUSTOMER_HOLD') return { ownerRole: 'sales', ownerLabel: 'Sales / Customer Owner' };
  if (code === 'SAFETY_CONCERN') return { ownerRole: 'shop_manager', ownerLabel: 'Shop Manager' };
  return { ownerRole: 'shop_manager', ownerLabel: 'Shop Manager' };
}

function classifyBlockedReason(reason?: string | null): string {
  const normalized = (reason ?? '').toLowerCase();
  if (/(part|vendor|po|purchase|stock|material)/.test(normalized)) return 'WAITING_PARTS';
  if (/(customer|approval|hold|quote)/.test(normalized)) return 'CUSTOMER_HOLD';
  if (/(safe|hazard|injury|fire|battery)/.test(normalized)) return 'SAFETY_CONCERN';
  if (/(tool|lift|fixture|equipment)/.test(normalized)) return 'TOOLING_ISSUE';
  return 'BLOCKED';
}

function workOrderLabel(workOrderTitle: string, childLabel: string): string {
  return childLabel ? `${workOrderTitle} - ${childLabel}` : workOrderTitle;
}

function clampInt(value: string | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function captureMetric(
  reportKey: string,
  source: string,
  generatedAt: string,
  metrics: ErpReportingSnapshot['metrics'],
  freshness: ErpReportingSnapshot['freshness'],
  warnings: Warning[],
  load: () => Promise<{ value: string; label: string; tone: ErpReportMetricTone }>,
): Promise<void> {
  try {
    const metric = await load();
    metrics[reportKey] = {
      ...metric,
      generatedAt,
      source,
    };
    freshness[reportKey] = {
      reportKey,
      source,
      status: 'LIVE',
      generatedAt,
      lastSuccessfulAt: generatedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reporting source unavailable.';
    freshness[reportKey] = {
      reportKey,
      source,
      status: 'ERROR',
      generatedAt,
      message,
    };
    warnings.push({ source, message });
  }
}

function numberFromCountRows(rows: CountRow[]): number {
  const value = rows[0]?.count ?? 0;
  return Number(value);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}
