'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import {
  createDealerRelationship,
  listCartVehicles,
  listDealers,
  listDealerRelationships,
  updateDealerRelationship,
  type CartVehicle,
  type Customer,
  type Dealer,
  type DealerRelationship,
} from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';
import { CustomerSelector } from '@/components/customers/CustomerSelector';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/components/ui/searchable-select';

const STRICT_LIVE_DATA = { allowMockFallback: false } as const;
const RELATIONSHIP_LIMIT = 100;
const RELATIONSHIP_STATE_OPTIONS = ['ACTIVE', 'INACTIVE', 'ENDED'] as const;
const CREATE_RELATIONSHIP_STATE_OPTIONS = ['ACTIVE', 'INACTIVE'] as const;
const RELATIONSHIP_TYPE_OPTIONS: DealerRelationship['relationshipType'][] = [
  'ACCOUNT_OWNER',
  'SERVICING_DEALER',
  'BILLING_ACCOUNT',
  'WARRANTY_PROVIDER',
];

interface RelationshipDraft {
  relationshipState: DealerRelationship['relationshipState'];
  escalationOwner: string;
  notes: string;
}

interface CreateRelationshipDraft {
  dealerId: string;
  customerId: string;
  cartVehicleId: string;
  relationshipType: DealerRelationship['relationshipType'];
  relationshipState: Exclude<DealerRelationship['relationshipState'], 'ENDED'>;
  escalationOwner: string;
  notes: string;
}

function customerLookupHref(row: DealerRelationship): string {
  return erpRoute('customer', { search: row.customerEmail || row.customerName });
}

function dealerLookupHref(row: DealerRelationship): string {
  return erpRoute('dealer', { search: row.dealerCode ?? row.dealerName });
}

function workOrderHref(row: DealerRelationship): string {
  return erpRoute('create-work-order', {
    customerId: row.customerId,
    vehicleId: row.cartVehicleId,
  });
}

function relationshipLabel(type: DealerRelationship['relationshipType']): string {
  return type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function dealerOption(dealer: Dealer): SearchableSelectOption {
  return {
    id: dealer.id,
    label: dealer.name,
    description: [dealer.dealerCode, dealer.primaryContact, dealer.contactEmail]
      .filter(Boolean)
      .join(' · '),
    meta: [dealer.territory, dealer.serviceRelationship].filter(Boolean).join(' · '),
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

function optionMatchesSearch(option: SearchableSelectOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [option.label, option.description, option.meta].some((value) =>
    value?.toLowerCase().includes(needle),
  );
}

function cartDetail(row: DealerRelationship): string {
  return [row.vin, row.serialNumber].filter(Boolean).join(' / ') || 'No cart assigned';
}

function customerDetail(row: DealerRelationship): string {
  return [row.customerEmail, row.customerPhone].filter(Boolean).join(' · ');
}

function rowSearchText(row: DealerRelationship): string {
  return [
    row.dealerName,
    row.dealerCode,
    row.territory,
    row.customerName,
    row.customerEmail,
    row.customerPhone,
    row.cartDisplayName,
    row.vin,
    row.serialNumber,
    row.relationshipType,
    row.relationshipState,
    row.escalationOwner,
    row.notes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function relationshipState(row: DealerRelationship): string {
  if (row.relationshipState === 'ENDED') return 'INACTIVE';
  return row.relationshipState;
}

function relationshipDraft(row: DealerRelationship): RelationshipDraft {
  return {
    relationshipState: row.relationshipState,
    escalationOwner: row.escalationOwner ?? '',
    notes: row.notes ?? '',
  };
}

function normalizeRelationshipTypeParam(value: string | null): DealerRelationship['relationshipType'] {
  const candidate = value?.toUpperCase().replace(/[\s-]+/g, '_') as
    | DealerRelationship['relationshipType']
    | undefined;
  return candidate && RELATIONSHIP_TYPE_OPTIONS.includes(candidate)
    ? candidate
    : 'SERVICING_DEALER';
}

function createRelationshipDraft(
  overrides: Partial<CreateRelationshipDraft> = {},
): CreateRelationshipDraft {
  return {
    dealerId: '',
    customerId: '',
    cartVehicleId: '',
    relationshipType: 'SERVICING_DEALER',
    relationshipState: 'ACTIVE',
    escalationOwner: '',
    notes: '',
    ...overrides,
  };
}

export default function RelationshipsPage() {
  const searchParams = useSearchParams();
  const filterCustomerId = searchParams.get('customerId')?.trim() || undefined;
  const prefillVehicleId = searchParams.get('vehicleId')?.trim() ?? '';
  const prefillRelationshipType = normalizeRelationshipTypeParam(
    searchParams.get('relationshipType'),
  );
  const initialCreatePanelOpen = searchParams.get('create') === 'relationship';
  const [relationships, setRelationships] = useState<DealerRelationship[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [editingRelationshipId, setEditingRelationshipId] = useState<string | undefined>();
  const [relationshipEditDraft, setRelationshipEditDraft] = useState<RelationshipDraft | undefined>();
  const [savingRelationshipId, setSavingRelationshipId] = useState<string | undefined>();
  const [relationshipSaveError, setRelationshipSaveError] = useState<string | undefined>();
  const [createPanelOpen, setCreatePanelOpen] = useState(initialCreatePanelOpen);
  const [createDraft, setCreateDraft] = useState<CreateRelationshipDraft>(() =>
    createRelationshipDraft({
      customerId: filterCustomerId ?? '',
      cartVehicleId: prefillVehicleId,
      relationshipType: prefillRelationshipType,
    }),
  );
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [dealerSearch, setDealerSearch] = useState('');
  const [dealersLoading, setDealersLoading] = useState(true);
  const [dealersError, setDealersError] = useState<string | undefined>();
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | undefined>();
  const [customerLoading, setCustomerLoading] = useState(false);
  const [cartVehicles, setCartVehicles] = useState<CartVehicle[]>([]);
  const [cartSearch, setCartSearch] = useState('');
  const [cartLoading, setCartLoading] = useState(false);
  const [cartError, setCartError] = useState<string | undefined>();
  const [creatingRelationship, setCreatingRelationship] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();
  const [createSuccess, setCreateSuccess] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const relationshipResult = await listDealerRelationships(
        { customerId: filterCustomerId, limit: RELATIONSHIP_LIMIT },
        STRICT_LIVE_DATA,
      );
      setRelationships(relationshipResult.items);
      setTotal(relationshipResult.total);
    } catch (err) {
      setRelationships([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : 'Failed to load dealer relationship records.');
    } finally {
      setLoading(false);
    }
  }, [filterCustomerId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    setDealersLoading(true);
    setDealersError(undefined);
    listDealers({ limit: 100 }, STRICT_LIVE_DATA)
      .then((dealerResult) => {
        if (!active) return;
        setDealers(dealerResult.items);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setDealers([]);
        setDealersError(err instanceof Error ? err.message : 'Failed to load dealer accounts.');
      })
      .finally(() => {
        if (!active) return;
        setDealersLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setCartSearch('');
    if (!createDraft.customerId) {
      setCartVehicles([]);
      setCartError(undefined);
      setCartLoading(false);
      return () => {
        active = false;
      };
    }

    setCartLoading(true);
    setCartError(undefined);
    listCartVehicles({ customerId: createDraft.customerId, limit: 100 }, STRICT_LIVE_DATA)
      .then((cartResult) => {
        if (!active) return;
        setCartVehicles(cartResult.items);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setCartVehicles([]);
        setCartError(err instanceof Error ? err.message : 'Failed to load customer carts.');
      })
      .finally(() => {
        if (!active) return;
        setCartLoading(false);
      });

    return () => {
      active = false;
    };
  }, [createDraft.customerId]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return relationships;
    return relationships.filter((row) => rowSearchText(row).includes(query));
  }, [relationships, search]);

  const dealerOptions = useMemo(() => {
    const options = dealers.map(dealerOption);
    return options.filter((option) => optionMatchesSearch(option, dealerSearch));
  }, [dealerSearch, dealers]);
  const selectedDealerOption = useMemo(() => {
    const dealer = dealers.find((item) => item.id === createDraft.dealerId);
    return dealer ? dealerOption(dealer) : undefined;
  }, [createDraft.dealerId, dealers]);
  const cartOptions = useMemo(() => {
    const options = cartVehicles.map(cartOption);
    return options.filter((option) => optionMatchesSearch(option, cartSearch));
  }, [cartSearch, cartVehicles]);
  const selectedCartOption = useMemo(() => {
    const vehicle = cartVehicles.find((item) => item.id === createDraft.cartVehicleId);
    return vehicle ? cartOption(vehicle) : undefined;
  }, [cartVehicles, createDraft.cartVehicleId]);

  const beginRelationshipEdit = (row: DealerRelationship) => {
    setEditingRelationshipId(row.id);
    setRelationshipEditDraft(relationshipDraft(row));
    setRelationshipSaveError(undefined);
  };

  const cancelRelationshipEdit = () => {
    setEditingRelationshipId(undefined);
    setRelationshipEditDraft(undefined);
    setRelationshipSaveError(undefined);
  };

  const saveRelationship = async (row: DealerRelationship) => {
    if (!relationshipEditDraft) return;
    setSavingRelationshipId(row.id);
    setRelationshipSaveError(undefined);
    try {
      const updated = await updateDealerRelationship(row.id, {
        relationshipState: relationshipEditDraft.relationshipState,
        escalationOwner: relationshipEditDraft.escalationOwner || null,
        notes: relationshipEditDraft.notes || null,
      });
      setRelationships((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      cancelRelationshipEdit();
    } catch (err) {
      setRelationshipSaveError(
        err instanceof Error ? err.message : 'Failed to save dealer relationship.',
      );
    } finally {
      setSavingRelationshipId(undefined);
    }
  };

  const resetCreateDraft = () => {
    setCreateDraft(
      createRelationshipDraft({
        customerId: filterCustomerId ?? '',
        cartVehicleId: prefillVehicleId,
        relationshipType: prefillRelationshipType,
      }),
    );
    setSelectedCustomer(undefined);
    setDealerSearch('');
    setCartSearch('');
  };

  const submitCreateRelationship = async () => {
    setCreateError(undefined);
    setCreateSuccess(undefined);
    if (!createDraft.dealerId) {
      setCreateError('Select a dealer account before linking a relationship.');
      return;
    }
    if (!createDraft.customerId) {
      setCreateError('Select an active customer before linking a relationship.');
      return;
    }
    if (customerLoading) {
      setCreateError('Wait for the selected customer to finish loading.');
      return;
    }
    if (!selectedCustomer || selectedCustomer.state !== 'ACTIVE') {
      setCreateError('Only active customer catalog records can be linked to dealer relationships.');
      return;
    }

    setCreatingRelationship(true);
    try {
      const created = await createDealerRelationship({
        dealerId: createDraft.dealerId,
        customerId: createDraft.customerId,
        cartVehicleId: createDraft.cartVehicleId || null,
        relationshipType: createDraft.relationshipType,
        relationshipState: createDraft.relationshipState,
        escalationOwner: createDraft.escalationOwner || null,
        notes: createDraft.notes || null,
      });
      setRelationships((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setTotal((current) => current + 1);
      setCreateSuccess(`Linked ${created.dealerName} to ${created.customerName}.`);
      resetCreateDraft();
      setCreatePanelOpen(false);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'Failed to link dealer relationship.',
      );
    } finally {
      setCreatingRelationship(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Customer-Dealer Relationships"
        description={
          loading
            ? 'Loading live dealer relationship records...'
            : `${total} live dealer relationship records`
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="bg-yellow-400 text-gray-900 hover:bg-yellow-300"
              onClick={() => {
                setCreatePanelOpen((current) => !current);
                setCreateError(undefined);
                setCreateSuccess(undefined);
              }}
            >
              {createPanelOpen ? 'Close Link Form' : 'Link Relationship'}
            </Button>
            <Link href={erpRoute('create-work-order')}>
              <Button variant="outline">
                New Work Order
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search dealer, customer, cart, VIN, serial..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-sm"
        />
        <Link href={erpRoute('dealer')} className="text-sm font-semibold text-gray-700 hover:underline">
          Open dealer accounts
        </Link>
      </div>

      {createSuccess && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {createSuccess}
        </div>
      )}

      {createPanelOpen && (
        <div className="mb-5 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Link Dealer Relationship</h2>
              <p className="mt-1 text-sm text-gray-600">
                Create a live dealer/customer assignment for service, billing, warranty, or account ownership.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetCreateDraft();
                setCreateError(undefined);
              }}
            >
              Reset
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SearchableSelect
              id="dealerRelationshipDealer"
              label="Dealer Account"
              required
              value={createDraft.dealerId}
              selectedOption={selectedDealerOption}
              searchValue={dealerSearch}
              options={dealerOptions}
              loading={dealersLoading}
              error={dealersError}
              placeholder="Search dealer by account, contact, email, or territory"
              emptyText="No live dealer account matched. Create or activate the dealer account first."
              onSearchChange={setDealerSearch}
              onChange={(dealerId) =>
                setCreateDraft((current) => ({
                  ...current,
                  dealerId,
                }))
              }
            />

            <CustomerSelector
              id="dealerRelationshipCustomer"
              label="Customer"
              required
              value={createDraft.customerId}
              onLoadingChange={setCustomerLoading}
              onResolvedCustomer={setSelectedCustomer}
              onChange={(customerId, customer) => {
                setCreateDraft((current) => ({
                  ...current,
                  customerId,
                  cartVehicleId: '',
                }));
                setSelectedCustomer(customer);
              }}
            />

            <SearchableSelect
              id="dealerRelationshipCart"
              label="Customer Cart"
              value={createDraft.cartVehicleId}
              selectedOption={selectedCartOption}
              searchValue={cartSearch}
              options={cartOptions}
              loading={cartLoading}
              error={cartError}
              placeholder="Optional cart, VIN, serial, or model"
              emptyText={
                createDraft.customerId
                  ? 'No carts are registered for this customer. Leave blank for a customer-level relationship.'
                  : 'Select a customer before choosing a cart.'
              }
              onSearchChange={setCartSearch}
              onChange={(cartVehicleId) =>
                setCreateDraft((current) => ({
                  ...current,
                  cartVehicleId,
                }))
              }
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-gray-700">
                Type
                <select
                  value={createDraft.relationshipType}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      relationshipType: event.target.value as DealerRelationship['relationshipType'],
                    }))
                  }
                  className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
                >
                  {RELATIONSHIP_TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>
                      {relationshipLabel(type)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-medium text-gray-700">
                State
                <select
                  value={createDraft.relationshipState}
                  onChange={(event) =>
                    setCreateDraft((current) => ({
                      ...current,
                      relationshipState: event.target.value as CreateRelationshipDraft['relationshipState'],
                    }))
                  }
                  className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
                >
                  {CREATE_RELATIONSHIP_STATE_OPTIONS.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="text-sm font-medium text-gray-700">
              Escalation Owner
              <Input
                value={createDraft.escalationOwner}
                onChange={(event) =>
                  setCreateDraft((current) => ({
                    ...current,
                    escalationOwner: event.target.value,
                  }))
                }
                placeholder="Manager or owner"
                className="mt-1"
              />
            </label>

            <label className="text-sm font-medium text-gray-700 lg:col-span-2">
              Notes
              <textarea
                value={createDraft.notes}
                onChange={(event) =>
                  setCreateDraft((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                rows={2}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                placeholder="Service coverage, billing context, warranty instructions"
              />
            </label>
          </div>

          {createError && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {createError}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              className="bg-yellow-400 text-gray-900 hover:bg-yellow-300"
              disabled={creatingRelationship || customerLoading || dealersLoading || cartLoading}
              onClick={() => void submitCreateRelationship()}
            >
              {creatingRelationship ? 'Linking...' : 'Create Relationship'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCreatePanelOpen(false);
                setCreateError(undefined);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton rows={5} cols={5} />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          icon="🔗"
          title={search ? 'No relationship records matched' : 'No dealer relationships'}
          description={
            search
              ? `No live relationship record matches "${search}".`
              : 'Create dealer accounts or link customer carts to a dealer to populate this view.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Dealer</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Cart</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">VIN / Serial</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Relationship</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRows.map((row) => {
                const isEditing = editingRelationshipId === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{row.dealerName}</div>
                        <div className="text-xs text-gray-500">
                          {[row.dealerCode, row.territory].filter(Boolean).join(' · ') || 'Dealer account'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">
                          {row.customerName}
                        </div>
                        <div className="text-xs text-gray-500">{customerDetail(row) || 'Customer contact missing'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{row.cartDisplayName ?? 'Customer account'}</div>
                        <div className="text-xs text-gray-500">{row.cartState ?? 'No cart status'}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        <div>{cartDetail(row)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="mb-1 text-gray-700">{relationshipLabel(row.relationshipType)}</div>
                        <StatusBadge status={relationshipState(row)} />
                        <div className="mt-2 text-xs text-gray-500">
                          {row.escalationOwner ? `Owner: ${row.escalationOwner}` : 'No escalation owner'}
                        </div>
                        {row.notes && <div className="mt-1 text-xs text-gray-500">{row.notes}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <Link href={dealerLookupHref(row)} className="font-semibold text-gray-900 hover:underline">
                            Open dealer
                          </Link>
                          <Link href={customerLookupHref(row)} className="font-semibold text-gray-900 hover:underline">
                            Open customer
                          </Link>
                          <Link href={workOrderHref(row)} className="font-semibold text-gray-900 hover:underline">
                            Start work order
                          </Link>
                          <button
                            type="button"
                            onClick={() => beginRelationshipEdit(row)}
                            className="font-semibold text-gray-900 hover:underline"
                          >
                            Update relationship
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isEditing && relationshipEditDraft && (
                      <tr>
                        <td colSpan={6} className="border-t border-yellow-200 bg-yellow-50 px-4 py-4">
                          <div className="grid gap-3 md:grid-cols-[180px_220px_1fr_auto] md:items-end">
                            <label className="text-sm font-medium text-gray-700">
                              State
                              <select
                                value={relationshipEditDraft.relationshipState}
                                onChange={(event) =>
                                  setRelationshipEditDraft((current) =>
                                    current
                                      ? {
                                          ...current,
                                          relationshipState: event.target.value as DealerRelationship['relationshipState'],
                                        }
                                      : current,
                                  )
                                }
                                className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
                              >
                                {RELATIONSHIP_STATE_OPTIONS.map((state) => (
                                  <option key={state} value={state}>
                                    {state}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-sm font-medium text-gray-700">
                              Escalation Owner
                              <Input
                                value={relationshipEditDraft.escalationOwner}
                                onChange={(event) =>
                                  setRelationshipEditDraft((current) =>
                                    current ? { ...current, escalationOwner: event.target.value } : current,
                                  )
                                }
                                placeholder="Manager or owner"
                                className="mt-1"
                              />
                            </label>
                            <label className="text-sm font-medium text-gray-700">
                              Notes
                              <textarea
                                value={relationshipEditDraft.notes}
                                onChange={(event) =>
                                  setRelationshipEditDraft((current) =>
                                    current ? { ...current, notes: event.target.value } : current,
                                  )
                                }
                                rows={2}
                                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                                placeholder="Service coverage, billing context, warranty instructions"
                              />
                            </label>
                            <div className="flex gap-2 md:justify-end">
                              <Button
                                type="button"
                                className="bg-yellow-400 text-gray-900 hover:bg-yellow-300"
                                disabled={savingRelationshipId === row.id}
                                onClick={() => void saveRelationship(row)}
                              >
                                {savingRelationshipId === row.id ? 'Saving...' : 'Save Relationship'}
                              </Button>
                              <Button type="button" variant="outline" onClick={cancelRelationshipEdit}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                          {relationshipSaveError && (
                            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                              {relationshipSaveError}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
