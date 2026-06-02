import type { Customer } from '@/lib/api-client';
import type { SearchableSelectOption } from '@/components/ui/searchable-select';

export function customerDisplayName(customer: Pick<Customer, 'companyName' | 'fullName'>): string {
  return customer.companyName ?? customer.fullName;
}

export function customerToSearchableOption(customer: Customer): SearchableSelectOption {
  return {
    id: customer.id,
    label: customerDisplayName(customer),
    description: [customer.fullName, customer.email, customer.phone].filter(Boolean).join(' · '),
    meta: customer.state,
  };
}

export function mergeCustomerResults(
  activeCustomers: Customer[],
  selectedCustomer?: Customer,
): Customer[] {
  if (!selectedCustomer) return activeCustomers;
  const withoutSelected = activeCustomers.filter((customer) => customer.id !== selectedCustomer.id);
  return [selectedCustomer, ...withoutSelected];
}

export function customerOptionMatchesSearch(
  option: SearchableSelectOption,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [option.label, option.description, option.meta].some((value) =>
    value?.toLowerCase().includes(needle),
  );
}

export function isActiveSelectedCustomer(customerId: string, selectedCustomer?: Customer): boolean {
  return Boolean(
    customerId && selectedCustomer?.id === customerId && selectedCustomer.state === 'ACTIVE',
  );
}

export function requiredActiveCustomerSubmitError(
  customerId: string,
  selectedCustomer?: Customer,
  recordLabel = 'record',
  pluralRecordLabel = `${recordLabel}s`,
): string | undefined {
  if (!customerId) return `Select an active customer before creating the ${recordLabel}.`;
  if (!selectedCustomer)
    return `Choose a customer from the catalog results before creating the ${recordLabel}.`;
  if (selectedCustomer.state !== 'ACTIVE') {
    return `Only active customers can be used for new ${pluralRecordLabel}.`;
  }
  return undefined;
}

export function quoteCustomerSubmitError(
  customerId: string,
  selectedCustomer?: Customer,
): string | undefined {
  return requiredActiveCustomerSubmitError(customerId, selectedCustomer, 'quote', 'quotes');
}

export function customerSelectorEmptyMessage(search: string): string {
  const term = search.trim();
  return term
    ? `No active customers matched "${term}". Add or activate the customer before continuing.`
    : 'No active customers are available. Add or activate a customer before continuing.';
}
