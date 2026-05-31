'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@gg-erp/ui';
import { createOpportunity, getCustomer, listCustomers, type Customer } from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';

const STRICT_LIVE_DATA = { allowMockFallback: false } as const;

const STAGES = [
  { value: 'PROSPECT', label: 'Prospect' },
  { value: 'QUALIFIED', label: 'Qualified' },
  { value: 'PROPOSAL', label: 'Proposal' },
  { value: 'NEGOTIATION', label: 'Negotiation' },
] as const;

const SOURCES = [
  { value: 'OTHER', label: 'Other' },
  { value: 'PHONE', label: 'Phone' },
  { value: 'WALK_IN', label: 'Walk in' },
  { value: 'REFERRAL', label: 'Referral' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'EVENT', label: 'Event' },
] as const;

function customerOption(customer: Customer): SearchableSelectOption {
  return {
    id: customer.id,
    label: customer.companyName ?? customer.fullName,
    description: [customer.fullName, customer.email, customer.phone].filter(Boolean).join(' · '),
    meta: customer.state,
  };
}

export default function NewOpportunityPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCustomerId = searchParams.get('customerId') ?? '';
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [referenceError, setReferenceError] = useState<string | undefined>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stage, setStage] = useState<(typeof STAGES)[number]['value']>('PROSPECT');
  const [source, setSource] = useState<(typeof SOURCES)[number]['value']>('OTHER');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setReferenceLoading(true);
    setReferenceError(undefined);

    const customerRequest =
      customerId && !customerSearch
        ? getCustomer(customerId, STRICT_LIVE_DATA).then((customer) => ({
            items: [customer],
            total: 1,
          }))
        : listCustomers(
            { search: customerSearch || undefined, state: 'ACTIVE', limit: 25 },
            STRICT_LIVE_DATA,
          );

    customerRequest
      .then((customerResult) => {
        if (!active) return;
        setCustomers(customerResult.items);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setCustomers([]);
        setReferenceError(err instanceof Error ? err.message : 'Failed to load customers.');
      })
      .finally(() => {
        if (active) setReferenceLoading(false);
      });

    return () => {
      active = false;
    };
  }, [customerId, customerSearch]);

  const customerOptions = useMemo(() => customers.map(customerOption), [customers]);
  const selectedCustomer = customerOptions.find((option) => option.id === customerId);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!customerId) {
      setError('Customer is required.');
      return;
    }
    if (!title.trim()) {
      setError('Opportunity title is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const opportunity = await createOpportunity({
        customerId,
        title: title.trim(),
        description: description.trim() || undefined,
        stage,
        estimatedValue: estimatedValue ? Number(estimatedValue) : undefined,
        expectedCloseDate: expectedCloseDate || undefined,
        source,
      });
      router.push(erpRecordRoute('sales-opportunity', opportunity.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create opportunity.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Link href={erpRoute('sales')} className="hover:text-yellow-600">
          Sales
        </Link>
        <span>/</span>
        <Link href={erpRoute('sales-pipeline')} className="hover:text-yellow-600">
          Pipeline
        </Link>
        <span>/</span>
        <span className="font-medium text-gray-900">New Opportunity</span>
      </div>

      <PageHeader
        title="New Opportunity"
        description="Create a deal record from a live customer for follow-up and quoting"
      />

      {(error || referenceError) && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error ?? referenceError}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="max-w-3xl space-y-5 rounded-lg border border-gray-200 bg-white p-6"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <SearchableSelect
            id="opportunity-customer"
            label="Customer"
            required
            value={customerId}
            selectedOption={selectedCustomer}
            searchValue={customerSearch}
            options={customerOptions}
            loading={referenceLoading}
            error={referenceError}
            placeholder="Search customers by name, company, or email"
            emptyText="No active customers matched this search."
            onSearchChange={setCustomerSearch}
            onChange={setCustomerId}
          />
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Title</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Custom cart build"
              required
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700">Description</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-yellow-400 focus:outline-none focus:ring-2 focus:ring-yellow-100"
            placeholder="Scope, requested upgrades, timeline, or follow-up notes"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Stage</span>
            <select
              value={stage}
              onChange={(event) => setStage(event.target.value as typeof stage)}
              className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm focus:border-yellow-400 focus:outline-none focus:ring-2 focus:ring-yellow-100"
            >
              {STAGES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Source</span>
            <select
              value={source}
              onChange={(event) => setSource(event.target.value as typeof source)}
              className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm focus:border-yellow-400 focus:outline-none focus:ring-2 focus:ring-yellow-100"
            >
              {SOURCES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Estimated Value</span>
            <Input
              value={estimatedValue}
              onChange={(event) => setEstimatedValue(event.target.value)}
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-gray-700">Expected Close</span>
            <Input
              value={expectedCloseDate}
              onChange={(event) => setExpectedCloseDate(event.target.value)}
              type="date"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={submitting}
            className="bg-yellow-400 text-gray-900 hover:bg-yellow-300"
          >
            {submitting ? 'Creating...' : 'Create Opportunity'}
          </Button>
          <Link
            href={erpRoute('sales-pipeline')}
            className="inline-flex h-10 items-center rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-700 hover:border-yellow-400"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
