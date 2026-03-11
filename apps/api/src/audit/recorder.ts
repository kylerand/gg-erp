import type { AuditEmission, AuditRecord } from '../../../../packages/domain/src/audit.js';

export interface AuditSink {
  record(entry: AuditRecord): Promise<AuditEmission>;
}

export class InMemoryAuditSink implements AuditSink {
  private readonly entries: AuditRecord[] = [];
  private readonly emissions: AuditEmission[] = [];

  async record(entry: AuditRecord): Promise<AuditEmission> {
    this.entries.push(entry);
    const emission: AuditEmission = {
      state: 'RECORDED',
      eventName: 'audit.event.recorded',
      emittedAt: new Date().toISOString(),
      record: entry
    };
    this.emissions.push(emission);
    return emission;
  }

  list(): AuditRecord[] {
    return [...this.entries];
  }

  listEmissions(): AuditEmission[] {
    return [...this.emissions];
  }
}
