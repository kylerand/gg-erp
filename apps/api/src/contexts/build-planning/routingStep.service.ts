import type { PrismaClient } from '@prisma/client';
import type { StepEvidenceAttachment } from '../../../../../packages/domain/src/model/buildPlanning.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RoutingSopStepExecutionState = 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED';

export interface RoutingSopStepWithExecution {
  id: string;
  workOrderId: string;
  stepCode: string;
  stepName: string;
  sequenceNo: number;
  description: string | null;
  estimatedMinutes: number | null;
  executionState: string;
  completedBy: string | null;
  completedAt: Date | null;
  failedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** True when all steps with a lower sequenceNo on the same workOrder are COMPLETE. */
  canStart: boolean;
  evidenceAttachments: StepEvidenceAttachment[];
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class StepNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepNotFoundError';
  }
}

export class InvalidStepTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION' as const;
  constructor(
    message: string,
    readonly currentState: string,
    readonly targetState: string,
    readonly allowedTransitions: string[]
  ) {
    super(message);
    this.name = 'InvalidStepTransitionError';
  }
}

// ─── Transition table ─────────────────────────────────────────────────────────

const STEP_TRANSITIONS: Record<string, RoutingSopStepExecutionState[]> = {
  PENDING: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETE', 'FAILED'],
  COMPLETE: [],
  FAILED: [],
};

// ─── Service ──────────────────────────────────────────────────────────────────

export class RoutingStepService {
  constructor(private readonly db: PrismaClient) {}

  async listStepsForTask(params: {
    workOrderId: string;
    taskId?: string;
  }): Promise<RoutingSopStepWithExecution[]> {
    // If taskId provided resolve it to a specific routingStepId via TechnicianTask
    let stepIdFilter: string | undefined;
    if (params.taskId) {
      const task = await this.db.technicianTask.findUnique({
        where: { id: params.taskId },
        select: { routingStepId: true },
      });
      if (task) {
        stepIdFilter = task.routingStepId;
      }
    }

    const steps = await this.db.routingSopStep.findMany({
      where: {
        workOrderId: params.workOrderId,
        ...(stepIdFilter ? { id: stepIdFilter } : {}),
      },
      include: { stepEvidenceAttachments: true },
      orderBy: { sequenceNo: 'asc' },
    });

    // Need all step states for the work order to compute canStart accurately,
    // even when a filter has narrowed the result set.
    const allStepStates =
      stepIdFilter
        ? await this.db.routingSopStep.findMany({
            where: { workOrderId: params.workOrderId },
            select: { sequenceNo: true, executionState: true },
            orderBy: { sequenceNo: 'asc' },
          })
        : steps.map((s) => ({ sequenceNo: s.sequenceNo, executionState: s.executionState }));

    return steps.map((step) => ({
      ...step,
      canStart: computeCanStart(step.sequenceNo, allStepStates),
      evidenceAttachments: step.stepEvidenceAttachments.map(toStepEvidenceAttachment),
    }));
  }

  async transitionStepState(params: {
    stepId: string;
    state: RoutingSopStepExecutionState;
    technicianId: string;
    failedReason?: string;
    evidenceAttachmentIds?: string[];
    correlationId: string;
  }): Promise<RoutingSopStepWithExecution> {
    const existing = await this.db.routingSopStep.findUnique({
      where: { id: params.stepId },
      include: { stepEvidenceAttachments: true },
    });

    if (!existing) {
      throw new StepNotFoundError(`RoutingSopStep not found: ${params.stepId}`);
    }

    const currentState = existing.executionState as RoutingSopStepExecutionState;
    const allowed = STEP_TRANSITIONS[currentState] ?? [];
    if (!allowed.includes(params.state)) {
      throw new InvalidStepTransitionError(
        `Cannot transition step from ${currentState} to ${params.state}.`,
        currentState,
        params.state,
        allowed
      );
    }

    const now = new Date();
    const updated = await this.db.routingSopStep.update({
      where: { id: params.stepId },
      data: {
        executionState: params.state,
        updatedAt: now,
        ...(params.state === 'COMPLETE'
          ? { completedBy: params.technicianId, completedAt: now }
          : {}),
        ...(params.state === 'FAILED' && params.failedReason
          ? { failedReason: params.failedReason }
          : {}),
      },
      include: { stepEvidenceAttachments: true },
    });

    if (params.state === 'COMPLETE' && params.evidenceAttachmentIds?.length) {
      await this.db.stepEvidenceAttachment.createMany({
        data: params.evidenceAttachmentIds.map((fileAttachmentId) => ({
          routingStepId: updated.id,
          fileAttachmentId,
          uploadedBy: params.technicianId,
        })),
      });
    }

    const updatedWithEvidence = await this.db.routingSopStep.findUnique({
      where: { id: updated.id },
      include: { stepEvidenceAttachments: true },
    });
    const stepForResponse = updatedWithEvidence ?? updated;

    const allStepStates = await this.db.routingSopStep.findMany({
      where: { workOrderId: stepForResponse.workOrderId },
      select: { sequenceNo: true, executionState: true },
      orderBy: { sequenceNo: 'asc' },
    });

    return {
      ...stepForResponse,
      canStart: computeCanStart(stepForResponse.sequenceNo, allStepStates),
      evidenceAttachments: stepForResponse.stepEvidenceAttachments.map(toStepEvidenceAttachment),
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeCanStart(
  sequenceNo: number,
  allSteps: Array<{ sequenceNo: number; executionState: string }>
): boolean {
  return allSteps
    .filter((s) => s.sequenceNo < sequenceNo)
    .every((s) => s.executionState === 'COMPLETE');
}

function toStepEvidenceAttachment(row: {
  id: string;
  routingStepId: string;
  fileAttachmentId: string;
  uploadedBy: string;
  createdAt: Date;
}): StepEvidenceAttachment {
  return {
    id: row.id,
    routingStepId: row.routingStepId,
    fileAttachmentId: row.fileAttachmentId,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  };
}
