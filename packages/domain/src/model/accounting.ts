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

// ─── Customer Sync ────────────────────────────────────────────────────────────

export enum CustomerSyncState {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  SYNCED = 'SYNCED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

export interface CustomerSyncRecord {
  id: string;
  customerId: string;
  provider: 'QUICKBOOKS' | 'GENERIC';
  state: CustomerSyncState;
  attemptCount: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  externalReference?: string;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string;
}

export const CustomerSyncRecordDesign: EntityDesign<CustomerSyncState> = {
  entity: 'CustomerSyncRecord',
  purpose:
    'Tracks outbound customer synchronization to external accounting systems.',
  keyFields: [
    'id',
    'customerId',
    'provider',
    'state',
    'attemptCount',
    'lastErrorCode',
    'externalReference',
    'updatedAt',
  ],
  requiredIndexes: [
    { name: 'customer_sync_customer_id_uk', fields: ['customerId', 'provider'], unique: true },
    { name: 'customer_sync_state_idx', fields: ['state'] },
  ],
  lifecycle: {
    initial: CustomerSyncState.PENDING,
    terminal: [CustomerSyncState.SYNCED, CustomerSyncState.SKIPPED],
    transitions: [
      { from: CustomerSyncState.PENDING, to: CustomerSyncState.IN_PROGRESS, rule: 'Sync attempt started' },
      { from: CustomerSyncState.IN_PROGRESS, to: CustomerSyncState.SYNCED, rule: 'Provider sync succeeded' },
      { from: CustomerSyncState.IN_PROGRESS, to: CustomerSyncState.FAILED, rule: 'Provider sync failed' },
      { from: CustomerSyncState.FAILED, to: CustomerSyncState.IN_PROGRESS, rule: 'Retry initiated' },
      { from: CustomerSyncState.PENDING, to: CustomerSyncState.SKIPPED, rule: 'Customer already exists in provider' },
    ],
  },
  businessRules: [
    'attemptCount increments on each IN_PROGRESS transition.',
    'SYNCED state requires externalReference and syncedAt.',
    'A customer can only have one active sync record per provider.',
  ],
  emittedEvents: [
    'customer_sync.started',
    'customer_sync.succeeded',
    'customer_sync.failed',
    'customer_sync.skipped',
  ],
  apiOperations: [
    { method: 'POST', path: '/accounting/customer-sync', summary: 'Create customer sync record' },
    { method: 'GET', path: '/accounting/customer-sync', summary: 'List customer sync records' },
    { method: 'GET', path: '/accounting/customer-sync/:id', summary: 'Get customer sync record' },
  ],
};

// ─── Payment Sync ─────────────────────────────────────────────────────────────

export enum PaymentSyncState {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  SYNCED = 'SYNCED',
  FAILED = 'FAILED',
  RECONCILED = 'RECONCILED',
  MISMATCH = 'MISMATCH',
}

export interface PaymentSyncRecord {
  id: string;
  invoiceSyncId?: string;
  workOrderId: string;
  customerId: string;
  qbPaymentId?: string;
  qbInvoiceId?: string;
  amountCents: number;
  paymentMethod?: string;
  paymentDate?: string;
  state: PaymentSyncState;
  direction: 'INBOUND' | 'OUTBOUND';
  errorMessage?: string;
  attemptCount: number;
  lastAttemptAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const PaymentSyncRecordDesign: EntityDesign<PaymentSyncState> = {
  entity: 'PaymentSyncRecord',
  purpose: 'Tracks inbound/outbound payment synchronization with QuickBooks.',
  keyFields: [
    'id',
    'workOrderId',
    'customerId',
    'qbPaymentId',
    'qbInvoiceId',
    'amountCents',
    'state',
    'direction',
    'attemptCount',
    'updatedAt',
  ],
  requiredIndexes: [
    { name: 'payment_sync_work_order_idx', fields: ['workOrderId'] },
    { name: 'payment_sync_state_idx', fields: ['state'] },
    { name: 'payment_sync_qb_payment_idx', fields: ['qbPaymentId'] },
  ],
  lifecycle: {
    initial: PaymentSyncState.PENDING,
    terminal: [PaymentSyncState.SYNCED, PaymentSyncState.RECONCILED, PaymentSyncState.MISMATCH],
    transitions: [
      { from: PaymentSyncState.PENDING, to: PaymentSyncState.IN_PROGRESS, rule: 'Payment processing started' },
      { from: PaymentSyncState.IN_PROGRESS, to: PaymentSyncState.SYNCED, rule: 'Payment sync succeeded' },
      { from: PaymentSyncState.IN_PROGRESS, to: PaymentSyncState.FAILED, rule: 'Payment sync failed' },
      { from: PaymentSyncState.FAILED, to: PaymentSyncState.IN_PROGRESS, rule: 'Retry initiated' },
      { from: PaymentSyncState.SYNCED, to: PaymentSyncState.RECONCILED, rule: 'Reconciliation confirmed match' },
      { from: PaymentSyncState.SYNCED, to: PaymentSyncState.MISMATCH, rule: 'Reconciliation found discrepancy' },
    ],
  },
  businessRules: [
    'attemptCount increments on each IN_PROGRESS transition.',
    'SYNCED state indicates payment recorded successfully.',
    'RECONCILED and MISMATCH are terminal states set during reconciliation.',
  ],
  emittedEvents: [
    'payment_sync.started',
    'payment_sync.completed',
    'payment_sync.failed',
  ],
  apiOperations: [
    { method: 'POST', path: '/accounting/webhook', summary: 'Receive QB payment webhook' },
    { method: 'GET', path: '/accounting/payment-syncs', summary: 'List payment sync records' },
  ],
};
