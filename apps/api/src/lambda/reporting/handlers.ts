import { PrismaClient, type WoStatus } from '@prisma/client';
import {
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
