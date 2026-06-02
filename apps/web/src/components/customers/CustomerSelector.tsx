'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getCustomer, listCustomers, type Customer } from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  customerSelectorEmptyMessage,
  customerToSearchableOption,
  isActiveSelectedCustomer,
  mergeCustomerResults,
} from './customer-selector.helpers';

interface CustomerSelectorProps {
  id: string;
  label?: string;
  required?: boolean;
  value: string;
  onChange: (customerId: string, customer?: Customer) => void;
  onResolvedCustomer?: (customer?: Customer) => void;
  onLoadingChange?: (loading: boolean) => void;
  placeholder?: string;
}

export function CustomerSelector({
  id,
  label = 'Customer',
  required,
  value,
  onChange,
  onResolvedCustomer,
  onLoadingChange,
  placeholder = 'Search customers by name, company, or email',
}: CustomerSelectorProps) {
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    onLoadingChange?.(true);
    setError(undefined);

    const activeCustomersRequest = listCustomers(
      { search: search || undefined, state: 'ACTIVE', limit: 25 },
      { allowMockFallback: false },
    );
    const selectedCustomerRequest = value
      ? getCustomer(value, { allowMockFallback: false }).catch(() => undefined)
      : Promise.resolve(undefined);

    Promise.all([activeCustomersRequest, selectedCustomerRequest])
      .then(([customerResult, selectedCustomer]) => {
        if (!active) return;
        const nextCustomers = mergeCustomerResults(customerResult.items, selectedCustomer);
        setCustomers(nextCustomers);
        onResolvedCustomer?.(selectedCustomer);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setCustomers([]);
        onResolvedCustomer?.(undefined);
        setError(err instanceof Error ? err.message : 'Failed to load active customers.');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        onLoadingChange?.(false);
      });

    return () => {
      active = false;
    };
  }, [onLoadingChange, onResolvedCustomer, search, value]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === value),
    [customers, value],
  );
  const options = useMemo(() => customers.map(customerToSearchableOption), [customers]);
  const selectedOption = selectedCustomer
    ? customerToSearchableOption(selectedCustomer)
    : undefined;
  const selectedInactive = Boolean(
    value && selectedCustomer && !isActiveSelectedCustomer(value, selectedCustomer),
  );

  return (
    <div className="space-y-2">
      <SearchableSelect
        id={id}
        label={label}
        required={required}
        value={value}
        selectedOption={selectedOption}
        searchValue={search}
        options={options}
        loading={loading}
        error={error}
        placeholder={placeholder}
        emptyText={
          <span>
            {customerSelectorEmptyMessage(search)}{' '}
            <Link
              href={erpRoute('create-customer')}
              className="font-semibold text-amber-700 hover:underline"
            >
              Create customer
            </Link>
          </span>
        }
        onSearchChange={setSearch}
        onChange={(nextCustomerId) => {
          const nextCustomer = customers.find((customer) => customer.id === nextCustomerId);
          onChange(nextCustomerId, nextCustomer);
        }}
      />
      {selectedInactive && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          This customer is {selectedCustomer?.state.toLowerCase()}. Activate the customer before
          using it on new quotes or work orders.
        </div>
      )}
    </div>
  );
}
