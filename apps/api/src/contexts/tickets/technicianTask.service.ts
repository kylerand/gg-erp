import { randomUUID } from 'node:crypto';
import {
  InvariantViolationError,
  TechnicianTaskDesign,
  TechnicianTaskState,
  type TechnicianTask,
  assertTransitionAllowed
} from '../../../../../packages/domain/src/model/index.js';
import { AUDIT_POINTS, type AuditSink } from '../../audit/index.js';
import {
  type EventEnvelope,
  type EventPublisher,
  type OutboxWriter,
  publishWithOutbox
} from '../../events/index.js';
import type { ObservabilityContext, ObservabilityHooks } from '../../observability/hooks.js';

export interface CommandContext extends Pick<ObservabilityContext, 'correlationId' | 'actorId'> {
  module: string;
}

export interface TechnicianTaskServiceDeps {
  audit: AuditSink;
  publisher: EventPublisher;
  outbox: OutboxWriter;
  observability: ObservabilityHooks;
}

export interface CreateTechnicianTaskInput {
  workOrderId: string;
  routingStepId: string;
  technicianId?: string;
}

export class TechnicianTaskService {
  private readonly tasks = new Map<string, TechnicianTask>();

  constructor(private readonly deps: TechnicianTaskServiceDeps) {}

  async createTask(
    input: CreateTechnicianTaskInput,
    context: CommandContext
  ): Promise<TechnicianTask> {
    const task: TechnicianTask = {
      id: randomUUID(),
      workOrderId: input.workOrderId,
      routingStepId: input.routingStepId,
      technicianId: input.technicianId,
      state: TechnicianTaskState.READY,
      updatedAt: new Date().toISOString()
    };
    this.tasks.set(task.id, task);
    await this.record(task.id, task, 'technician_task.created', context);
    return task;
  }

  async transitionTask(
    taskId: string,
    nextState: TechnicianTaskState,
    context: CommandContext
  ): Promise<TechnicianTask> {
    const existing = this.tasks.get(taskId);
    if (!existing) {
      throw new InvariantViolationError(`TechnicianTask not found: ${taskId}`);
    }

    assertTransitionAllowed(existing.state, nextState, TechnicianTaskDesign.lifecycle);
    if (nextState === TechnicianTaskState.IN_PROGRESS && !existing.technicianId) {
      throw new InvariantViolationError('Technician must be assigned before starting task');
    }

    const updated: TechnicianTask = {
      ...existing,
      state: nextState,
      startedAt:
        nextState === TechnicianTaskState.IN_PROGRESS && !existing.startedAt
          ? new Date().toISOString()
          : existing.startedAt,
      completedAt:
        nextState === TechnicianTaskState.DONE ? new Date().toISOString() : existing.completedAt,
      updatedAt: new Date().toISOString()
    };

    this.tasks.set(taskId, updated);
    const eventName =
      nextState === TechnicianTaskState.IN_PROGRESS
        ? 'technician_task.started'
        : nextState === TechnicianTaskState.BLOCKED
          ? 'technician_task.blocked'
          : nextState === TechnicianTaskState.DONE
            ? 'technician_task.completed'
            : 'technician_task.assigned';
    await this.record(taskId, { before: existing.state, after: updated.state }, eventName, context);
    return updated;
  }

  private async record(
    taskId: string,
    metadata: unknown,
    eventName:
      | 'technician_task.created'
      | 'technician_task.assigned'
      | 'technician_task.started'
      | 'technician_task.blocked'
      | 'technician_task.completed',
    context: CommandContext
  ): Promise<void> {
    await this.deps.audit.record({
      actorId: context.actorId,
      action: AUDIT_POINTS.technicianTaskStateChange,
      entityType: 'TechnicianTask',
      entityId: taskId,
      correlationId: context.correlationId,
      metadata,
      createdAt: new Date().toISOString()
    });

    const event: EventEnvelope<unknown> = {
      name: eventName,
      correlationId: context.correlationId,
      emittedAt: new Date().toISOString(),
      payload: metadata
    };
    await publishWithOutbox(this.deps.publisher, this.deps.outbox, event);
    this.deps.observability.metric('technician_task.transition', 1, context);
  }
}
