'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { EmptyState, LoadingSkeleton, PageHeader, StatusBadge } from '@gg-erp/ui';
import {
  getCustomer,
  listActivities,
  listCartVehicles,
  listCustomerSyncs,
  listOpportunities,
  listPaymentSyncRecords,
  listQuotes,
  listWoOrders,
  paymentSyncWorkOrderDisplayName,
  salesUserDisplayName,
  updateCustomer,
  type CartVehicle,
  type Customer,
  type CustomerSyncRecord,
  type PaymentSyncRecord,
  type Quote,
  type SalesActivity,
  type SalesOpportunity,
  type UpdateCustomerInput,
  type WoOrder,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const STRICT_LIVE_DATA = { allowMockFallback: false } as const;
const CONTACT_METHOD_OPTIONS = ['EMAIL', 'PHONE', 'SMS'] as const;

interface RelatedLoad<T> {
  items: T[];
  total: number;
}

interface CustomerProfileDraft {
  fullName: string;
  companyName: string;
  email: string;
  phone: string;
  preferredContactMethod: 'EMAIL' | 'PHONE' | 'SMS';
  billingAddress: string;
  shippingAddress: string;
}

function customerDisplayName(customer: Customer): string {
  return customer.companyName ?? customer.fullName;
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatCurrency(value?: number | null): string {
  if (value == null) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function normalizeStatus(value: string): string {
  return value.replace(/_/g, ' ');
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

function customerDraftFromCustomer(customer: Customer): CustomerProfileDraft {
  return {
    fullName: customer.fullName,
    companyName: customer.companyName ?? '',
    email: customer.email,
    phone: customer.phone ?? '',
    preferredContactMethod: CONTACT_METHOD_OPTIONS.includes(
      customer.preferredContactMethod as CustomerProfileDraft['preferredContactMethod'],
    )
      ? (customer.preferredContactMethod as CustomerProfileDraft['preferredContactMethod'])
      : 'EMAIL',
    billingAddress: customer.billingAddress ?? '',
    shippingAddress: customer.shippingAddress ?? '',
  };
}

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {count !== undefined && <p className="text-xs text-gray-500">{count} total</p>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ActionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-700 hover:border-yellow-400"
    >
      {children}
    </Link>
  );
}

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="mt-1 text-xs font-medium uppercase text-gray-500">{label}</div>
    </div>
  );
}

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id;
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [vehicles, setVehicles] = useState<RelatedLoad<CartVehicle>>({ items: [], total: 0 });
  const [workOrders, setWorkOrders] = useState<RelatedLoad<WoOrder>>({ items: [], total: 0 });
  const [opportunities, setOpportunities] = useState<RelatedLoad<SalesOpportunity>>({
    items: [],
    total: 0,
  });
  const [quotes, setQuotes] = useState<RelatedLoad<Quote>>({ items: [], total: 0 });
  const [activities, setActivities] = useState<RelatedLoad<SalesActivity>>({ items: [], total: 0 });
  const [customerSyncs, setCustomerSyncs] = useState<RelatedLoad<CustomerSyncRecord>>({
    items: [],
    total: 0,
  });
  const [paymentSyncs, setPaymentSyncs] = useState<RelatedLoad<PaymentSyncRecord>>({
    items: [],
    total: 0,
  });
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState<CustomerProfileDraft | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);

    const [
      customerResult,
      vehicleResult,
      workOrderResult,
      opportunityResult,
      quoteResult,
      activityResult,
      customerSyncResult,
      paymentSyncResult,
    ] = await Promise.allSettled([
      getCustomer(customerId, STRICT_LIVE_DATA),
      listCartVehicles({ customerId, limit: 50 }, STRICT_LIVE_DATA),
      listWoOrders({ customerId, limit: 25 }, STRICT_LIVE_DATA),
      listOpportunities({ customerId, limit: 25 }, STRICT_LIVE_DATA),
      listQuotes({ customerId, limit: 25 }, STRICT_LIVE_DATA),
      listActivities({ customerId, limit: 25 }, STRICT_LIVE_DATA),
      listCustomerSyncs({ customerId, limit: 10 }, STRICT_LIVE_DATA),
      listPaymentSyncRecords({ customerId, limit: 10 }, STRICT_LIVE_DATA),
    ]);

    const nextErrors: string[] = [];
    if (customerResult.status === 'fulfilled') {
      setCustomer(customerResult.value);
    } else {
      setCustomer(null);
      nextErrors.push(
        customerResult.reason instanceof Error
          ? customerResult.reason.message
          : 'Failed to load customer profile.',
      );
    }

    if (vehicleResult.status === 'fulfilled') {
      setVehicles(vehicleResult.value);
    } else {
      setVehicles({ items: [], total: 0 });
      nextErrors.push('Cart assets failed to load.');
    }

    if (workOrderResult.status === 'fulfilled') {
      setWorkOrders(workOrderResult.value);
    } else {
      setWorkOrders({ items: [], total: 0 });
      nextErrors.push('Work orders failed to load.');
    }

    if (opportunityResult.status === 'fulfilled') {
      setOpportunities(opportunityResult.value);
    } else {
      setOpportunities({ items: [], total: 0 });
      nextErrors.push('Opportunities failed to load.');
    }

    if (quoteResult.status === 'fulfilled') {
      setQuotes(quoteResult.value);
    } else {
      setQuotes({ items: [], total: 0 });
      nextErrors.push('Quotes failed to load.');
    }

    if (activityResult.status === 'fulfilled') {
      setActivities(activityResult.value);
    } else {
      setActivities({ items: [], total: 0 });
      nextErrors.push('Sales activity failed to load.');
    }

    if (customerSyncResult.status === 'fulfilled') {
      setCustomerSyncs(customerSyncResult.value);
    } else {
      setCustomerSyncs({ items: [], total: 0 });
      nextErrors.push('Customer accounting sync failed to load.');
    }

    if (paymentSyncResult.status === 'fulfilled') {
      setPaymentSyncs(paymentSyncResult.value);
    } else {
      setPaymentSyncs({ items: [], total: 0 });
      nextErrors.push('Payment sync history failed to load.');
    }

    setErrors(nextErrors);
    setLoading(false);
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  function beginProfileEdit() {
    if (!customer) return;
    setProfileDraft(customerDraftFromCustomer(customer));
    setProfileSaveError(null);
    setEditingProfile(true);
  }

  async function saveProfile() {
    if (!customer || !profileDraft) return;
    if (!profileDraft.fullName.trim()) {
      setProfileSaveError('Customer name is required.');
      return;
    }
    if (!profileDraft.email.trim()) {
      setProfileSaveError('Customer email is required.');
      return;
    }

    const payload: UpdateCustomerInput = {
      fullName: profileDraft.fullName.trim(),
      companyName: optionalText(profileDraft.companyName),
      email: profileDraft.email.trim(),
      phone: optionalText(profileDraft.phone),
      preferredContactMethod: profileDraft.preferredContactMethod,
      billingAddress: optionalText(profileDraft.billingAddress),
      shippingAddress: optionalText(profileDraft.shippingAddress),
    };

    setSavingProfile(true);
    setProfileSaveError(null);
    try {
      const updated = await updateCustomer(customer.id, payload);
      setCustomer(updated);
      setEditingProfile(false);
      setProfileDraft(null);
    } catch (error) {
      setProfileSaveError(errorMessage(error));
    } finally {
      setSavingProfile(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Customer" description="Loading live customer workspace..." />
        <LoadingSkeleton rows={7} cols={4} />
      </div>
    );
  }

  if (!customer) {
    return (
      <div>
        <PageHeader title="Customer Not Found" />
        <EmptyState
          title="Customer could not be loaded"
          description={errors[0] ?? `No live customer profile was returned for ${customerId}.`}
          action={<ActionLink href={erpRoute('customer')}>Back to customers</ActionLink>}
        />
      </div>
    );
  }

  const displayName = customerDisplayName(customer);
  const primaryVehicle = vehicles.items[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={erpRoute('customers')} className="hover:text-yellow-600">
          Customer & Dealer Ops
        </Link>
        <span>/</span>
        <Link href={erpRoute('customer')} className="hover:text-yellow-600">
          Customers
        </Link>
        <span>/</span>
        <span className="font-medium text-gray-900">{displayName}</span>
      </div>

      <PageHeader
        title={displayName}
        description={[customer.email, customer.phone, customer.preferredContactMethod]
          .filter(Boolean)
          .join(' · ')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionLink href={erpRoute('create-sales-opportunity', { customerId })}>
              New Opportunity
            </ActionLink>
            <ActionLink href={erpRoute('create-quote', { customerId })}>New Quote</ActionLink>
            <ActionLink
              href={erpRoute('create-work-order', {
                customerId,
                vehicleId: primaryVehicle?.id,
              })}
            >
              New Work Order
            </ActionLink>
          </div>
        }
      />

      {errors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {errors.join(' ')}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricTile label="Cart Assets" value={vehicles.total} />
        <MetricTile label="Work Orders" value={workOrders.total} />
        <MetricTile label="Opportunities" value={opportunities.total} />
        <MetricTile label="Quotes" value={quotes.total} />
        <MetricTile label="Activities" value={activities.total} />
        <MetricTile label="Accounting Sync" value={customerSyncs.total + paymentSyncs.total} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.35fr]">
        <Section
          title="Contact & Profile"
          action={
            !editingProfile ? (
              <Button type="button" size="sm" variant="outline" onClick={beginProfileEdit}>
                Edit Profile
              </Button>
            ) : null
          }
        >
          {editingProfile && profileDraft ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase text-gray-500">Full Name</span>
                  <Input
                    value={profileDraft.fullName}
                    onChange={(event) =>
                      setProfileDraft((current) =>
                        current ? { ...current, fullName: event.target.value } : current,
                      )
                    }
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase text-gray-500">Company</span>
                  <Input
                    value={profileDraft.companyName}
                    onChange={(event) =>
                      setProfileDraft((current) =>
                        current ? { ...current, companyName: event.target.value } : current,
                      )
                    }
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase text-gray-500">Email</span>
                  <Input
                    type="email"
                    value={profileDraft.email}
                    onChange={(event) =>
                      setProfileDraft((current) =>
                        current ? { ...current, email: event.target.value } : current,
                      )
                    }
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase text-gray-500">Phone</span>
                  <Input
                    value={profileDraft.phone}
                    onChange={(event) =>
                      setProfileDraft((current) =>
                        current ? { ...current, phone: event.target.value } : current,
                      )
                    }
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase text-gray-500">Preferred</span>
                  <select
                    className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
                    value={profileDraft.preferredContactMethod}
                    onChange={(event) =>
                      setProfileDraft((current) =>
                        current
                          ? {
                              ...current,
                              preferredContactMethod: event.target
                                .value as CustomerProfileDraft['preferredContactMethod'],
                            }
                          : current,
                      )
                    }
                  >
                    {CONTACT_METHOD_OPTIONS.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-gray-500">
                  Billing Address
                </span>
                <Textarea
                  rows={2}
                  value={profileDraft.billingAddress}
                  onChange={(event) =>
                    setProfileDraft((current) =>
                      current ? { ...current, billingAddress: event.target.value } : current,
                    )
                  }
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase text-gray-500">
                  Shipping Address
                </span>
                <Textarea
                  rows={2}
                  value={profileDraft.shippingAddress}
                  onChange={(event) =>
                    setProfileDraft((current) =>
                      current ? { ...current, shippingAddress: event.target.value } : current,
                    )
                  }
                />
              </label>
              {profileSaveError && <p className="text-sm text-red-700">{profileSaveError}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={saveProfile} disabled={savingProfile}>
                  {savingProfile ? 'Saving' : 'Save Profile'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingProfile(false);
                    setProfileDraft(null);
                    setProfileSaveError(null);
                  }}
                  disabled={savingProfile}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Lifecycle</dt>
                <dd className="mt-1">
                  <StatusBadge status={customer.state} />
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Preferred Contact</dt>
                <dd className="mt-1 text-gray-900">
                  {normalizeStatus(customer.preferredContactMethod)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Full Name</dt>
                <dd className="mt-1 text-gray-900">{customer.fullName}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Company</dt>
                <dd className="mt-1 text-gray-900">{customer.companyName ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Email</dt>
                <dd className="mt-1 text-gray-900">{customer.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Phone</dt>
                <dd className="mt-1 text-gray-900">{customer.phone ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Billing</dt>
                <dd className="mt-1 text-gray-900">{customer.billingAddress ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Shipping</dt>
                <dd className="mt-1 text-gray-900">{customer.shippingAddress ?? '-'}</dd>
              </div>
            </dl>
          )}
        </Section>

        <Section title="Cart Assets" count={vehicles.total}>
          {vehicles.items.length === 0 ? (
            <EmptyState
              title="No carts on this profile"
              description="Start a work order from this customer once a cart asset is registered."
              action={
                <ActionLink href={erpRoute('create-work-order', { customerId })}>
                  New Work Order
                </ActionLink>
              }
            />
          ) : (
            <div className="space-y-3">
              {vehicles.items.map((vehicle) => (
                <div
                  key={vehicle.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2"
                >
                  <div>
                    <div className="font-medium text-gray-900">
                      {vehicle.modelYear} {vehicle.modelCode}
                    </div>
                    <div className="text-xs text-gray-500">
                      VIN {vehicle.vin} · Serial {vehicle.serialNumber}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={vehicle.state} />
                    <Link
                      href={erpRoute('create-work-order', {
                        customerId,
                        vehicleId: vehicle.id,
                      })}
                      className="text-sm font-semibold text-gray-900 hover:underline"
                    >
                      Start work
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title="Open Work Orders"
          count={workOrders.total}
          action={
            <ActionLink href={erpRoute('work-order', { search: customerId })}>Open list</ActionLink>
          }
        >
          {workOrders.items.length === 0 ? (
            <EmptyState
              title="No execution work yet"
              description="Create a work order when this customer is ready for shop intake."
              action={
                <ActionLink href={erpRoute('create-work-order', { customerId })}>
                  New Work Order
                </ActionLink>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-md border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Work Order</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {workOrders.items.map((workOrder) => (
                    <tr key={workOrder.id}>
                      <td className="px-3 py-2">
                        <Link
                          href={erpRecordRoute('work-order', workOrder.id)}
                          className="font-semibold text-gray-900 hover:underline"
                        >
                          {workOrder.workOrderNumber}
                        </Link>
                        <div className="text-xs text-gray-500">{workOrder.title}</div>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={workOrder.status} />
                      </td>
                      <td className="px-3 py-2 text-gray-600">{formatDate(workOrder.dueAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section
          title="Sales Opportunities"
          count={opportunities.total}
          action={
            <ActionLink href={erpRoute('create-sales-opportunity', { customerId })}>
              New Opportunity
            </ActionLink>
          }
        >
          {opportunities.items.length === 0 ? (
            <EmptyState
              title="No opportunities"
              description="Create an opportunity to track sales follow-up for this customer."
            />
          ) : (
            <div className="space-y-3">
              {opportunities.items.map((opportunity) => (
                <div key={opportunity.id} className="rounded-md border border-gray-200 px-3 py-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <Link
                        href={erpRecordRoute('sales-opportunity', opportunity.id)}
                        className="font-semibold text-gray-900 hover:underline"
                      >
                        {opportunity.title}
                      </Link>
                      <div className="text-xs text-gray-500">
                        {salesUserDisplayName(opportunity.assignedToUser)} ·{' '}
                        {formatDate(opportunity.expectedCloseDate)}
                      </div>
                    </div>
                    <StatusBadge status={opportunity.stage} />
                  </div>
                  <div className="mt-2 text-sm text-gray-700">
                    {formatCurrency(opportunity.estimatedValue)} estimated ·{' '}
                    {opportunity.probability}% probability
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title="Quotes"
          count={quotes.total}
          action={
            <ActionLink href={erpRoute('create-quote', { customerId })}>New Quote</ActionLink>
          }
        >
          {quotes.items.length === 0 ? (
            <EmptyState
              title="No quotes"
              description="Build a quote from this customer once scope and parts are known."
            />
          ) : (
            <div className="space-y-3">
              {quotes.items.map((quote) => (
                <div
                  key={quote.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2"
                >
                  <div>
                    <Link
                      href={erpRecordRoute('quote', quote.id)}
                      className="font-semibold text-gray-900 hover:underline"
                    >
                      {quote.quoteNumber}
                    </Link>
                    <div className="text-xs text-gray-500">
                      {formatDate(quote.createdAt)} · Valid until {formatDate(quote.validUntil)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-gray-900">{formatCurrency(quote.total)}</div>
                    <StatusBadge status={quote.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Accounting Sync"
          count={customerSyncs.total + paymentSyncs.total}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <ActionLink href={erpRoute('accounting-sync', { view: 'customers', customerId })}>
                Customer Sync
              </ActionLink>
              <ActionLink href={erpRoute('accounting-sync', { view: 'payments', customerId })}>
                Payments
              </ActionLink>
            </div>
          }
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Customer Sync</h3>
              {customerSyncs.items.length === 0 ? (
                <p className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-500">
                  No customer sync records for this profile.
                </p>
              ) : (
                <div className="space-y-2">
                  {customerSyncs.items.map((record) => (
                    <div key={record.id} className="rounded-md border border-gray-200 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-gray-900">{record.provider}</div>
                        <StatusBadge status={record.state} />
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        Attempts {record.attemptCount} · Created {formatDate(record.createdAt)}
                      </div>
                      {record.externalReference && (
                        <div className="mt-1 text-xs text-gray-600">
                          External {record.externalReference}
                        </div>
                      )}
                      {record.lastErrorMessage && (
                        <div className="mt-1 text-xs text-red-700">{record.lastErrorMessage}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Payments</h3>
              {paymentSyncs.items.length === 0 ? (
                <p className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-500">
                  No payment sync records for this customer.
                </p>
              ) : (
                <div className="space-y-2">
                  {paymentSyncs.items.map((record) => (
                    <div key={record.id} className="rounded-md border border-gray-200 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          href={erpRecordRoute('work-order', record.workOrderId)}
                          className="font-semibold text-gray-900 hover:underline"
                        >
                          {paymentSyncWorkOrderDisplayName(record)}
                        </Link>
                        <StatusBadge status={record.state} />
                      </div>
                      <div className="mt-1 text-sm text-gray-700">
                        {formatCurrency(record.amountCents / 100)}
                        {record.paymentMethod ? ` · ${record.paymentMethod}` : ''}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        Attempts {record.attemptCount} · Updated {formatDate(record.updatedAt)}
                      </div>
                      {record.errorMessage && (
                        <div className="mt-1 text-xs text-red-700">{record.errorMessage}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Section>
      </div>

      <Section title="Recent Sales Activity" count={activities.total}>
        {activities.items.length === 0 ? (
          <EmptyState
            title="No sales activity"
            description="Activity will appear here after follow-up notes, calls, or stage changes are logged."
          />
        ) : (
          <div className="space-y-3">
            {activities.items.map((activity) => (
              <div key={activity.id} className="rounded-md border border-gray-200 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-gray-900">{activity.subject}</div>
                  <StatusBadge status={activity.activityType} />
                </div>
                {activity.body && <p className="mt-1 text-sm text-gray-600">{activity.body}</p>}
                <div className="mt-2 text-xs text-gray-500">
                  Created {formatDate(activity.createdAt)}
                  {activity.dueDate ? ` · Due ${formatDate(activity.dueDate)}` : ''}
                  {activity.completedAt ? ` · Completed ${formatDate(activity.completedAt)}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void load()}>
          Refresh Live Data
        </Button>
        <ActionLink href={erpRoute('customer')}>Back to Customers</ActionLink>
      </div>
    </div>
  );
}
