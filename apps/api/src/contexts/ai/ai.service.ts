import { InvariantViolationError } from '../../../../../packages/domain/src/model/index.js';
import { summarizeWorkOrder, type AiProvider } from '../../../../../packages/ai/src/index.js';
import { AUDIT_POINTS, type AuditSink } from '../../audit/index.js';
import type { ObservabilityContext, ObservabilityHooks } from '../../observability/hooks.js';

export interface CommandContext extends Pick<ObservabilityContext, 'correlationId' | 'actorId'> {
  module: string;
}

export interface AiServiceDeps {
  provider: AiProvider;
  audit: AuditSink;
  observability: ObservabilityHooks;
}

export interface SummarizeWorkOrderNotesInput {
  workOrderId: string;
  notes: string;
}

export interface WorkOrderSummary {
  workOrderId: string;
  summary: string;
}

export class AiService {
  constructor(private readonly deps: AiServiceDeps) {}

  async summarizeWorkOrderNotes(
    input: SummarizeWorkOrderNotesInput,
    context: CommandContext
  ): Promise<WorkOrderSummary> {
    this.deps.observability.trace('ai.summarize_work_order_notes', context);

    const workOrderId = input.workOrderId?.trim() ?? '';
    const notes = input.notes?.trim() ?? '';

    if (!workOrderId) {
      await this.recordRejectedRequest('workOrderId is required', workOrderId, notes.length, context);
      throw new InvariantViolationError('workOrderId is required');
    }
    if (!notes) {
      await this.recordRejectedRequest('notes are required', workOrderId, notes.length, context);
      throw new InvariantViolationError('notes are required');
    }

    try {
      const summary = await summarizeWorkOrder(this.deps.provider, {
        correlationId: context.correlationId,
        workOrderId,
        notes
      });

      await this.recordAudit(
        workOrderId,
        {
          operation: 'work_order_notes_summary',
          status: 'succeeded',
          notesLength: notes.length,
          summaryLength: summary.length
        },
        context
      );
      this.deps.observability.metric('ai.request.success', 1, context);
      this.deps.observability.logInfo('AI work order summary generated', context);
      return { workOrderId, summary };
    } catch (error) {
      await this.recordAudit(
        workOrderId,
        {
          operation: 'work_order_notes_summary',
          status: 'failed',
          notesLength: notes.length,
          error: this.toErrorMessage(error)
        },
        context
      );
      this.deps.observability.metric('ai.request.failure', 1, context);
      this.deps.observability.logError('AI work order summary failed', context);
      throw error;
    }
  }

  private async recordRejectedRequest(
    reason: string,
    workOrderId: string,
    notesLength: number,
    context: CommandContext
  ): Promise<void> {
    await this.recordAudit(
      workOrderId || 'unknown',
      {
        operation: 'work_order_notes_summary',
        status: 'rejected',
        reason,
        notesLength
      },
      context
    );
    this.deps.observability.metric('ai.request.validation_error', 1, context);
    this.deps.observability.logError(`AI work order summary rejected: ${reason}`, context);
  }

  private async recordAudit(
    entityId: string,
    metadata: unknown,
    context: CommandContext
  ): Promise<void> {
    await this.deps.audit.record({
      actorId: context.actorId,
      action: AUDIT_POINTS.aiRequest,
      entityType: 'WorkOrder',
      entityId,
      correlationId: context.correlationId,
      metadata,
      createdAt: new Date().toISOString()
    });
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
