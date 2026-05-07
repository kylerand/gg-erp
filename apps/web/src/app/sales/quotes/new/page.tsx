'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  createQuote,
  listCustomers,
  listOpportunities,
  listParts,
  type Customer,
  type Part,
  type SalesOpportunity,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';
import { PageHeader } from '@gg-erp/ui';
import PricingIntelligence from '@/components/sales/PricingIntelligence';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';

interface LineItem {
  key: string;
  partId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
}

const emptyLine = (key: string): LineItem => ({
  key,
  partId: '',
  description: '',
  quantity: 1,
  unitPrice: 0,
  discountPercent: 0,
});

function customerOption(customer: Customer): SearchableSelectOption {
  return {
    id: customer.id,
    label: customer.companyName ?? customer.fullName,
    description: [customer.fullName, customer.email, customer.phone].filter(Boolean).join(' · '),
    meta: customer.state,
  };
}

function opportunityOption(opportunity: SalesOpportunity): SearchableSelectOption {
  const estimatedValue = opportunity.estimatedValue ?? 0;
  return {
    id: opportunity.id,
    label: opportunity.title,
    description: `${opportunity.stage} · ${opportunity.probability}% probability`,
    meta: `$${estimatedValue.toLocaleString()} estimated`,
  };
}

function partOption(part: Part): SearchableSelectOption {
  return {
    id: part.id,
    label: `${part.sku} · ${part.name}`,
    description: [part.variant, part.manufacturerName, part.defaultVendorName]
      .filter(Boolean)
      .join(' · '),
    meta: part.quantityOnHand === undefined ? part.unitOfMeasure : `${part.quantityOnHand} on hand`,
  };
}

function filterOptions(options: SearchableSelectOption[], query: string): SearchableSelectOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options;
  return options.filter((option) =>
    [option.label, option.description, option.meta].some((value) =>
      value?.toLowerCase().includes(needle),
    ),
  );
}

export default function NewQuotePage() {
  const router = useRouter();
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [opportunitySearch, setOpportunitySearch] = useState('');
  const [notes, setNotes] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [lines, setLines] = useState<LineItem[]>(() => [emptyLine('quote-line-1')]);
  const [nextLineNumber, setNextLineNumber] = useState(2);
  const [partSearches, setPartSearches] = useState<Record<string, string>>({});
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [opportunities, setOpportunities] = useState<SalesOpportunity[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [referenceError, setReferenceError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setReferenceLoading(true);
    setReferenceError(undefined);

    Promise.all([
      listCustomers(
        { search: customerSearch || undefined, state: 'ACTIVE', limit: 25 },
        { allowMockFallback: false },
      ),
      listOpportunities(
        {
          customerId: customerId || undefined,
          search: opportunitySearch || undefined,
          limit: 25,
        },
        { allowMockFallback: false },
      ),
      listParts({ partState: 'ACTIVE', limit: 100 }, { allowMockFallback: false }),
    ])
      .then(([customerResult, opportunityResult, partResult]) => {
        if (!active) return;
        setCustomers(customerResult.items);
        setOpportunities(opportunityResult.items);
        setParts(partResult.items);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setCustomers([]);
        setOpportunities([]);
        setParts([]);
        setReferenceError(err instanceof Error ? err.message : 'Failed to load selector data.');
      })
      .finally(() => {
        if (active) setReferenceLoading(false);
      });

    return () => {
      active = false;
    };
  }, [customerId, customerSearch, opportunitySearch]);

  const customerOptions = useMemo(() => customers.map(customerOption), [customers]);
  const opportunityOptions = useMemo(() => opportunities.map(opportunityOption), [opportunities]);
  const partOptions = useMemo(() => parts.map(partOption), [parts]);
  const selectedCustomer = customerOptions.find((option) => option.id === customerId);
  const selectedOpportunity = opportunityOptions.find((option) => option.id === opportunityId);

  const updateLine = (key: string, field: keyof LineItem, value: string | number) => {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, [field]: value } : line)));
  };

  const selectPart = (line: LineItem, partId: string) => {
    const part = parts.find((item) => item.id === partId);
    setLines((prev) =>
      prev.map((item) =>
        item.key === line.key
          ? {
              ...item,
              partId,
              description: part ? `${part.sku} - ${part.name}` : item.description,
            }
          : item,
      ),
    );
  };

  const addLine = () => {
    setLines((prev) => [...prev, emptyLine(`quote-line-${nextLineNumber}`)]);
    setNextLineNumber((prev) => prev + 1);
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((line) => line.key !== key));
    setPartSearches((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const lineTotal = (line: LineItem) => {
    const base = line.quantity * line.unitPrice;
    return base - base * (line.discountPercent / 100);
  };

  const quoteTotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);

  const handleSubmit = async () => {
    if (!customerId.trim()) {
      setError('Customer is required.');
      return;
    }
    if (lines.length === 0 || lines.every((line) => !line.description.trim())) {
      setError('At least one line item is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const quote = await createQuote({
        customerId,
        opportunityId: opportunityId || undefined,
        notes: notes.trim() || undefined,
        validUntil: validUntil || undefined,
        lines: lines
          .filter((line) => line.description.trim())
          .map((line) => ({
            partId: line.partId || undefined,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent || undefined,
          })),
      });
      router.push(erpRecordRoute('quote', quote.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create quote.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Link href={erpRoute('sales')} className="hover:text-yellow-600">
          Sales
        </Link>
        <span>/</span>
        <Link href={erpRoute('quote')} className="hover:text-yellow-600">
          Quotes
        </Link>
        <span>/</span>
        <span className="font-medium text-gray-900">New Quote</span>
      </div>

      <PageHeader title="New Quote" description="Build a quote from live customers and parts." />

      {(error || referenceError) && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error ?? referenceError}
        </div>
      )}

      <div className="mb-6 space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SearchableSelect
            id="quote-customer"
            label="Customer"
            required
            value={customerId}
            selectedOption={selectedCustomer}
            searchValue={customerSearch}
            options={customerOptions}
            loading={referenceLoading}
            error={referenceError}
            placeholder="Search customers"
            emptyText="No active customers matched this search."
            onSearchChange={setCustomerSearch}
            onChange={(nextCustomerId) => {
              setCustomerId(nextCustomerId);
              setOpportunityId('');
            }}
          />
          <SearchableSelect
            id="quote-opportunity"
            label="Opportunity"
            value={opportunityId}
            selectedOption={selectedOpportunity}
            searchValue={opportunitySearch}
            options={opportunityOptions}
            loading={referenceLoading}
            error={referenceError}
            placeholder="Search open opportunities"
            emptyText={
              customerId
                ? 'No opportunities are open for this customer.'
                : 'Select a customer to narrow opportunity results.'
            }
            onSearchChange={setOpportunitySearch}
            onChange={setOpportunityId}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="validUntil" className="mb-1 block">
              Valid Until
            </Label>
            <Input
              id="validUntil"
              type="date"
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="notes" className="mb-1 block">
              Notes
            </Label>
            <Input
              id="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional notes"
            />
          </div>
        </div>
      </div>

      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Line Items</h2>
          <Button type="button" size="sm" variant="outline" onClick={addLine}>
            Add Line
          </Button>
        </div>

        <div className="space-y-3">
          {lines.map((line) => {
            const selectedPart = partOptions.find((option) => option.id === line.partId);
            const filteredPartOptions = filterOptions(partOptions, partSearches[line.key] ?? '');

            return (
              <div key={line.key} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="grid gap-4 lg:grid-cols-[1.4fr_1.5fr_.55fr_.75fr_.65fr_auto]">
                  <SearchableSelect
                    id={`part-${line.key}`}
                    label="Part"
                    value={line.partId}
                    selectedOption={selectedPart}
                    searchValue={partSearches[line.key] ?? ''}
                    options={filteredPartOptions}
                    loading={referenceLoading}
                    error={referenceError}
                    placeholder="Search parts"
                    emptyText="No active parts matched this search."
                    onSearchChange={(value) =>
                      setPartSearches((prev) => ({ ...prev, [line.key]: value }))
                    }
                    onChange={(partId) => selectPart(line, partId)}
                  />
                  <div>
                    <Label htmlFor={`description-${line.key}`} className="mb-1 block">
                      Description
                    </Label>
                    <Input
                      id={`description-${line.key}`}
                      value={line.description}
                      onChange={(event) => updateLine(line.key, 'description', event.target.value)}
                      placeholder="Line description"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`quantity-${line.key}`} className="mb-1 block">
                      Qty
                    </Label>
                    <Input
                      id={`quantity-${line.key}`}
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(line.key, 'quantity', Number(event.target.value))
                      }
                      className="text-right"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`unitPrice-${line.key}`} className="mb-1 block">
                      Unit Price
                    </Label>
                    <Input
                      id={`unitPrice-${line.key}`}
                      type="number"
                      min={0}
                      step={0.01}
                      value={line.unitPrice}
                      onChange={(event) =>
                        updateLine(line.key, 'unitPrice', Number(event.target.value))
                      }
                      className="text-right"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`discount-${line.key}`} className="mb-1 block">
                      Discount %
                    </Label>
                    <Input
                      id={`discount-${line.key}`}
                      type="number"
                      min={0}
                      max={100}
                      value={line.discountPercent}
                      onChange={(event) =>
                        updateLine(line.key, 'discountPercent', Number(event.target.value))
                      }
                      className="text-right"
                    />
                  </div>
                  <div className="flex flex-col justify-end gap-2">
                    <div className="text-right font-mono text-sm font-semibold text-gray-900">
                      $
                      {lineTotal(line).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                    {lines.length > 1 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => removeLine(line.key)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex justify-end">
          <div className="text-sm font-bold text-gray-900">
            Total:{' '}
            <span className="font-mono">
              $
              {quoteTotal.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>
      </div>

      {lines.some((line) => line.description.trim() && line.unitPrice > 0) && (
        <div className="mb-6">
          <PricingIntelligence
            customerId={customerId || undefined}
            customerName={selectedCustomer?.label}
            opportunityId={opportunityId || undefined}
            items={lines
              .filter((line) => line.description.trim())
              .map((line) => ({
                name: line.description,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
              }))}
          />
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || !customerId}
          className="bg-yellow-400 font-semibold text-gray-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {submitting ? 'Creating...' : 'Create Quote'}
        </Button>
        <Link href={erpRoute('quote')} className="text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </Link>
      </div>
    </div>
  );
}
