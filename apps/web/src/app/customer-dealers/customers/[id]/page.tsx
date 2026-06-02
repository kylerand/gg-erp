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
  updateCartVehicle,
  updateCustomer,
  type CartVehicle,
  type CartVehicleState,
  type Customer,
  type CustomerSyncRecord,
  type PaymentSyncRecord,
  type Quote,
  type SalesActivity,
  type SalesOpportunity,
  type UpdateCartVehicleInput,
  type UpdateCustomerInput,
  type WoOrder,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const STRICT_LIVE_DATA = { allowMockFallback: false } as const;
const CONTACT_METHOD_OPTIONS = ['EMAIL', 'PHONE', 'SMS'] as const;
const CART_STATE_OPTIONS = [
  'REGISTERED',
  'IN_BUILD',
  'QUALITY_HOLD',
  'COMPLETED',
  'RETIRED',
] as const;

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

interface CartProfileDraft {
  vin: string;
  serialNumber: string;
  modelCode: string;
  modelYear: string;
  state: CartVehicleState;
}

interface CustomerTimelineItem {
  id: string;
  category: string;
  title: string;
  detail: string;
  occurredAt: string;
  status?: string;
  href?: string;
  actionLabel?: string;
}

interface CustomerNextActionItem {
  id: string;
  priority: 'Critical' | 'High' | 'Normal';
  category: string;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
  status?: string;
  sortOrder: number;
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

function timelineSortValue(value?: string | null): number {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function daysUntil(value?: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - today.getTime()) / 86_400_000);
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

function cartDraftFromVehicle(vehicle: CartVehicle): CartProfileDraft {
  return {
    vin: vehicle.vin,
    serialNumber: vehicle.serialNumber,
    modelCode: vehicle.modelCode,
    modelYear: String(vehicle.modelYear),
    state: CART_STATE_OPTIONS.includes(vehicle.state) ? vehicle.state : 'REGISTERED',
  };
}

function buildCustomerNextActions({
  customerId,
  vehicles,
  workOrders,
  opportunities,
  quotes,
  activities,
  customerSyncs,
  paymentSyncs,
}: {
  customerId: string;
  vehicles: CartVehicle[];
  workOrders: WoOrder[];
  opportunities: SalesOpportunity[];
  quotes: Quote[];
  activities: SalesActivity[];
  customerSyncs: CustomerSyncRecord[];
  paymentSyncs: PaymentSyncRecord[];
}): CustomerNextActionItem[] {
  const actions: CustomerNextActionItem[] = [];
  const openOpportunityStages = new Set(['PROSPECT', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION']);
  const activeQuoteStatuses = new Set(['DRAFT', 'SENT']);

  for (const record of customerSyncs.filter((item) => item.state === 'FAILED').slice(0, 2)) {
    actions.push({
      id: `customer-sync-${record.id}`,
      priority: 'Critical',
      category: 'Accounting',
      title: 'Fix customer sync failure',
      detail:
        record.lastErrorMessage ??
        `${record.provider} customer sync has failed after ${record.attemptCount} attempts.`,
      href: erpRoute('accounting-sync', { view: 'customers', customerId }),
      actionLabel: 'Open Customer Sync',
      status: record.state,
      sortOrder: 10,
    });
  }

  for (const record of paymentSyncs
    .filter((item) => item.state === 'FAILED' || item.state === 'MISMATCH')
    .slice(0, 2)) {
    actions.push({
      id: `payment-sync-${record.id}`,
      priority: 'Critical',
      category: 'Payment',
      title: record.state === 'MISMATCH' ? 'Resolve payment mismatch' : 'Fix payment sync failure',
      detail:
        record.errorMessage ??
        `${paymentSyncWorkOrderDisplayName(record)} has ${record.attemptCount} payment sync attempts.`,
      href: erpRoute('accounting-sync', { view: 'payments', customerId }),
      actionLabel: 'Open Payments',
      status: record.state,
      sortOrder: 20,
    });
  }

  for (const workOrder of workOrders.filter((item) => item.status === 'BLOCKED').slice(0, 2)) {
    actions.push({
      id: `blocked-work-order-${workOrder.id}`,
      priority: 'Critical',
      category: 'Service',
      title: 'Unblock work order',
      detail: `${workOrder.workOrderNumber} · ${workOrder.title}`,
      href: erpRecordRoute('work-order', workOrder.id),
      actionLabel: 'Open Work Order',
      status: workOrder.status,
      sortOrder: 30,
    });
  }

  for (const activity of activities
    .filter(
      (item) =>
        !item.completedAt && daysUntil(item.dueDate) !== null && daysUntil(item.dueDate)! < 0,
    )
    .slice(0, 2)) {
    actions.push({
      id: `overdue-activity-${activity.id}`,
      priority: 'High',
      category: 'Sales',
      title: 'Complete overdue follow-up',
      detail: `${activity.subject} was due ${formatDate(activity.dueDate)}.`,
      href: activity.opportunityId
        ? erpRecordRoute('sales-opportunity', activity.opportunityId)
        : erpRoute('sales'),
      actionLabel: activity.opportunityId ? 'Log Activity' : 'Open Sales',
      status: activity.activityType,
      sortOrder: 40,
    });
  }

  for (const quote of quotes
    .filter((item) => item.status === 'ACCEPTED' && !item.convertedWoId)
    .slice(0, 2)) {
    actions.push({
      id: `accepted-quote-${quote.id}`,
      priority: 'High',
      category: 'Quote',
      title: 'Convert accepted quote',
      detail: `${quote.quoteNumber} is accepted for ${formatCurrency(quote.total)}.`,
      href: erpRecordRoute('quote', quote.id),
      actionLabel: 'Open Quote',
      status: quote.status,
      sortOrder: 50,
    });
  }

  for (const quote of quotes
    .filter((item) => activeQuoteStatuses.has(item.status) && daysUntil(item.validUntil) !== null)
    .sort((a, b) => (daysUntil(a.validUntil) ?? 999) - (daysUntil(b.validUntil) ?? 999))
    .slice(0, 2)) {
    const remainingDays = daysUntil(quote.validUntil);
    if (remainingDays !== null && remainingDays <= 14) {
      actions.push({
        id: `quote-expiration-${quote.id}`,
        priority: remainingDays < 0 ? 'High' : 'Normal',
        category: 'Quote',
        title: remainingDays < 0 ? 'Review expired quote' : 'Follow up before quote expires',
        detail:
          remainingDays < 0
            ? `${quote.quoteNumber} passed its valid-until date on ${formatDate(quote.validUntil)}.`
            : `${quote.quoteNumber} expires in ${remainingDays} days for ${formatCurrency(
                quote.total,
              )}.`,
        href: erpRecordRoute('quote', quote.id),
        actionLabel: 'Open Quote',
        status: quote.status,
        sortOrder: 60 + Math.max(remainingDays, 0),
      });
    }
  }

  for (const workOrder of workOrders
    .filter((item) => item.status !== 'COMPLETED' && item.status !== 'CANCELLED')
    .sort((a, b) => (daysUntil(a.dueAt) ?? 999) - (daysUntil(b.dueAt) ?? 999))
    .slice(0, 2)) {
    const remainingDays = daysUntil(workOrder.dueAt);
    if (remainingDays !== null && remainingDays <= 3) {
      actions.push({
        id: `work-order-due-${workOrder.id}`,
        priority: remainingDays < 0 ? 'High' : 'Normal',
        category: 'Service',
        title: remainingDays < 0 ? 'Catch up overdue work order' : 'Confirm upcoming work order',
        detail:
          remainingDays < 0
            ? `${workOrder.workOrderNumber} was due ${formatDate(workOrder.dueAt)}.`
            : `${workOrder.workOrderNumber} is due ${formatDate(workOrder.dueAt)}.`,
        href: erpRecordRoute('work-order', workOrder.id),
        actionLabel: 'Open Work Order',
        status: workOrder.status,
        sortOrder: 80 + Math.max(remainingDays, 0),
      });
    }
  }

  const openOpportunities = opportunities.filter((item) => openOpportunityStages.has(item.stage));
  for (const opportunity of openOpportunities
    .filter(
      (item) =>
        daysUntil(item.expectedCloseDate) !== null && daysUntil(item.expectedCloseDate)! < 0,
    )
    .slice(0, 2)) {
    actions.push({
      id: `overdue-opportunity-${opportunity.id}`,
      priority: 'Normal',
      category: 'Sales',
      title: 'Review overdue opportunity',
      detail: `${opportunity.title} expected close was ${formatDate(opportunity.expectedCloseDate)}.`,
      href: erpRecordRoute('sales-opportunity', opportunity.id),
      actionLabel: 'Open Opportunity',
      status: opportunity.stage,
      sortOrder: 100,
    });
  }

  const latestActivity = activities
    .map((activity) => timelineSortValue(activity.completedAt ?? activity.createdAt))
    .sort((a, b) => b - a)[0];
  const staleActivity =
    openOpportunities.length > 0 &&
    (!latestActivity || Date.now() - latestActivity > 14 * 86_400_000);
  if (staleActivity) {
    const opportunity = openOpportunities[0];
    actions.push({
      id: `stale-sales-activity-${opportunity.id}`,
      priority: 'Normal',
      category: 'Sales',
      title: activities.length === 0 ? 'Log first sales activity' : 'Log customer follow-up',
      detail: `${opportunity.title} has no recent completed activity.`,
      href: erpRecordRoute('sales-opportunity', opportunity.id),
      actionLabel: 'Log Activity',
      status: opportunity.stage,
      sortOrder: 120,
    });
  }

  if (vehicles.length === 0 && workOrders.length === 0) {
    actions.push({
      id: 'start-first-work-order',
      priority: 'Normal',
      category: 'Service',
      title: 'Start first shop intake',
      detail: 'No cart asset or execution work order is tied to this customer yet.',
      href: erpRoute('create-work-order', { customerId }),
      actionLabel: 'New Work Order',
      sortOrder: 140,
    });
  }

  if (openOpportunities.length === 0 && quotes.length === 0) {
    actions.push({
      id: 'start-first-opportunity',
      priority: 'Normal',
      category: 'Sales',
      title: 'Create sales opportunity',
      detail: 'No open opportunity or quote is tied to this customer.',
      href: erpRoute('create-sales-opportunity', { customerId }),
      actionLabel: 'New Opportunity',
      sortOrder: 150,
    });
  }

  return actions
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((action, index, sorted) => sorted.findIndex((item) => item.id === action.id) === index)
    .slice(0, 6);
}

function buildCustomerTimeline({
  customerId,
  vehicles,
  workOrders,
  opportunities,
  quotes,
  activities,
  customerSyncs,
  paymentSyncs,
}: {
  customerId: string;
  vehicles: CartVehicle[];
  workOrders: WoOrder[];
  opportunities: SalesOpportunity[];
  quotes: Quote[];
  activities: SalesActivity[];
  customerSyncs: CustomerSyncRecord[];
  paymentSyncs: PaymentSyncRecord[];
}): CustomerTimelineItem[] {
  const items: CustomerTimelineItem[] = [];

  for (const workOrder of workOrders) {
    items.push({
      id: `work-order-${workOrder.id}`,
      category: 'Service',
      title: workOrder.workOrderNumber,
      detail: [workOrder.title, workOrder.dueAt ? `Due ${formatDate(workOrder.dueAt)}` : null]
        .filter(Boolean)
        .join(' · '),
      occurredAt: workOrder.updatedAt ?? workOrder.openedAt ?? workOrder.createdAt,
      status: workOrder.status,
      href: erpRecordRoute('work-order', workOrder.id),
      actionLabel: 'Open Work Order',
    });
  }

  for (const vehicle of vehicles) {
    items.push({
      id: `vehicle-${vehicle.id}`,
      category: 'Asset',
      title: `${vehicle.modelYear} ${vehicle.modelCode}`,
      detail: `VIN ${vehicle.vin} · Serial ${vehicle.serialNumber}`,
      occurredAt: vehicle.updatedAt ?? vehicle.createdAt,
      status: vehicle.state,
      href: erpRoute('create-work-order', { customerId, vehicleId: vehicle.id }),
      actionLabel: 'Start Work',
    });
  }

  for (const opportunity of opportunities) {
    items.push({
      id: `opportunity-${opportunity.id}`,
      category: 'Sales',
      title: opportunity.title,
      detail: `${formatCurrency(opportunity.estimatedValue)} estimated · ${opportunity.probability}% probability`,
      occurredAt: opportunity.updatedAt ?? opportunity.createdAt,
      status: opportunity.stage,
      href: erpRecordRoute('sales-opportunity', opportunity.id),
      actionLabel: 'Open Opportunity',
    });
  }

  for (const quote of quotes) {
    items.push({
      id: `quote-${quote.id}`,
      category: 'Quote',
      title: quote.quoteNumber,
      detail: `${formatCurrency(quote.total)} · Valid until ${formatDate(quote.validUntil)}`,
      occurredAt: quote.updatedAt ?? quote.createdAt,
      status: quote.status,
      href: erpRecordRoute('quote', quote.id),
      actionLabel: 'Open Quote',
    });
  }

  for (const activity of activities) {
    const activityScheduleDetail = [
      activity.dueDate ? `Due ${formatDate(activity.dueDate)}` : null,
      activity.completedAt ? `Completed ${formatDate(activity.completedAt)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    items.push({
      id: `activity-${activity.id}`,
      category: 'Activity',
      title: activity.subject,
      detail:
        activity.body?.trim() || activityScheduleDetail || normalizeStatus(activity.activityType),
      occurredAt: activity.completedAt ?? activity.createdAt,
      status: activity.completedAt ? 'COMPLETED' : activity.activityType,
      href: activity.opportunityId
        ? erpRecordRoute('sales-opportunity', activity.opportunityId)
        : erpRoute('sales'),
      actionLabel: activity.opportunityId ? 'Open Opportunity' : 'Open Sales',
    });
  }

  for (const record of customerSyncs) {
    items.push({
      id: `customer-sync-${record.id}`,
      category: 'Accounting',
      title: `${record.provider} customer sync`,
      detail: [
        `Attempts ${record.attemptCount}`,
        record.externalReference ? `External ${record.externalReference}` : null,
        record.lastErrorMessage,
      ]
        .filter(Boolean)
        .join(' · '),
      occurredAt: record.syncedAt ?? record.createdAt ?? '',
      status: record.state,
      href: erpRoute('accounting-sync', { view: 'customers', customerId }),
      actionLabel: 'Open Customer Sync',
    });
  }

  for (const record of paymentSyncs) {
    items.push({
      id: `payment-sync-${record.id}`,
      category: 'Payment',
      title: formatCurrency(record.amountCents / 100),
      detail: [
        paymentSyncWorkOrderDisplayName(record),
        record.paymentMethod ?? record.direction,
        record.errorMessage,
      ]
        .filter(Boolean)
        .join(' · '),
      occurredAt: record.paymentDate ?? record.updatedAt ?? record.createdAt,
      status: record.state,
      href: erpRoute('accounting-sync', { view: 'payments', customerId }),
      actionLabel: 'Open Payments',
    });
  }

  return items
    .filter((item) => timelineSortValue(item.occurredAt) > 0)
    .sort((a, b) => timelineSortValue(b.occurredAt) - timelineSortValue(a.occurredAt))
    .slice(0, 12);
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
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [vehicleDraft, setVehicleDraft] = useState<CartProfileDraft | null>(null);
  const [savingVehicleId, setSavingVehicleId] = useState<string | null>(null);
  const [vehicleSaveError, setVehicleSaveError] = useState<string | null>(null);
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

  function beginVehicleEdit(vehicle: CartVehicle) {
    setVehicleDraft(cartDraftFromVehicle(vehicle));
    setVehicleSaveError(null);
    setEditingVehicleId(vehicle.id);
  }

  function cancelVehicleEdit() {
    setEditingVehicleId(null);
    setVehicleDraft(null);
    setVehicleSaveError(null);
  }

  async function saveVehicleProfile(vehicle: CartVehicle) {
    if (!vehicleDraft) return;
    const modelYear = Number(vehicleDraft.modelYear);
    if (!vehicleDraft.serialNumber.trim()) {
      setVehicleSaveError('Cart serial number is required.');
      return;
    }
    if (!vehicleDraft.vin.trim()) {
      setVehicleSaveError('Cart VIN is required.');
      return;
    }
    if (!vehicleDraft.modelCode.trim()) {
      setVehicleSaveError('Cart model is required.');
      return;
    }
    if (!Number.isInteger(modelYear) || modelYear < 1950 || modelYear > 2100) {
      setVehicleSaveError('Model year must be an integer between 1950 and 2100.');
      return;
    }

    const payload: UpdateCartVehicleInput = {
      vin: vehicleDraft.vin.trim(),
      serialNumber: vehicleDraft.serialNumber.trim(),
      modelCode: vehicleDraft.modelCode.trim(),
      modelYear,
      state: vehicleDraft.state,
    };

    setSavingVehicleId(vehicle.id);
    setVehicleSaveError(null);
    try {
      const updated = await updateCartVehicle(vehicle.id, payload);
      setVehicles((current) => ({
        ...current,
        items: current.items.map((item) => (item.id === updated.id ? updated : item)),
      }));
      cancelVehicleEdit();
    } catch (error) {
      setVehicleSaveError(errorMessage(error));
    } finally {
      setSavingVehicleId(null);
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
  const nextActionItems = buildCustomerNextActions({
    customerId,
    vehicles: vehicles.items,
    workOrders: workOrders.items,
    opportunities: opportunities.items,
    quotes: quotes.items,
    activities: activities.items,
    customerSyncs: customerSyncs.items,
    paymentSyncs: paymentSyncs.items,
  });
  const timelineItems = buildCustomerTimeline({
    customerId,
    vehicles: vehicles.items,
    workOrders: workOrders.items,
    opportunities: opportunities.items,
    quotes: quotes.items,
    activities: activities.items,
    customerSyncs: customerSyncs.items,
    paymentSyncs: paymentSyncs.items,
  });

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

      <Section
        title="Customer Next Actions"
        count={nextActionItems.length}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionLink href={erpRoute('create-sales-opportunity', { customerId })}>
              New Opportunity
            </ActionLink>
            <ActionLink href={erpRoute('create-work-order', { customerId })}>
              New Work Order
            </ActionLink>
          </div>
        }
      >
        {nextActionItems.length === 0 ? (
          <EmptyState
            title="No immediate customer actions"
            description="No customer-specific blockers, due follow-ups, expiring quotes, or accounting sync issues were found in live records."
            action={
              <ActionLink href={erpRoute('create-quote', { customerId })}>New Quote</ActionLink>
            }
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {nextActionItems.map((item) => (
              <div key={item.id} className="rounded-md border border-gray-200 px-3 py-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase text-gray-500">
                        {item.category}
                      </span>
                      <span
                        className={
                          item.priority === 'Critical'
                            ? 'rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700'
                            : item.priority === 'High'
                              ? 'rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700'
                              : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700'
                        }
                      >
                        {item.priority}
                      </span>
                    </div>
                    <div className="mt-1 font-semibold text-gray-900">{item.title}</div>
                    <div className="mt-1 text-sm text-gray-600">{item.detail}</div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {item.status && <StatusBadge status={item.status} />}
                    <Link
                      href={item.href}
                      className="text-sm font-semibold text-gray-900 hover:underline"
                    >
                      {item.actionLabel}
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Customer Timeline"
        count={timelineItems.length}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionLink href={erpRoute('work-order', { search: customerId })}>
              Work History
            </ActionLink>
            <ActionLink href={erpRoute('accounting-sync', { view: 'customers', customerId })}>
              Sync History
            </ActionLink>
          </div>
        }
      >
        {timelineItems.length === 0 ? (
          <EmptyState
            title="No customer history yet"
            description="Work orders, quotes, activities, cart changes, and accounting sync events will appear here once live records exist."
            action={
              <ActionLink href={erpRoute('create-work-order', { customerId })}>
                New Work Order
              </ActionLink>
            }
          />
        ) : (
          <div className="space-y-3">
            {timelineItems.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-gray-200 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase text-gray-500">
                      {item.category}
                    </span>
                    <span className="text-xs text-gray-400">{formatDate(item.occurredAt)}</span>
                  </div>
                  <div className="mt-1 font-semibold text-gray-900">{item.title}</div>
                  <div className="mt-1 text-sm text-gray-600">{item.detail}</div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {item.status && <StatusBadge status={item.status} />}
                  {item.href && (
                    <Link
                      href={item.href}
                      className="text-sm font-semibold text-gray-900 hover:underline"
                    >
                      {item.actionLabel ?? 'Open'}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

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
                <div key={vehicle.id} className="rounded-md border border-gray-200 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-gray-900">
                        {vehicle.modelYear} {vehicle.modelCode}
                      </div>
                      <div className="text-xs text-gray-500">
                        VIN {vehicle.vin} · Serial {vehicle.serialNumber}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={vehicle.state} />
                      {editingVehicleId !== vehicle.id && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => beginVehicleEdit(vehicle)}
                        >
                          Edit Asset
                        </Button>
                      )}
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
                  {editingVehicleId === vehicle.id && vehicleDraft && (
                    <div className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase text-gray-500">
                            Serial
                          </span>
                          <Input
                            value={vehicleDraft.serialNumber}
                            onChange={(event) =>
                              setVehicleDraft((current) =>
                                current
                                  ? { ...current, serialNumber: event.target.value }
                                  : current,
                              )
                            }
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase text-gray-500">VIN</span>
                          <Input
                            value={vehicleDraft.vin}
                            onChange={(event) =>
                              setVehicleDraft((current) =>
                                current ? { ...current, vin: event.target.value } : current,
                              )
                            }
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase text-gray-500">
                            Model
                          </span>
                          <Input
                            value={vehicleDraft.modelCode}
                            onChange={(event) =>
                              setVehicleDraft((current) =>
                                current ? { ...current, modelCode: event.target.value } : current,
                              )
                            }
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase text-gray-500">
                            Year
                          </span>
                          <Input
                            inputMode="numeric"
                            value={vehicleDraft.modelYear}
                            onChange={(event) =>
                              setVehicleDraft((current) =>
                                current ? { ...current, modelYear: event.target.value } : current,
                              )
                            }
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase text-gray-500">
                            State
                          </span>
                          <select
                            className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
                            value={vehicleDraft.state}
                            onChange={(event) =>
                              setVehicleDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      state: event.target.value as CartVehicleState,
                                    }
                                  : current,
                              )
                            }
                          >
                            {CART_STATE_OPTIONS.map((state) => (
                              <option key={state} value={state}>
                                {normalizeStatus(state)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {vehicleSaveError && (
                        <p className="text-sm text-red-700">{vehicleSaveError}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => saveVehicleProfile(vehicle)}
                          disabled={savingVehicleId === vehicle.id}
                        >
                          {savingVehicleId === vehicle.id ? 'Saving' : 'Save Cart'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={cancelVehicleEdit}
                          disabled={savingVehicleId === vehicle.id}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
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
