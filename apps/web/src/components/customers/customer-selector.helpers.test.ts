import assert from 'node:assert/strict';
import test from 'node:test';
import type { Customer } from '@/lib/api-client';
import {
  customerOptionMatchesSearch,
  customerSelectorEmptyMessage,
  customerToSearchableOption,
  isActiveSelectedCustomer,
  mergeCustomerResults,
  quoteCustomerSubmitError,
} from './customer-selector.helpers';

const activeCustomer: Customer = {
  id: 'cust-active',
  fullName: 'Kyle Rand',
  companyName: 'Golfin Garage',
  email: 'krand40@gmail.com',
  phone: '555-0100',
  state: 'ACTIVE',
  preferredContactMethod: 'EMAIL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const leadCustomer: Customer = {
  ...activeCustomer,
  id: 'cust-lead',
  companyName: undefined,
  email: 'lead@example.com',
  state: 'LEAD',
};

test('customer selector search matches customer display fields', () => {
  const option = customerToSearchableOption(activeCustomer);

  assert.equal(option.label, 'Golfin Garage');
  assert.equal(customerOptionMatchesSearch(option, 'garage'), true);
  assert.equal(customerOptionMatchesSearch(option, 'krand40'), true);
  assert.equal(customerOptionMatchesSearch(option, 'active'), true);
  assert.equal(customerOptionMatchesSearch(option, 'missing'), false);
});

test('customer selector keeps selected customer visible alongside active search results', () => {
  const merged = mergeCustomerResults([activeCustomer], leadCustomer);

  assert.deepEqual(
    merged.map((customer) => customer.id),
    ['cust-lead', 'cust-active'],
  );
  assert.deepEqual(
    mergeCustomerResults([activeCustomer], activeCustomer).map((customer) => customer.id),
    ['cust-active'],
  );
});

test('customer selector empty state explains active customer requirement', () => {
  assert.match(
    customerSelectorEmptyMessage('Riverside'),
    /No active customers matched "Riverside"/,
  );
  assert.match(customerSelectorEmptyMessage(''), /No active customers are available/);
});

test('quote customer submit validation requires a selected active catalog customer', () => {
  assert.equal(isActiveSelectedCustomer(activeCustomer.id, activeCustomer), true);
  assert.equal(isActiveSelectedCustomer(leadCustomer.id, leadCustomer), false);
  assert.equal(
    quoteCustomerSubmitError('', undefined),
    'Select an active customer before creating the quote.',
  );
  assert.equal(
    quoteCustomerSubmitError(activeCustomer.id, undefined),
    'Choose a customer from the catalog results before creating the quote.',
  );
  assert.equal(
    quoteCustomerSubmitError(leadCustomer.id, leadCustomer),
    'Only active customers can be used for new quotes.',
  );
  assert.equal(quoteCustomerSubmitError(activeCustomer.id, activeCustomer), undefined);
});
