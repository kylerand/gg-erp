import { randomUUID } from 'node:crypto';
import {
  InvariantViolationError,
  TicketReworkIssueDesign,
  TicketReworkIssueState,
  type TicketReworkIssue,
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

export interface TicketReworkServiceDeps {
  audit: AuditSink;
  publisher: EventPublisher;
  outbox: OutboxWriter;
  observability: ObservabilityHooks;
}

export interface CreateReworkIssueInput {
  workOrderId: string;
  title: string;
  description: string;
  severity: TicketReworkIssue['severity'];
  assignedTo?: string;
}

export class TicketReworkService {
  private readonly issues = new Map<string, TicketReworkIssue>();

  constructor(private readonly deps: TicketReworkServiceDeps) {}

  async createIssue(
    input: CreateReworkIssueInput,
    context: CommandContext
  ): Promise<TicketReworkIssue> {
    const now = new Date().toISOString();
    const issue: TicketReworkIssue = {
      id: randomUUID(),
      workOrderId: input.workOrderId,
      title: input.title.trim(),
      description: input.description.trim(),
      severity: input.severity,
      state: TicketReworkIssueState.OPEN,
      reportedBy: context.actorId ?? 'system',
      assignedTo: input.assignedTo,
      createdAt: now,
      updatedAt: now
    };

    this.issues.set(issue.id, issue);
    await this.record(issue.id, issue, 'ticket.rework.created', context);
    return issue;
  }

  async transitionIssue(
    issueId: string,
    nextState: TicketReworkIssueState,
    context: CommandContext
  ): Promise<TicketReworkIssue> {
    const existing = this.issues.get(issueId);
    if (!existing) {
      throw new InvariantViolationError(`Rework issue not found: ${issueId}`);
    }

    assertTransitionAllowed(existing.state, nextState, TicketReworkIssueDesign.lifecycle);
    if (
      nextState === TicketReworkIssueState.RESOLVED &&
      existing.severity === 'CRITICAL' &&
      !existing.assignedTo
    ) {
      throw new InvariantViolationError(
        'CRITICAL rework issue must be assigned before RESOLVED'
      );
    }

    const updated: TicketReworkIssue = {
      ...existing,
      state: nextState,
      resolvedAt:
        nextState === TicketReworkIssueState.RESOLVED
          ? new Date().toISOString()
          : existing.resolvedAt,
      updatedAt: new Date().toISOString()
    };
    this.issues.set(issueId, updated);

    const eventName =
      nextState === TicketReworkIssueState.CLOSED
        ? 'ticket.rework.closed'
        : 'ticket.rework.state_changed';
    await this.record(issueId, { before: existing.state, after: updated.state }, eventName, context);
    return updated;
  }

  private async record(
    issueId: string,
    metadata: unknown,
    eventName: 'ticket.rework.created' | 'ticket.rework.state_changed' | 'ticket.rework.closed',
    context: CommandContext
  ): Promise<void> {
    await this.deps.audit.record({
      actorId: context.actorId,
      action: AUDIT_POINTS.ticketReworkStateChange,
      entityType: 'TicketReworkIssue',
      entityId: issueId,
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
    this.deps.observability.metric('ticket_rework.transition', 1, context);
  }
}
