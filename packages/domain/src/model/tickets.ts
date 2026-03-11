import type { EntityDesign } from './shared.js';

export enum TechnicianTaskState {
  READY = 'READY',
  IN_PROGRESS = 'IN_PROGRESS',
  BLOCKED = 'BLOCKED',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED'
}

export interface TechnicianTask {
  id: string;
  workOrderId: string;
  routingStepId: string;
  technicianId?: string;
  state: TechnicianTaskState;
  startedAt?: string;
  completedAt?: string;
  blockedReason?: string;
  updatedAt: string;
}

export const TechnicianTaskDesign: EntityDesign<TechnicianTaskState> = {
  entity: 'TechnicianTask',
  purpose: 'Atomic execution task assigned to technicians for a work order step.',
  keyFields: ['id', 'workOrderId', 'routingStepId', 'technicianId', 'state', 'updatedAt'],
  requiredIndexes: [
    { name: 'technician_tasks_work_order_idx', fields: ['workOrderId'] },
    { name: 'technician_tasks_technician_state_idx', fields: ['technicianId', 'state'] }
  ],
  lifecycle: {
    initial: TechnicianTaskState.READY,
    terminal: [TechnicianTaskState.DONE, TechnicianTaskState.CANCELLED],
    transitions: [
      { from: TechnicianTaskState.READY, to: TechnicianTaskState.IN_PROGRESS, rule: 'Technician starts task' },
      { from: TechnicianTaskState.IN_PROGRESS, to: TechnicianTaskState.BLOCKED, rule: 'Execution issue' },
      {
        from: TechnicianTaskState.BLOCKED,
        to: TechnicianTaskState.IN_PROGRESS,
        rule: 'Issue resolved and work resumed'
      },
      { from: TechnicianTaskState.IN_PROGRESS, to: TechnicianTaskState.DONE, rule: 'Task finished' },
      { from: TechnicianTaskState.READY, to: TechnicianTaskState.CANCELLED, rule: 'Task cancelled' }
    ]
  },
  businessRules: [
    'DONE tasks require completedAt timestamp.',
    'Task cannot move to IN_PROGRESS without assigned technician.'
  ],
  emittedEvents: [
    'technician_task.created',
    'technician_task.assigned',
    'technician_task.started',
    'technician_task.blocked',
    'technician_task.completed'
  ],
  apiOperations: [
    { method: 'POST', path: '/tickets/technician-tasks', summary: 'Create technician task' },
    {
      method: 'PATCH',
      path: '/tickets/technician-tasks/:id/state',
      summary: 'Transition technician task state'
    }
  ]
};

export enum TicketReworkIssueState {
  OPEN = 'OPEN',
  IN_REVIEW = 'IN_REVIEW',
  RESOLVED = 'RESOLVED',
  REOPENED = 'REOPENED',
  CLOSED = 'CLOSED'
}

export interface TicketReworkIssue {
  id: string;
  workOrderId: string;
  title: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  state: TicketReworkIssueState;
  reportedBy: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export const TicketReworkIssueDesign: EntityDesign<TicketReworkIssueState> = {
  entity: 'TicketReworkIssue',
  purpose: 'Tracks defects/rework issues that must be resolved during production.',
  keyFields: [
    'id',
    'workOrderId',
    'title',
    'severity',
    'state',
    'reportedBy',
    'assignedTo',
    'updatedAt'
  ],
  requiredIndexes: [
    { name: 'rework_issues_work_order_idx', fields: ['workOrderId'] },
    { name: 'rework_issues_state_severity_idx', fields: ['state', 'severity'] }
  ],
  lifecycle: {
    initial: TicketReworkIssueState.OPEN,
    terminal: [TicketReworkIssueState.CLOSED],
    transitions: [
      { from: TicketReworkIssueState.OPEN, to: TicketReworkIssueState.IN_REVIEW, rule: 'Issue triaged' },
      { from: TicketReworkIssueState.IN_REVIEW, to: TicketReworkIssueState.RESOLVED, rule: 'Fix confirmed' },
      {
        from: TicketReworkIssueState.RESOLVED,
        to: TicketReworkIssueState.REOPENED,
        rule: 'Issue recurred or fix failed'
      },
      {
        from: TicketReworkIssueState.REOPENED,
        to: TicketReworkIssueState.IN_REVIEW,
        rule: 'Re-triage after reopen'
      },
      { from: TicketReworkIssueState.RESOLVED, to: TicketReworkIssueState.CLOSED, rule: 'Final close' }
    ]
  },
  businessRules: [
    'CRITICAL issues require assignment before RESOLVED.',
    'CLOSED issue cannot be reopened in MVP.'
  ],
  emittedEvents: ['ticket.rework.created', 'ticket.rework.state_changed', 'ticket.rework.closed'],
  apiOperations: [
    { method: 'POST', path: '/tickets/rework-issues', summary: 'Create rework issue' },
    { method: 'PATCH', path: '/tickets/rework-issues/:id/state', summary: 'Transition rework issue state' }
  ]
};

export enum FileAttachmentState {
  UPLOADED = 'UPLOADED',
  SCANNING = 'SCANNING',
  AVAILABLE = 'AVAILABLE',
  QUARANTINED = 'QUARANTINED',
  DELETED = 'DELETED'
}

export interface FileAttachment {
  id: string;
  relatedEntityType: string;
  relatedEntityId: string;
  fileName: string;
  storageKey: string;
  contentType: string;
  byteSize: number;
  checksumSha256: string;
  state: FileAttachmentState;
  uploadedBy: string;
  uploadedAt: string;
  updatedAt: string;
}

export const FileAttachmentDesign: EntityDesign<FileAttachmentState> = {
  entity: 'FileAttachment',
  purpose: 'Captures metadata and lifecycle of files attached to operational entities.',
  keyFields: [
    'id',
    'relatedEntityType',
    'relatedEntityId',
    'fileName',
    'storageKey',
    'contentType',
    'byteSize',
    'checksumSha256',
    'state',
    'uploadedBy',
    'uploadedAt'
  ],
  requiredIndexes: [
    {
      name: 'file_attachments_related_entity_idx',
      fields: ['relatedEntityType', 'relatedEntityId']
    },
    { name: 'file_attachments_state_idx', fields: ['state'] },
    { name: 'file_attachments_checksum_uk', fields: ['checksumSha256'], unique: true }
  ],
  lifecycle: {
    initial: FileAttachmentState.UPLOADED,
    terminal: [FileAttachmentState.DELETED],
    transitions: [
      { from: FileAttachmentState.UPLOADED, to: FileAttachmentState.SCANNING, rule: 'Security scan started' },
      { from: FileAttachmentState.SCANNING, to: FileAttachmentState.AVAILABLE, rule: 'Scan passed' },
      {
        from: FileAttachmentState.SCANNING,
        to: FileAttachmentState.QUARANTINED,
        rule: 'Scan failed or suspicious content'
      },
      { from: FileAttachmentState.AVAILABLE, to: FileAttachmentState.DELETED, rule: 'Attachment removed' },
      {
        from: FileAttachmentState.QUARANTINED,
        to: FileAttachmentState.DELETED,
        rule: 'Quarantined file purged'
      }
    ]
  },
  businessRules: [
    'Attachment must always reference an existing entity.',
    'Only AVAILABLE attachments may be downloaded in MVP.',
    'checksumSha256 enforces dedupe and traceability.'
  ],
  emittedEvents: ['file_attachment.uploaded', 'file_attachment.available', 'file_attachment.quarantined'],
  apiOperations: [
    { method: 'POST', path: '/tickets/attachments', summary: 'Upload attachment metadata' },
    { method: 'PATCH', path: '/tickets/attachments/:id/state', summary: 'Transition attachment state' },
    { method: 'DELETE', path: '/tickets/attachments/:id', summary: 'Delete attachment' }
  ]
};
