import type { EntityDesign } from './shared.js';

export enum AuditEventState {
  RECORDED = 'RECORDED'
}

export interface AuditEvent {
  id: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  state: AuditEventState;
}

export const AuditEventDesign: EntityDesign<AuditEventState> = {
  entity: 'AuditEvent',
  purpose: 'Immutable compliance trail for state-changing business operations.',
  keyFields: ['id', 'actorId', 'action', 'entityType', 'entityId', 'correlationId', 'createdAt', 'state'],
  requiredIndexes: [
    { name: 'audit_events_entity_idx', fields: ['entityType', 'entityId'] },
    { name: 'audit_events_correlation_idx', fields: ['correlationId'] },
    { name: 'audit_events_created_at_idx', fields: ['createdAt'] }
  ],
  lifecycle: {
    initial: AuditEventState.RECORDED,
    terminal: [AuditEventState.RECORDED],
    transitions: [
      { from: AuditEventState.RECORDED, to: AuditEventState.RECORDED, rule: 'Immutable append-only record' }
    ]
  },
  businessRules: [
    'Audit events are append-only and immutable.',
    'Every mutation command should write at least one audit event.',
    'correlationId is mandatory for traceability.'
  ],
  emittedEvents: ['audit.event.recorded'],
  apiOperations: [
    { method: 'GET', path: '/audit/events', summary: 'Query audit trail' },
    { method: 'GET', path: '/audit/events/:id', summary: 'Get audit event detail' }
  ]
};
