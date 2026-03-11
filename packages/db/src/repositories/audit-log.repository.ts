export interface AuditLogRecord {
  id: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogRepository {
  append(record: AuditLogRecord): Promise<void>;
  listByCorrelationId(correlationId: string): Promise<AuditLogRecord[]>;
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  private readonly records: AuditLogRecord[] = [];

  async append(record: AuditLogRecord): Promise<void> {
    this.records.push(record);
  }

  async listByCorrelationId(correlationId: string): Promise<AuditLogRecord[]> {
    return this.records.filter((record) => record.correlationId === correlationId);
  }
}
