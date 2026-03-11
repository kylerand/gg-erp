export interface AuditRecord {
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  metadata: unknown;
  createdAt: string;
}

export interface AuditMutationDetail {
  field: string;
  before?: unknown;
  after?: unknown;
}

export interface AuditEmission {
  state: 'RECORDED';
  eventName: 'audit.event.recorded';
  emittedAt: string;
  record: AuditRecord;
}

export interface AuditRecorder {
  record(event: AuditRecord): Promise<AuditEmission>;
}
