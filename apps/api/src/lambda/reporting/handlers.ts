import { PrismaClient, type WoStatus } from '@prisma/client';
import {
  type ErpBlockedAlert,
  type ErpBlockedAlertFeed,
  type ErpBlockedAlertSeverity,
  type ErpBlockedAlertTriageActionType,
  type ErpBlockedAlertTriageEvent,
  type ErpBlockedAlertTriageResult,
  type ErpBlockedAlertTriageState,
  type ErpReportDeliveryFormat,
  type ErpReportExportRun,
  type ErpReportExportRunList,
  type ErpReportExportRunRequest,
  type ErpReportExportRunStatus,
  type ErpReportSubscription,
  type ErpReportSubscriptionCadence,
  type ErpReportSubscriptionList,
  getLiveErpReports,
  getMissingReportingSnapshotKeys,
  getErpSavedReportViews,
  getErpReportByKey,
  type ErpReportBlockedWorkOrder,
  type ErpReportMetricTone,
  type ErpReportingSnapshot,
} from '@gg-erp/domain';
import { qbStatusHandler } from '../accounting/handlers.js';
import { jsonResponse, parseBody, wrapHandler } from '../../shared/lambda/index.js';

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

interface BlockedAlertTriageInput {
  note?: unknown;
  ownerRole?: unknown;
}

interface ReportSubscriptionInput {
  viewKey?: unknown;
  cadence?: unknown;
  timezone?: unknown;
  enabled?: unknown;
}

interface ReportSubscriptionUpdateInput {
  cadence?: unknown;
  timezone?: unknown;
  enabled?: unknown;
}

interface ReportExportRow {
  viewKey: string;
  viewLabel: string;
  reportKey: string;
  reportLabel: string;
  category: string;
  cadence: string;
  metricValue: string;
  metricLabel: string;
  freshnessStatus: string;
  freshnessMessage: string;
  lastSuccessfulAt: string;
  drillThroughRoute: string;
  generatedAt: string;
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
    const taskWorkOrdersById = new Map(
      taskWorkOrders.map((workOrder) => [workOrder.id, workOrder]),
    );

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

    const alerts = rows
      .map(toBlockedAlert)
      .sort(
        (a, b) =>
          severityRank(a.severity) - severityRank(b.severity) || b.ageMinutes - a.ageMinutes,
      )
      .slice(0, limit);

    const latestTriage = await reportingSnapshotQueries.listLatestBlockedAlertTriage(
      alerts.map((alert) => alert.id),
    );
    return alerts.map((alert) => applyBlockedAlertTriage(alert, latestTriage.get(alert.id)));
  },

  async listLatestBlockedAlertTriage(
    alertIds: string[],
  ): Promise<Map<string, ErpBlockedAlertTriageEvent>> {
    if (alertIds.length === 0) return new Map();
    const events = await prisma.blockedAlertTriageEvent.findMany({
      where: { alertId: { in: alertIds } },
      orderBy: [{ createdAt: 'desc' }],
    });
    const latest = new Map<string, ErpBlockedAlertTriageEvent>();
    for (const event of events) {
      if (latest.has(event.alertId)) continue;
      latest.set(event.alertId, toBlockedAlertTriageEvent(event));
    }
    return latest;
  },

  async recordBlockedAlertTriageAction(input: {
    alert: ErpBlockedAlert;
    action: ErpBlockedAlertTriageActionType;
    actorId?: string;
    note?: string;
    ownerRole?: string;
    correlationId: string;
  }): Promise<ErpBlockedAlertTriageEvent> {
    const event = await prisma.blockedAlertTriageEvent.create({
      data: {
        alertId: input.alert.id,
        sourceType: input.alert.sourceType,
        sourceId: input.alert.sourceId,
        action: input.action,
        actorId: input.actorId,
        note: input.note,
        ownerRole: input.ownerRole ?? input.alert.ownerRole,
        correlationId: input.correlationId,
      },
    });
    return toBlockedAlertTriageEvent(event);
  },

  async listReportSubscriptions(): Promise<ErpReportSubscription[]> {
    const rows = await prisma.reportSubscription.findMany({
      orderBy: [{ enabled: 'desc' }, { nextRunAt: 'asc' }, { updatedAt: 'desc' }],
    });
    return rows.map(toReportSubscription);
  },

  async getReportSubscription(id: string): Promise<ErpReportSubscription | null> {
    const row = await prisma.reportSubscription.findUnique({ where: { id } });
    return row ? toReportSubscription(row) : null;
  },

  async createReportSubscription(input: {
    viewKey: string;
    cadence: ErpReportSubscriptionCadence;
    timezone: string;
    enabled: boolean;
    createdByUserId?: string;
    correlationId: string;
  }): Promise<ErpReportSubscription> {
    const nextRunAt = input.enabled ? nextScheduledRun(input.cadence) : null;
    const existing = await prisma.reportSubscription.findFirst({
      where: {
        viewKey: input.viewKey,
        cadence: input.cadence,
        createdByUserId: input.createdByUserId ?? null,
      },
    });
    const row = existing
      ? await prisma.reportSubscription.update({
          where: { id: existing.id },
          data: {
            timezone: input.timezone,
            enabled: input.enabled,
            nextRunAt,
            correlationId: input.correlationId,
          },
        })
      : await prisma.reportSubscription.create({
          data: {
            viewKey: input.viewKey,
            cadence: input.cadence,
            timezone: input.timezone,
            enabled: input.enabled,
            createdByUserId: input.createdByUserId,
            nextRunAt,
            correlationId: input.correlationId,
          },
        });
    return toReportSubscription(row);
  },

  async updateReportSubscription(input: {
    id: string;
    cadence?: ErpReportSubscriptionCadence;
    timezone?: string;
    enabled?: boolean;
    correlationId: string;
  }): Promise<ErpReportSubscription | null> {
    const current = await prisma.reportSubscription.findUnique({ where: { id: input.id } });
    if (!current) return null;
    const cadence = input.cadence ?? (current.cadence as ErpReportSubscriptionCadence);
    const enabled = input.enabled ?? current.enabled;
    const row = await prisma.reportSubscription.update({
      where: { id: input.id },
      data: {
        cadence,
        timezone: input.timezone ?? current.timezone,
        enabled,
        nextRunAt: enabled ? nextScheduledRun(cadence) : null,
        correlationId: input.correlationId,
      },
    });
    return toReportSubscription(row);
  },

  async listReportExportRuns(limit: number): Promise<ErpReportExportRun[]> {
    const rows = await prisma.reportExportRun.findMany({
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
    });
    return rows.map(toReportExportRun);
  },

  async createReportExportRun(input: {
    subscriptionId?: string;
    viewKey: string;
    requestedByUserId?: string;
    scheduledFor: Date;
    filename: string;
    correlationId: string;
  }): Promise<ErpReportExportRun> {
    const row = await prisma.reportExportRun.create({
      data: {
        subscriptionId: input.subscriptionId,
        viewKey: input.viewKey,
        status: 'RUNNING',
        requestedByUserId: input.requestedByUserId,
        scheduledFor: input.scheduledFor,
        startedAt: new Date(),
        filename: input.filename,
        correlationId: input.correlationId,
      },
    });
    return toReportExportRun(row);
  },

  async completeReportExportRun(input: {
    id: string;
    status: Extract<ErpReportExportRunStatus, 'SUCCEEDED' | 'FAILED'>;
    rowCount?: number;
    csvText?: string;
    failureMessage?: string;
  }): Promise<ErpReportExportRun> {
    const row = await prisma.reportExportRun.update({
      where: { id: input.id },
      data: {
        status: input.status,
        completedAt: new Date(),
        rowCount: input.rowCount ?? 0,
        csvText: input.csvText,
        failureMessage: input.failureMessage,
      },
    });
    return toReportExportRun(row);
  },

  async markSubscriptionExportResult(input: {
    subscriptionId: string;
    cadence: ErpReportSubscriptionCadence;
    status: ErpReportExportRunStatus;
  }): Promise<void> {
    await prisma.reportSubscription.update({
      where: { id: input.subscriptionId },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: input.status,
        nextRunAt: input.status === 'SUCCEEDED' ? nextScheduledRun(input.cadence) : undefined,
      },
    });
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

export async function buildReportingSnapshot(): Promise<ErpReportingSnapshot> {
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

  return response;
}

export const getReportingSnapshotHandler = wrapHandler(
  async () => jsonResponse(200, await buildReportingSnapshot()),
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
      acknowledged: items.filter((item) => item.triageState === 'ACKNOWLEDGED').length,
      escalated: items.filter((item) => item.triageState === 'ESCALATED').length,
      averageAgeMinutes: items.length > 0 ? Math.round(totalAge / items.length) : 0,
      oldestAgeMinutes: items.reduce((oldest, item) => Math.max(oldest, item.ageMinutes), 0),
    };

    return jsonResponse(200, { generatedAt, summary, items } satisfies ErpBlockedAlertFeed);
  },
  { requireAuth: false },
);

export const recordBlockedAlertTriageActionHandler = wrapHandler(
  async (ctx) => {
    const route = resolveBlockedAlertActionRoute(ctx.event);
    if (!route) {
      return jsonResponse(400, {
        message: 'Blocked alert action route must include an alert ID and action.',
      });
    }

    const parsed = parseBody<BlockedAlertTriageInput>(ctx.event);
    if (!parsed.ok) return jsonResponse(400, { message: parsed.error });

    const note = normalizeOptionalText(parsed.value.note, 'note', 1000);
    if (!note.ok) return jsonResponse(422, { message: note.error });

    const ownerRole = normalizeOptionalText(parsed.value.ownerRole, 'ownerRole', 80);
    if (!ownerRole.ok) return jsonResponse(422, { message: ownerRole.error });

    const activeAlerts = await reportingSnapshotQueries.listBlockedAlerts(500);
    const alert = activeAlerts.find((item) => item.id === route.alertId);
    if (!alert) {
      return jsonResponse(404, {
        message: `Blocked alert is no longer active: ${route.alertId}`,
      });
    }

    const event = await reportingSnapshotQueries.recordBlockedAlertTriageAction({
      alert,
      action: route.action,
      actorId: ctx.actorUserId,
      note: note.value,
      ownerRole: ownerRole.value,
      correlationId: ctx.correlationId,
    });

    return jsonResponse(200, {
      alertId: alert.id,
      triageState: triageStateForAction(event.action),
      event,
    } satisfies ErpBlockedAlertTriageResult);
  },
  { requireAuth: false },
);

export const listReportSubscriptionsHandler = wrapHandler(
  async () => {
    const items = await reportingSnapshotQueries.listReportSubscriptions();
    return jsonResponse(200, {
      generatedAt: new Date().toISOString(),
      items,
    } satisfies ErpReportSubscriptionList);
  },
  { requireAuth: false },
);

export const createReportSubscriptionHandler = wrapHandler(
  async (ctx) => {
    const parsed = parseBody<ReportSubscriptionInput>(ctx.event);
    if (!parsed.ok) return jsonResponse(400, { message: parsed.error });

    const view = resolveSavedReportView(parsed.value.viewKey);
    if (!view) return jsonResponse(422, { message: 'viewKey must reference a saved report view.' });

    const cadence = normalizeSubscriptionCadence(parsed.value.cadence, view.cadence);
    if (!cadence.ok) return jsonResponse(422, { message: cadence.error });

    const timezone = normalizeTimezone(parsed.value.timezone, 'America/New_York');
    if (!timezone.ok) return jsonResponse(422, { message: timezone.error });

    const enabled = normalizeOptionalBoolean(parsed.value.enabled, true);
    if (!enabled.ok) return jsonResponse(422, { message: enabled.error });

    const subscription = await reportingSnapshotQueries.createReportSubscription({
      viewKey: view.key,
      cadence: cadence.value ?? 'daily',
      timezone: timezone.value ?? 'America/New_York',
      enabled: enabled.value ?? true,
      createdByUserId: ctx.actorUserId,
      correlationId: ctx.correlationId,
    });

    return jsonResponse(201, subscription);
  },
  { requireAuth: false },
);

export const updateReportSubscriptionHandler = wrapHandler(
  async (ctx) => {
    const subscriptionId = resolvePathParameter(ctx.event, 'subscriptionId');
    if (!subscriptionId) {
      return jsonResponse(400, { message: 'subscriptionId is required.' });
    }

    const parsed = parseBody<ReportSubscriptionUpdateInput>(ctx.event);
    if (!parsed.ok) return jsonResponse(400, { message: parsed.error });

    const cadence = normalizeSubscriptionCadence(parsed.value.cadence);
    if (!cadence.ok) return jsonResponse(422, { message: cadence.error });

    const timezone = normalizeTimezone(parsed.value.timezone);
    if (!timezone.ok) return jsonResponse(422, { message: timezone.error });

    const enabled = normalizeOptionalBoolean(parsed.value.enabled);
    if (!enabled.ok) return jsonResponse(422, { message: enabled.error });

    const subscription = await reportingSnapshotQueries.updateReportSubscription({
      id: subscriptionId,
      cadence: cadence.value,
      timezone: timezone.value,
      enabled: enabled.value,
      correlationId: ctx.correlationId,
    });

    if (!subscription) {
      return jsonResponse(404, { message: `Report subscription not found: ${subscriptionId}` });
    }

    return jsonResponse(200, subscription);
  },
  { requireAuth: false },
);

export const listReportExportRunsHandler = wrapHandler(
  async (ctx) => {
    const limit = clampInt(ctx.event.queryStringParameters?.limit, 1, 100, 20);
    const items = await reportingSnapshotQueries.listReportExportRuns(limit);
    return jsonResponse(200, {
      generatedAt: new Date().toISOString(),
      items,
    } satisfies ErpReportExportRunList);
  },
  { requireAuth: false },
);

export const runReportExportNowHandler = wrapHandler(
  async (ctx) => {
    const parsed = parseBody<ErpReportExportRunRequest>(ctx.event);
    if (!parsed.ok) return jsonResponse(400, { message: parsed.error });

    const subscription = parsed.value.subscriptionId
      ? await reportingSnapshotQueries.getReportSubscription(parsed.value.subscriptionId)
      : null;
    if (parsed.value.subscriptionId && !subscription) {
      return jsonResponse(404, {
        message: `Report subscription not found: ${parsed.value.subscriptionId}`,
      });
    }

    const view = resolveSavedReportView(subscription?.viewKey ?? parsed.value.viewKey);
    if (!view) {
      return jsonResponse(422, {
        message: 'subscriptionId or viewKey must reference a saved report view.',
      });
    }

    const filename = reportExportFilename(view.exportFilename, new Date());
    const run = await reportingSnapshotQueries.createReportExportRun({
      subscriptionId: subscription?.id,
      viewKey: view.key,
      requestedByUserId: ctx.actorUserId,
      scheduledFor: new Date(),
      filename,
      correlationId: ctx.correlationId,
    });

    try {
      const snapshot = await buildReportingSnapshot();
      const rows = buildSavedViewExportRows(view, snapshot);
      const csvText = toCsv(rows, [
        'viewKey',
        'viewLabel',
        'reportKey',
        'reportLabel',
        'category',
        'cadence',
        'metricValue',
        'metricLabel',
        'freshnessStatus',
        'freshnessMessage',
        'lastSuccessfulAt',
        'drillThroughRoute',
        'generatedAt',
      ]);
      const completed = await reportingSnapshotQueries.completeReportExportRun({
        id: run.id,
        status: 'SUCCEEDED',
        rowCount: rows.length,
        csvText,
      });
      if (subscription) {
        await reportingSnapshotQueries.markSubscriptionExportResult({
          subscriptionId: subscription.id,
          cadence: subscription.cadence,
          status: 'SUCCEEDED',
        });
      }
      return jsonResponse(201, completed);
    } catch (error) {
      const failureMessage =
        error instanceof Error ? error.message : 'Report export failed during snapshot generation.';
      const failed = await reportingSnapshotQueries.completeReportExportRun({
        id: run.id,
        status: 'FAILED',
        failureMessage,
      });
      if (subscription) {
        await reportingSnapshotQueries.markSubscriptionExportResult({
          subscriptionId: subscription.id,
          cadence: subscription.cadence,
          status: 'FAILED',
        });
      }
      return jsonResponse(500, failed);
    }
  },
  { requireAuth: false },
);

function toReportSubscription(row: {
  id: string;
  viewKey: string;
  cadence: string;
  timezone: string;
  format: string;
  enabled: boolean;
  createdByUserId: string | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ErpReportSubscription {
  const view = resolveSavedReportView(row.viewKey);
  return {
    id: row.id,
    viewKey: row.viewKey,
    viewLabel: view?.label ?? row.viewKey,
    cadence: row.cadence as ErpReportSubscriptionCadence,
    timezone: row.timezone,
    format: row.format as ErpReportDeliveryFormat,
    enabled: row.enabled,
    createdByUserId: row.createdByUserId ?? undefined,
    nextRunAt: row.nextRunAt?.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString(),
    lastRunStatus: (row.lastRunStatus as ErpReportExportRunStatus | null) ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toReportExportRun(row: {
  id: string;
  subscriptionId: string | null;
  viewKey: string;
  status: string;
  format: string;
  requestedByUserId: string | null;
  scheduledFor: Date;
  startedAt: Date;
  completedAt: Date | null;
  rowCount: number;
  filename: string;
  csvText: string | null;
  failureMessage: string | null;
  createdAt: Date;
}): ErpReportExportRun {
  const view = resolveSavedReportView(row.viewKey);
  return {
    id: row.id,
    subscriptionId: row.subscriptionId ?? undefined,
    viewKey: row.viewKey,
    viewLabel: view?.label ?? row.viewKey,
    status: row.status as ErpReportExportRunStatus,
    format: row.format as ErpReportDeliveryFormat,
    requestedByUserId: row.requestedByUserId ?? undefined,
    scheduledFor: row.scheduledFor.toISOString(),
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    rowCount: row.rowCount,
    filename: row.filename,
    csvText: row.csvText ?? undefined,
    failureMessage: row.failureMessage ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

function resolveSavedReportView(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return getErpSavedReportViews().find((view) => view.key === value.trim());
}

function normalizeSubscriptionCadence(
  value: unknown,
  fallback?: string,
): { ok: true; value?: ErpReportSubscriptionCadence } | { ok: false; error: string } {
  const raw = value === undefined || value === null || value === '' ? fallback : value;
  if (raw === undefined || raw === null || raw === '') return { ok: true };
  if (raw === 'daily' || raw === 'weekly' || raw === 'monthly') {
    return { ok: true, value: raw };
  }
  return { ok: false, error: 'cadence must be daily, weekly, or monthly.' };
}

function normalizeTimezone(
  value: unknown,
  fallback?: string,
): { ok: true; value?: string } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') {
    return fallback ? { ok: true, value: fallback } : { ok: true };
  }
  if (typeof value !== 'string') return { ok: false, error: 'timezone must be a string.' };
  const trimmed = value.trim();
  if (!trimmed) return fallback ? { ok: true, value: fallback } : { ok: true };
  if (!/^[A-Za-z0-9_/-]{1,64}$/.test(trimmed)) {
    return { ok: false, error: 'timezone must be an IANA-style timezone name.' };
  }
  return { ok: true, value: trimmed };
}

function normalizeOptionalBoolean(
  value: unknown,
  fallback?: boolean,
): { ok: true; value?: boolean } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return fallback === undefined ? { ok: true } : { ok: true, value: fallback };
  }
  if (typeof value !== 'boolean') return { ok: false, error: 'enabled must be a boolean.' };
  return { ok: true, value };
}

function resolvePathParameter(
  event: {
    pathParameters?: Record<string, string | undefined> | null;
    path?: string;
    rawPath?: string;
  },
  name: string,
): string | undefined {
  const direct = event.pathParameters?.[name];
  if (direct) return decodePathSegment(direct);
  const path = event.path ?? event.rawPath ?? '';
  const match = /^\/reporting\/subscriptions\/([^/]+)$/.exec(path);
  return match ? decodePathSegment(match[1]!) : undefined;
}

function nextScheduledRun(cadence: ErpReportSubscriptionCadence, from = new Date()): Date {
  const next = new Date(from);
  if (cadence === 'daily') next.setUTCDate(next.getUTCDate() + 1);
  if (cadence === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
  if (cadence === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCSeconds(0, 0);
  return next;
}

function buildSavedViewExportRows(
  view: ReturnType<typeof getErpSavedReportViews>[number],
  snapshot: ErpReportingSnapshot,
): ReportExportRow[] {
  return view.reportKeys.map((reportKey) => {
    const report = getErpReportByKey(reportKey);
    const metric = snapshot.metrics[reportKey];
    const freshness = snapshot.freshness[reportKey];
    return {
      viewKey: view.key,
      viewLabel: view.label,
      reportKey,
      reportLabel: report?.label ?? reportKey,
      category: report?.category ?? view.category,
      cadence: report?.cadence ?? view.cadence,
      metricValue: metric?.value ?? '',
      metricLabel: metric?.label ?? report?.metricLabel ?? '',
      freshnessStatus: freshness?.status ?? 'ERROR',
      freshnessMessage: freshness?.message ?? '',
      lastSuccessfulAt: freshness?.lastSuccessfulAt ?? '',
      drillThroughRoute: report?.route ?? view.route,
      generatedAt: snapshot.generatedAt,
    };
  });
}

function reportExportFilename(exportFilename: string, generatedAt: Date): string {
  const date = generatedAt.toISOString().slice(0, 10);
  const safeName = exportFilename
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${safeName || 'report-export'}-${date}.csv`;
}

function toCsv<T>(rows: readonly T[], columns: readonly (keyof T)[]): string {
  const header = columns.map((column) => escapeCsvCell(String(column))).join(',');
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(row[column])).join(','));
  return [header, ...body].join('\n');
}

function escapeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

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
    triageState: 'OPEN',
  };
}

function applyBlockedAlertTriage(
  alert: ErpBlockedAlert,
  event: ErpBlockedAlertTriageEvent | undefined,
): ErpBlockedAlert {
  if (!event) return alert;
  return {
    ...alert,
    triageState: triageStateForAction(event.action),
    lastTriageAction: event.action,
    lastTriagedAt: event.createdAt,
    lastTriagedBy: event.actorId,
    lastTriageNote: event.note,
  };
}

function toBlockedAlertTriageEvent(event: {
  id: string;
  alertId: string;
  action: string;
  actorId: string | null;
  note: string | null;
  ownerRole: string | null;
  createdAt: Date;
}): ErpBlockedAlertTriageEvent {
  return {
    id: event.id,
    alertId: event.alertId,
    action: event.action as ErpBlockedAlertTriageActionType,
    actorId: event.actorId ?? undefined,
    note: event.note ?? undefined,
    ownerRole: event.ownerRole ?? undefined,
    createdAt: event.createdAt.toISOString(),
  };
}

function triageStateForAction(action: ErpBlockedAlertTriageActionType): ErpBlockedAlertTriageState {
  return action === 'ESCALATE' ? 'ESCALATED' : 'ACKNOWLEDGED';
}

function resolveBlockedAlertActionRoute(event: {
  pathParameters?: Record<string, string | undefined> | null;
  path?: string;
  rawPath?: string;
}): { alertId: string; action: ErpBlockedAlertTriageActionType } | null {
  const pathAction = event.pathParameters?.action?.toLowerCase();
  const pathAlertId = event.pathParameters?.alertId;
  if (pathAction && pathAlertId) {
    const action = toBlockedAlertTriageAction(pathAction);
    if (!action) return null;
    return { alertId: decodePathSegment(pathAlertId), action };
  }

  const path = event.path ?? event.rawPath ?? '';
  const match = /^\/reporting\/blocked-alerts\/([^/]+)\/(acknowledge|escalate)$/.exec(path);
  if (!match) return null;
  const action = toBlockedAlertTriageAction(match[2]!);
  if (!action) return null;
  return { alertId: decodePathSegment(match[1]!), action };
}

function toBlockedAlertTriageAction(value: string): ErpBlockedAlertTriageActionType | null {
  if (value.toLowerCase() === 'acknowledge') return 'ACKNOWLEDGE';
  if (value.toLowerCase() === 'escalate') return 'ESCALATE';
  return null;
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeOptionalText(
  value: unknown,
  field: string,
  maxLength: number,
): { ok: true; value?: string } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a string.` };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true };
  if (trimmed.length > maxLength) {
    return { ok: false, error: `${field} must be ${maxLength} characters or less.` };
  }
  return { ok: true, value: trimmed };
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

function nextBlockedAlertAction(
  reasonCode: string,
  sourceType: ErpBlockedAlert['sourceType'],
): string {
  if (reasonCode === 'WAITING_PARTS')
    return 'Confirm part availability, PO status, or substitution path.';
  if (reasonCode === 'CUSTOMER_HOLD')
    return 'Confirm customer decision or sales/account owner follow-up.';
  if (reasonCode === 'SAFETY_CONCERN') return 'Escalate to shop manager before restarting work.';
  if (sourceType === 'TECHNICIAN_TASK')
    return 'Assign owner and resolve the technician task blocker.';
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

function ownerForReason(
  reason?: string | null,
): Pick<BlockedAlertSourceRow, 'ownerRole' | 'ownerLabel'> {
  const code = classifyBlockedReason(reason);
  if (code === 'WAITING_PARTS')
    return { ownerRole: 'parts_coordinator', ownerLabel: 'Parts Coordinator' };
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
