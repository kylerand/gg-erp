import { randomUUID } from 'node:crypto';
import {
  FileAttachmentDesign,
  FileAttachmentState,
  type FileAttachment,
  InvariantViolationError,
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

interface CommandContext extends Pick<ObservabilityContext, 'correlationId' | 'actorId'> {
  module: string;
}

export interface AttachmentServiceDeps {
  audit: AuditSink;
  publisher: EventPublisher;
  outbox: OutboxWriter;
  observability: ObservabilityHooks;
}

export interface UploadAttachmentInput {
  relatedEntityType: string;
  relatedEntityId: string;
  fileName: string;
  storageKey: string;
  contentType: string;
  byteSize: number;
  checksumSha256: string;
}

class AttachmentService {
  private readonly attachments = new Map<string, FileAttachment>();

  constructor(private readonly deps: AttachmentServiceDeps) {}

  async upload(input: UploadAttachmentInput, context: CommandContext): Promise<FileAttachment> {
    if (!input.relatedEntityType || !input.relatedEntityId) {
      throw new InvariantViolationError('Attachment relation is required');
    }
    if (input.byteSize < 0) {
      throw new InvariantViolationError('byteSize must be >= 0');
    }

    const now = new Date().toISOString();
    const attachment: FileAttachment = {
      id: randomUUID(),
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      fileName: input.fileName,
      storageKey: input.storageKey,
      contentType: input.contentType,
      byteSize: input.byteSize,
      checksumSha256: input.checksumSha256,
      state: FileAttachmentState.UPLOADED,
      uploadedBy: context.actorId ?? 'system',
      uploadedAt: now,
      updatedAt: now
    };

    this.attachments.set(attachment.id, attachment);
    await this.record(
      attachment.id,
      attachment,
      'file_attachment.uploaded',
      AUDIT_POINTS.attachmentUpload,
      context
    );
    return attachment;
  }

  async transitionState(
    attachmentId: string,
    nextState: FileAttachmentState,
    context: CommandContext
  ): Promise<FileAttachment> {
    const existing = this.attachments.get(attachmentId);
    if (!existing) {
      throw new InvariantViolationError(`Attachment not found: ${attachmentId}`);
    }

    assertTransitionAllowed(existing.state, nextState, FileAttachmentDesign.lifecycle);
    const updated: FileAttachment = {
      ...existing,
      state: nextState,
      updatedAt: new Date().toISOString()
    };
    this.attachments.set(attachmentId, updated);

    const eventName =
      nextState === FileAttachmentState.AVAILABLE
        ? 'file_attachment.available'
        : nextState === FileAttachmentState.QUARANTINED
          ? 'file_attachment.quarantined'
          : 'file_attachment.uploaded';
    await this.record(
      attachmentId,
      { before: existing.state, after: updated.state },
      eventName,
      AUDIT_POINTS.attachmentUpload,
      context
    );
    return updated;
  }

  get(attachmentId: string): FileAttachment | undefined {
    return this.attachments.get(attachmentId);
  }

  private async record(
    attachmentId: string,
    metadata: unknown,
    eventName: 'file_attachment.uploaded' | 'file_attachment.available' | 'file_attachment.quarantined',
    action: string,
    context: CommandContext
  ): Promise<void> {
    await this.deps.audit.record({
      actorId: context.actorId,
      action,
      entityType: 'FileAttachment',
      entityId: attachmentId,
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
    this.deps.observability.metric('file_attachment.transition', 1, context);
  }
}

export interface AttachmentRoutes {
  upload(
    input: UploadAttachmentInput,
    correlationId: string,
    actorId?: string
  ): Promise<FileAttachment>;
  transition(
    attachmentId: string,
    nextState: FileAttachmentState,
    correlationId: string,
    actorId?: string
  ): Promise<FileAttachment>;
  get(attachmentId: string): FileAttachment | undefined;
}

export function createAttachmentRoutes(deps: AttachmentServiceDeps): AttachmentRoutes {
  const service = new AttachmentService(deps);
  return {
    upload(input, correlationId, actorId) {
      return service.upload(input, { correlationId, actorId, module: 'tickets' });
    },
    transition(attachmentId, nextState, correlationId, actorId) {
      return service.transitionState(attachmentId, nextState, {
        correlationId,
        actorId,
        module: 'tickets'
      });
    },
    get(attachmentId) {
      return service.get(attachmentId);
    }
  };
}
