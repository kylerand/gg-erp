import type { EntityDesign } from './shared.js';

export enum CustomerLifecycleState {
  LEAD = 'LEAD',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ARCHIVED = 'ARCHIVED'
}

export interface Customer {
  id: string;
  state: CustomerLifecycleState;
  externalReference?: string;
  fullName: string;
  companyName?: string;
  email: string;
  phone?: string;
  billingAddress?: string;
  shippingAddress?: string;
  preferredContactMethod: 'EMAIL' | 'PHONE' | 'SMS';
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export const CustomerDesign: EntityDesign<CustomerLifecycleState> = {
  entity: 'Customer',
  purpose: 'Represents the commercial party ordering builds and receiving invoices.',
  keyFields: [
    'id',
    'state',
    'fullName',
    'email',
    'preferredContactMethod',
    'createdAt',
    'updatedAt'
  ],
  requiredIndexes: [
    { name: 'customers_email_uk', fields: ['email'], unique: true },
    { name: 'customers_state_idx', fields: ['state'] },
    { name: 'customers_updated_at_idx', fields: ['updatedAt'] }
  ],
  lifecycle: {
    initial: CustomerLifecycleState.LEAD,
    terminal: [CustomerLifecycleState.ARCHIVED],
    transitions: [
      {
        from: CustomerLifecycleState.LEAD,
        to: CustomerLifecycleState.ACTIVE,
        rule: 'Lead is qualified and has a valid contact profile'
      },
      {
        from: CustomerLifecycleState.ACTIVE,
        to: CustomerLifecycleState.INACTIVE,
        rule: 'Customer account is temporarily paused'
      },
      {
        from: CustomerLifecycleState.INACTIVE,
        to: CustomerLifecycleState.ACTIVE,
        rule: 'Customer reactivated'
      },
      {
        from: CustomerLifecycleState.ACTIVE,
        to: CustomerLifecycleState.ARCHIVED,
        rule: 'Customer removed from active business workflows'
      },
      {
        from: CustomerLifecycleState.INACTIVE,
        to: CustomerLifecycleState.ARCHIVED,
        rule: 'Inactive customer archived'
      }
    ]
  },
  businessRules: [
    'Email must be unique for active customers.',
    'Archived customers cannot be assigned to new build configurations.',
    'At least one contact method must be valid for ACTIVE customers.'
  ],
  emittedEvents: [
    'customer.created',
    'customer.updated',
    'customer.state_changed',
    'customer.archived'
  ],
  apiOperations: [
    { method: 'POST', path: '/customers', summary: 'Create customer' },
    { method: 'GET', path: '/customers/:id', summary: 'Get customer by id' },
    { method: 'PATCH', path: '/customers/:id', summary: 'Update customer profile' },
    {
      method: 'PATCH',
      path: '/customers/:id/state',
      summary: 'Transition customer lifecycle state'
    }
  ]
};
