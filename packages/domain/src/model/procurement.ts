import type { EntityDesign } from './shared.js';

export enum VendorState {
  ACTIVE = 'ACTIVE',
  ON_HOLD = 'ON_HOLD',
  INACTIVE = 'INACTIVE'
}

export interface Vendor {
  id: string;
  vendorCode: string;
  state: VendorState;
  name: string;
  email?: string;
  phone?: string;
  leadTimeDays?: number;
  createdAt: string;
  updatedAt: string;
}

export const VendorDesign: EntityDesign<VendorState> = {
  entity: 'Vendor',
  purpose: 'Represents a supplier of parts/services used in production.',
  keyFields: ['id', 'vendorCode', 'state', 'name', 'leadTimeDays', 'updatedAt'],
  requiredIndexes: [
    { name: 'vendors_vendor_code_uk', fields: ['vendorCode'], unique: true },
    { name: 'vendors_state_idx', fields: ['state'] }
  ],
  lifecycle: {
    initial: VendorState.ACTIVE,
    terminal: [VendorState.INACTIVE],
    transitions: [
      { from: VendorState.ACTIVE, to: VendorState.ON_HOLD, rule: 'Compliance or delivery issue' },
      { from: VendorState.ON_HOLD, to: VendorState.ACTIVE, rule: 'Issue resolved' },
      { from: VendorState.ACTIVE, to: VendorState.INACTIVE, rule: 'Vendor retired' },
      { from: VendorState.ON_HOLD, to: VendorState.INACTIVE, rule: 'Vendor retired while on hold' }
    ]
  },
  businessRules: [
    'Only ACTIVE vendors can receive new purchase orders.',
    'leadTimeDays must be >= 0 when provided.'
  ],
  emittedEvents: ['vendor.created', 'vendor.updated', 'vendor.state_changed'],
  apiOperations: [
    { method: 'POST', path: '/inventory/vendors', summary: 'Create vendor' },
    { method: 'PATCH', path: '/inventory/vendors/:id', summary: 'Update vendor profile' },
    { method: 'PATCH', path: '/inventory/vendors/:id/state', summary: 'Set vendor state' }
  ]
};

export enum PurchaseOrderState {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
  SENT = 'SENT',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED'
}

export interface PurchaseOrderLine {
  id: string;
  partSkuId: string;
  orderedQty: number;
  receivedQty: number;
  unitCost: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  vendorId: string;
  state: PurchaseOrderState;
  orderedAt: string;
  expectedAt?: string;
  approvedBy?: string;
  notes?: string;
  lines: PurchaseOrderLine[];
  updatedAt: string;
}

export const PurchaseOrderDesign: EntityDesign<PurchaseOrderState> = {
  entity: 'PurchaseOrder',
  purpose: 'Tracks vendor procurement lifecycle and inbound inventory commitments.',
  keyFields: [
    'id',
    'poNumber',
    'vendorId',
    'state',
    'orderedAt',
    'expectedAt',
    'approvedBy',
    'updatedAt'
  ],
  requiredIndexes: [
    { name: 'purchase_orders_number_uk', fields: ['poNumber'], unique: true },
    { name: 'purchase_orders_vendor_state_idx', fields: ['vendorId', 'state'] },
    { name: 'purchase_orders_expected_at_idx', fields: ['expectedAt'] }
  ],
  lifecycle: {
    initial: PurchaseOrderState.DRAFT,
    terminal: [PurchaseOrderState.RECEIVED, PurchaseOrderState.CANCELLED],
    transitions: [
      {
        from: PurchaseOrderState.DRAFT,
        to: PurchaseOrderState.APPROVED,
        rule: 'Approved by authorized purchaser'
      },
      { from: PurchaseOrderState.APPROVED, to: PurchaseOrderState.SENT, rule: 'Dispatched to vendor' },
      {
        from: PurchaseOrderState.SENT,
        to: PurchaseOrderState.PARTIALLY_RECEIVED,
        rule: 'Some lines received'
      },
      {
        from: PurchaseOrderState.SENT,
        to: PurchaseOrderState.RECEIVED,
        rule: 'All lines received in one shipment'
      },
      {
        from: PurchaseOrderState.PARTIALLY_RECEIVED,
        to: PurchaseOrderState.RECEIVED,
        rule: 'All remaining quantities received'
      },
      {
        from: PurchaseOrderState.DRAFT,
        to: PurchaseOrderState.CANCELLED,
        rule: 'Draft PO cancelled before approval'
      },
      {
        from: PurchaseOrderState.APPROVED,
        to: PurchaseOrderState.CANCELLED,
        rule: 'Approved PO cancelled before send'
      },
      {
        from: PurchaseOrderState.SENT,
        to: PurchaseOrderState.CANCELLED,
        rule: 'Sent PO cancelled only with zero received quantities'
      }
    ]
  },
  businessRules: [
    'Each line in a PO must reference a unique partSkuId.',
    'orderedQty must be > 0 and unitCost >= 0.',
    'RECEIVED state requires sum(receivedQty) = sum(orderedQty).',
    'CANCELLED state is invalid when any line has receivedQty > 0.'
  ],
  emittedEvents: [
    'purchase_order.created',
    'purchase_order.approved',
    'purchase_order.sent',
    'purchase_order.partially_received',
    'purchase_order.received',
    'purchase_order.cancelled'
  ],
  apiOperations: [
    { method: 'POST', path: '/inventory/purchase-orders', summary: 'Create purchase order draft' },
    {
      method: 'PATCH',
      path: '/inventory/purchase-orders/:id/approve',
      summary: 'Approve purchase order'
    },
    { method: 'PATCH', path: '/inventory/purchase-orders/:id/send', summary: 'Mark purchase order sent' },
    {
      method: 'PATCH',
      path: '/inventory/purchase-orders/:id/receive',
      summary: 'Register received quantities'
    },
    {
      method: 'PATCH',
      path: '/inventory/purchase-orders/:id/cancel',
      summary: 'Cancel purchase order'
    }
  ]
};
