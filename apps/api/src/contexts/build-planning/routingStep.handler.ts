import { PrismaClient } from '@prisma/client';
import { wrapHandler, parseBody, jsonResponse } from '../../shared/lambda/index.js';
import {
  RoutingStepService,
  InvalidStepTransitionError,
  StepNotFoundError,
  type RoutingSopStepExecutionState,
  type RoutingSopStepWithExecution,
} from './routingStep.service.js';

const db = new PrismaClient();
const routingStepService = new RoutingStepService(db);

const VALID_TRANSITION_STATES: RoutingSopStepExecutionState[] = ['IN_PROGRESS', 'COMPLETE', 'FAILED'];

// ─── GET /planning/routing-steps ─────────────────────────────────────────────

export const listRoutingStepsHandler = wrapHandler(async (ctx) => {
  const qs = ctx.event.queryStringParameters ?? {};
  const workOrderId = qs.workOrderId?.trim();
  const taskId = qs.taskId?.trim();

  if (!workOrderId) {
    return jsonResponse(400, { message: 'workOrderId query parameter is required.' });
  }

  const workOrder = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true },
  });
  if (!workOrder) {
    return jsonResponse(404, { message: `Work order not found: ${workOrderId}` });
  }

  const steps = await routingStepService.listStepsForTask({
    workOrderId,
    taskId: taskId || undefined,
  });

  return jsonResponse(200, {
    steps: steps.map(toStepResponse),
    total: steps.length,
  });
}, { requireAuth: false });

// ─── PATCH /planning/routing-steps/:id/state ─────────────────────────────────

export const transitionRoutingStepStateHandler = wrapHandler(async (ctx) => {
  const id = ctx.event.pathParameters?.id ?? ctx.event.pathParameters?.stepId;
  if (!id) {
    return jsonResponse(400, { message: 'Step ID path parameter is required.' });
  }

  const body = parseBody<{
    state: string;
    technicianId: string;
    failedReason?: string;
    evidenceAttachmentIds?: string[];
  }>(ctx.event);
  if (!body.ok) {
    return jsonResponse(400, { message: body.error });
  }

  const { state, technicianId, failedReason, evidenceAttachmentIds } = body.value;

  if (!state) {
    return jsonResponse(422, { code: 'MISSING_FIELD', message: 'state is required.' });
  }
  if (!technicianId) {
    return jsonResponse(422, { code: 'MISSING_FIELD', message: 'technicianId is required.' });
  }
  if (!VALID_TRANSITION_STATES.includes(state as RoutingSopStepExecutionState)) {
    return jsonResponse(422, {
      code: 'INVALID_STATE',
      message: `state must be one of: ${VALID_TRANSITION_STATES.join(', ')}.`,
    });
  }

  try {
    const step = await routingStepService.transitionStepState({
      stepId: id,
      state: state as RoutingSopStepExecutionState,
      technicianId,
      failedReason,
      evidenceAttachmentIds,
      correlationId: ctx.correlationId,
    });

    return jsonResponse(200, { step: toStepResponse(step) });
  } catch (error) {
    if (error instanceof InvalidStepTransitionError) {
      return jsonResponse(422, {
        code: error.code,
        message: error.message,
        allowedTransitions: error.allowedTransitions,
      });
    }
    if (error instanceof StepNotFoundError) {
      return jsonResponse(404, { message: error.message });
    }
    throw error;
  }
}, { requireAuth: false });

// ─── Response mapper ──────────────────────────────────────────────────────────

function toStepResponse(step: RoutingSopStepWithExecution) {
  return {
    id: step.id,
    workOrderId: step.workOrderId,
    stepCode: step.stepCode,
    stepName: step.stepName,
    title: step.stepName,
    sequenceNo: step.sequenceNo,
    sequence: step.sequenceNo,
    description: step.description ?? undefined,
    requiresEvidence: false,
    estimatedMinutes: step.estimatedMinutes ?? undefined,
    executionState: step.executionState,
    completedBy: step.completedBy ?? undefined,
    completedAt: step.completedAt?.toISOString(),
    failedReason: step.failedReason ?? undefined,
    createdAt: step.createdAt.toISOString(),
    updatedAt: step.updatedAt.toISOString(),
    canStart: step.canStart,
    evidenceAttachments: step.evidenceAttachments,
  };
}
