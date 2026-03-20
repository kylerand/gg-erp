import { randomUUID } from 'node:crypto';
import type { PrismaClient, WorkOrderQcGate } from '@prisma/client';

export interface QcGateBatchSubmitInput {
  workOrderId: string;
  taskId?: string;
  reviewedBy: string;
  results: Array<{
    gateLabel: string;
    isCritical: boolean;
    result: 'PASS' | 'FAIL' | 'NA';
    failureNote?: string;
  }>;
  correlationId: string;
}

export interface QcGateBatchSubmitResult {
  gates: WorkOrderQcGate[];
  overallResult: 'PASSED' | 'FAILED';
  reworkIssuesCreated: number;
  activeReworkLoopCount: number;
}

export class QcGateService {
  constructor(private readonly db: PrismaClient) {}

  async getGates(params: { workOrderId: string; taskId?: string }): Promise<WorkOrderQcGate[]> {
    return this.db.workOrderQcGate.findMany({
      where: {
        workOrderId: params.workOrderId,
        ...(params.taskId ? { taskId: params.taskId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async batchSubmit(input: QcGateBatchSubmitInput): Promise<QcGateBatchSubmitResult> {
    const { workOrderId, taskId, reviewedBy, results, correlationId } = input;
    const now = new Date();

    const criticalFailures = results.filter((r) => r.result === 'FAIL' && r.isCritical);
    const overallResult: 'PASSED' | 'FAILED' = criticalFailures.length > 0 ? 'FAILED' : 'PASSED';

    return this.db.$transaction(async (tx) => {
      // 1. Create a WorkOrderQcGate row for each result
      const gates = await Promise.all(
        results.map((r) =>
          tx.workOrderQcGate.create({
            data: {
              id: randomUUID(),
              workOrderId,
              taskId: taskId ?? null,
              gateLabel: r.gateLabel,
              isCritical: r.isCritical,
              result: r.result,
              failureNote: r.failureNote ?? null,
              reviewedBy,
              reviewedAt: now,
            },
          }),
        ),
      );

      // 2. Create CRITICAL rework issues for each critical failure
      let reworkIssuesCreated = 0;
      for (const failure of criticalFailures) {
        await tx.reworkIssue.create({
          data: {
            id: randomUUID(),
            workOrderId,
            title: `QC Gate failure: ${failure.gateLabel}`,
            description: failure.failureNote ?? `Critical QC gate failed: ${failure.gateLabel}`,
            severity: 'CRITICAL',
            state: 'OPEN',
            reportedBy: reviewedBy,
            correlationId,
            createdAt: now,
            updatedAt: now,
          },
        });
        reworkIssuesCreated++;
      }

      // 3–5. If FAILED: increment activeReworkLoopCount; escalate if >= 3
      let activeReworkLoopCount = 0;
      if (overallResult === 'FAILED') {
        const updated = await tx.workOrder.update({
          where: { id: workOrderId },
          data: { activeReworkLoopCount: { increment: 1 } },
          select: { activeReworkLoopCount: true },
        });
        activeReworkLoopCount = updated.activeReworkLoopCount;

        if (activeReworkLoopCount >= 3) {
          await tx.reworkIssue.create({
            data: {
              id: randomUUID(),
              workOrderId,
              title: 'Max rework loops exceeded — escalation required',
              description: `Work order has reached ${activeReworkLoopCount} active rework loops. Immediate escalation is required.`,
              severity: 'CRITICAL',
              state: 'OPEN',
              reportedBy: reviewedBy,
              correlationId,
              createdAt: now,
              updatedAt: now,
            },
          });
          reworkIssuesCreated++;
        }
      }

      // 6. Update qcGateState
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: { qcGateState: overallResult },
      });

      return { gates, overallResult, reworkIssuesCreated, activeReworkLoopCount };
    });
  }
}
