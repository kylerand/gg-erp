import type { EntityDesign } from './shared.js';

export enum InvoiceSyncState {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  SYNCED = 'SYNCED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export interface InvoiceSyncRecord {
  id: string;
  invoiceNumber: string;
  workOrderId: string;
  provider: 'QUICKBOOKS' | 'GENERIC';
  state: InvoiceSyncState;
  attemptCount: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  externalReference?: string;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string;
}

export const InvoiceSyncRecordDesign: EntityDesign<InvoiceSyncState> = {
  entity: 'InvoiceSyncRecord',
  purpose: 'Tracks outbound accounting synchronization lifecycle and retryability.',
  keyFields: [
    'id',
    'invoiceNumber',
    'workOrderId',
    'provider',
    'state',
    'attemptCount',
    'lastErrorCode',
    'externalReference',
    'updatedAt'
  ],
  requiredIndexes: [
    { name: 'invoice_sync_invoice_number_uk', fields: ['invoiceNumber'], unique: true },
    { name: 'invoice_sync_work_order_idx', fields: ['workOrderId'] },
    { name: 'invoice_sync_state_idx', fields: ['state'] }
  ],
  lifecycle: {
    initial: InvoiceSyncState.PENDING,
    terminal: [InvoiceSyncState.SYNCED, InvoiceSyncState.CANCELLED],
    transitions: [
      { from: InvoiceSyncState.PENDING, to: InvoiceSyncState.IN_PROGRESS, rule: 'Sync attempt started' },
      {
        from: InvoiceSyncState.IN_PROGRESS,
        to: InvoiceSyncState.SYNCED,
        rule: 'Provider sync succeeded'
      },
      { from: InvoiceSyncState.IN_PROGRESS, to: InvoiceSyncState.FAILED, rule: 'Provider sync failed' },
      { from: InvoiceSyncState.FAILED, to: InvoiceSyncState.IN_PROGRESS, rule: 'Retry initiated' },
      { from: InvoiceSyncState.PENDING, to: InvoiceSyncState.CANCELLED, rule: 'Sync cancelled before start' },
      { from: InvoiceSyncState.FAILED, to: InvoiceSyncState.CANCELLED, rule: 'Sync permanently abandoned' }
    ]
  },
  businessRules: [
    'attemptCount increments on each IN_PROGRESS transition.',
    'SYNCED state requires externalReference and syncedAt.',
    'CANCELLED records are immutable.'
  ],
  emittedEvents: [
    'invoice_sync.started',
    'invoice_sync.succeeded',
    'invoice_sync.failed',
    'invoice_sync.retried',
    'invoice_sync.cancelled'
  ],
  apiOperations: [
    { method: 'POST', path: '/accounting/invoice-sync', summary: 'Create invoice sync record' },
    {
      method: 'PATCH',
      path: '/accounting/invoice-sync/:id/start',
      summary: 'Start sync attempt'
    },
    {
      method: 'PATCH',
      path: '/accounting/invoice-sync/:id/success',
      summary: 'Mark sync successful'
    },
    {
      method: 'PATCH',
      path: '/accounting/invoice-sync/:id/fail',
      summary: 'Mark sync failed'
    }
  ]
};
