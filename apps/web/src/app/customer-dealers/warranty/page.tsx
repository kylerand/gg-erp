'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { EmptyState, LoadingSkeleton, PageHeader, StatusBadge } from '@gg-erp/ui';
import {
  createWarrantyClaim,
  listCartVehicles,
  listDealerRelationships,
  listWarrantyClaims,
  listWoOrders,
  updateWarrantyClaim,
  type CartVehicle,
  type Customer,
  type DealerRelationship,
  type WarrantyClaim,
  type WoOrder,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';
import { CustomerSelector } from '@/components/customers/CustomerSelector';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';

const STRICT_LIVE_DATA = { allowMockFallback: false } as const;
const CLAIM_LIMIT = 100;
const CLAIM_STATUSES: WarrantyClaim['claimStatus'][] = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REIMBURSEMENT_PENDING',
  'REIMBURSED',
  'DENIED',
  'CLOSED',
];
const ACTIVE_CLAIM_STATUSES = new Set<WarrantyClaim['claimStatus']>([
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REIMBURSEMENT_PENDING',
]);

interface ClaimDraft {
  customerId: string;
  dealerRelationshipId: string;
  cartVehicleId: string;
  workOrderId: string;
  claimStatus: WarrantyClaim['claimStatus'];
  requestedAmount: string;
  externalReference: string;
  claimReason: string;
  notes: string;
}

interface ClaimEditDraft {
  claimStatus: WarrantyClaim['claimStatus'];
  approvedAmount: string;
  reimbursedAmount: string;
  externalReference: string;
  notes: string;
}

function normalizeClaimStatusParam(value: string | null): WarrantyClaim['claimStatus'] | 'ALL' {
  const candidate = value?.toUpperCase().replace(/[\s-]+/g, '_') as
    | WarrantyClaim['claimStatus']
    | undefined;
  return candidate && CLAIM_STATUSES.includes(candidate) ? candidate : 'ALL';
}

function createClaimDraft(overrides: Partial<ClaimDraft> = {}): ClaimDraft {
  return {
    customerId: '',
    dealerRelationshipId: '',
    cartVehicleId: '',
    workOrderId: '',
    claimStatus: 'SUBMITTED',
    requestedAmount: '',
    externalReference: '',
    claimReason: 'Warranty service',
    notes: '',
    ...overrides,
  };
}

function claimEditDraft(claim: WarrantyClaim): ClaimEditDraft {
  return {
    claimStatus: claim.claimStatus,
    approvedAmount:
      claim.approvedAmountCents === undefined ? '' : String(claim.approvedAmountCents / 100),
    reimbursedAmount:
      claim.reimbursedAmountCents === undefined ? '' : String(claim.reimbursedAmountCents / 100),
    externalReference: claim.externalReference ?? '',
    notes: claim.notes ?? '',
  };
}

function centsFromDollars(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed.replace(/[$,]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : undefined;
}

function optionalCentsFromDollars(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return centsFromDollars(trimmed);
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatCurrencyCents(value?: number | null): string {
  if (value == null) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100);
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

function normalizeStatus(value: string): string {
  return value.replace(/_/g, ' ');
}

function optionMatchesSearch(option: SearchableSelectOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [option.label, option.description, option.meta].some((value) =>
    value?.toLowerCase().includes(needle),
  );
}

function relationshipOption(row: DealerRelationship): SearchableSelectOption {
  return {
    id: row.id,
    label: row.dealerName,
    description: [
      row.dealerCode,
      normalizeStatus(row.relationshipType),
      row.cartDisplayName ?? 'Customer account',
    ]
      .filter(Boolean)
      .join(' · '),
    meta: [row.escalationOwner, row.territory].filter(Boolean).join(' · '),
  };
}

function cartOption(vehicle: CartVehicle): SearchableSelectOption {
  return {
    id: vehicle.id,
    label: `${vehicle.modelYear} ${vehicle.modelCode}`,
    description: [vehicle.vin, vehicle.serialNumber].filter(Boolean).join(' · '),
    meta: vehicle.state,
  };
}

function workOrderOption(order: WoOrder): SearchableSelectOption {
  return {
    id: order.id,
    label: order.workOrderNumber,
    description: order.title,
    meta: [order.status, order.dueAt ? `Due ${formatDate(order.dueAt)}` : null]
      .filter(Boolean)
      .join(' · '),
  };
}

function claimSearchText(claim: WarrantyClaim): string {
  return [
    claim.claimNumber,
    claim.customerName,
    claim.customerEmail,
    claim.dealerName,
    claim.dealerCode,
    claim.workOrderNumber,
    claim.workOrderTitle,
    claim.vin,
    claim.serialNumber,
    claim.externalReference,
    claim.claimReason,
    claim.notes,
    claim.claimStatus,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function claimTone(claim: WarrantyClaim): 'critical' | 'warning' | 'ready' | 'neutral' {
  if (claim.claimStatus === 'DENIED') return 'critical';
  if (claim.claimStatus === 'SUBMITTED' || claim.claimStatus === 'REIMBURSEMENT_PENDING') {
    return 'warning';
  }
  if (claim.claimStatus === 'REIMBURSED' || claim.claimStatus === 'CLOSED') return 'ready';
  return 'neutral';
}

export default function WarrantyClaimsPage() {
  const searchParams = useSearchParams();
  const filterCustomerId = searchParams.get('customerId')?.trim() || undefined;
  const initialCreatePanelOpen = searchParams.get('create') === 'claim';
  const [claims, setClaims] = useState<WarrantyClaim[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [statusFilter, setStatusFilter] = useState<WarrantyClaim['claimStatus'] | 'ALL'>(() =>
    normalizeClaimStatusParam(searchParams.get('status')),
  );
  const [createPanelOpen, setCreatePanelOpen] = useState(initialCreatePanelOpen);
  const [createDraft, setCreateDraft] = useState<ClaimDraft>(() =>
    createClaimDraft({
      customerId: filterCustomerId ?? '',
      dealerRelationshipId: searchParams.get('dealerRelationshipId') ?? '',
      cartVehicleId: searchParams.get('vehicleId') ?? '',
      workOrderId: searchParams.get('workOrderId') ?? '',
    }),
  );
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | undefined>();
  const [relationships, setRelationships] = useState<DealerRelationship[]>([]);
  const [relationshipSearch, setRelationshipSearch] = useState('');
  const [relationshipError, setRelationshipError] = useState<string | undefined>();
  const [cartVehicles, setCartVehicles] = useState<CartVehicle[]>([]);
  const [cartSearch, setCartSearch] = useState('');
  const [workOrders, setWorkOrders] = useState<WoOrder[]>([]);
  const [workOrderSearch, setWorkOrderSearch] = useState('');
  const [contextLoading, setContextLoading] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();
  const [createSuccess, setCreateSuccess] = useState<string | undefined>();
  const [creatingClaim, setCreatingClaim] = useState(false);
  const [editingClaimId, setEditingClaimId] = useState<string | undefined>();
  const [claimEdit, setClaimEdit] = useState<ClaimEditDraft | undefined>();
  const [savingClaimId, setSavingClaimId] = useState<string | undefined>();
  const [claimSaveError, setClaimSaveError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await listWarrantyClaims(
        {
          search: search || undefined,
          customerId: filterCustomerId,
          status: statusFilter === 'ALL' ? undefined : statusFilter,
          limit: CLAIM_LIMIT,
        },
        STRICT_LIVE_DATA,
      );
      setClaims(result.items);
      setTotal(result.total);
    } catch (err) {
      setClaims([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : 'Failed to load warranty claims.');
    } finally {
      setLoading(false);
    }
  }, [filterCustomerId, search, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    setRelationshipSearch('');
    setCartSearch('');
    setWorkOrderSearch('');
    if (!createDraft.customerId) {
      setRelationships([]);
      setCartVehicles([]);
      setWorkOrders([]);
      setRelationshipError(undefined);
      setContextLoading(false);
      return () => {
        active = false;
      };
    }

    setContextLoading(true);
    setRelationshipError(undefined);
    Promise.allSettled([
      listDealerRelationships(
        { customerId: createDraft.customerId, state: 'ACTIVE', limit: 100 },
        STRICT_LIVE_DATA,
      ),
      listCartVehicles({ customerId: createDraft.customerId, limit: 100 }, STRICT_LIVE_DATA),
      listWoOrders({ customerId: createDraft.customerId, limit: 100 }, STRICT_LIVE_DATA),
    ])
      .then(([relationshipResult, cartResult, workOrderResult]) => {
        if (!active) return;
        const nextRelationships =
          relationshipResult.status === 'fulfilled' ? relationshipResult.value.items : [];
        setRelationships(nextRelationships);
        setCartVehicles(cartResult.status === 'fulfilled' ? cartResult.value.items : []);
        setWorkOrders(workOrderResult.status === 'fulfilled' ? workOrderResult.value.items : []);
        if (relationshipResult.status === 'rejected') {
          setRelationshipError('Warranty provider relationships failed to load.');
        }
        setCreateDraft((current) => {
          if (current.dealerRelationshipId) return current;
          const warrantyProvider = nextRelationships.find(
            (relationship) => relationship.relationshipType === 'WARRANTY_PROVIDER',
          );
          return warrantyProvider
            ? {
                ...current,
                dealerRelationshipId: warrantyProvider.id,
                cartVehicleId: current.cartVehicleId || warrantyProvider.cartVehicleId || '',
              }
            : current;
        });
      })
      .finally(() => {
        if (!active) return;
        setContextLoading(false);
      });

    return () => {
      active = false;
    };
  }, [createDraft.customerId]);

  const selectedRelationship = relationships.find(
    (relationship) => relationship.id === createDraft.dealerRelationshipId,
  );
  const relationshipOptions = useMemo(
    () =>
      relationships
        .filter((row) => row.relationshipType === 'WARRANTY_PROVIDER')
        .map(relationshipOption)
        .filter((option) => optionMatchesSearch(option, relationshipSearch)),
    [relationshipSearch, relationships],
  );
  const cartOptions = useMemo(
    () => cartVehicles.map(cartOption).filter((option) => optionMatchesSearch(option, cartSearch)),
    [cartSearch, cartVehicles],
  );
  const workOrderOptions = useMemo(
    () =>
      workOrders
        .map(workOrderOption)
        .filter((option) => optionMatchesSearch(option, workOrderSearch)),
    [workOrderSearch, workOrders],
  );
  const filteredClaims = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? claims.filter((claim) => claimSearchText(claim).includes(needle)) : claims;
  }, [claims, search]);
  const activeClaimCount = claims.filter((claim) =>
    ACTIVE_CLAIM_STATUSES.has(claim.claimStatus),
  ).length;
  const reimbursementQueueCount = claims.filter(
    (claim) => claim.claimStatus === 'APPROVED' || claim.claimStatus === 'REIMBURSEMENT_PENDING',
  ).length;

  function resetCreateDraft() {
    setCreateDraft(
      createClaimDraft({
        customerId: filterCustomerId ?? '',
        dealerRelationshipId: searchParams.get('dealerRelationshipId') ?? '',
        cartVehicleId: searchParams.get('vehicleId') ?? '',
        workOrderId: searchParams.get('workOrderId') ?? '',
      }),
    );
    setSelectedCustomer(undefined);
    setCreateError(undefined);
    setCreateSuccess(undefined);
  }

  async function saveClaim() {
    if (!createDraft.customerId) {
      setCreateError('Select a customer before creating a warranty claim.');
      return;
    }
    const requestedAmountCents = centsFromDollars(createDraft.requestedAmount);
    if (requestedAmountCents === undefined) {
      setCreateError('Requested amount must be a non-negative dollar amount.');
      return;
    }
    setCreatingClaim(true);
    setCreateError(undefined);
    setCreateSuccess(undefined);
    try {
      const created = await createWarrantyClaim({
        customerId: createDraft.customerId,
        dealerRelationshipId: optionalText(createDraft.dealerRelationshipId),
        cartVehicleId: optionalText(createDraft.cartVehicleId),
        workOrderId: optionalText(createDraft.workOrderId),
        claimStatus: createDraft.claimStatus,
        requestedAmountCents,
        externalReference: optionalText(createDraft.externalReference),
        claimReason: optionalText(createDraft.claimReason),
        notes: optionalText(createDraft.notes),
      });
      setClaims((current) => [created, ...current.filter((claim) => claim.id !== created.id)]);
      setTotal((current) => current + (claims.some((claim) => claim.id === created.id) ? 0 : 1));
      setCreateSuccess(`Created ${created.claimNumber}.`);
      resetCreateDraft();
      setCreatePanelOpen(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create warranty claim.');
    } finally {
      setCreatingClaim(false);
    }
  }

  function beginClaimEdit(claim: WarrantyClaim) {
    setEditingClaimId(claim.id);
    setClaimEdit(claimEditDraft(claim));
    setClaimSaveError(undefined);
  }

  async function saveClaimUpdate(claim: WarrantyClaim) {
    if (!claimEdit) return;
    const approvedAmountCents = optionalCentsFromDollars(claimEdit.approvedAmount);
    const reimbursedAmountCents = optionalCentsFromDollars(claimEdit.reimbursedAmount);
    if (approvedAmountCents === undefined || reimbursedAmountCents === undefined) {
      setClaimSaveError('Approved and reimbursed amounts must be valid non-negative amounts.');
      return;
    }

    setSavingClaimId(claim.id);
    setClaimSaveError(undefined);
    try {
      const updated = await updateWarrantyClaim(claim.id, {
        claimStatus: claimEdit.claimStatus,
        approvedAmountCents,
        reimbursedAmountCents,
        externalReference: optionalText(claimEdit.externalReference),
        notes: optionalText(claimEdit.notes),
      });
      setClaims((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setEditingClaimId(undefined);
      setClaimEdit(undefined);
    } catch (err) {
      setClaimSaveError(err instanceof Error ? err.message : 'Failed to update warranty claim.');
    } finally {
      setSavingClaimId(undefined);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={erpRoute('customers')} className="hover:text-yellow-600">
          Customer & Dealer Ops
        </Link>
        <span>/</span>
        <span className="font-medium text-gray-900">Warranty Claims</span>
      </div>

      <PageHeader
        title="Warranty Claims"
        description="Provider-backed warranty claims, approvals, and reimbursement follow-through"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={erpRoute('customer-relationship', {
                customerId: filterCustomerId,
                relationshipType: 'WARRANTY_PROVIDER',
                create: 'relationship',
              })}
              className="inline-flex h-9 items-center rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-700 hover:border-yellow-400"
            >
              Warranty Providers
            </Link>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                resetCreateDraft();
                setCreatePanelOpen((current) => !current);
              }}
            >
              New Warranty Claim
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Link
          href={erpRoute('warranty-claim')}
          className="rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-yellow-400"
        >
          <div className="text-2xl font-bold text-gray-900">{total}</div>
          <div className="mt-1 text-xs font-medium uppercase text-gray-500">Total Claims</div>
        </Link>
        <Link
          href={erpRoute('warranty-claim', { status: 'SUBMITTED' })}
          className="rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-yellow-400"
        >
          <div className="text-2xl font-bold text-gray-900">{activeClaimCount}</div>
          <div className="mt-1 text-xs font-medium uppercase text-gray-500">Active Claims</div>
        </Link>
        <Link
          href={erpRoute('accounting-sync', { view: 'payments', customerId: filterCustomerId })}
          className="rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-yellow-400"
        >
          <div className="text-2xl font-bold text-gray-900">{reimbursementQueueCount}</div>
          <div className="mt-1 text-xs font-medium uppercase text-gray-500">
            Reimbursement Queue
          </div>
        </Link>
      </div>

      {createPanelOpen && (
        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-base font-semibold text-gray-900">Claim Intake</h2>
            <p className="text-sm text-gray-500">
              Create a live warranty claim tied to customer, warranty provider, cart, and work order
              context.
            </p>
          </div>
          <div className="space-y-4 p-4">
            {createError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {createError}
              </div>
            )}
            {createSuccess && (
              <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                {createSuccess}
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <CustomerSelector
                id="warrantyClaimCustomer"
                required
                value={createDraft.customerId}
                onChange={(customerId, customer) => {
                  setSelectedCustomer(customer);
                  setCreateDraft((current) => ({
                    ...current,
                    customerId,
                    dealerRelationshipId: '',
                    cartVehicleId: '',
                    workOrderId: '',
                  }));
                }}
                onResolvedCustomer={setSelectedCustomer}
              />
              <SearchableSelect
                id="warrantyProviderRelationship"
                label="Warranty Provider"
                value={createDraft.dealerRelationshipId}
                selectedOption={
                  selectedRelationship ? relationshipOption(selectedRelationship) : undefined
                }
                searchValue={relationshipSearch}
                options={relationshipOptions}
                loading={contextLoading}
                error={relationshipError}
                placeholder={
                  selectedCustomer
                    ? 'Select warranty provider'
                    : 'Select a customer before choosing provider'
                }
                emptyText="No active warranty provider relationships for this customer."
                onSearchChange={setRelationshipSearch}
                onChange={(relationshipId) => {
                  const relationship = relationships.find((item) => item.id === relationshipId);
                  setCreateDraft((current) => ({
                    ...current,
                    dealerRelationshipId: relationshipId,
                    cartVehicleId: current.cartVehicleId || relationship?.cartVehicleId || '',
                  }));
                }}
              />
              <SearchableSelect
                id="warrantyClaimCart"
                label="Cart Asset"
                value={createDraft.cartVehicleId}
                selectedOption={
                  cartVehicles.find((vehicle) => vehicle.id === createDraft.cartVehicleId)
                    ? cartOption(
                        cartVehicles.find((vehicle) => vehicle.id === createDraft.cartVehicleId)!,
                      )
                    : undefined
                }
                searchValue={cartSearch}
                options={cartOptions}
                loading={contextLoading}
                placeholder="Optional cart asset"
                emptyText="No cart assets found for this customer."
                onSearchChange={setCartSearch}
                onChange={(cartVehicleId) =>
                  setCreateDraft((current) => ({ ...current, cartVehicleId }))
                }
              />
              <SearchableSelect
                id="warrantyClaimWorkOrder"
                label="Work Order"
                value={createDraft.workOrderId}
                selectedOption={
                  workOrders.find((order) => order.id === createDraft.workOrderId)
                    ? workOrderOption(
                        workOrders.find((order) => order.id === createDraft.workOrderId)!,
                      )
                    : undefined
                }
                searchValue={workOrderSearch}
                options={workOrderOptions}
                loading={contextLoading}
                placeholder="Optional work order"
                emptyText="No work orders found for this customer."
                onSearchChange={setWorkOrderSearch}
                onChange={(workOrderId) =>
                  setCreateDraft((current) => ({ ...current, workOrderId }))
                }
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-4">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase text-gray-500">Status</span>
                <select
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm"
                  value={createDraft.claimStatus}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      claimStatus: event.target.value as WarrantyClaim['claimStatus'],
                    }))
                  }
                >
                  {CLAIM_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {normalizeStatus(status)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase text-gray-500">
                  Requested Amount
                </span>
                <Input
                  value={createDraft.requestedAmount}
                  placeholder="0.00"
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      requestedAmount: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase text-gray-500">
                  External Reference
                </span>
                <Input
                  value={createDraft.externalReference}
                  placeholder="Provider claim number"
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      externalReference: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase text-gray-500">Reason</span>
                <Input
                  value={createDraft.claimReason}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      claimReason: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase text-gray-500">Claim Notes</span>
              <Textarea
                value={createDraft.notes}
                rows={3}
                onChange={(event) =>
                  setCreateDraft((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </label>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={creatingClaim}
                onClick={() => {
                  resetCreateDraft();
                  setCreatePanelOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button type="button" disabled={creatingClaim} onClick={() => void saveClaim()}>
                {creatingClaim ? 'Saving...' : 'Create Claim'}
              </Button>
            </div>
          </div>
        </section>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto]">
          <Input
            value={search}
            placeholder="Search claim, customer, provider, work order, VIN, or reference"
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as WarrantyClaim['claimStatus'] | 'ALL')
            }
          >
            <option value="ALL">All statuses</option>
            {CLAIM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {normalizeStatus(status)}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton rows={6} cols={5} />
      ) : filteredClaims.length === 0 ? (
        <EmptyState
          title={
            search || statusFilter !== 'ALL'
              ? 'No warranty claims matched'
              : 'No warranty claims yet'
          }
          description={
            search || statusFilter !== 'ALL'
              ? 'Adjust search or status filters to review other live warranty claims.'
              : 'Create provider-backed warranty claims from customer, dealer, cart, and work-order context.'
          }
          action={
            <Button type="button" onClick={() => setCreatePanelOpen(true)}>
              New Warranty Claim
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {claimSaveError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {claimSaveError}
            </div>
          )}
          {filteredClaims.map((claim) => {
            const isEditing = editingClaimId === claim.id && claimEdit;
            const tone = claimTone(claim);
            return (
              <section key={claim.id} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-gray-900">{claim.claimNumber}</span>
                      <StatusBadge status={claim.claimStatus} />
                      {tone === 'warning' && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          Follow Up
                        </span>
                      )}
                      {tone === 'critical' && (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                          Review
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-gray-600">
                      {claim.customerName} · {claim.dealerName ?? 'No provider'} ·{' '}
                      {claim.cartDisplayName ?? 'Customer account'}
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      {claim.workOrderNumber ?? 'No work order'} · {claim.claimReason}
                    </div>
                  </div>
                  <div className="grid min-w-[260px] grid-cols-3 gap-2 text-right">
                    <div>
                      <div className="text-xs font-semibold uppercase text-gray-500">Requested</div>
                      <div className="font-semibold text-gray-900">
                        {formatCurrencyCents(claim.requestedAmountCents)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase text-gray-500">Approved</div>
                      <div className="font-semibold text-gray-900">
                        {formatCurrencyCents(claim.approvedAmountCents)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase text-gray-500">
                        Reimbursed
                      </div>
                      <div className="font-semibold text-gray-900">
                        {formatCurrencyCents(claim.reimbursedAmountCents)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 text-sm lg:grid-cols-4">
                  <div>
                    <div className="text-xs font-semibold uppercase text-gray-500">Submitted</div>
                    <div className="text-gray-700">{formatDate(claim.submittedAt)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase text-gray-500">
                      External Ref
                    </div>
                    <div className="text-gray-700">{claim.externalReference ?? '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase text-gray-500">
                      VIN / Serial
                    </div>
                    <div className="text-gray-700">
                      {[claim.vin, claim.serialNumber].filter(Boolean).join(' / ') || '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase text-gray-500">Updated</div>
                    <div className="text-gray-700">{formatDate(claim.updatedAt)}</div>
                  </div>
                </div>

                {claim.notes && !isEditing && (
                  <div className="mt-3 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    {claim.notes}
                  </div>
                )}

                {isEditing && (
                  <div className="mt-4 rounded-md border border-gray-200 p-3">
                    <div className="grid gap-3 lg:grid-cols-4">
                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase text-gray-500">
                          Status
                        </span>
                        <select
                          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm"
                          value={claimEdit.claimStatus}
                          onChange={(event) =>
                            setClaimEdit((current) =>
                              current
                                ? {
                                    ...current,
                                    claimStatus: event.target.value as WarrantyClaim['claimStatus'],
                                  }
                                : current,
                            )
                          }
                        >
                          {CLAIM_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {normalizeStatus(status)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase text-gray-500">
                          Approved Amount
                        </span>
                        <Input
                          value={claimEdit.approvedAmount}
                          onChange={(event) =>
                            setClaimEdit((current) =>
                              current
                                ? { ...current, approvedAmount: event.target.value }
                                : current,
                            )
                          }
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase text-gray-500">
                          Reimbursed Amount
                        </span>
                        <Input
                          value={claimEdit.reimbursedAmount}
                          onChange={(event) =>
                            setClaimEdit((current) =>
                              current
                                ? { ...current, reimbursedAmount: event.target.value }
                                : current,
                            )
                          }
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase text-gray-500">
                          External Reference
                        </span>
                        <Input
                          value={claimEdit.externalReference}
                          onChange={(event) =>
                            setClaimEdit((current) =>
                              current
                                ? { ...current, externalReference: event.target.value }
                                : current,
                            )
                          }
                        />
                      </label>
                    </div>
                    <label className="mt-3 block space-y-1">
                      <span className="text-xs font-semibold uppercase text-gray-500">Notes</span>
                      <Textarea
                        value={claimEdit.notes}
                        rows={3}
                        onChange={(event) =>
                          setClaimEdit((current) =>
                            current ? { ...current, notes: event.target.value } : current,
                          )
                        }
                      />
                    </label>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={savingClaimId === claim.id}
                        onClick={() => {
                          setEditingClaimId(undefined);
                          setClaimEdit(undefined);
                          setClaimSaveError(undefined);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        disabled={savingClaimId === claim.id}
                        onClick={() => void saveClaimUpdate(claim)}
                      >
                        {savingClaimId === claim.id ? 'Saving...' : 'Save Claim'}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <Link
                      href={erpRecordRoute('customer', claim.customerId)}
                      className="font-semibold text-gray-900 hover:underline"
                    >
                      Open Customer
                    </Link>
                    <Link
                      href={erpRoute('customer-relationship', { customerId: claim.customerId })}
                      className="font-semibold text-gray-900 hover:underline"
                    >
                      Provider Links
                    </Link>
                    {claim.workOrderId && (
                      <Link
                        href={erpRecordRoute('work-order', claim.workOrderId)}
                        className="font-semibold text-gray-900 hover:underline"
                      >
                        Work Order
                      </Link>
                    )}
                    <Link
                      href={erpRoute('accounting-sync', {
                        view: 'payments',
                        customerId: claim.customerId,
                      })}
                      className="font-semibold text-gray-900 hover:underline"
                    >
                      Payments
                    </Link>
                  </div>
                  {!isEditing && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => beginClaimEdit(claim)}
                    >
                      Update Claim
                    </Button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
